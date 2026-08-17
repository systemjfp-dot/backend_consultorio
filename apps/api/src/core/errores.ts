/**
 * Errores de la aplicación.
 *
 * Los services lanzan estas clases y un único middleware las traduce a HTTP.
 * Así ningún service necesita conocer `res`, y no hay forma de que dos
 * endpoints devuelvan formatos distintos para el mismo problema.
 */

export class ErrorAplicacion extends Error {
  readonly estado: number
  readonly codigo: string
  readonly detalles: unknown

  constructor(mensaje: string, estado: number, codigo: string, detalles?: unknown) {
    super(mensaje)
    this.name = new.target.name
    this.estado = estado
    this.codigo = codigo
    this.detalles = detalles
    Error.captureStackTrace?.(this, new.target)
  }
}

/** 400 — la petición está mal formada. */
export class ErrorPeticion extends ErrorAplicacion {
  constructor(mensaje: string, detalles?: unknown) {
    super(mensaje, 400, 'PETICION_INVALIDA', detalles)
  }
}

/** 401 — no hay sesión válida. */
export class ErrorNoAutenticado extends ErrorAplicacion {
  constructor(mensaje = 'Debes iniciar sesión') {
    super(mensaje, 401, 'NO_AUTENTICADO')
  }
}

/** 403 — hay sesión, pero no alcanza para esta acción. */
export class ErrorProhibido extends ErrorAplicacion {
  constructor(mensaje = 'No tienes permiso para realizar esta acción', detalles?: unknown) {
    super(mensaje, 403, 'PROHIBIDO', detalles)
  }
}

/** 404 — no existe, o el usuario no tiene alcance para verlo. */
export class ErrorNoEncontrado extends ErrorAplicacion {
  constructor(mensaje = 'No se encontró el recurso solicitado') {
    super(mensaje, 404, 'NO_ENCONTRADO')
  }
}

/** 409 — choca con el estado actual (horario ocupado, documento duplicado). */
export class ErrorConflicto extends ErrorAplicacion {
  constructor(mensaje: string, detalles?: unknown) {
    super(mensaje, 409, 'CONFLICTO', detalles)
  }
}

/** 422 — bien formada pero los datos no pasan validación. */
export class ErrorValidacion extends ErrorAplicacion {
  constructor(mensaje = 'Los datos enviados no son válidos', detalles?: unknown) {
    super(mensaje, 422, 'VALIDACION', detalles)
  }
}

/** 429 — demasiadas peticiones. */
export class ErrorLimiteExcedido extends ErrorAplicacion {
  constructor(mensaje = 'Demasiadas peticiones. Inténtalo de nuevo en unos momentos') {
    super(mensaje, 429, 'LIMITE_EXCEDIDO')
  }
}

/** 500 — falla nuestra. El detalle nunca sale al cliente. */
export class ErrorInterno extends ErrorAplicacion {
  constructor(mensaje = 'Ocurrió un error inesperado', detalles?: unknown) {
    super(mensaje, 500, 'ERROR_INTERNO', detalles)
  }
}

export function esErrorAplicacion(valor: unknown): valor is ErrorAplicacion {
  return valor instanceof ErrorAplicacion
}
