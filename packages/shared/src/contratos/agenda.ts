/**
 * Contratos de agenda: sedes, horarios y disponibilidad.
 */

import { z } from 'zod'

/** Fecha del calendario de la clínica. */
export const esquemaFechaLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Se espera una fecha con formato AAAA-MM-DD')

/**
 * Hora del día como minutos desde medianoche.
 *
 * 1440 (medianoche del día siguiente) se admite solo como FIN de franja: un
 * turno de noche que termina a las 00:00 es legítimo, pero empezar a las 24:00
 * no significa nada.
 */
const esquemaMinutoDelDia = z.coerce
  .number()
  .int('Los minutos deben ser un número entero')
  .min(0)
  .max(1440)

// --- Sedes -------------------------------------------------------------------

export const esquemaSede = z.object({
  nombre: z.string().trim().min(2, 'El nombre es obligatorio').max(80),
  direccion: z.string().trim().min(5, 'La dirección es obligatoria').max(200),
  telefono: z.string().trim().max(30).optional().or(z.literal('')),
})

export type DatosSede = z.infer<typeof esquemaSede>

export interface Sede {
  id: string
  nombre: string
  direccion: string
  telefono: string | null
  activa: boolean
}

// --- Horarios ----------------------------------------------------------------

export const DIAS_SEMANA = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const

export const esquemaHorario = z
  .object({
    medicoId: z.string().min(1, 'Elige un médico'),
    diaSemana: z.coerce.number().int().min(0).max(6),
    inicioMinuto: esquemaMinutoDelDia,
    finMinuto: esquemaMinutoDelDia,
    /** Duración de cita propia de esta franja. Si falta, la del médico. */
    slotMinutos: z.coerce.number().int().min(5).max(240).optional(),
    sedeId: z.string().optional().or(z.literal('')),
  })
  .refine((h) => h.inicioMinuto < h.finMinuto, {
    message: 'La hora de fin debe ser posterior a la de inicio',
    path: ['finMinuto'],
  })
  .refine((h) => h.inicioMinuto < 1440, {
    message: 'La hora de inicio debe estar dentro del día',
    path: ['inicioMinuto'],
  })
  .refine((h) => h.finMinuto - h.inicioMinuto >= (h.slotMinutos ?? 5), {
    message: 'La franja es más corta que una sola cita',
    path: ['finMinuto'],
  })

export type DatosHorario = z.infer<typeof esquemaHorario>
export type EntradaHorario = z.input<typeof esquemaHorario>

export interface Horario {
  id: string
  medicoId: string
  medicoNombre: string
  diaSemana: number
  inicioMinuto: number
  finMinuto: number
  slotMinutos: number | null
  sedeId: string | null
  sedeNombre: string | null
  activo: boolean
}

// --- Excepciones -------------------------------------------------------------

export const TIPOS_EXCEPCION = ['AUSENTE', 'EXTRA'] as const
export type TipoExcepcion = (typeof TIPOS_EXCEPCION)[number]

export const ETIQUETAS_EXCEPCION: Record<TipoExcepcion, string> = {
  AUSENTE: 'No atiende',
  EXTRA: 'Atención extraordinaria',
}

export const esquemaExcepcion = z
  .object({
    medicoId: z.string().min(1),
    fecha: esquemaFechaLocal,
    tipo: z.enum(TIPOS_EXCEPCION).default('AUSENTE'),
    inicioMinuto: esquemaMinutoDelDia.optional(),
    finMinuto: esquemaMinutoDelDia.optional(),
    motivo: z.string().trim().max(200).optional().or(z.literal('')),
  })
  .refine(
    (e) =>
      (e.inicioMinuto === undefined && e.finMinuto === undefined) ||
      (e.inicioMinuto !== undefined && e.finMinuto !== undefined && e.inicioMinuto < e.finMinuto),
    { message: 'Indica ambas horas, o ninguna para el día completo', path: ['finMinuto'] },
  )
  .refine((e) => e.tipo !== 'EXTRA' || e.inicioMinuto !== undefined, {
    message: 'Una atención extraordinaria necesita hora de inicio y de fin',
    path: ['inicioMinuto'],
  })

export type DatosExcepcion = z.infer<typeof esquemaExcepcion>

export interface Excepcion {
  id: string
  medicoId: string
  fecha: string
  tipo: TipoExcepcion
  inicioMinuto: number | null
  finMinuto: number | null
  motivo: string | null
}

// --- Disponibilidad ----------------------------------------------------------

export const esquemaConsultaDisponibilidad = z.object({
  medicoId: z.string().min(1, 'Elige un médico'),
  fecha: esquemaFechaLocal,
  /** Si no se indica, se usa la duración configurada del médico. */
  duracionMinutos: z.coerce.number().int().min(5).max(240).optional(),
  sedeId: z.string().optional(),
})

export interface HuecoDisponible {
  /** Instante absoluto. Es lo que se envía al crear la cita. */
  inicio: string
  fin: string
  /** "08:30", ya en hora de la clínica: la web no vuelve a convertir. */
  hora: string
  sedeId: string | null
}

export interface DisponibilidadDelDia {
  fecha: string
  medicoId: string
  duracionMinutos: number
  huecos: HuecoDisponible[]
  /** Motivo por el que no hay huecos, para poder explicarlo en pantalla. */
  motivoSinHuecos: 'sin_horario' | 'ausente' | 'completo' | 'dia_pasado' | null
}

// --- Médicos (resumen para los selectores de agenda) -------------------------

export interface MedicoResumen {
  id: string
  nombre: string
  especialidad: string
  color: string
  duracionCitaMinutos: number
  activo: boolean
}

/** 510 → "08:30". Misma conversión en ambos lados, sin duplicar la regla. */
export function formatearMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60)
  return `${String(horas).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
}

/** "08:30" → 510 */
export function parsearHora(texto: string): number {
  const coincidencia = /^(\d{1,2}):(\d{2})$/.exec(texto.trim())
  if (!coincidencia) throw new RangeError(`Hora inválida: "${texto}"`)

  const horas = Number(coincidencia[1])
  const minutos = Number(coincidencia[2])
  if (horas > 24 || minutos > 59) throw new RangeError(`Hora inexistente: "${texto}"`)

  return horas * 60 + minutos
}
