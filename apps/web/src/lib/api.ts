/**
 * Cliente de la API.
 *
 * DÓNDE VIVE EL TOKEN, y por qué importa:
 *
 * El access token se guarda en una variable de este módulo — en memoria — y no
 * en localStorage. Cualquier script que llegue a ejecutarse en la página puede
 * leer localStorage; con historias clínicas de por medio, ese riesgo no se
 * asume. En memoria, un token robado exige ejecución activa en ese instante.
 *
 * El precio es que al recargar la página se pierde. No importa: el refresh
 * token vive en una cookie httpOnly que JavaScript no puede leer, y al
 * arrancar la aplicación pide una renovación y recupera la sesión. Es el mismo
 * mecanismo que ya usa el backend, visto desde este lado.
 */

let accessToken: string | null = null

export function guardarAccessToken(token: string | null): void {
  accessToken = token
}

export function hayAccessToken(): boolean {
  return accessToken !== null
}

export interface DetalleValidacion {
  campo: string
  mensaje: string
}

/** Error con la forma que devuelve el backend. */
export class ErrorApi extends Error {
  readonly estado: number
  readonly codigo: string
  readonly detalles: unknown
  readonly idPeticion: string | undefined

  constructor(
    estado: number,
    codigo: string,
    mensaje: string,
    detalles?: unknown,
    idPeticion?: string,
  ) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.estado = estado
    this.codigo = codigo
    this.detalles = detalles
    this.idPeticion = idPeticion
  }

  /** Errores por campo, cuando el backend devolvió una validación. */
  get camposInvalidos(): DetalleValidacion[] {
    const detalles = this.detalles as { campos?: DetalleValidacion[] } | undefined
    return detalles?.campos ?? []
  }
}

/**
 * Renovación en curso.
 *
 * Si cinco peticiones reciben 401 a la vez —cosa habitual en una pantalla que
 * carga varias cosas— sin esto se dispararían cinco renovaciones simultáneas.
 * Como el backend ROTA el refresh token en cada una y revoca el anterior, la
 * segunda llegaría con un token ya usado: el servidor lo interpretaría como
 * reutilización y cerraría todas las sesiones del usuario. Es decir, cargar
 * una pantalla expulsaría a la persona.
 *
 * Compartiendo una única promesa, las cinco esperan la misma renovación.
 */
export interface SesionRenovada {
  accessToken: string
  usuario: unknown
}

let renovacionEnCurso: Promise<SesionRenovada | null> | null = null

async function renovarSesion(): Promise<SesionRenovada | null> {
  renovacionEnCurso ??= (async () => {
    try {
      const respuesta = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      })
      if (!respuesta.ok) return null

      // La renovación ya devuelve los datos del usuario, así que recuperar la
      // sesión al arrancar cuesta UNA petición y no dos.
      const datos = (await respuesta.json()) as SesionRenovada
      accessToken = datos.accessToken
      return datos
    } catch {
      return null
    } finally {
      // Se libera en el siguiente ciclo para que las peticiones que ya estaban
      // esperando compartan este resultado y no arranquen otra ronda.
      queueMicrotask(() => {
        renovacionEnCurso = null
      })
    }
  })()

  return renovacionEnCurso
}

/** Aviso a la aplicación de que la sesión se perdió de forma irrecuperable. */
type ManejadorSesionPerdida = () => void
let alPerderSesion: ManejadorSesionPerdida = () => undefined

export function alPerderLaSesion(manejador: ManejadorSesionPerdida): void {
  alPerderSesion = manejador
}

interface OpcionesPeticion extends Omit<RequestInit, 'body'> {
  cuerpo?: unknown
  /** Uso interno: evita reintentar en bucle tras renovar. */
  reintentado?: boolean
}

export async function peticion<T>(ruta: string, opciones: OpcionesPeticion = {}): Promise<T> {
  const { cuerpo, reintentado, headers, ...resto } = opciones

  const respuesta = await fetch(ruta, {
    ...resto,
    credentials: 'include',
    headers: {
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  })

  // 401 con sesión: probablemente el access token caducó (dura 15 minutos).
  // Se renueva una vez y se reintenta; si tampoco así, la sesión se acabó.
  if (respuesta.status === 401 && !reintentado && ruta !== '/api/auth/refresh') {
    if (await renovarSesion()) {
      return peticion<T>(ruta, { ...opciones, reintentado: true })
    }
    accessToken = null
    alPerderSesion()
  }

  if (respuesta.status === 204) return undefined as T

  const datos: unknown = await respuesta.json().catch(() => null)

  if (!respuesta.ok) {
    const error = (datos as { error?: { codigo: string; mensaje: string; detalles?: unknown; idPeticion?: string } })
      ?.error

    throw new ErrorApi(
      respuesta.status,
      error?.codigo ?? 'ERROR_DESCONOCIDO',
      error?.mensaje ?? 'No se pudo completar la operación. Revisa tu conexión.',
      error?.detalles,
      error?.idPeticion,
    )
  }

  return datos as T
}

export const api = {
  get: <T,>(ruta: string) => peticion<T>(ruta),
  post: <T,>(ruta: string, cuerpo?: unknown) => peticion<T>(ruta, { method: 'POST', cuerpo }),
  put: <T,>(ruta: string, cuerpo?: unknown) => peticion<T>(ruta, { method: 'PUT', cuerpo }),
  patch: <T,>(ruta: string, cuerpo?: unknown) => peticion<T>(ruta, { method: 'PATCH', cuerpo }),
  delete: <T,>(ruta: string) => peticion<T>(ruta, { method: 'DELETE' }),
}

/**
 * Descarga un archivo binario protegido.
 *
 * Hace falta porque el access token vive EN MEMORIA, no en una cookie: un
 * enlace normal o un `window.open()` saldrían sin la cabecera de autorización
 * y recibirían un 401. Se pide con el cliente —que sí la añade— y se envuelve
 * el resultado en una URL de objeto que el navegador puede abrir.
 */
export async function descargarArchivo(ruta: string): Promise<string> {
  const respuesta = await fetch(ruta, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })

  if (!respuesta.ok) {
    const datos = (await respuesta.json().catch(() => null)) as
      | { error?: { codigo: string; mensaje: string } }
      | null

    throw new ErrorApi(
      respuesta.status,
      datos?.error?.codigo ?? 'ERROR_DESCONOCIDO',
      datos?.error?.mensaje ?? 'No se pudo abrir el documento',
    )
  }

  return URL.createObjectURL(await respuesta.blob())
}

/**
 * Intenta recuperar la sesión al arrancar usando la cookie de refresh.
 * Devuelve los datos del usuario, o null si no había sesión que recuperar.
 */
export async function recuperarSesion(): Promise<SesionRenovada | null> {
  return renovarSesion()
}
