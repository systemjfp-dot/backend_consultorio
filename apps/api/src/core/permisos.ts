/**
 * Aplicación de permisos y alcance en el servidor.
 *
 * Dos preguntas distintas, deliberadamente separadas:
 *
 *   ¿PUEDE tocar este recurso?   → `exigirPermiso`, lo usa el middleware.
 *   ¿QUÉ FILAS puede ver?        → `filtroDeAlcance`, lo usa el repositorio.
 *
 * Mezclarlas es el origen del error clásico: el controlador comprueba el
 * permiso, da por buena la petición y consulta sin filtrar. El permiso estaba
 * bien y aun así un médico terminó viendo las historias de otro.
 */

import { puede, alcanceDe, type Alcance, type Permiso } from '@consultorio/shared'
import type { ContextoAuth } from './contexto.js'
import { ErrorProhibido } from './errores.js'

/** ¿El contexto tiene el permiso, con al menos el alcance pedido? */
export function contextoPuede(
  ctx: ContextoAuth,
  permiso: Permiso,
  alcance?: Alcance,
): boolean {
  return puede(ctx, permiso, alcance)
}

/** Igual, pero lanza 403 en vez de devolver false. Para usar en services. */
export function exigirPermiso(ctx: ContextoAuth, permiso: Permiso, alcance?: Alcance): void {
  if (!contextoPuede(ctx, permiso, alcance)) {
    throw new ErrorProhibido('No tienes permiso para realizar esta acción', { permiso })
  }
}

/**
 * Construye el fragmento `where` que restringe las filas visibles.
 *
 * ESTA FUNCIÓN ES EL PUNTO ÚNICO donde se decide el alcance. Los repositorios
 * la llaman en su constructor y la mezclan en TODAS sus consultas, de modo que
 * un endpoint nuevo no puede olvidarse del filtro: no hay una consulta "sin
 * filtrar" a la que recurrir.
 *
 * Devuelve:
 *   · `{}`                    si el alcance es `all` (sin restricción)
 *   · `{ [campo]: doctorId }` si el alcance es `own`
 *
 * Y lanza en los dos casos en que continuar sería inseguro:
 *   · sin el permiso → 403
 *   · alcance `own` pero el contexto no tiene doctorId → 403
 *
 * El segundo caso merece explicación. Que un usuario tenga alcance `own` sin
 * ser médico no debería pasar según la matriz, pero si pasara —un rol mal
 * configurado, un médico desactivado— devolver `{}` significaría "sin
 * restricción", es decir, mostrarle TODO. Ante una situación imposible, la
 * única respuesta segura es negar, no abrir.
 */
export function filtroDeAlcance(
  ctx: ContextoAuth,
  permiso: Permiso,
  campo = 'doctorId',
): Record<string, string> {
  const alcance = alcanceDe(ctx, permiso)

  if (!alcance) {
    throw new ErrorProhibido('No tienes permiso para consultar estos datos', { permiso })
  }

  if (alcance === 'all') return {}

  if (!ctx.doctorId) {
    throw new ErrorProhibido(
      'Tu cuenta tiene alcance limitado a sus propios registros pero no está asociada a un médico activo',
      { permiso },
    )
  }

  return { [campo]: ctx.doctorId }
}

/**
 * ¿El contexto ve todas las filas para este permiso?
 * Útil para decidir si hace falta comprobar la pertenencia de un registro
 * concreto antes de modificarlo.
 */
export function alcanceEsTotal(ctx: ContextoAuth, permiso: Permiso): boolean {
  return alcanceDe(ctx, permiso) === 'all'
}
