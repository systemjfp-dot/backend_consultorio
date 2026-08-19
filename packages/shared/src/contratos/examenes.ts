/**
 * Contratos de órdenes de examen auxiliar.
 */

import { z } from 'zod'

export const TIPOS_EXAMEN = ['LABORATORY', 'IMAGING', 'SPECIAL', 'OTHER'] as const
export type TipoExamen = (typeof TIPOS_EXAMEN)[number]

export const ETIQUETAS_TIPO_EXAMEN: Record<TipoExamen, string> = {
  LABORATORY: 'Laboratorio',
  IMAGING: 'Imagenología',
  SPECIAL: 'Estudio especial',
  OTHER: 'Otro',
}

/**
 * Indicaciones frecuentes por tipo.
 *
 * Un ayuno mal indicado obliga a repetir el examen y a que el paciente vuelva
 * otro día en ayunas. Ofrecerlas de un clic es más fiable que confiar en que
 * se escriban a mano con prisa.
 */
export const INDICACIONES_FRECUENTES = [
  'Ayuno de 8 horas',
  'Ayuno de 12 horas',
  'Vejiga llena',
  'No suspender medicación habitual',
  'Traer exámenes previos',
  'Acudir con ropa cómoda',
] as const

export const esquemaOrdenExamen = z.object({
  atencionId: z.string().min(1),
  examenes: z
    .array(
      z.object({
        tipo: z.enum(TIPOS_EXAMEN),
        nombre: z.string().trim().min(2, 'Indica el examen').max(160),
        indicaciones: z.string().trim().max(400).optional().or(z.literal('')),
        urgente: z.boolean().default(false),
      }),
    )
    .min(1, 'Añade al menos un examen')
    .max(20, 'Demasiados exámenes para una sola orden'),
  /** Fecha límite para realizárselo. Opcional: muchos no la necesitan. */
  fechaLimite: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato AAAA-MM-DD')
    .optional()
    .or(z.literal('')),
})

export type DatosOrdenExamen = z.infer<typeof esquemaOrdenExamen>

/**
 * Resultado.
 *
 * Se admite texto, archivo o ambos: un hemograma llega como PDF del
 * laboratorio, pero también hay resultados que el médico transcribe en dos
 * líneas. Exigir uno de los dos formatos dejaría fuera la mitad de los casos.
 */
export const esquemaResultado = z.object({
  texto: z.string().trim().max(4000).optional().or(z.literal('')),
})

export const esquemaBuscarExamen = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(80),
  tipo: z.enum(TIPOS_EXAMEN).optional(),
  limite: z.coerce.number().int().min(1).max(30).default(12),
})

// --- Respuestas --------------------------------------------------------------

export interface Examen {
  id: string
  atencionId: string

  pacienteId: string
  pacienteNombre: string
  pacienteDocumento: string

  medicoId: string
  medicoNombre: string

  tipo: TipoExamen
  nombre: string
  indicaciones: string | null
  urgente: boolean

  emitidoEn: string
  fechaLimite: string | null

  resultado: string | null
  tieneArchivoResultado: boolean
  resultadoEn: string | null

  tienePdf: boolean
}

export interface ExamenCatalogo {
  id: string
  tipo: TipoExamen
  nombre: string
  indicaciones: string | null
}

/** Estado de una orden, para mostrarlo de un vistazo. */
export type EstadoExamen = 'pendiente' | 'vencido' | 'con_resultado'

export function estadoExamen(examen: Examen, hoy = new Date()): EstadoExamen {
  if (examen.resultado || examen.tieneArchivoResultado) return 'con_resultado'

  if (examen.fechaLimite) {
    const limite = new Date(`${examen.fechaLimite}T23:59:59Z`)
    if (limite < hoy) return 'vencido'
  }

  return 'pendiente'
}

export const ETIQUETAS_ESTADO_EXAMEN: Record<EstadoExamen, string> = {
  pendiente: 'Pendiente',
  vencido: 'Fuera de plazo',
  con_resultado: 'Con resultado',
}
