/**
 * Contratos de citas.
 *
 * La máquina de estados vive aquí, compartida: la web la usa para decidir qué
 * botones mostrar y la API para decidir qué transiciones acepta. Con dos
 * definiciones, la interfaz acabaría ofreciendo acciones que el servidor
 * rechaza — o peor, escondiendo las que sí se podían hacer.
 */

import { z } from 'zod'

export const ESTADOS_CITA = [
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_ATTENTION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const

export type EstadoCita = (typeof ESTADOS_CITA)[number]

export const ETIQUETAS_ESTADO: Record<EstadoCita, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  ARRIVED: 'En sala de espera',
  IN_ATTENTION: 'En atención',
  COMPLETED: 'Atendida',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
}

/**
 * Transiciones permitidas.
 *
 * Los tres estados finales no llevan a ningún sitio: una cita atendida,
 * cancelada o marcada como inasistencia es historia. Cambiarla después
 * falsearía las estadísticas del módulo de reportes, que es precisamente lo
 * que se quiere medir.
 *
 * `IN_ATTENTION` solo puede completarse: cancelar a un paciente que ya está
 * dentro del consultorio no describe nada real.
 */
export const TRANSICIONES: Record<EstadoCita, readonly EstadoCita[]> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_ATTENTION', 'CANCELLED', 'NO_SHOW'],
  IN_ATTENTION: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
}

export function puedeTransicionar(desde: EstadoCita, hasta: EstadoCita): boolean {
  return TRANSICIONES[desde].includes(hasta)
}

/** Una cita en estado final ya no admite cambios de agenda. */
export function esEstadoFinal(estado: EstadoCita): boolean {
  return TRANSICIONES[estado].length === 0
}

/** Los estados que ocupan sitio en la agenda del médico. */
export function ocupaHorario(estado: EstadoCita): boolean {
  return estado !== 'CANCELLED' && estado !== 'NO_SHOW'
}

export const MODALIDADES = ['PRESENCIAL', 'TELECONSULTA'] as const
export type Modalidad = (typeof MODALIDADES)[number]

// --- Creación ----------------------------------------------------------------

export const esquemaCrearCita = z.object({
  pacienteId: z.string().min(1, 'Elige un paciente'),
  medicoId: z.string().min(1, 'Elige un médico'),
  /** Instante absoluto, tal como lo devuelve el cálculo de disponibilidad. */
  inicio: z.string().datetime({ message: 'Elige una hora disponible' }),
  duracionMinutos: z.coerce.number().int().min(5).max(240).optional(),
  sedeId: z.string().optional().or(z.literal('')),
  modalidad: z.enum(MODALIDADES).default('PRESENCIAL'),
  motivo: z.string().trim().max(300).optional().or(z.literal('')),
  notas: z.string().trim().max(500).optional().or(z.literal('')),
  /**
   * Agendar fuera de los huecos disponibles.
   *
   * Requiere el permiso `appointment:overbook`. El módulo 4.2 pide advertir en
   * ese caso, no impedirlo: una urgencia que se encaja entre dos citas es algo
   * que pasa todos los días en un consultorio.
   */
  sobreagendar: z.boolean().default(false),
})

export type DatosCrearCita = z.infer<typeof esquemaCrearCita>
export type EntradaCrearCita = z.input<typeof esquemaCrearCita>

// --- Reprogramación y cancelación --------------------------------------------

export const esquemaReprogramar = z.object({
  inicio: z.string().datetime(),
  duracionMinutos: z.coerce.number().int().min(5).max(240).optional(),
  medicoId: z.string().optional(),
  sobreagendar: z.boolean().default(false),
})

export const ORIGENES_CANCELACION = ['PATIENT', 'CLINIC'] as const
export type OrigenCancelacion = (typeof ORIGENES_CANCELACION)[number]

export const ETIQUETAS_ORIGEN: Record<OrigenCancelacion, string> = {
  PATIENT: 'El paciente canceló',
  CLINIC: 'La clínica canceló',
}

export const esquemaCancelar = z.object({
  /**
   * El motivo es obligatorio.
   *
   * El módulo 4.3 lo pide "para estadísticas", y ahí está la razón: sin
   * motivo, el reporte de cancelaciones solo dice cuántas hubo. Con él se
   * puede distinguir un problema de agenda de uno de recordatorios.
   */
  motivo: z.string().trim().min(3, 'Indica el motivo de la cancelación').max(300),
  origen: z.enum(ORIGENES_CANCELACION).default('PATIENT'),
})

export const esquemaActualizarCita = z.object({
  motivo: z.string().trim().max(300).optional(),
  notas: z.string().trim().max(500).optional(),
})

// --- Consulta ----------------------------------------------------------------

export const esquemaConsultaCitas = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD'),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  medicoId: z.string().optional(),
  sedeId: z.string().optional(),
  pacienteId: z.string().optional(),
  incluirCanceladas: z.coerce.boolean().default(false),
})

export type ConsultaCitas = z.infer<typeof esquemaConsultaCitas>

// --- Respuestas --------------------------------------------------------------

export interface Cita {
  id: string
  /** Instantes absolutos. */
  inicio: string
  fin: string
  /** Fecha y hora ya en el calendario de la clínica: la web no reconvierte. */
  fecha: string
  hora: string
  horaFin: string
  duracionMinutos: number

  estado: EstadoCita
  modalidad: Modalidad
  sobreagendada: boolean

  pacienteId: string
  pacienteNombre: string
  pacienteDocumento: string
  pacienteTelefono: string
  /** Se muestra en la agenda: puede cambiar lo que el médico prescriba. */
  pacienteAlergias: string | null

  medicoId: string
  medicoNombre: string
  medicoColor: string

  sedeId: string | null
  sedeNombre: string | null

  motivo: string | null
  notas: string | null

  llegadaEn: string | null
  confirmadaEn: string | null
  canceladaEn: string | null
  motivoCancelacion: string | null
}

export interface AgendaDelDia {
  fecha: string
  citas: Cita[]
}
