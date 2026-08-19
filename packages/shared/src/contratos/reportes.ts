/**
 * Contratos de reportes.
 */

import { z } from 'zod'

export const esquemaRangoReporte = z.object({
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD'),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD'),
  medicoId: z.string().optional(),
  sedeId: z.string().optional(),
})

export type RangoReporte = z.infer<typeof esquemaRangoReporte>

// --- Reporte de citas --------------------------------------------------------

export interface ConteoPorEstado {
  agendadas: number
  confirmadas: number
  atendidas: number
  noAsistieron: number
  canceladas: number
}

export interface FilaMedico {
  medicoId: string
  medicoNombre: string
  total: number
  atendidas: number
  noAsistieron: number
  canceladas: number
  tasaAsistencia: number
  tasaInasistencia: number
}

export interface ReporteCitas {
  desde: string
  hasta: string
  total: number
  porEstado: ConteoPorEstado
  /**
   * Porcentajes sobre las citas RESUELTAS (atendidas + no asistieron), no
   * sobre el total: incluir las citas futuras que todavía están agendadas
   * hundiría artificialmente la tasa de asistencia de cualquier rango que
   * llegue hasta hoy.
   */
  tasaAsistencia: number
  tasaInasistencia: number
  tasaCancelacion: number
  porMedico: FilaMedico[]
  porDiaSemana: { dia: number; total: number; noAsistieron: number }[]
  /** Lo que justifica que cancelar exija un motivo. */
  motivosCancelacion: { motivo: string; cantidad: number }[]
  cancelacionesPorOrigen: { paciente: number; clinica: number }
}

// --- Reporte de pacientes ----------------------------------------------------

export interface ReportePacientes {
  desde: string
  hasta: string
  /** Registrados por primera vez dentro del rango. */
  nuevos: number
  /** Atendidos en el rango que ya existían antes. */
  recurrentes: number
  totalAtendidos: number
  porGenero: { genero: string; cantidad: number }[]
  porRangoEdad: { rango: string; cantidad: number }[]
}

/** Rangos de edad del reporte. Los cortes siguen el uso clínico habitual. */
export const RANGOS_EDAD = [
  { etiqueta: '0-4', desde: 0, hasta: 4 },
  { etiqueta: '5-17', desde: 5, hasta: 17 },
  { etiqueta: '18-39', desde: 18, hasta: 39 },
  { etiqueta: '40-59', desde: 40, hasta: 59 },
  { etiqueta: '60+', desde: 60, hasta: 200 },
] as const

export function rangoDeEdad(edad: number): string {
  return RANGOS_EDAD.find((r) => edad >= r.desde && edad <= r.hasta)?.etiqueta ?? '60+'
}

export const NOMBRES_DIA = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const

/** Porcentaje con un decimal. Devuelve 0 cuando no hay base, no NaN. */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 1000) / 10
}
