/**
 * Contexto de autenticación de una petición.
 *
 * Es lo mínimo que necesitan el middleware de permisos y los repositorios para
 * decidir qué puede hacer y qué filas puede ver quien está llamando.
 *
 * Se mantiene deliberadamente pequeño (no es el modelo `User` completo) para
 * que la lógica de autorización sea probable sin base de datos.
 *
 * El comportamiento (`puede`, `alcanceDe`) y quien lo construye llegan en H0.6;
 * aquí se declara la forma para que el resto del sistema ya pueda tiparse.
 */

import type { Rol } from '@consultorio/shared'

export interface ContextoAuth {
  usuarioId: string
  sesionId: string
  roles: Rol[]
  /** Presente solo si el usuario tiene rol DOCTOR. Define el alcance `own`. */
  doctorId?: string
  extraPermissions: string[]
  deniedPermissions: string[]
}
