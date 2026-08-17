import type { ContextoAuth } from '../core/contexto.js'

declare global {
  namespace Express {
    interface Request {
      /** Identificador de la petición. Aparece en los logs y en los errores. */
      idPeticion: string
      /** Sesión resuelta. Lo completa el middleware de autenticación (H0.5). */
      auth?: ContextoAuth
    }
  }
}

export {}
