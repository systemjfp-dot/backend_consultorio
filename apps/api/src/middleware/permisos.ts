/**
 * Control de acceso a nivel de ruta.
 *
 * Cada ruta del sistema debe declarar EXPLÍCITAMENTE una de tres cosas:
 *
 *   requierePermiso(p)  → hace falta ese permiso
 *   rutaPropia(motivo)  → basta con tener sesión; actúa sobre la cuenta propia
 *   rutaPublica(motivo) → accesible sin sesión, a propósito
 *
 * No hay cuarta opción, y una prueba recorre todas las rutas registradas y
 * falla si alguna no declara ninguna. Eso convierte la vulnerabilidad más
 * común de estos sistemas —el endpoint nuevo que alguien olvidó proteger— en
 * un fallo de la suite de pruebas en vez de un incidente.
 *
 * Los marcadores viven junto a la ruta, no en una lista aparte: una lista de
 * excepciones por ruta se desactualiza en cuanto alguien renombra un path.
 */

import type { Alcance, Permiso } from '@consultorio/shared'
import type { RequestHandler } from 'express'
import { contextoPuede } from '../core/permisos.js'
import { ErrorNoAutenticado, ErrorProhibido } from '../core/errores.js'

/** Metadatos que la prueba de cobertura lee de cada manejador. */
export interface MarcadorAcceso {
  permisoRequerido?: Permiso
  alcanceRequerido?: Alcance
  esPropia?: boolean
  esPublica?: boolean
  motivo?: string
}

export type ManejadorMarcado = RequestHandler & MarcadorAcceso

/**
 * Exige un permiso.
 *
 * El `alcance` es opcional y casi nunca hace falta aquí: el middleware
 * responde "¿puede tocar este recurso?", y el filtrado de filas ocurre después
 * en el repositorio. Solo se indica cuando la ruta entera carece de sentido
 * sin alcance total (por ejemplo, un reporte de toda la clínica).
 */
export function requierePermiso(permiso: Permiso, alcance?: Alcance): ManejadorMarcado {
  const manejador: ManejadorMarcado = (req, _res, next) => {
    if (!req.auth) return next(new ErrorNoAutenticado())

    if (!contextoPuede(req.auth, permiso, alcance)) {
      return next(
        new ErrorProhibido('No tienes permiso para realizar esta acción', { permiso }),
      )
    }

    next()
  }

  manejador.permisoRequerido = permiso
  if (alcance) manejador.alcanceRequerido = alcance
  return manejador
}

/**
 * Ruta que solo requiere sesión, porque opera sobre la cuenta de quien llama:
 * cambiar su propia contraseña, ver sus propias sesiones, configurar su 2FA.
 *
 * No necesita permiso porque no hay nada que autorizar más allá de ser uno
 * mismo. El motivo es obligatorio para que la decisión quede justificada donde
 * se toma.
 */
export function rutaPropia(motivo: string): ManejadorMarcado {
  const manejador: ManejadorMarcado = (req, _res, next) => {
    if (!req.auth) return next(new ErrorNoAutenticado())
    next()
  }

  manejador.esPropia = true
  manejador.motivo = motivo
  return manejador
}

/**
 * Ruta deliberadamente pública. El motivo es obligatorio: si alguien no puede
 * explicar en una frase por qué una ruta no lleva autenticación, probablemente
 * no debería estar abierta.
 */
export function rutaPublica(motivo: string): ManejadorMarcado {
  const manejador: ManejadorMarcado = (_req, _res, next) => next()

  manejador.esPublica = true
  manejador.motivo = motivo
  return manejador
}

export function estaMarcado(manejador: unknown): manejador is ManejadorMarcado {
  if (typeof manejador !== 'function') return false
  const m = manejador as MarcadorAcceso
  return Boolean(m.permisoRequerido ?? m.esPropia ?? m.esPublica)
}
