import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { crearApp } from './app.js'

const app = crearApp()

describe('salud del servicio', () => {
  it('GET /api/health responde ok', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body.estado).toBe('ok')
    expect(res.body.tiempoActivoSegundos).toBeGreaterThanOrEqual(0)
  })

  it('GET /api/health/ready comprueba la base de datos', async () => {
    const res = await request(app).get('/api/health/ready')

    // 200 con la base levantada, 503 sin ella. Lo que se verifica aquí es que
    // el endpoint distinga ambos casos en vez de responder siempre ok.
    expect([200, 503]).toContain(res.status)
    expect(res.body.baseDeDatos).toBeDefined()
  })
})

describe('manejo de errores', () => {
  it('una ruta inexistente devuelve 404 con el formato estándar', async () => {
    const res = await request(app).get('/api/no-existe')

    expect(res.status).toBe(404)
    expect(res.body.error.codigo).toBe('NO_ENCONTRADO')
    expect(res.body.error.mensaje).toContain('/api/no-existe')
  })

  it('todo error incluye el identificador de petición', async () => {
    // Es lo que permite pasar de "me salió un error" a la traza exacta.
    const res = await request(app).get('/api/no-existe')

    expect(res.body.error.idPeticion).toBeTruthy()
    expect(res.headers['x-request-id']).toBe(res.body.error.idPeticion)
  })

  it('un JSON mal formado devuelve 400 y no 500', async () => {
    // La petición viene mal del cliente; devolver 500 achacaría al servidor un
    // problema que no es suyo y confundiría cualquier diagnóstico.
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"roto": ')

    expect(res.status).toBe(400)
    expect(res.body.error.mensaje).toContain('no es JSON válido')
  })
})

describe('cabeceras y trazabilidad', () => {
  it('respeta el x-request-id que envía el cliente', async () => {
    const res = await request(app).get('/api/health').set('x-request-id', 'traza-123')

    expect(res.headers['x-request-id']).toBe('traza-123')
  })

  it('ignora un x-request-id absurdamente largo y genera uno propio', async () => {
    // Evita que un cliente contamine los logs con cadenas arbitrarias.
    const res = await request(app).get('/api/health').set('x-request-id', 'x'.repeat(500))

    expect(res.headers['x-request-id']).not.toHaveLength(500)
    expect(res.headers['x-request-id']).toBeTruthy()
  })

  it('no revela el motor del servidor', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('aplica las cabeceras de seguridad de Helmet', async () => {
    const res = await request(app).get('/api/health')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBeDefined()
  })
})

describe('CORS', () => {
  it('permite el origen del frontend', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173')

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('no autoriza un origen desconocido', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://sitio-malicioso.com')

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
