/**
 * Sirve la interfaz web desde el mismo proceso que la API.
 *
 * En desarrollo la web la sirve Vite en su propio puerto y las llamadas a
 * `/api` llegan por su proxy. En producción no hay tal proxy: se despliega un
 * único contenedor que responde tanto la API como la aplicación, de modo que
 * cada consultorio tiene UN dominio y no hay CORS de por medio.
 *
 * DOS DETALLES QUE IMPORTAN:
 *
 * 1. El 404 de `/api` sigue siendo JSON. Devolver el `index.html` ante una
 *    ruta de API mal escrita le daría al cliente HTML donde espera datos, y el
 *    error aparecería como un fallo de parseo lejos de su causa.
 *
 * 2. El `index.html` NO se cachea; los assets sí, y de forma agresiva. Vite
 *    les pone un hash en el nombre, así que un archivo concreto nunca cambia
 *    de contenido. El `index.html`, en cambio, es el que apunta a los hashes
 *    nuevos: si el navegador se quedara con una copia vieja, seguiría pidiendo
 *    los assets del despliegue anterior —que ya no existen— y la aplicación
 *    quedaría en blanco tras cada actualización.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Express } from 'express'
import { logger } from '../core/logger.js'

/**
 * Dónde quedó el `dist` de la web.
 *
 * Se puede fijar con `WEB_DIST`. Por defecto se busca relativo a este archivo
 * compilado (`apps/api/dist/middleware/`), subiendo hasta la raíz del
 * repositorio, que es donde lo deja el build del contenedor.
 */
function carpetaDeLaWeb(): string | null {
  const configurada = process.env['WEB_DIST']?.trim()
  if (configurada) return existsSync(configurada) ? resolve(configurada) : null

  const aqui = dirname(fileURLToPath(import.meta.url))
  const candidata = resolve(aqui, '../../../web/dist')

  return existsSync(candidata) ? candidata : null
}

/**
 * Monta la web si está compilada.
 *
 * Si no lo está —desarrollo, o un contenedor que solo trae la API— no monta
 * nada y el servidor sigue siendo solo la API. Se avisa por el log: un
 * despliegue de producción sin interfaz es casi siempre un build a medias, y
 * conviene que se vea en el arranque y no cuando alguien abre la página.
 */
export function montarWeb(app: Express): void {
  const carpeta = carpetaDeLaWeb()

  if (!carpeta) {
    logger.info('Sin interfaz compilada: este proceso sirve solo la API')
    return
  }

  const indice = join(carpeta, 'index.html')

  app.use(
    express.static(carpeta, {
      // Un año para todo lo que lleva hash en el nombre.
      maxAge: '1y',
      index: false,
      setHeaders(res, ruta) {
        if (ruta === indice) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )

  // Cualquier ruta que no sea de la API la resuelve el enrutador del navegador:
  // /agenda, /pacientes/123… no son archivos, son estados de la aplicación.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indice)
  })

  logger.info({ carpeta }, 'Interfaz web servida desde este mismo proceso')
}
