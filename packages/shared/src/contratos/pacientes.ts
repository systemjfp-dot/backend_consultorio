/**
 * Contratos del módulo de pacientes.
 */

import { z } from 'zod'

export const TIPOS_DOCUMENTO = ['DNI', 'CE', 'PASSPORT', 'OTHER'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

export const GENEROS = ['M', 'F', 'OTHER'] as const
export type Genero = (typeof GENEROS)[number]

export const ETIQUETAS_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  DNI: 'DNI',
  CE: 'Carné de extranjería',
  PASSPORT: 'Pasaporte',
  OTHER: 'Otro',
}

export const ETIQUETAS_GENERO: Record<Genero, string> = {
  M: 'Masculino',
  F: 'Femenino',
  OTHER: 'Otro',
}

/**
 * Documento de identidad.
 *
 * Se guarda tal como se teclea salvo espacios: un DNI peruano tiene 8 dígitos,
 * pero un carné de extranjería o un pasaporte no siguen ese formato, y rechazar
 * lo que no encaje dejaría fuera a pacientes reales. La comprobación estricta
 * de 8 dígitos se aplica solo cuando el tipo es DNI.
 */
const esquemaDocumento = z
  .string()
  .trim()
  .min(6, 'El documento debe tener al menos 6 caracteres')
  .max(20, 'El documento no puede superar los 20 caracteres')
  .regex(/^[A-Za-z0-9-]+$/, 'El documento solo admite letras, números y guiones')

const esquemaNombre = z
  .string()
  .trim()
  .min(2, 'Debe tener al menos 2 caracteres')
  .max(60, 'No puede superar los 60 caracteres')
  // Nombres peruanos llevan tildes, ñ y apellidos compuestos con espacios y
  // apóstrofes ("D'Angelo"). Restringir a [a-z] excluiría a personas reales.
  .regex(/^[\p{L}\p{M}\s'.-]+$/u, 'Solo se admiten letras, espacios, apóstrofes y guiones')

const esquemaTelefono = z
  .string()
  .trim()
  .min(6, 'El teléfono debe tener al menos 6 dígitos')
  .max(20)
  .regex(/^[0-9+()\s-]+$/, 'El teléfono solo admite números y los signos + ( ) -')

/**
 * Fecha de nacimiento.
 *
 * No puede ser futura ni anterior a 130 años: ambas son erratas de tecleo, y
 * una fecha imposible contamina cálculos de edad, dosis pediátricas y reportes.
 */
const esquemaFechaNacimiento = z.coerce
  .date()
  .refine((fecha) => fecha <= new Date(), 'La fecha de nacimiento no puede ser futura')
  .refine((fecha) => {
    const limite = new Date()
    limite.setFullYear(limite.getFullYear() - 130)
    return fecha >= limite
  }, 'Revisa la fecha: parece anterior a lo posible')

/** Campos del paciente, sin las reglas que cruzan varios de ellos. */
const camposPaciente = z
  .object({
    tipoDocumento: z.enum(TIPOS_DOCUMENTO).default('DNI'),
    documento: esquemaDocumento,
    nombres: esquemaNombre,
    apellidos: esquemaNombre,
    fechaNacimiento: esquemaFechaNacimiento,
    genero: z.enum(GENEROS),
    telefono: esquemaTelefono,
    email: z.string().trim().toLowerCase().email('El correo no tiene un formato válido').optional().or(z.literal('')),
    direccion: z.string().trim().max(200).optional().or(z.literal('')),
    alergias: z.string().trim().max(500).optional().or(z.literal('')),
    antecedentes: z.string().trim().max(2000).optional().or(z.literal('')),
  })

export const esquemaCrearPaciente = camposPaciente.refine(
  (datos) => datos.tipoDocumento !== 'DNI' || /^\d{8}$/.test(datos.documento),
  { message: 'El DNI debe tener exactamente 8 dígitos', path: ['documento'] },
)

export type DatosCrearPaciente = z.infer<typeof esquemaCrearPaciente>

/**
 * Lo que el FORMULARIO maneja, antes de validar.
 *
 * No coincide con `DatosCrearPaciente`: un `<input type="date">` produce texto,
 * y el esquema lo convierte a `Date`. Distinguir la entrada de la salida es lo
 * que permite tipar el formulario sin forzar conversiones a mano en cada campo.
 */
export type EntradaCrearPaciente = z.input<typeof esquemaCrearPaciente>

/**
 * Actualización.
 *
 * El documento y el tipo NO se pueden cambiar: identifican a la persona y son
 * la clave por la que se une su historial. Corregir una errata en el documento
 * es una operación excepcional que debe hacerse conscientemente, no como parte
 * de editar un teléfono.
 */
export const esquemaActualizarPaciente = camposPaciente
  .omit({ tipoDocumento: true, documento: true })
  .partial()

export type DatosActualizarPaciente = z.infer<typeof esquemaActualizarPaciente>
export type EntradaActualizarPaciente = z.input<typeof esquemaActualizarPaciente>

export const esquemaBuscarPacientes = z.object({
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
})

export type ConsultaPacientes = z.infer<typeof esquemaBuscarPacientes>

export const esquemaConsultaDocumento = z.object({
  tipoDocumento: z.enum(TIPOS_DOCUMENTO).default('DNI'),
  documento: esquemaDocumento,
})

// --- Respuestas --------------------------------------------------------------

export interface PacienteResumen {
  id: string
  tipoDocumento: TipoDocumento
  documento: string
  nombres: string
  apellidos: string
  nombreCompleto: string
  fechaNacimiento: string
  edad: number
  genero: Genero
  telefono: string
  /** Se destaca en la interfaz: es un dato que puede cambiar una prescripción. */
  alergias: string | null
}

export interface PacienteDetalle extends PacienteResumen {
  email: string | null
  direccion: string | null
  antecedentes: string | null
  creadoEn: string
  actualizadoEn: string
}

export interface ResultadoBusquedaPacientes {
  pacientes: PacienteResumen[]
  total: number
  pagina: number
  porPagina: number
}

/**
 * Edad en años cumplidos.
 *
 * Se calcula y no se guarda, por lo mismo que el IMC: un campo almacenado
 * quedaría desactualizado al día siguiente del cumpleaños.
 */
export function calcularEdad(fechaNacimiento: Date | string, referencia = new Date()): number {
  const nacimiento = new Date(fechaNacimiento)
  let edad = referencia.getFullYear() - nacimiento.getFullYear()

  const mes = referencia.getMonth() - nacimiento.getMonth()
  if (mes < 0 || (mes === 0 && referencia.getDate() < nacimiento.getDate())) edad--

  return Math.max(0, edad)
}

/**
 * Edad legible.
 *
 * En pediatría "0 años" no dice nada: la dosis de un lactante de 2 meses no es
 * la de uno de 11. Por debajo del año se expresa en meses, y por debajo del mes
 * en días.
 */
export function edadLegible(fechaNacimiento: Date | string, referencia = new Date()): string {
  const nacimiento = new Date(fechaNacimiento)
  const dias = Math.floor((referencia.getTime() - nacimiento.getTime()) / 86_400_000)

  if (dias < 31) return `${dias} ${dias === 1 ? 'día' : 'días'}`

  const meses =
    (referencia.getFullYear() - nacimiento.getFullYear()) * 12 +
    (referencia.getMonth() - nacimiento.getMonth()) -
    (referencia.getDate() < nacimiento.getDate() ? 1 : 0)

  if (meses < 24) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`

  const edad = calcularEdad(nacimiento, referencia)
  return `${edad} años`
}
