/**
 * Cifrado y comparación de contraseñas.
 */

import bcrypt from 'bcryptjs'

/**
 * Coste de bcrypt (el documento maestro pide 10).
 *
 * Cada punto duplica el trabajo. Diez es el equilibrio habitual: suficiente
 * para que probar contraseñas a gran escala sea caro, y lo bastante rápido
 * como para no volver lento el inicio de sesión.
 */
const RONDAS = 10

/**
 * Hash de una contraseña que no corresponde a nadie.
 *
 * Sirve para gastar el mismo tiempo cuando el correo no existe. Sin esto, el
 * login responde en 2 ms para un correo desconocido y en 100 ms para uno real,
 * y esa diferencia permite a cualquiera averiguar qué correos están
 * registrados en la clínica: un dato personal en sí mismo, y el primer paso
 * para un ataque dirigido.
 *
 * Se calcula una vez al cargar el módulo.
 */
const HASH_SENUELO = bcrypt.hashSync('contrasena-que-nadie-usa-jamas', RONDAS)

export async function cifrarContrasena(contrasena: string): Promise<string> {
  return bcrypt.hash(contrasena, RONDAS)
}

export async function verificarContrasena(
  contrasena: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(contrasena, hash)
}

/**
 * Consume el mismo tiempo que una verificación real, y siempre falla.
 * Se usa cuando el usuario no existe o está desactivado.
 */
export async function verificarContraSenuelo(contrasena: string): Promise<false> {
  await bcrypt.compare(contrasena, HASH_SENUELO)
  return false
}
