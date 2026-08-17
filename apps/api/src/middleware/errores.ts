/**
 * Traducción de errores a respuestas HTTP.
 *
 * Único lugar del sistema donde un error se convierte en respuesta. Los
 * services lanzan y se olvidan.
 */

import { Prisma } from '@prisma/client'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'
import { esProduccion } from '../config/env.js'
import { logger } from '../core/logger.js'
import {
  ErrorAplicacion,
  ErrorConflicto,
  ErrorInterno,
  ErrorNoEncontrado,
  ErrorPeticion,
  ErrorValidacion,
} from '../core/errores.js'

/**
 * Mensajes para los constraints que definimos a mano en la migración inicial.
 *
 * Sin esto, chocar con el constraint de solapamiento le mostraría a la
 * recepcionista un volcado de PostgreSQL. Con esto, le dice qué pasó y qué
 * puede hacer.
 */
const MENSAJES_POR_CONSTRAINT: Record<string, string> = {
  Appointment_sin_solapamiento:
    'Ese horario se cruza con otra cita del mismo médico. Elige otra hora o marca la cita como sobreagenda.',
  Schedule_sin_solapamiento:
    'Ese horario se superpone con otra franja del mismo médico ese día.',
  Schedule_rango_valido: 'La hora de inicio debe ser anterior a la de fin.',
  ScheduleException_rango_valido: 'La hora de inicio debe ser anterior a la de fin.',
  Appointment_rango_valido: 'La cita debe terminar después de haber empezado.',
  Attendance_signos_vitales_plausibles:
    'Algún signo vital está fuera de rango. Revisa los valores ingresados.',
  ClinicSettings_fila_unica: 'Solo puede existir una configuración de clínica.',
}

/** Busca el nombre de un constraint conocido dentro del mensaje de PostgreSQL. */
function constraintEnMensaje(mensaje: string): string | undefined {
  return Object.keys(MENSAJES_POR_CONSTRAINT).find((nombre) => mensaje.includes(nombre))
}

/**
 * Errores que lanza body-parser (el `express.json()` de la app) antes de que
 * la petición llegue a ninguna ruta: JSON mal formado, cuerpo demasiado
 * grande, codificación no soportada. Siguen la convención de `http-errors`:
 * traen `status` y `expose`.
 *
 * Sin este caso terminaban clasificados como error interno, y un cliente que
 * manda `{"roto":` recibía un 500 —"la culpa es del servidor"— cuando en
 * realidad la petición venía mal.
 */
interface ErrorHttpDeLibreria {
  status?: number
  statusCode?: number
  expose?: boolean
  type?: string
  message: string
}

function esErrorDeCuerpo(error: unknown): error is ErrorHttpDeLibreria {
  if (typeof error !== 'object' || error === null) return false
  const e = error as ErrorHttpDeLibreria
  const estado = e.status ?? e.statusCode
  return typeof estado === 'number' && estado >= 400 && estado < 500 && e.expose === true
}

/** Convierte cualquier error en un ErrorAplicacion con estado y código. */
function normalizar(error: unknown): ErrorAplicacion {
  if (error instanceof ErrorAplicacion) return error

  if (esErrorDeCuerpo(error)) {
    const estado = error.status ?? error.statusCode ?? 400

    if (error.type === 'entity.parse.failed') {
      return new ErrorPeticion('El cuerpo de la petición no es JSON válido')
    }
    if (error.type === 'entity.too.large') {
      return new ErrorAplicacion(
        'El contenido enviado es demasiado grande',
        413,
        'CONTENIDO_DEMASIADO_GRANDE',
      )
    }
    return new ErrorAplicacion(error.message, estado, 'PETICION_INVALIDA')
  }

  if (error instanceof ZodError) {
    return new ErrorValidacion('Los datos enviados no son válidos', {
      campos: error.issues.map((issue) => ({
        campo: issue.path.join('.'),
        mensaje: issue.message,
      })),
    })
  }

  // Violaciones de CHECK y de constraints de exclusión. Prisma no las modela,
  // así que llegan como error "desconocido" con el texto crudo del motor.
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientKnownRequestError
  ) {
    const nombre = constraintEnMensaje(error.message)
    if (nombre) return new ErrorConflicto(MENSAJES_POR_CONSTRAINT[nombre]!, { constraint: nombre })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const campos = (error.meta?.['target'] as string[] | undefined)?.join(', ')
        return new ErrorConflicto(
          campos ? `Ya existe un registro con ese ${campos}.` : 'Ese registro ya existe.',
          { campos },
        )
      }
      case 'P2025':
        return new ErrorNoEncontrado()
      case 'P2003':
        return new ErrorConflicto(
          'No se puede completar: el registro está vinculado a otros datos.',
        )
      default:
        break
    }
  }

  const mensaje = error instanceof Error ? error.message : String(error)
  return new ErrorInterno(mensaje)
}

/** Ruta inexistente. Se registra antes del manejador de errores. */
export const manejadorNoEncontrado: RequestHandler = (req, _res, next) => {
  next(new ErrorNoEncontrado(`La ruta ${req.method} ${req.path} no existe`))
}

export const manejadorErrores: ErrorRequestHandler = (error, req, res, _next) => {
  const normalizado = normalizar(error)

  const contexto = {
    err: error,
    idPeticion: req.idPeticion,
    metodo: req.method,
    ruta: req.path,
    codigo: normalizado.codigo,
  }

  // 5xx es problema nuestro; 4xx es del cliente y no debe llenar los logs de
  // error, o los avisos importantes se pierden entre el ruido.
  if (normalizado.estado >= 500) logger.error(contexto, normalizado.message)
  else logger.debug(contexto, normalizado.message)

  // En producción, un 500 nunca revela el detalle interno: puede contener
  // fragmentos de consulta, rutas o nombres de columnas.
  const mensajePublico =
    esProduccion && normalizado.estado >= 500
      ? 'Ocurrió un error inesperado. Si persiste, contacta a soporte.'
      : normalizado.message

  res.status(normalizado.estado).json({
    error: {
      codigo: normalizado.codigo,
      mensaje: mensajePublico,
      ...(normalizado.detalles ? { detalles: normalizado.detalles } : {}),
      idPeticion: req.idPeticion,
    },
  })
}
