/**
 * Logger de la aplicación.
 *
 * REGLA IRRENUNCIABLE EN ESTE SISTEMA: los logs no llevan datos clínicos ni
 * datos personales. Un diagnóstico o un DNI que caiga en un archivo de log
 * queda fuera de todos los controles de acceso que construimos, se replica en
 * cualquier servicio de observabilidad y no hay forma de borrarlo si el
 * paciente ejerce su derecho de supresión.
 *
 * Para trazar QUIÉN accedió a QUÉ está AuditLog, que sí vive en la base, es
 * inmutable y está sujeto a permisos.
 */

import { pino } from 'pino'
import { env, esDesarrollo } from '../config/env.js'

/**
 * Campos que nunca deben aparecer en un log, ni siquiera por accidente al
 * volcar un objeto completo con `logger.info({ body })`.
 */
const CAMPOS_CENSURADOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
  '*.refreshTokenHash',
  '*.token',
  '*.accessToken',
  '*.twoFactorSecret',
  '*.signatureData',
  // Datos de salud y personales: si alguien vuelca una entidad entera, que no
  // se filtren los campos más sensibles.
  '*.diagnosis',
  '*.currentIllness',
  '*.treatmentPlan',
  '*.allergies',
  '*.medicalHistory',
  '*.document',
]

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: CAMPOS_CENSURADOS,
    censor: '[censurado]',
  },
  // En desarrollo, salida legible. En producción, JSON por línea.
  ...(esDesarrollo
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
})

export type Logger = typeof logger
