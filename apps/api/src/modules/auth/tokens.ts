/**
 * Emisión y verificación de tokens.
 *
 * DECISIÓN CLAVE: el access token lleva únicamente el id de usuario y el de
 * sesión. Ni roles ni permisos.
 *
 * Es lo acordado en datos/ROLES-Y-PERMISOS.md §10. Si los permisos viajaran
 * dentro del token, quitarle un permiso a alguien —o echarlo de la clínica—
 * tardaría hasta que expire el token en surtir efecto. Resolverlos por
 * petición cuesta una consulta indexada, algo irrelevante a esta escala, y a
 * cambio la revocación es inmediata y de paso se comprueba en cada llamada que
 * la cuenta siga activa y la sesión no esté revocada.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { ErrorNoAutenticado } from '../../core/errores.js'

const EMISOR = 'consultorio'

/** Tipos de token. El campo `typ` impide usar uno donde va otro. */
type TipoToken = 'acceso' | 'desafio2fa'

interface CargaToken {
  sub: string
  sid: string
  typ: TipoToken
}

// --- Access token ------------------------------------------------------------

export function firmarAccessToken(usuarioId: string, sesionId: string): string {
  const carga: CargaToken = { sub: usuarioId, sid: sesionId, typ: 'acceso' }

  return jwt.sign(carga, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: EMISOR,
  } as jwt.SignOptions)
}

export function verificarAccessToken(token: string): { usuarioId: string; sesionId: string } {
  return verificar(token, 'acceso')
}

// --- Token de desafío 2FA ----------------------------------------------------

/**
 * Token efímero entre "la contraseña es correcta" y "el código TOTP es
 * correcto". Evita tener que reenviar la contraseña en el segundo paso.
 *
 * Cinco minutos: suficiente para abrir la aplicación de autenticación y
 * teclear el código, y poco para que sirva de algo si se filtra.
 */
export function firmarTokenDesafio2FA(usuarioId: string): string {
  const carga: CargaToken = { sub: usuarioId, sid: 'desafio', typ: 'desafio2fa' }

  return jwt.sign(carga, env.JWT_ACCESS_SECRET, {
    expiresIn: '5m',
    issuer: EMISOR,
  })
}

export function verificarTokenDesafio2FA(token: string): { usuarioId: string } {
  const { usuarioId } = verificar(token, 'desafio2fa')
  return { usuarioId }
}

function verificar(token: string, tipoEsperado: TipoToken) {
  let carga: CargaToken
  try {
    carga = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: EMISOR }) as CargaToken
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ErrorNoAutenticado('Tu sesión expiró. Vuelve a iniciar sesión.')
    }
    throw new ErrorNoAutenticado('Token inválido')
  }

  // Sin esta comprobación, un token de desafío 2FA —que se entrega ANTES de
  // validar el segundo factor— serviría como token de acceso, y bastaría con
  // saber la contraseña para saltarse el 2FA por completo.
  if (carga.typ !== tipoEsperado) throw new ErrorNoAutenticado('Token inválido')

  return { usuarioId: carga.sub, sesionId: carga.sid }
}

// --- Refresh token -----------------------------------------------------------

/**
 * El refresh token es aleatorio, no un JWT: no necesita llevar información
 * porque siempre se contrasta contra la fila de `Session`. Al ser opaco, no
 * revela nada si alguien lo intercepta, y la única fuente de verdad sobre su
 * validez es la base de datos, que es donde se puede revocar.
 *
 * En la base se guarda solo el hash: si alguien obtiene una copia de la tabla
 * `Session`, no puede suplantar a nadie.
 */
export function generarRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

export function hashRefreshToken(token: string): string {
  // SHA-256 y no bcrypt: el token ya tiene 384 bits de entropía, así que no
  // hay nada que un ataque de diccionario pueda adivinar. Y como este hash se
  // calcula en cada renovación, conviene que sea barato.
  return createHash('sha256').update(token).digest('hex')
}

/** Comparación en tiempo constante de dos hashes hexadecimales. */
export function hashesIguales(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex')
  const bufferB = Buffer.from(b, 'hex')
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

// --- Tokens de un solo uso (recuperación de contraseña) ----------------------

export function generarTokenUnUso(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: createHash('sha256').update(token).digest('hex') }
}

export function hashTokenUnUso(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
