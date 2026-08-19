/**
 * Contratos de recetas médicas.
 */

import { z } from 'zod'

export const VIAS_ADMINISTRACION = [
  'Oral',
  'Sublingual',
  'Intramuscular',
  'Intravenosa',
  'Subcutánea',
  'Tópica',
  'Oftálmica',
  'Ótica',
  'Nasal',
  'Inhalatoria',
  'Rectal',
  'Vaginal',
] as const

export type ViaAdministracion = (typeof VIAS_ADMINISTRACION)[number]

/**
 * Un medicamento de la receta.
 *
 * Solo el nombre es obligatorio. Exigir concentración, vía, frecuencia y
 * duración en todos los casos suena riguroso pero no lo es: hay indicaciones
 * legítimas —"suero fisiológico para lavado nasal a demanda"— que no encajan
 * en ese molde, y forzarlas lleva a que el médico escriba cualquier cosa para
 * poder guardar.
 */
export const esquemaMedicamento = z.object({
  nombre: z.string().trim().min(2, 'Indica el medicamento').max(120),
  concentracion: z.string().trim().max(60).optional().or(z.literal('')),
  forma: z.string().trim().max(60).optional().or(z.literal('')),
  via: z.string().trim().max(40).optional().or(z.literal('')),
  frecuencia: z.string().trim().max(80).optional().or(z.literal('')),
  duracion: z.string().trim().max(60).optional().or(z.literal('')),
  cantidad: z.coerce.number().int().min(1).max(999).optional(),
  indicaciones: z.string().trim().max(300).optional().or(z.literal('')),
})

export type DatosMedicamento = z.infer<typeof esquemaMedicamento>
export type EntradaMedicamento = z.input<typeof esquemaMedicamento>

export const esquemaCrearReceta = z.object({
  atencionId: z.string().min(1),
  medicamentos: z
    .array(esquemaMedicamento)
    .min(1, 'Añade al menos un medicamento')
    .max(20, 'Demasiados medicamentos para una sola receta'),
  indicacionesGenerales: z.string().trim().max(1000).optional().or(z.literal('')),
  diasValidez: z.coerce.number().int().min(1).max(365).default(30),
})

export type DatosCrearReceta = z.infer<typeof esquemaCrearReceta>

export const esquemaGuardarPlantilla = z.object({
  nombre: z.string().trim().min(2, 'Ponle un nombre a la plantilla').max(80),
  indicacionesGenerales: z.string().trim().max(1000).optional().or(z.literal('')),
  medicamentos: z.array(esquemaMedicamento).min(1).max(20),
})

export const esquemaBuscarMedicamento = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(80),
  limite: z.coerce.number().int().min(1).max(30).default(12),
})

/** Firma del médico: imagen PNG en data URL, dibujada una sola vez en su perfil. */
export const esquemaFirma = z.object({
  imagen: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'La firma debe ser una imagen PNG')
    // ~700 KB en base64. Una firma dibujada pesa unos pocos KB; un límite alto
    // solo dejaría pasar una fotografía subida por error.
    .max(700_000, 'La imagen es demasiado grande'),
})

// --- Respuestas --------------------------------------------------------------

export type TipoFirma = 'DRAWN' | 'CERTIFICATE'

export interface Medicamento extends DatosMedicamento {
  id: string
  /** Línea lista para leer: "Paracetamol 500 mg — Oral, cada 8 h, 5 días". */
  resumen: string
}

export interface Receta {
  id: string
  atencionId: string

  pacienteId: string
  pacienteNombre: string
  pacienteDocumento: string

  medicoNombre: string
  medicoColegiatura: string
  medicoEspecialidad: string

  emitidaEn: string
  diasValidez: number
  /** Fecha hasta la que la receta sigue vigente. */
  validaHasta: string

  indicacionesGenerales: string | null
  medicamentos: Medicamento[]

  tipoFirma: TipoFirma
  firmadaEn: string | null
  /** SHA-256 del PDF emitido: permite demostrar que no fue alterado. */
  hashPdf: string | null
  tienePdf: boolean
}

export interface RecetaResumen {
  id: string
  emitidaEn: string
  medicoNombre: string
  cantidadMedicamentos: number
  primerMedicamento: string
  firmadaEn: string | null
  tienePdf: boolean
}

export interface PlantillaReceta {
  id: string
  nombre: string
  indicacionesGenerales: string | null
  medicamentos: DatosMedicamento[]
}

export interface MedicamentoCatalogo {
  id: string
  nombre: string
  nombreGenerico: string | null
  concentracion: string | null
  forma: string | null
}

/** "Paracetamol 500 mg — Oral, cada 8 horas, 5 días" */
export function resumirMedicamento(m: DatosMedicamento): string {
  const encabezado = [m.nombre, m.concentracion].filter(Boolean).join(' ')
  const detalle = [m.via, m.frecuencia, m.duracion].filter(Boolean).join(', ')
  return detalle ? `${encabezado} — ${detalle}` : encabezado
}
