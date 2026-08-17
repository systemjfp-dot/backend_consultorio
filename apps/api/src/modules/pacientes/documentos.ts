/**
 * Consulta de datos por documento de identidad.
 *
 * POR QUÉ ES UN ADAPTADOR Y NO UNA LLAMADA DIRECTA:
 *
 * RENIEC no expone una API pública. Se llega a ella por convenio (con coste por
 * consulta) o a través de intermediarios comerciales, y cada uno devuelve una
 * forma distinta. Encerrar esa decisión tras una interfaz permite empezar sin
 * credenciales, cambiar de proveedor sin tocar el módulo de pacientes, y —lo
 * más importante— que el registro de pacientes funcione igual si el servicio
 * está caído: autocompletar es una comodidad, no un requisito.
 */

import { env } from '../../config/env.js'
import { logger } from '../../core/logger.js'

export interface DatosDocumento {
  nombres: string
  apellidos: string
  /** Algunos proveedores la devuelven; la mayoría no. */
  fechaNacimiento?: string
}

export interface ProveedorDocumentos {
  readonly nombre: string
  readonly disponible: boolean
  consultar(documento: string): Promise<DatosDocumento | null>
}

/**
 * Proveedor inactivo: el que rige mientras no haya credenciales.
 *
 * Devolver null en vez de fallar es deliberado. El formulario de registro debe
 * comportarse igual con y sin autocompletado; si esto lanzara, la ausencia de
 * una comodidad opcional impediría registrar pacientes.
 */
class ProveedorInactivo implements ProveedorDocumentos {
  readonly nombre = 'ninguno'
  readonly disponible = false

  async consultar(): Promise<null> {
    return null
  }
}

/**
 * Proveedor HTTP genérico.
 *
 * Sirve para los intermediarios habituales en Perú (apis.net.pe, decolecta,
 * factiliza, json.pe): todos exponen `GET <url>?numero=<dni>` con un token
 * Bearer y devuelven un JSON con los nombres. Se aceptan varias grafías de
 * campo porque no hay dos que coincidan.
 */
class ProveedorHttp implements ProveedorDocumentos {
  readonly nombre = 'http'
  readonly disponible = true

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async consultar(documento: string): Promise<DatosDocumento | null> {
    // Tiempo de espera corto: esto ocurre mientras el paciente está delante del
    // mostrador. Más de tres segundos y es más rápido teclear el nombre.
    const cancelar = AbortSignal.timeout(3_000)

    try {
      const respuesta = await fetch(`${this.url}?numero=${encodeURIComponent(documento)}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
        signal: cancelar,
      })

      if (!respuesta.ok) {
        // 404 significa "no existe", que es una respuesta legítima.
        if (respuesta.status !== 404) {
          logger.warn(
            { estado: respuesta.status, proveedor: this.nombre },
            'El proveedor de documentos respondió con error',
          )
        }
        return null
      }

      const datos = (await respuesta.json()) as Record<string, unknown>
      return normalizarRespuesta(datos)
    } catch (error) {
      // Caída, tiempo agotado o respuesta ilegible: se registra y se sigue. El
      // registro manual nunca debe depender de un servicio externo.
      logger.warn({ err: error, proveedor: this.nombre }, 'No se pudo consultar el documento')
      return null
    }
  }
}

/** Reconcilia las distintas grafías de campo de los proveedores peruanos. */
function normalizarRespuesta(datos: Record<string, unknown>): DatosDocumento | null {
  const texto = (...claves: string[]): string | undefined => {
    for (const clave of claves) {
      const valor = datos[clave]
      if (typeof valor === 'string' && valor.trim()) return valor.trim()
    }
    return undefined
  }

  const nombres = texto('nombres', 'first_name', 'firstName', 'prenombres')

  const apellidos =
    texto('apellidos', 'last_name', 'lastName') ??
    [texto('apellidoPaterno', 'apellido_paterno'), texto('apellidoMaterno', 'apellido_materno')]
      .filter(Boolean)
      .join(' ')

  if (!nombres || !apellidos) return null

  const fechaNacimiento = texto('fechaNacimiento', 'fecha_nacimiento', 'birthDate')

  return {
    nombres: aCapitalizacionDeNombre(nombres),
    apellidos: aCapitalizacionDeNombre(apellidos),
    ...(fechaNacimiento ? { fechaNacimiento } : {}),
  }
}

/**
 * "MARIA DEL CARMEN QUISPE" → "Maria Del Carmen Quispe".
 * Los proveedores devuelven todo en mayúsculas, y guardarlo así haría que las
 * recetas y las fichas se vieran como un grito.
 */
function aCapitalizacionDeNombre(texto: string): string {
  return texto
    .toLocaleLowerCase('es')
    .split(/\s+/)
    .map((palabra) => palabra.charAt(0).toLocaleUpperCase('es') + palabra.slice(1))
    .join(' ')
}

let proveedor: ProveedorDocumentos | null = null

export function proveedorDocumentos(): ProveedorDocumentos {
  proveedor ??=
    env.DNI_API_URL && env.DNI_API_TOKEN
      ? new ProveedorHttp(env.DNI_API_URL, env.DNI_API_TOKEN)
      : new ProveedorInactivo()

  return proveedor
}

/** Solo para pruebas: permite inyectar un proveedor controlado. */
export function establecerProveedorDocumentos(nuevo: ProveedorDocumentos | null): void {
  proveedor = nuevo
}
