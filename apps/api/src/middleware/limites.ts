/**
 * Límites de peticiones.
 *
 * El documento maestro pedía "100 peticiones por minuto por IP". Eso no
 * funciona en un consultorio: cinco recepcionistas, tres médicos y las tablets
 * salen todos por el mismo router, con una única IP pública. Compartirían una
 * sola cuota y el sistema se bloquearía solo en la hora punta, justo cuando más
 * se usa.
 *
 * Por eso el límite general se aplica POR USUARIO autenticado, y se cae a la IP
 * únicamente cuando todavía no hay sesión (que es cuando la IP sí es la unidad
 * correcta: ahí lo que se defiende es el inicio de sesión).
 */

import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit'
import type { Request } from 'express'
import { esPrueba } from '../config/env.js'
import { ErrorLimiteExcedido } from '../core/errores.js'

/** Usuario autenticado si lo hay; si no, la IP (normalizada para IPv6). */
function claveporUsuarioOIp(req: Request): string {
  const usuarioId = req.auth?.usuarioId
  if (usuarioId) return `u:${usuarioId}`
  return `ip:${ipKeyGenerator(req.ip ?? '')}`
}

function crearLimite(opciones: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // En las pruebas el límite estorba: se ejecutan cientos de peticiones
    // seguidas desde la misma clave.
    skip: () => esPrueba,
    handler: (_req, _res, next) => next(new ErrorLimiteExcedido()),
    ...opciones,
  })
}

/**
 * Límite general de la API.
 * Holgado a propósito: una recepcionista buscando pacientes mientras escribe
 * genera muchas peticiones legítimas por minuto.
 */
export const limiteGeneral = crearLimite({
  windowMs: 60_000,
  limit: 300,
  keyGenerator: claveporUsuarioOIp,
})

/**
 * Límite de inicio de sesión, por IP.
 * Estrecho porque aquí sí defendemos contra fuerza bruta. Solo cuentan los
 * intentos fallidos: quien acierta la contraseña no consume cuota, así que un
 * consultorio entero puede entrar a las 8 de la mañana sin bloquearse.
 */
export const limiteAutenticacion = crearLimite({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `auth:${ipKeyGenerator(req.ip ?? '')}`,
  handler: (_req, _res, next) =>
    next(
      new ErrorLimiteExcedido(
        'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.',
      ),
    ),
})

/**
 * Límite para operaciones que envían correos o mensajes (recuperar contraseña,
 * reenviar recordatorio). Evita que el sistema se convierta en un emisor de
 * spam a costa nuestra.
 */
export const limiteEnvios = crearLimite({
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: claveporUsuarioOIp,
})
