/**
 * Sedes, horarios, excepciones y cálculo de disponibilidad.
 *
 * Este service es el que reúne los datos que necesita el motor de
 * disponibilidad (`disponibilidad.ts`) y le añade lo que el motor no sabe: qué
 * dice la base y qué permisos tiene quien pregunta.
 */

import {
  formatearMinutos,
  type DatosExcepcion,
  type DatosHorario,
  type DatosSede,
  type DisponibilidadDelDia,
  type Excepcion,
  type Horario,
  type MedicoResumen,
  type Sede,
  type TipoExcepcion,
} from '@consultorio/shared'
import type { Prisma } from '@prisma/client'
import { registrarAuditoria } from '../../core/auditoria.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorConflicto, ErrorNoEncontrado } from '../../core/errores.js'
import { exigirPermiso } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'
import { aFechaLocal, aInstante, diaDeLaSemana, hoyLocal, ZONA_POR_DEFECTO } from '../../core/tiempo.js'
import { calcularHuecos, type Excepcion as ExcepcionMotor, type Franja } from './disponibilidad.js'

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

// =============================================================================
//  Configuración de la clínica
// =============================================================================

interface ConfiguracionAgenda {
  zonaHoraria: string
  duracionPorDefecto: number
}

let configuracionCacheada: ConfiguracionAgenda | null = null

/**
 * Zona horaria y duración por defecto.
 *
 * Se cachea: se consulta en cada cálculo de disponibilidad y cambia como mucho
 * una vez al año. `olvidarConfiguracion()` la invalida cuando se edita.
 */
export async function configuracionAgenda(): Promise<ConfiguracionAgenda> {
  if (configuracionCacheada) return configuracionCacheada

  const ajustes = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { timezone: true, defaultSlotMinutes: true },
  })

  configuracionCacheada = {
    zonaHoraria: ajustes?.timezone ?? ZONA_POR_DEFECTO,
    duracionPorDefecto: ajustes?.defaultSlotMinutes ?? 20,
  }
  return configuracionCacheada
}

export function olvidarConfiguracion(): void {
  configuracionCacheada = null
}

// =============================================================================
//  Sedes
// =============================================================================

const aSede = (fila: {
  id: string
  name: string
  address: string
  phone: string | null
  isActive: boolean
}): Sede => ({
  id: fila.id,
  nombre: fila.name,
  direccion: fila.address,
  telefono: fila.phone,
  activa: fila.isActive,
})

export async function listarSedes(ctx: ContextoAuth): Promise<Sede[]> {
  // Basta con poder ver la agenda: recepción necesita saber en qué sede es
  // cada cita, aunque no pueda administrar las sedes.
  exigirPermiso(ctx, 'appointment:read')

  const filas = await prisma.location.findMany({ orderBy: { name: 'asc' } })
  return filas.map(aSede)
}

export async function crearSede(
  ctx: ContextoAuth,
  datos: DatosSede,
  cliente: DatosCliente,
): Promise<Sede> {
  exigirPermiso(ctx, 'location:manage')

  const creada = await prisma.location.create({
    data: {
      name: datos.nombre,
      address: datos.direccion,
      phone: datos.telefono?.trim() || null,
    },
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'Location',
    entidadId: creada.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'location:manage',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aSede(creada)
}

export async function actualizarSede(
  ctx: ContextoAuth,
  id: string,
  datos: Partial<DatosSede> & { activa?: boolean },
): Promise<Sede> {
  exigirPermiso(ctx, 'location:manage')

  const cambios: Prisma.LocationUpdateInput = {}
  if (datos.nombre !== undefined) cambios.name = datos.nombre
  if (datos.direccion !== undefined) cambios.address = datos.direccion
  if (datos.telefono !== undefined) cambios.phone = datos.telefono.trim() || null
  if (datos.activa !== undefined) cambios.isActive = datos.activa

  const { count } = await prisma.location.updateMany({ where: { id }, data: cambios })
  if (count === 0) throw new ErrorNoEncontrado('No se encontró la sede')

  return aSede(await prisma.location.findUniqueOrThrow({ where: { id } }))
}

// =============================================================================
//  Médicos (resumen para la agenda)
// =============================================================================

export async function listarMedicos(ctx: ContextoAuth): Promise<MedicoResumen[]> {
  exigirPermiso(ctx, 'appointment:read')

  const filas = await prisma.doctor.findMany({
    include: { user: { select: { firstName: true, lastName: true, isActive: true } } },
    orderBy: { user: { lastName: 'asc' } },
  })

  return filas
    .filter((d) => d.user.isActive)
    .map((d) => ({
      id: d.id,
      nombre: `${d.user.firstName} ${d.user.lastName}`,
      especialidad: d.specialty,
      color: d.colorCode,
      duracionCitaMinutos: d.defaultSlotMinutes,
      activo: d.isActive,
    }))
}

// =============================================================================
//  Horarios
// =============================================================================

const aHorario = (fila: {
  id: string
  doctorId: string
  dayOfWeek: number
  startMinute: number
  endMinute: number
  slotMinutes: number | null
  locationId: string | null
  isActive: boolean
  doctor: { user: { firstName: string; lastName: string } }
  location: { name: string } | null
}): Horario => ({
  id: fila.id,
  medicoId: fila.doctorId,
  medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,
  diaSemana: fila.dayOfWeek,
  inicioMinuto: fila.startMinute,
  finMinuto: fila.endMinute,
  slotMinutos: fila.slotMinutes,
  sedeId: fila.locationId,
  sedeNombre: fila.location?.name ?? null,
  activo: fila.isActive,
})

const INCLUIR_HORARIO = {
  doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
  location: { select: { name: true } },
} satisfies Prisma.ScheduleInclude

export async function listarHorarios(
  ctx: ContextoAuth,
  medicoId?: string,
): Promise<Horario[]> {
  exigirPermiso(ctx, 'appointment:read')

  const filas = await prisma.schedule.findMany({
    where: medicoId ? { doctorId: medicoId } : {},
    include: INCLUIR_HORARIO,
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  })

  return filas.map(aHorario)
}

/**
 * Crea una franja de atención.
 *
 * El no-solapamiento lo garantiza el constraint de exclusión de la base, que
 * resiste a dos administradores guardando a la vez. Aquí solo se traduce ese
 * choque a un mensaje que se entienda: el manejador de errores ya convierte
 * `Schedule_sin_solapamiento` en "ese horario se superpone con otra franja".
 */
export async function crearHorario(
  ctx: ContextoAuth,
  datos: DatosHorario,
  cliente: DatosCliente,
): Promise<Horario> {
  exigirPermiso(ctx, 'schedule:manage')

  const creado = await prisma.schedule.create({
    data: {
      doctorId: datos.medicoId,
      dayOfWeek: datos.diaSemana,
      startMinute: datos.inicioMinuto,
      endMinute: datos.finMinuto,
      slotMinutes: datos.slotMinutos ?? null,
      locationId: datos.sedeId?.trim() || null,
    },
    include: INCLUIR_HORARIO,
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'Schedule',
    entidadId: creado.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'schedule:manage',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aHorario(creado)
}

/**
 * Elimina una franja.
 *
 * Se comprueba que no queden citas futuras dentro de ella: borrar el horario
 * de los martes por la mañana con doce pacientes ya citados los dejaría en una
 * hora que el sistema considera inexistente, y nadie se enteraría hasta que
 * llegaran.
 */
export async function eliminarHorario(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<void> {
  exigirPermiso(ctx, 'schedule:manage')

  const horario = await prisma.schedule.findUnique({ where: { id } })
  if (!horario) throw new ErrorNoEncontrado('No se encontró el horario')

  const { zonaHoraria } = await configuracionAgenda()
  const citasFuturas = await contarCitasFuturasEnFranja(horario, zonaHoraria)

  if (citasFuturas > 0) {
    throw new ErrorConflicto(
      `No se puede eliminar: hay ${citasFuturas} ${citasFuturas === 1 ? 'cita' : 'citas'} agendadas en esa franja. ` +
        'Reprográmalas o cancélalas antes.',
    )
  }

  await prisma.schedule.delete({ where: { id } })

  await registrarAuditoria({
    accion: 'DELETE',
    entidad: 'Schedule',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'schedule:manage',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })
}

async function contarCitasFuturasEnFranja(
  horario: { doctorId: string; dayOfWeek: number; startMinute: number; endMinute: number },
  zonaHoraria: string,
): Promise<number> {
  const futuras = await prisma.appointment.findMany({
    where: {
      doctorId: horario.doctorId,
      startsAt: { gte: new Date() },
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] },
    },
    select: { startsAt: true },
  })

  return futuras.filter((cita) => {
    const fecha = aFechaLocal(cita.startsAt, zonaHoraria)
    if (diaDeLaSemana(fecha) !== horario.dayOfWeek) return false

    const inicioFranja = aInstante(fecha, horario.startMinute, zonaHoraria)
    const finFranja = aInstante(fecha, horario.endMinute, zonaHoraria)
    return cita.startsAt >= inicioFranja && cita.startsAt < finFranja
  }).length
}

// =============================================================================
//  Excepciones
// =============================================================================

/**
 * El esquema de datos usa nombres en inglés (convención del ORM y del futuro
 * mapeo FHIR) y los contratos de la interfaz, en español. La traducción vive
 * aquí, en un solo sitio, en lugar de repartirse por controladores y vistas.
 */
const TIPO_A_BASE = { AUSENTE: 'UNAVAILABLE', EXTRA: 'EXTRA' } as const
const TIPO_DESDE_BASE = { UNAVAILABLE: 'AUSENTE', EXTRA: 'EXTRA' } as const

const aExcepcion = (fila: {
  id: string
  doctorId: string
  date: Date
  type: string
  startMinute: number | null
  endMinute: number | null
  reason: string | null
}): Excepcion => ({
  id: fila.id,
  medicoId: fila.doctorId,
  // `date` es un DATE de PostgreSQL: se lee en UTC para no desplazar el día.
  fecha: fila.date.toISOString().slice(0, 10),
  tipo: TIPO_DESDE_BASE[fila.type as keyof typeof TIPO_DESDE_BASE] as TipoExcepcion,
  inicioMinuto: fila.startMinute,
  finMinuto: fila.endMinute,
  motivo: fila.reason,
})

export async function listarExcepciones(
  ctx: ContextoAuth,
  medicoId?: string,
  desde?: string,
): Promise<Excepcion[]> {
  exigirPermiso(ctx, 'appointment:read')

  const filas = await prisma.scheduleException.findMany({
    where: {
      ...(medicoId ? { doctorId: medicoId } : {}),
      ...(desde ? { date: { gte: new Date(`${desde}T00:00:00Z`) } } : {}),
    },
    orderBy: { date: 'asc' },
  })

  return filas.map(aExcepcion)
}

export async function crearExcepcion(
  ctx: ContextoAuth,
  datos: DatosExcepcion,
  cliente: DatosCliente,
): Promise<Excepcion> {
  exigirPermiso(ctx, 'schedule:manage')

  const creada = await prisma.scheduleException.create({
    data: {
      doctorId: datos.medicoId,
      // Se ancla a medianoche UTC porque la columna es DATE: cualquier otra
      // hora la desplazaría un día según el huso del servidor.
      date: new Date(`${datos.fecha}T00:00:00Z`),
      type: TIPO_A_BASE[datos.tipo],
      startMinute: datos.inicioMinuto ?? null,
      endMinute: datos.finMinuto ?? null,
      reason: datos.motivo?.trim() || null,
    },
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'ScheduleException',
    entidadId: creada.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'schedule:manage',
    motivo: datos.motivo || undefined,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aExcepcion(creada)
}

export async function eliminarExcepcion(ctx: ContextoAuth, id: string): Promise<void> {
  exigirPermiso(ctx, 'schedule:manage')

  const { count } = await prisma.scheduleException.deleteMany({ where: { id } })
  if (count === 0) throw new ErrorNoEncontrado('No se encontró la excepción')
}

// =============================================================================
//  Disponibilidad
// =============================================================================

/**
 * Huecos libres de un médico en un día.
 *
 * Reúne lo que el motor necesita y traduce el resultado vacío a un motivo
 * concreto. Un calendario que solo dice "no hay horas" obliga a la
 * recepcionista a adivinar si el médico libra, está completo o simplemente no
 * trabaja ese día — y a llamar a alguien para averiguarlo.
 */
export async function disponibilidadDelDia(
  ctx: ContextoAuth,
  medicoId: string,
  fecha: string,
  duracionPedida?: number,
  ahora = new Date(),
): Promise<DisponibilidadDelDia> {
  exigirPermiso(ctx, 'appointment:read')

  const { zonaHoraria, duracionPorDefecto } = await configuracionAgenda()

  const medico = await prisma.doctor.findUnique({
    where: { id: medicoId },
    select: { defaultSlotMinutes: true, isActive: true },
  })
  if (!medico) throw new ErrorNoEncontrado('No se encontró el médico')

  const duracionMinutos = duracionPedida ?? medico.defaultSlotMinutes ?? duracionPorDefecto

  const [horarios, excepciones, citas] = await Promise.all([
    prisma.schedule.findMany({ where: { doctorId: medicoId, isActive: true } }),
    prisma.scheduleException.findMany({
      where: { doctorId: medicoId, date: new Date(`${fecha}T00:00:00Z`) },
    }),
    prisma.appointment.findMany({
      where: {
        doctorId: medicoId,
        // Se pide una ventana amplia y el motor descarta lo que no es del día:
        // una cita que empieza a las 23:40 puede terminar al día siguiente.
        startsAt: {
          gte: aInstante(fecha, 0, zonaHoraria),
          lt: aInstante(fecha, 1440, zonaHoraria),
        },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { startsAt: true, endsAt: true },
    }),
  ])

  const franjas: Franja[] = horarios.map((h) => ({
    diaSemana: h.dayOfWeek,
    inicioMinuto: h.startMinute,
    finMinuto: h.endMinute,
    ...(h.slotMinutes !== null ? { slotMinutos: h.slotMinutes } : {}),
    ...(h.locationId !== null ? { sedeId: h.locationId } : {}),
  }))

  const excepcionesMotor: ExcepcionMotor[] = excepciones.map((e) => ({
    tipo: e.type === 'EXTRA' ? 'EXTRA' : 'AUSENTE',
    ...(e.startMinute !== null ? { inicioMinuto: e.startMinute } : {}),
    ...(e.endMinute !== null ? { finMinuto: e.endMinute } : {}),
  }))

  const huecos = calcularHuecos({
    fecha,
    zonaHoraria,
    franjas,
    excepciones: excepcionesMotor,
    ocupadas: citas.map((c) => ({ inicio: c.startsAt, fin: c.endsAt })),
    duracionMinutos,
    ahora,
  })

  return {
    fecha,
    medicoId,
    duracionMinutos,
    huecos: huecos.map((h) => ({
      inicio: h.inicio.toISOString(),
      fin: h.fin.toISOString(),
      hora: formatearMinutos(h.inicioMinuto),
      sedeId: h.sedeId ?? null,
    })),
    motivoSinHuecos:
      huecos.length > 0
        ? null
        : diagnosticarAusenciaDeHuecos({
            fecha,
            hoy: hoyLocal(zonaHoraria, ahora),
            franjas,
            excepciones: excepcionesMotor,
            hayCitas: citas.length > 0,
          }),
  }
}

/**
 * Por qué no hay huecos.
 *
 * El orden importa: se comprueba de la causa más definitiva a la más
 * circunstancial, para que el mensaje sea el que de verdad explica la
 * situación y no el primero que encaje.
 */
function diagnosticarAusenciaDeHuecos(datos: {
  fecha: string
  hoy: string
  franjas: Franja[]
  excepciones: ExcepcionMotor[]
  hayCitas: boolean
}): DisponibilidadDelDia['motivoSinHuecos'] {
  if (datos.fecha < datos.hoy) return 'dia_pasado'

  if (datos.excepciones.some((e) => e.tipo === 'AUSENTE')) return 'ausente'

  const diaObjetivo = diaDeLaSemana(datos.fecha)
  const trabajaEseDia =
    datos.franjas.some((f) => f.diaSemana === diaObjetivo) ||
    datos.excepciones.some((e) => e.tipo === 'EXTRA')

  if (!trabajaEseDia) return 'sin_horario'

  return datos.hayCitas ? 'completo' : 'sin_horario'
}
