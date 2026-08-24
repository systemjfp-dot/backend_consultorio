/**
 * La interfaz servida desde el mismo proceso que la API.
 *
 * Lo que se comprueba aquí no es que el HTML sea bonito, sino los dos bordes
 * donde esto se rompe: que una ruta del navegador reciba la aplicación, y que
 * una ruta de API inexistente siga devolviendo JSON.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const HTML = '<!doctype html><title>Consultorio</title><div id="root"></div>'

let app: Express

beforeAll(async () => {
  // Un `dist` de mentira: basta con que exista para que el middleware lo monte.
  const carpeta = mkdtempSync(join(tmpdir(), 'web-dist-'))
  writeFileSync(join(carpeta, 'index.html'), HTML)
  mkdirSync(join(carpeta, 'assets'))
  writeFileSync(join(carpeta, 'assets', 'index-abc123.js'), 'console.log(1)')

  vi.resetModules()
  process.env['WEB_DIST'] = carpeta

  const { crearApp } = await import('../app.js')
  app = crearApp()
})

afterAll(() => {
  delete process.env['WEB_DIST']
  vi.resetModules()
})

describe('interfaz servida por la API', () => {
  it('la raíz devuelve la aplicación', async () => {
    const res = await request(app).get('/')

    expect(res.status).toBe(200)
    expect(res.text).toContain('id="root"')
  })

  it('una ruta del navegador también, porque la resuelve React Router', async () => {
    // /agenda no es un archivo: es un estado de la aplicación. Si esto
    // devolviera 404, recargar la página en cualquier pantalla sacaría al
    // usuario del sistema.
    const res = await request(app).get('/agenda')

    expect(res.status).toBe(200)
    expect(res.text).toContain('id="root"')
  })

  it('una ruta de API inexistente sigue devolviendo JSON', async () => {
    // Servirle el index.html a una llamada de API convertiría un 404 claro en
    // un error de parseo lejos de su causa.
    const res = await request(app).get('/api/no-existe')

    expect(res.status).toBe(404)
    expect(res.body.error.codigo).toBe('NO_ENCONTRADO')
  })

  it('el index.html no se cachea', async () => {
    // Es el que apunta a los assets con hash. Cacheado, tras un despliegue el
    // navegador seguiría pidiendo los del anterior —que ya no existen— y la
    // aplicación quedaría en blanco.
    const res = await request(app).get('/')

    expect(res.headers['cache-control']).toContain('no-cache')
  })

  it('los assets con hash sí se cachean', async () => {
    const res = await request(app).get('/assets/index-abc123.js')

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toContain('max-age=31536000')
  })
})
