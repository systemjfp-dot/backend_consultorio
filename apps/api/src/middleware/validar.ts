/**
 * Validación de entradas con Zod.
 *
 * El principio: los services reciben datos YA validados y tipados. Nunca
 * inspeccionan `req` ni comprueban si un campo llegó. Toda la desconfianza
 * hacia el exterior se concentra en el borde.
 */

import type { RequestHandler } from 'express'
import type { ZodType } from 'zod'

/**
 * Valida `req.body` y lo REEMPLAZA por el resultado parseado.
 *
 * El reemplazo importa: Zod normaliza (recorta espacios, pasa el correo a
 * minúsculas, convierte tipos) y descarta las claves no declaradas. Si el
 * service leyera el body original, recibiría el correo tal como lo tecleó el
 * usuario —con mayúsculas y espacios— y "Ana@Clinica.com " no encontraría a
 * "ana@clinica.com".
 */
export function validarCuerpo(esquema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const resultado = esquema.safeParse(req.body)
    // El ZodError lo traduce a 422 el manejador central de errores.
    if (!resultado.success) return next(resultado.error)

    req.body = resultado.data
    next()
  }
}

/** Igual, para los parámetros de consulta. */
export function validarConsulta(esquema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const resultado = esquema.safeParse(req.query)
    if (!resultado.success) return next(resultado.error)

    // req.query es de solo lectura en Express 5; el resultado se deja en una
    // propiedad aparte que los controladores leen con tipo.
    Object.defineProperty(req, 'consulta', { value: resultado.data, configurable: true })
    next()
  }
}

/** Y para los parámetros de ruta. */
export function validarParametros(esquema: ZodType): RequestHandler {
  return (req, _res, next) => {
    const resultado = esquema.safeParse(req.params)
    if (!resultado.success) return next(resultado.error)

    Object.defineProperty(req, 'parametros', { value: resultado.data, configurable: true })
    next()
  }
}
