/**
 * Lógica de citas.
 *
 * Tres capas de defensa contra el doble agendamiento, de fuera hacia dentro:
 *
 *   1. La web solo ofrece huecos que el motor calculó como libres.
 *   2. Este service revalida contra el motor antes de escribir, porque la
 *      pantalla pudo quedarse desactualizada.
 *   3. El constraint de exclusión de la base lo garantiza de verdad, incluso
 *      con dos recepcionistas pulsando en el mismo milisegundo.
 *
 * Las dos primeras existen para dar un mensaje que se entienda. La tercera es
 * la que impide que ocurra.
 */

import {
  esEstadoFinal,
  ocupaHorario,
  puedeTransicionar,
  type Cita,
  type DatosCrearCita,
  type EstadoCita,
  type Modalidad,
  type OrigenCancelacion,
} from '@consultorio/shared'
import type { AppointmentStatus, Prisma } from '@prisma/client'
import { registrarAuditoria } from '../../core/auditoria.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorConflicto, ErrorNoEncontrado, ErrorProhibido } from '../../core/errores.js'
import { contextoPuede, exigirPermiso } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'
import {
  aFechaLocal,
  aInstante,
  aMinutosLocales,
  formatearMinutos,
  sumarDiasLocal,
} from '../../core/tiempo.js'
import { configuracionAgenda, disponibilidadDelDia } from '../agenda/agenda.service.js'
import { RepositorioCitas, type FilaCita } from './citas.repository.js'

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

// --- Conversión --------------------------------------------------------------

function aCita(fila: FilaCita, zonaHoraria: string): Cita {
  const duracionMinutos = Math.round((fila.endsAt.getTime() - fila.startsAt.getTime()) / 60_000)

  return {
    id: fila.id,
    inicio: fila.startsAt.toISOString(),
    fin: fila.endsAt.toISOString(),
    fecha: aFechaLocal(fila.startsAt, zonaHoraria),
    hora: formatearMinutos(aMinutosLocales(fila.startsAt, zonaHoraria)),
    horaFin: formatearMinutos(aMinutosLocales(fila.endsAt, zonaHoraria)),
    duracionMinutos,

    estado: fila.status as EstadoCita,
    modalidad: fila.modality as Modalidad,
    sobreagendada: fila.allowOverbook,

    pacienteId: fila.patient.id,
    pacienteNombre: `${fila.patient.firstName} ${fila.patient.lastName}`,
    pacienteDocumento: fila.patient.document,
    pacienteTelefono: fila.patient.phone,
    pacienteAlergias: fila.patient.allergies,

    medicoId: fila.doctor.id,
    medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,
    medicoColor: fila.doctor.colorCode,

    sedeId: fila.location?.id ?? null,
    sedeNombre: fila.location?.name ?? null,

    motivo: fila.reason,
    notas: fila.notes,

    llegadaEn: fila.arrivedAt?.toISOString() ?? null,
    confirmadaEn: fila.confirmedAt?.toISOString() ?? null,
    canceladaEn: fila.cancelledAt?.toISOString() ?? null,
    motivoCancelacion: fila.cancelReason,
  }
}

// --- Consulta ----------------------------------------------------------------

export async function listar(
  ctx: ContextoAuth,
  filtros: {
    desde: string
    hasta?: string
    medicoId?: string
    sedeId?: string
    pacienteId?: string
    incluirCanceladas: boolean
  },
): Promise<{ citas: Cita[]; desde: string; hasta: string }> {
  const { zonaHoraria } = await configuracionAgenda()
  const repositorio = new RepositorioCitas(ctx)

  const hasta = filtros.hasta ?? filtros.desde

  const filas = await repositorio.enRango({
    desde: aInstante(filtros.desde, 0, zonaHoraria),
    // El límite superior es la medianoche del día SIGUIENTE al último pedido,
    // porque el rango es exclusivo por arriba. Sin el +1, pedir un solo día
    // devolvería una lista vacía.
    hasta: aInstante(sumarDiasLocal(hasta, 1), 0, zonaHoraria),
    ...(filtros.medicoId ? { medicoId: filtros.medicoId } : {}),
    ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
    ...(filtros.pacienteId ? { pacienteId: filtros.pacienteId } : {}),
    incluirCanceladas: filtros.incluirCanceladas,
  })

  return { citas: filas.map((f) => aCita(f, zonaHoraria)), desde: filtros.desde, hasta }
}

export async function porId(ctx: ContextoAuth, id: string): Promise<Cita> {
  const { zonaHoraria } = await configuracionAgenda()
  const fila = await new RepositorioCitas(ctx).porId(id)

  // 404 y no 403 cuando existe pero está fuera del alcance: decir "existe pero
  // no puedes verla" ya revela que ese médico atiende a ese paciente.
  if (!fila) throw new ErrorNoEncontrado('No se encontró la cita')

  return aCita(fila, zonaHoraria)
}

export async function proximasDePaciente(ctx: ContextoAuth, pacienteId: string): Promise<Cita[]> {
  const { zonaHoraria } = await configuracionAgenda()
  const filas = await new RepositorioCitas(ctx).proximasDePaciente(pacienteId)
  return filas.map((f) => aCita(f, zonaHoraria))
}

// --- Creación ----------------------------------------------------------------

/**
 * Comprueba que la hora elegida siga libre.
 *
 * Se salta solo con `sobreagendar` y el permiso correspondiente. Sin permiso,
 * pedir sobreagenda es un 403 explícito y no un silencioso "no está
 * disponible": quien lo intenta merece saber que la acción existe y que le
 * falta autorización, no creer que el hueco está ocupado.
 */
async function validarHueco(
  ctx: ContextoAuth,
  medicoId: string,
  inicio: Date,
  duracionMinutos: number,
  sobreagendar: boolean,
  excluirCitaId?: string,
): Promise<void> {
  if (sobreagendar) {
    if (!contextoPuede(ctx, 'appointment:overbook')) {
      throw new ErrorProhibido('No tienes permiso para agendar fuera del horario disponible', {
        permiso: 'appointment:overbook',
      })
    }
    return
  }

  const { zonaHoraria } = await configuracionAgenda()
  const fecha = aFechaLocal(inicio, zonaHoraria)

  const disponibilidad = await disponibilidadDelDia(ctx, medicoId, fecha, duracionMinutos)
  const libre = disponibilidad.huecos.some((h) => new Date(h.inicio).getTime() === inicio.getTime())

  if (libre) return

  // Al reprogramar, la propia cita ocupa su hueco actual: mover una cita a la
  // hora que ya tiene no debe rechazarse.
  if (excluirCitaId) {
    const actual = await prisma.appointment.findUnique({
      where: { id: excluirCitaId },
      select: { startsAt: true },
    })
    if (actual && actual.startsAt.getTime() === inicio.getTime()) return
  }

  const hora = formatearMinutos(aMinutosLocales(inicio, zonaHoraria))
  throw new ErrorConflicto(
    `Las ${hora} ya no están disponibles. Elige otra hora o marca la cita como sobreagenda.`,
  )
}

export async function crear(
  ctx: ContextoAuth,
  datos: DatosCrearCita,
  cliente: DatosCliente,
): Promise<Cita> {
  exigirPermiso(ctx, 'appointment:create')

  const { zonaHoraria, duracionPorDefecto } = await configuracionAgenda()

  const [paciente, medico] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: datos.pacienteId, deletedAt: null },
      select: { id: true },
    }),
    prisma.doctor.findUnique({
      where: { id: datos.medicoId },
      select: { id: true, isActive: true, defaultSlotMinutes: true },
    }),
  ])

  if (!paciente) throw new ErrorNoEncontrado('No se encontró el paciente')
  if (!medico) throw new ErrorNoEncontrado('No se encontró el médico')
  if (!medico.isActive) throw new ErrorConflicto('Ese médico ya no atiende en la clínica')

  // Un médico solo agenda en su propia agenda. Recepción, en la de todos.
  if (!contextoPuede(ctx, 'appointment:create', 'all') && ctx.doctorId !== datos.medicoId) {
    throw new ErrorProhibido('Solo puedes agendar citas en tu propia agenda')
  }

  const duracionMinutos = datos.duracionMinutos ?? medico.defaultSlotMinutes ?? duracionPorDefecto
  const inicio = new Date(datos.inicio)
  const fin = new Date(inicio.getTime() + duracionMinutos * 60_000)

  if (inicio < new Date()) {
    throw new ErrorConflicto('No se puede agendar una cita en el pasado')
  }

  await validarHueco(ctx, datos.medicoId, inicio, duracionMinutos, datos.sobreagendar)

  const creada = await new RepositorioCitas(ctx).crear({
    patient: { connect: { id: datos.pacienteId } },
    doctor: { connect: { id: datos.medicoId } },
    ...(datos.sedeId?.trim() ? { location: { connect: { id: datos.sedeId } } } : {}),
    startsAt: inicio,
    endsAt: fin,
    modality: datos.modalidad,
    allowOverbook: datos.sobreagendar,
    reason: datos.motivo?.trim() || null,
    notes: datos.notas?.trim() || null,
    createdById: ctx.usuarioId,
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'Appointment',
    entidadId: creada.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'appointment:create',
    ...(datos.sobreagendar ? { motivo: 'sobreagenda autorizada' } : {}),
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aCita(creada, zonaHoraria)
}

// --- Cambios de estado -------------------------------------------------------

/** Permiso necesario para llegar a cada estado. */
const PERMISO_POR_ESTADO: Record<EstadoCita, Parameters<typeof exigirPermiso>[1]> = {
  SCHEDULED: 'appointment:update',
  CONFIRMED: 'appointment:update',
  ARRIVED: 'appointment:checkin',
  IN_ATTENTION: 'encounter:create',
  COMPLETED: 'encounter:complete',
  CANCELLED: 'appointment:cancel',
  NO_SHOW: 'appointment:update',
}

async function cambiarEstado(
  ctx: ContextoAuth,
  id: string,
  nuevoEstado: EstadoCita,
  extras: Prisma.AppointmentUpdateInput,
  cliente: DatosCliente,
  motivoAuditoria?: string,
): Promise<Cita> {
  exigirPermiso(ctx, PERMISO_POR_ESTADO[nuevoEstado])

  const { zonaHoraria } = await configuracionAgenda()
  const repositorio = new RepositorioCitas(ctx)

  const actual = await repositorio.porId(id)
  if (!actual) throw new ErrorNoEncontrado('No se encontró la cita')

  const estadoActual = actual.status as EstadoCita

  if (estadoActual === nuevoEstado) {
    // Pulsar dos veces "confirmar" no es un error: se devuelve la cita tal
    // como está en lugar de un mensaje que confunda a quien no notó el primer
    // clic.
    return aCita(actual, zonaHoraria)
  }

  if (!puedeTransicionar(estadoActual, nuevoEstado)) {
    throw new ErrorConflicto(
      `Una cita ${esEstadoFinal(estadoActual) ? 'ya cerrada' : 'en ese estado'} no puede pasar a "${nuevoEstado}".`,
    )
  }

  const actualizada = await repositorio.actualizar(id, { status: nuevoEstado, ...extras })
  if (!actualizada) throw new ErrorNoEncontrado('No se encontró la cita')

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Appointment',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: PERMISO_POR_ESTADO[nuevoEstado],
    cambios: { estado: { de: estadoActual, a: nuevoEstado } },
    ...(motivoAuditoria ? { motivo: motivoAuditoria } : {}),
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aCita(actualizada, zonaHoraria)
}

export const confirmar = (ctx: ContextoAuth, id: string, cliente: DatosCliente) =>
  cambiarEstado(ctx, id, 'CONFIRMED', { confirmedAt: new Date() }, cliente)

export const registrarLlegada = (ctx: ContextoAuth, id: string, cliente: DatosCliente) =>
  cambiarEstado(ctx, id, 'ARRIVED', { arrivedAt: new Date() }, cliente)

export const marcarInasistencia = (ctx: ContextoAuth, id: string, cliente: DatosCliente) =>
  cambiarEstado(ctx, id, 'NO_SHOW', {}, cliente)

export const cancelar = (
  ctx: ContextoAuth,
  id: string,
  motivo: string,
  origen: OrigenCancelacion,
  cliente: DatosCliente,
) =>
  cambiarEstado(
    ctx,
    id,
    'CANCELLED',
    { cancelledAt: new Date(), cancelReason: motivo, cancelledBy: origen },
    cliente,
    `cancelada por ${origen === 'PATIENT' ? 'el paciente' : 'la clínica'}: ${motivo}`,
  )

// --- Reprogramación ----------------------------------------------------------

export async function reprogramar(
  ctx: ContextoAuth,
  id: string,
  datos: { inicio: string; duracionMinutos?: number; medicoId?: string; sobreagendar: boolean },
  cliente: DatosCliente,
): Promise<Cita> {
  exigirPermiso(ctx, 'appointment:reschedule')

  const { zonaHoraria, duracionPorDefecto } = await configuracionAgenda()
  const repositorio = new RepositorioCitas(ctx)

  const actual = await repositorio.porId(id)
  if (!actual) throw new ErrorNoEncontrado('No se encontró la cita')

  const estadoActual = actual.status as EstadoCita
  if (esEstadoFinal(estadoActual)) {
    throw new ErrorConflicto(
      'Esa cita ya está cerrada. Agenda una nueva en lugar de reprogramarla.',
    )
  }
  if (estadoActual === 'IN_ATTENTION') {
    throw new ErrorConflicto('No se puede mover una cita que ya está en atención')
  }

  const medicoId = datos.medicoId ?? actual.doctorId
  const duracionActual = Math.round(
    (actual.endsAt.getTime() - actual.startsAt.getTime()) / 60_000,
  )
  const duracionMinutos = datos.duracionMinutos ?? duracionActual ?? duracionPorDefecto

  const inicio = new Date(datos.inicio)
  if (inicio < new Date()) throw new ErrorConflicto('No se puede reprogramar hacia el pasado')

  await validarHueco(ctx, medicoId, inicio, duracionMinutos, datos.sobreagendar, id)

  const actualizada = await repositorio.actualizar(id, {
    startsAt: inicio,
    endsAt: new Date(inicio.getTime() + duracionMinutos * 60_000),
    // Campo escalar y no `doctor: { connect }`: el repositorio usa updateMany
    // para respetar el alcance, y updateMany no admite escrituras anidadas.
    ...(datos.medicoId ? { doctorId: datos.medicoId } : {}),
    allowOverbook: datos.sobreagendar,
    // Se vuelve al estado inicial: una cita movida ya no está confirmada por
    // el paciente, que ni siquiera sabe todavía de la nueva hora.
    status: 'SCHEDULED' as AppointmentStatus,
    confirmedAt: null,
    reminderSentAt: null,
  })
  if (!actualizada) throw new ErrorNoEncontrado('No se encontró la cita')

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Appointment',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'appointment:reschedule',
    cambios: {
      de: actual.startsAt.toISOString(),
      a: inicio.toISOString(),
      ...(datos.medicoId && datos.medicoId !== actual.doctorId ? { cambioDeMedico: true } : {}),
    },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aCita(actualizada, zonaHoraria)
}

// --- Edición de datos --------------------------------------------------------

export async function actualizar(
  ctx: ContextoAuth,
  id: string,
  datos: { motivo?: string; notas?: string },
  cliente: DatosCliente,
): Promise<Cita> {
  exigirPermiso(ctx, 'appointment:update')

  const { zonaHoraria } = await configuracionAgenda()
  const repositorio = new RepositorioCitas(ctx)

  const cambios: Prisma.AppointmentUpdateInput = {}
  if (datos.motivo !== undefined) cambios.reason = datos.motivo.trim() || null
  if (datos.notas !== undefined) cambios.notes = datos.notas.trim() || null

  const actualizada = await repositorio.actualizar(id, cambios)
  if (!actualizada) throw new ErrorNoEncontrado('No se encontró la cita')

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Appointment',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'appointment:update',
    cambios: { campos: Object.keys(cambios) },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aCita(actualizada, zonaHoraria)
}

// --- Sala de espera ----------------------------------------------------------

/**
 * Pacientes que ya llegaron y esperan.
 *
 * Es la vista que necesita el médico para llamar al siguiente, y la que
 * justifica que exista el estado ARRIVED — el diseño original saltaba de
 * "confirmada" a "en atención" sin registrar la llegada.
 */
export async function salaDeEspera(ctx: ContextoAuth, medicoId?: string): Promise<Cita[]> {
  const { zonaHoraria } = await configuracionAgenda()
  const hoy = aFechaLocal(new Date(), zonaHoraria)

  const filas = await new RepositorioCitas(ctx).enRango({
    desde: aInstante(hoy, 0, zonaHoraria),
    hasta: aInstante(sumarDiasLocal(hoy, 1), 0, zonaHoraria),
    ...(medicoId ? { medicoId } : {}),
    incluirCanceladas: false,
  })

  return filas
    .filter((f) => f.status === 'ARRIVED' && ocupaHorario(f.status as EstadoCita))
    .map((f) => aCita(f, zonaHoraria))
}
