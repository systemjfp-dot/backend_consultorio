/**
 * Arranque del servidor HTTP.
 *
 * Este archivo SOLO se encarga de levantar y apagar el proceso.
 * La construcción de la aplicación Express vive en `app.ts`, para que las
 * pruebas puedan crear la app sin abrir un puerto. Llega en el paso H0.4.
 */

const puerto = Number(process.env['PORT'] ?? 3000)

console.log(`[api] esqueleto listo — el servidor Express llega en H0.4 (puerto ${puerto})`)
