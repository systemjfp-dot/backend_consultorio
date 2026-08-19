/**
 * Consultorios servidos por este proceso.
 *
 * UN SOLO DESPLIEGUE PUEDE ATENDER A VARIOS CONSULTORIOS INDEPENDIENTES, y lo
 * hace sin `tenantId` en ninguna tabla: cada consultorio tiene su PROPIA BASE
 * DE DATOS y lo que se elige por petición es la CONEXIÓN, mirando el dominio.
 *
 * La diferencia con el multi-tenant clásico no es cosmética. Con `tenantId` en
 * cada tabla, la separación depende de que ninguna de las cientos de consultas
 * del sistema se olvide del filtro; basta un `findMany` despistado para
 * enseñarle a una clínica los pacientes de otra. Aquí no existe esa consulta
 * posible: la base de datos del otro consultorio no está al alcance.
 *
 * Configuración (variable `CONSULTORIOS`, JSON):
 *
 *   {
 *     "sanrafael.midominio.com":  { "clave": "sanrafael",  "baseDeDatos": "postgresql://…" },
 *     "sansantiago.midominio.com":{ "clave": "sansantiago","baseDeDatos": "postgresql://…" }
 *   }
 *
 * Sin esa variable el sistema funciona como siempre: un solo consultorio con
 * `DATABASE_URL`. Es lo que usan las pruebas y la instalación de una clínica
 * sola, y por eso no hay que configurar nada para ese caso.
 */

import { z } from 'zod'
import { env } from './env.js'

export interface Consultorio {
  /**
   * Nombre corto e interno. Da nombre a la carpeta de archivos y aparece en
   * los logs. No se muestra a nadie: el nombre visible vive en la base, en
   * `ClinicSettings`, y por eso cada consultorio ya se presenta con el suyo.
   */
  clave: string
  baseDeDatos: string
}

const esquemaConsultorio = z.object({
  clave: z
    .string()
    .regex(/^[a-z0-9-]{1,40}$/, 'La clave solo admite minúsculas, dígitos y guiones'),
  baseDeDatos: z.string().min(1),
})

const esquemaMapa = z.record(z.string().min(1), esquemaConsultorio)

/** Clave del consultorio cuando el proceso atiende a uno solo. */
export const CLAVE_UNICA = 'principal'

function leerMapa(): Map<string, Consultorio> | null {
  const crudo = process.env['CONSULTORIOS']?.trim()
  if (!crudo) return null

  let json: unknown
  try {
    json = JSON.parse(crudo)
  } catch {
    abortar('CONSULTORIOS no es un JSON válido')
  }

  const resultado = esquemaMapa.safeParse(json)
  if (!resultado.success) {
    abortar(
      resultado.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n'),
    )
  }

  const entradas = Object.entries(resultado.data)
  if (entradas.length === 0) abortar('CONSULTORIOS está vacío')

  // Dos consultorios con la misma clave compartirían carpeta de archivos: las
  // firmas y los PDF de uno acabarían junto a los del otro.
  const claves = new Set(entradas.map(([, c]) => c.clave))
  if (claves.size !== entradas.length) abortar('Hay dos consultorios con la misma clave')

  // Y dos apuntando a la misma base serían, sencillamente, el mismo
  // consultorio con dos nombres. Casi siempre es un copiar y pegar a medias.
  const bases = new Set(entradas.map(([, c]) => c.baseDeDatos))
  if (bases.size !== entradas.length) abortar('Hay dos consultorios con la misma base de datos')

  return new Map(entradas.map(([dominio, c]) => [normalizarDominio(dominio), c]))
}

function abortar(detalle: string): never {
  console.error(`\nNo se puede arrancar: CONSULTORIOS es inválida.\n\n${detalle}\n`)
  process.exit(1)
}

/** Sin puerto y en minúsculas: `SanRafael.local:3000` y `sanrafael.local` son el mismo sitio. */
export function normalizarDominio(valor: string): string {
  return valor.trim().toLowerCase().replace(/:\d+$/, '')
}

const mapa = leerMapa()

/** ¿Este proceso atiende a más de un consultorio? */
export const esMultiConsultorio = mapa !== null

/** El consultorio único, cuando no hay mapa de dominios. */
export const consultorioUnico: Consultorio = {
  clave: CLAVE_UNICA,
  baseDeDatos: env.DATABASE_URL,
}

export const consultorios: Consultorio[] = mapa ? [...mapa.values()] : [consultorioUnico]

/**
 * Consultorio al que pertenece un dominio.
 *
 * Devuelve `null` si no está configurado. Quien llama DEBE rechazar la
 * petición: caer en un consultorio por defecto ante un dominio desconocido es
 * la forma más fácil de servirle a alguien los datos de otra clínica.
 */
export function consultorioDeDominio(dominio: string): Consultorio | null {
  if (!mapa) return consultorioUnico
  return mapa.get(normalizarDominio(dominio)) ?? null
}

/** Consultorio por su clave. Lo usan los scripts de línea de comandos. */
export function consultorioDeClave(clave: string): Consultorio | null {
  return consultorios.find((c) => c.clave === clave) ?? null
}
