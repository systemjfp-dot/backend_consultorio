/**
 * Punto de entrada del paquete compartido.
 *
 * Todo lo que se exporte aquí lo consumen TANTO la API como la web.
 * Regla: aquí solo va lo que ambos lados necesitan (contratos Zod, catálogo de
 * permisos, utilidades puras). Nada de acceso a base de datos ni al DOM.
 *
 * El catálogo de permisos y la matriz de roles llegan en el paso H0.3.
 */

export const VERSION_CONTRATOS = '0.1.0'
