/**
 * Reportes de citas y pacientes.
 *
 * Respetan el alcance: un médico ve sus propias cifras, la administración las
 * de toda la clínica. Es el mismo `filtroDeAlcance` que aplica el resto del
 * sistema — sin él, un reporte sería la vía más fácil para leer la actividad
 * ajena sin tocar ningún dato clínico.
 */

import {
  NOMBRES_DIA,
  calcularEdad,
  porcentaje,
  rangoDeEdad,
  type ConteoPorEstado,
  type FilaMedico,
  type RangoReporte,
  type ReporteCitas,
  type ReportePacientes,
} from '@consultorio/shared'
import type { Prisma } from '@prisma/client'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorPeticion } from '../../core/errores.js'
import { exigirPermiso, filtroDeAlcance } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'
import { aFechaLocal, aInstante, diaDeLaSemana, sumarDiasLocal } from '../../core/tiempo.js'
import { configuracionAgenda } from '../agenda/agenda.service.js'

/**
 * Rango máximo consultable.
 *
 * Sin tope, pedir "desde 2020" recorrería la tabla entera de citas en cada
 * carga del panel. Tres años cubre cualquier necesidad real de un consultorio
 * y mantiene la consulta acotada.
 */
const MAXIMO_DIAS = 1095

async function ventana(filtros: RangoReporte) {
  const { zonaHoraria } = await configuracionAgenda()

  if (filtros.hasta < filtros.desde) {
    throw new ErrorPeticion('La fecha final no puede ser anterior a la inicial')
  }

  const dias =
    (Date.parse(`${filtros.hasta}T00:00:00Z`) - Date.parse(`${filtros.desde}T00:00:00Z`)) /
    86_400_000

  if (dias > MAXIMO_DIAS) {
    throw new ErrorPeticion('El rango no puede superar los 3 años')
  }

  return {
    zonaHoraria,
    desde: aInstante(filtros.desde, 0, zonaHoraria),
    // El límite superior es la medianoche del día siguiente: el rango que pide
    // el usuario incluye el último día completo.
    hasta: aInstante(sumarDiasLocal(filtros.hasta, 1), 0, zonaHoraria),
  }
}

// =============================================================================
//  Citas
// =============================================================================

export async function reporteCitas(
  ctx: ContextoAuth,
  filtros: RangoReporte,
): Promise<ReporteCitas> {
  exigirPermiso(ctx, 'report:appointments')

  const { zonaHoraria, desde, hasta } = await ventana(filtros)
  const alcance = filtroDeAlcance(ctx, 'report:appointments')

  const where: Prisma.AppointmentWhereInput = {
    ...alcance,
    startsAt: { gte: desde, lt: hasta },
    ...(filtros.medicoId ? { doctorId: filtros.medicoId } : {}),
    ...(filtros.sedeId ? { locationId: filtros.sedeId } : {}),
  }

  const citas = await prisma.appointment.findMany({
    where,
    select: {
      startsAt: true,
      status: true,
      cancelReason: true,
      cancelledBy: true,
      doctorId: true,
      doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
  })

  const porEstado: ConteoPorEstado = {
    agendadas: 0,
    confirmadas: 0,
    atendidas: 0,
    noAsistieron: 0,
    canceladas: 0,
  }

  const porMedico = new Map<string, FilaMedico>()
  const porDia = new Map<number, { total: number; noAsistieron: number }>()
  const motivos = new Map<string, number>()
  const origen = { paciente: 0, clinica: 0 }

  for (const cita of citas) {
    switch (cita.status) {
      case 'COMPLETED':
        porEstado.atendidas++
        break
      case 'NO_SHOW':
        porEstado.noAsistieron++
        break
      case 'CANCELLED':
        porEstado.canceladas++
        break
      case 'CONFIRMED':
        porEstado.confirmadas++
        break
      default:
        // SCHEDULED, ARRIVED e IN_ATTENTION son citas todavía en curso.
        porEstado.agendadas++
    }

    const fila = porMedico.get(cita.doctorId) ?? {
      medicoId: cita.doctorId,
      medicoNombre: `${cita.doctor.user.firstName} ${cita.doctor.user.lastName}`,
      total: 0,
      atendidas: 0,
      noAsistieron: 0,
      canceladas: 0,
      tasaAsistencia: 0,
      tasaInasistencia: 0,
    }
    fila.total++
    if (cita.status === 'COMPLETED') fila.atendidas++
    if (cita.status === 'NO_SHOW') fila.noAsistieron++
    if (cita.status === 'CANCELLED') fila.canceladas++
    porMedico.set(cita.doctorId, fila)

    // El día de la semana se calcula sobre la fecha LOCAL: usar la UTC movería
    // al lunes las citas del domingo por la noche.
    const dia = diaDeLaSemana(aFechaLocal(cita.startsAt, zonaHoraria))
    const conteoDia = porDia.get(dia) ?? { total: 0, noAsistieron: 0 }
    conteoDia.total++
    if (cita.status === 'NO_SHOW') conteoDia.noAsistieron++
    porDia.set(dia, conteoDia)

    if (cita.status === 'CANCELLED') {
      const motivo = cita.cancelReason?.trim() || 'Sin motivo registrado'
      motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1)

      if (cita.cancelledBy === 'CLINIC') origen.clinica++
      else origen.paciente++
    }
  }

  // Las tasas se calculan sobre las citas RESUELTAS: incluir las que aún están
  // por ocurrir hundiría la asistencia de cualquier rango que llegue hasta hoy.
  const resueltas = porEstado.atendidas + porEstado.noAsistieron

  for (const fila of porMedico.values()) {
    const resueltasMedico = fila.atendidas + fila.noAsistieron
    fila.tasaAsistencia = porcentaje(fila.atendidas, resueltasMedico)
    fila.tasaInasistencia = porcentaje(fila.noAsistieron, resueltasMedico)
  }

  return {
    desde: filtros.desde,
    hasta: filtros.hasta,
    total: citas.length,
    porEstado,
    tasaAsistencia: porcentaje(porEstado.atendidas, resueltas),
    tasaInasistencia: porcentaje(porEstado.noAsistieron, resueltas),
    tasaCancelacion: porcentaje(porEstado.canceladas, citas.length),
    porMedico: [...porMedico.values()].sort((a, b) => b.total - a.total),
    porDiaSemana: [...Array(7).keys()].map((dia) => ({
      dia,
      total: porDia.get(dia)?.total ?? 0,
      noAsistieron: porDia.get(dia)?.noAsistieron ?? 0,
    })),
    motivosCancelacion: [...motivos.entries()]
      .map(([motivo, cantidad]) => ({ motivo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10),
    cancelacionesPorOrigen: origen,
  }
}

// =============================================================================
//  Pacientes
// =============================================================================

export async function reportePacientes(
  ctx: ContextoAuth,
  filtros: RangoReporte,
): Promise<ReportePacientes> {
  exigirPermiso(ctx, 'report:patients')

  const { desde, hasta } = await ventana(filtros)
  const alcance = filtroDeAlcance(ctx, 'report:patients')

  const [nuevos, atendidos] = await Promise.all([
    prisma.patient.count({
      where: { deletedAt: null, createdAt: { gte: desde, lt: hasta } },
    }),
    prisma.appointment.findMany({
      where: {
        ...alcance,
        startsAt: { gte: desde, lt: hasta },
        status: 'COMPLETED',
      },
      select: {
        patient: { select: { id: true, gender: true, birthDate: true, createdAt: true } },
      },
      // Un paciente con tres consultas en el rango es UNA persona atendida, no
      // tres: sin distinguirlo, el reporte contaría visitas y lo llamaría
      // pacientes.
      distinct: ['patientId'],
    }),
  ])

  const porGenero = new Map<string, number>()
  const porRango = new Map<string, number>()
  let recurrentes = 0

  for (const { patient } of atendidos) {
    if (patient.createdAt < desde) recurrentes++

    porGenero.set(patient.gender, (porGenero.get(patient.gender) ?? 0) + 1)

    const rango = rangoDeEdad(calcularEdad(patient.birthDate))
    porRango.set(rango, (porRango.get(rango) ?? 0) + 1)
  }

  return {
    desde: filtros.desde,
    hasta: filtros.hasta,
    nuevos,
    recurrentes,
    totalAtendidos: atendidos.length,
    porGenero: [...porGenero.entries()].map(([genero, cantidad]) => ({ genero, cantidad })),
    porRangoEdad: [...porRango.entries()]
      .map(([rango, cantidad]) => ({ rango, cantidad }))
      .sort((a, b) => a.rango.localeCompare(b.rango)),
  }
}

// =============================================================================
//  Exportación
// =============================================================================

/**
 * Valor que se escribe TAL CUAL, sin escapar.
 *
 * Hace falta para conservar los ceros iniciales. La forma `="07654321"` es lo
 * que hace que Excel trate el documento como texto en lugar de como número, y
 * escaparla como cualquier otro campo la convertiría en `"=""07654321"""`, que
 * Excel muestra literalmente, comillas incluidas.
 */
interface Literal {
  literal: string
}

/** Un DNI peruano puede empezar por cero: sin esto, Excel se lo come. */
function comoTexto(valor: string): Literal {
  return { literal: '="' + valor.replace(/"/g, '') + '"' }
}

type Celda = string | number | null | undefined | Literal

/**
 * Escapa un valor para CSV.
 *
 * Las comillas se duplican y todo campo con separador, comillas o salto de
 * línea va entrecomillado. Un motivo de cancelación con una coma —cosa
 * habitual— desplazaría todas las columnas siguientes sin esto.
 */
function celda(valor: Celda): string {
  if (valor !== null && typeof valor === 'object' && 'literal' in valor) return valor.literal

  const texto = String(valor ?? '')
  return /[",;\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

function aCsv(cabeceras: string[], filas: Celda[][]): string {
  const lineas = [cabeceras.map(celda).join(','), ...filas.map((f) => f.map(celda).join(','))]

  // El BOM y la línea `sep=` son para Excel: sin el primero destroza las
  // tildes, y sin la segunda usa el separador de la configuración regional,
  // que en español suele ser el punto y coma. Ambos son inofensivos para
  // cualquier otro programa.
  // \uFEFF es el BOM, escrito como escape y no como carácter literal: en el
  // código fuente sería un espacio invisible que nadie sabría de dónde salió.
  return `\uFEFFsep=,\n${lineas.join('\n')}\n`
}

export async function citasEnCsv(ctx: ContextoAuth, filtros: RangoReporte): Promise<string> {
  exigirPermiso(ctx, 'report:appointments')

  const { zonaHoraria, desde, hasta } = await ventana(filtros)
  const alcance = filtroDeAlcance(ctx, 'report:appointments')

  const citas = await prisma.appointment.findMany({
    where: {
      ...alcance,
      startsAt: { gte: desde, lt: hasta },
      ...(filtros.medicoId ? { doctorId: filtros.medicoId } : {}),
    },
    include: {
      patient: { select: { document: true, firstName: true, lastName: true, birthDate: true } },
      doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
      location: { select: { name: true } },
    },
    orderBy: { startsAt: 'asc' },
  })

  const ETIQUETAS: Record<string, string> = {
    SCHEDULED: 'Agendada',
    CONFIRMED: 'Confirmada',
    ARRIVED: 'En sala de espera',
    IN_ATTENTION: 'En atención',
    COMPLETED: 'Atendida',
    CANCELLED: 'Cancelada',
    NO_SHOW: 'No asistió',
  }

  return aCsv(
    [
      'Fecha',
      'Hora',
      'Paciente',
      'Documento',
      'Edad',
      'Médico',
      'Sede',
      'Estado',
      'Motivo',
      'Motivo de cancelación',
    ],
    citas.map((cita) => {
      const fecha = aFechaLocal(cita.startsAt, zonaHoraria)
      const hora = cita.startsAt.toLocaleTimeString('es-PE', {
        timeZone: zonaHoraria,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })

      return [
        fecha,
        hora,
        `${cita.patient.firstName} ${cita.patient.lastName}`,
        // El documento se exporta como texto: sin esto Excel lo lee como
        // número y se come el cero inicial de los DNI que lo llevan.
        comoTexto(cita.patient.document),
        calcularEdad(cita.patient.birthDate),
        `${cita.doctor.user.firstName} ${cita.doctor.user.lastName}`,
        cita.location?.name ?? '',
        ETIQUETAS[cita.status] ?? cita.status,
        cita.reason ?? '',
        cita.cancelReason ?? '',
      ]
    }),
  )
}

export async function pacientesEnCsv(ctx: ContextoAuth, filtros: RangoReporte): Promise<string> {
  exigirPermiso(ctx, 'report:patients')

  const { desde, hasta } = await ventana(filtros)

  const pacientes = await prisma.patient.findMany({
    where: { deletedAt: null, createdAt: { gte: desde, lt: hasta } },
    orderBy: { createdAt: 'asc' },
  })

  const GENEROS: Record<string, string> = { M: 'Masculino', F: 'Femenino', OTHER: 'Otro' }

  return aCsv(
    ['Registrado', 'Documento', 'Nombres', 'Apellidos', 'Edad', 'Género', 'Teléfono'],
    pacientes.map((paciente) => [
      paciente.createdAt.toISOString().slice(0, 10),
      comoTexto(paciente.document),
      paciente.firstName,
      paciente.lastName,
      calcularEdad(paciente.birthDate),
      GENEROS[paciente.gender] ?? paciente.gender,
      comoTexto(paciente.phone),
    ]),
  )
}

export { NOMBRES_DIA }
