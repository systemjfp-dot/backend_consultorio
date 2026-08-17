/**
 * Contratos de la atención en consultorio.
 *
 * Los campos siguen la estructura de la NTS 139-MINSA/2018 (anamnesis,
 * antecedentes, examen físico, diagnóstico, plan), no solo el subconjunto que
 * pedía el documento maestro.
 */

import { z } from 'zod'

// =============================================================================
//  Signos vitales
// =============================================================================

/**
 * Rangos habituales en un adulto.
 *
 * NO son criterio clínico ni sirven para diagnosticar: se usan solo para
 * destacar en pantalla un valor que conviene mirar dos veces. La decisión es
 * del médico; esto únicamente evita que un 190/110 pase desapercibido entre
 * quince campos.
 *
 * Los límites `min`/`max` sí son de validación: descartan erratas de tecleo
 * imposibles (390 °C) antes de que contaminen la historia y los reportes.
 */
export const RANGOS_VITALES = {
  presionSistolica: { min: 40, max: 300, habitual: [90, 139] as const, unidad: 'mmHg' },
  presionDiastolica: { min: 20, max: 200, habitual: [60, 89] as const, unidad: 'mmHg' },
  frecuenciaCardiaca: { min: 20, max: 300, habitual: [60, 100] as const, unidad: 'lpm' },
  frecuenciaRespiratoria: { min: 4, max: 90, habitual: [12, 20] as const, unidad: 'rpm' },
  temperatura: { min: 25, max: 45, habitual: [36, 37.5] as const, unidad: '°C' },
  saturacionOxigeno: { min: 30, max: 100, habitual: [95, 100] as const, unidad: '%' },
  pesoKg: { min: 0.3, max: 400, habitual: null, unidad: 'kg' },
  tallaCm: { min: 20, max: 260, habitual: null, unidad: 'cm' },
} as const

export type CampoVital = keyof typeof RANGOS_VITALES

/** ¿El valor está fuera del rango habitual? Solo para destacarlo en pantalla. */
export function fueraDeRangoHabitual(campo: CampoVital, valor: number | null): boolean {
  const rango = RANGOS_VITALES[campo].habitual
  if (!rango || valor === null) return false
  return valor < rango[0] || valor > rango[1]
}

const numeroOpcional = (campo: CampoVital, entero = true) => {
  const { min, max } = RANGOS_VITALES[campo]
  let esquema = z.coerce.number().min(min, `Mínimo ${min}`).max(max, `Máximo ${max}`)
  if (entero) esquema = esquema.int('Debe ser un número entero')

  // Un campo vacío es "no se midió", no cero: registrar 0 mmHg de presión
  // sería un dato clínicamente falso.
  return z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    esquema.optional(),
  )
}

export const esquemaSignosVitales = z
  .object({
    presionSistolica: numeroOpcional('presionSistolica'),
    presionDiastolica: numeroOpcional('presionDiastolica'),
    frecuenciaCardiaca: numeroOpcional('frecuenciaCardiaca'),
    frecuenciaRespiratoria: numeroOpcional('frecuenciaRespiratoria'),
    temperatura: numeroOpcional('temperatura', false),
    saturacionOxigeno: numeroOpcional('saturacionOxigeno'),
    pesoKg: numeroOpcional('pesoKg', false),
    tallaCm: numeroOpcional('tallaCm', false),
  })
  .refine(
    (v) =>
      v.presionSistolica === undefined ||
      v.presionDiastolica === undefined ||
      v.presionSistolica > v.presionDiastolica,
    {
      message: 'La sistólica debe ser mayor que la diastólica',
      path: ['presionDiastolica'],
    },
  )

export type DatosSignosVitales = z.infer<typeof esquemaSignosVitales>
export type EntradaSignosVitales = z.input<typeof esquemaSignosVitales>

// =============================================================================
//  Índice de masa corporal
// =============================================================================

export type ClasificacionImc =
  | 'bajo_peso'
  | 'normal'
  | 'sobrepeso'
  | 'obesidad_1'
  | 'obesidad_2'
  | 'obesidad_3'
  /** Menores de edad: la clasificación adulta no aplica. */
  | 'requiere_percentiles'

export const ETIQUETAS_IMC: Record<ClasificacionImc, string> = {
  bajo_peso: 'Bajo peso',
  normal: 'Normal',
  sobrepeso: 'Sobrepeso',
  obesidad_1: 'Obesidad grado I',
  obesidad_2: 'Obesidad grado II',
  obesidad_3: 'Obesidad grado III',
  requiere_percentiles: 'Requiere tablas de percentiles',
}

export interface ResultadoImc {
  valor: number
  clasificacion: ClasificacionImc
}

/**
 * Índice de masa corporal.
 *
 * Se calcula y NO se guarda, igual que la edad: un campo almacenado quedaría
 * desincronizado del peso y la talla que lo originan, y no habría forma de
 * saber cuál de los tres valores es el correcto.
 *
 * La clasificación por rangos solo vale para adultos. En menores, el IMC se
 * interpreta con tablas de percentiles por edad y sexo; aplicarles los cortes
 * adultos etiquetaría de "obesidad" a niños con desarrollo normal. Por eso,
 * sin edad o con menos de 18 años, se devuelve el valor sin clasificar.
 */
export function calcularImc(
  pesoKg: number | null | undefined,
  tallaCm: number | null | undefined,
  edadAnios?: number,
): ResultadoImc | null {
  if (!pesoKg || !tallaCm || tallaCm <= 0) return null

  const metros = tallaCm / 100
  const valor = Math.round((pesoKg / (metros * metros)) * 10) / 10

  if (edadAnios === undefined || edadAnios < 18) {
    return { valor, clasificacion: 'requiere_percentiles' }
  }

  const clasificacion: ClasificacionImc =
    valor < 18.5
      ? 'bajo_peso'
      : valor < 25
        ? 'normal'
        : valor < 30
          ? 'sobrepeso'
          : valor < 35
            ? 'obesidad_1'
            : valor < 40
              ? 'obesidad_2'
              : 'obesidad_3'

  return { valor, clasificacion }
}

// =============================================================================
//  Datos clínicos
// =============================================================================

const textoClinico = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(''))

export const esquemaDatosClinicos = z.object({
  // Anamnesis
  motivo: textoClinico(500),
  enfermedadActual: textoClinico(4000),

  // Antecedentes (NTS 139)
  antecedentesPersonales: textoClinico(2000),
  antecedentesFamiliares: textoClinico(2000),
  antecedentesQuirurgicos: textoClinico(2000),
  medicacionActual: textoClinico(2000),

  // Examen físico y conclusión
  examenFisico: textoClinico(4000),
  diagnostico: textoClinico(2000),
  planTratamiento: textoClinico(4000),
  notas: textoClinico(2000),
})

export type DatosClinicos = z.infer<typeof esquemaDatosClinicos>

export const esquemaGuardarAtencion = esquemaDatosClinicos.extend({
  signosVitales: esquemaSignosVitales.optional(),
  /** Códigos CIE-10. El primero es el diagnóstico principal. */
  diagnosticos: z.array(z.string().min(1)).max(10).optional(),
})

export type DatosGuardarAtencion = z.infer<typeof esquemaGuardarAtencion>

export const esquemaIniciarAtencion = z.object({
  citaId: z.string().min(1, 'Indica la cita'),
})

export const esquemaAddendum = z.object({
  /**
   * Una atención completada no se reescribe: se corrige con un addendum, que
   * queda firmado con su autor y su fecha. Así funciona un EMR real y es lo
   * que protege legalmente al médico.
   */
  contenido: z.string().trim().min(10, 'Explica la corrección o el agregado').max(4000),
  motivo: z.string().trim().max(300).optional().or(z.literal('')),
})

// =============================================================================
//  Respuestas
// =============================================================================

export interface DiagnosticoCodificado {
  codigo: string
  descripcion: string
  esPrincipal: boolean
}

export interface Addendum {
  id: string
  contenido: string
  motivo: string | null
  autorNombre: string
  creadoEn: string
}

export interface Atencion {
  id: string
  citaId: string

  pacienteId: string
  pacienteNombre: string
  pacienteDocumento: string
  pacienteEdad: number
  pacienteEdadLegible: string
  pacienteAlergias: string | null

  medicoId: string
  medicoNombre: string

  iniciadaEn: string
  finalizadaEn: string | null
  /** Cuando tiene valor, la atención está congelada. */
  congeladaEn: string | null

  signosVitales: {
    presionSistolica: number | null
    presionDiastolica: number | null
    frecuenciaCardiaca: number | null
    frecuenciaRespiratoria: number | null
    temperatura: number | null
    saturacionOxigeno: number | null
    pesoKg: number | null
    tallaCm: number | null
  }
  /** Calculado, nunca almacenado. */
  imc: ResultadoImc | null

  motivo: string | null
  enfermedadActual: string | null
  antecedentesPersonales: string | null
  antecedentesFamiliares: string | null
  antecedentesQuirurgicos: string | null
  medicacionActual: string | null
  examenFisico: string | null
  diagnostico: string | null
  planTratamiento: string | null
  notas: string | null

  diagnosticos: DiagnosticoCodificado[]
  addenda: Addendum[]
}

/** Entrada del historial clínico de un paciente. */
export interface AtencionResumen {
  id: string
  fecha: string
  hora: string
  medicoNombre: string
  motivo: string | null
  diagnostico: string | null
  diagnosticos: DiagnosticoCodificado[]
  congelada: boolean
}

// =============================================================================
//  Catálogo CIE-10
// =============================================================================

export const esquemaBuscarCie10 = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(80),
  limite: z.coerce.number().int().min(1).max(50).default(15),
})

export interface CodigoCie10 {
  codigo: string
  descripcion: string
  categoria: string | null
}
