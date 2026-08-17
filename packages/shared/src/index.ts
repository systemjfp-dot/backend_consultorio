/**
 * Punto de entrada del paquete compartido.
 *
 * Todo lo que se exporte aquí lo consumen TANTO la API como la web.
 * Regla: aquí solo va lo que ambos lados necesitan (contratos Zod, catálogo de
 * permisos, utilidades puras). Nada de acceso a base de datos ni al DOM.
 *
 */

export const VERSION_CONTRATOS = '0.1.0'

export * from './auth/permisos.js'
export * from './auth/roles.js'
export * from './contratos/auth.js'
export * from './contratos/auditoria.js'
export * from './contratos/pacientes.js'
export * from './contratos/agenda.js'
export * from './contratos/citas.js'
export * from './contratos/atenciones.js'
