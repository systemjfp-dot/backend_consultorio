/**
 * Aislamiento entre consultorios, de extremo a extremo.
 *
 * Las pruebas de `config/consultorios.test.ts` comprueban que el mapa resuelve
 * bien. Estas comprueban lo que de verdad importa: que una petición entrando
 * por el dominio de un consultorio NO ALCANZA los datos del otro, pasando por
 * la aplicación entera —sesión, permisos, repositorios—.
 *
 * Se montan dos bases de datos de verdad. Simular Prisma aquí no probaría
 * nada: el error que se teme es precisamente que la consulta acabe en la
 * conexión equivocada.
 */

import type { Express } from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { env } from '../config/env.js'

const CONTRASENA = 'Clinica2026!'

/** Dos bases sobre la misma instancia: la de siempre y una gemela vacía. */
const BASE_A = env.DATABASE_URL
const BASE_B = env.DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, '/$1_gemela$2')

const NOMBRE_B = BASE_B.match(/\/([^/?]+)(\?|$)/)?.[1] ?? ''

const CONSULTORIOS = JSON.stringify({
  'rafael.prueba': { clave: 'rafael-prueba', baseDeDatos: BASE_A },
  'santiago.prueba': { clave: 'santiago-prueba', baseDeDatos: BASE_B },
})

let app: Express
let cerrar: () => Promise<void>

const PACIENTE_A = { documento: '55110001', nombre: 'Aurora', apellido: 'Del Consultorio A' }
const PACIENTE_B = { documento: '55220002', nombre: 'Basilio', apellido: 'Del Consultorio B' }
const EMAIL_A = 'admin.a@aislamiento.test'
const EMAIL_B = 'admin.b@aislamiento.test'

beforeAll(async () => {
  const { execSync } = await import('node:child_process')

  // La base gemela se crea desde cero en cada ejecución: así la prueba no
  // depende de en qué estado la dejó la anterior.
  execSync(`dropdb --if-exists ${NOMBRE_B} && createdb ${NOMBRE_B}`, { stdio: 'ignore' })
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: BASE_B },
  })

  // El mapa se lee al importar, así que se define antes de traer los módulos.
  vi.resetModules()
  process.env['CONSULTORIOS'] = CONSULTORIOS

  const { crearApp } = await import('../app.js')
  const { conConsultorio, desconectarBaseDeDatos } = await import('../core/prisma.js')
  const { consultorioDeDominio } = await import('../config/consultorios.js')
  const { cifrarContrasena } = await import('../modules/auth/contrasenas.js')
  const { prisma } = await import('../core/prisma.js')

  app = crearApp()
  cerrar = desconectarBaseDeDatos

  const contrasena = await cifrarContrasena(CONTRASENA)

  // Un paciente y un administrador en cada consultorio, con datos que no se
  // parecen en nada: si aparece el de enfrente, se ve a simple vista.
  for (const [dominio, paciente, email] of [
    ['rafael.prueba', PACIENTE_A, EMAIL_A],
    ['santiago.prueba', PACIENTE_B, EMAIL_B],
  ] as const) {
    await conConsultorio(consultorioDeDominio(dominio)!, async () => {
      await prisma.patient.deleteMany({ where: { document: paciente.documento } })
      await prisma.session.deleteMany({ where: { user: { email } } })
      await prisma.user.deleteMany({ where: { email } })

      await prisma.clinicSettings.upsert({
        where: { id: 1 },
        update: {},
        create: {
          id: 1,
          name: `Clínica ${dominio}`,
          ruc: '20000000001',
          address: 'Calle Falsa 123',
          phone: '(01) 000-0000',
          email: `contacto@${dominio}`,
        },
      })

      await prisma.user.create({
        data: {
          email,
          password: contrasena,
          firstName: 'Admin',
          lastName: dominio,
          roles: ['ADMIN'],
        },
      })

      await prisma.patient.create({
        data: {
          document: paciente.documento,
          firstName: paciente.nombre,
          lastName: paciente.apellido,
          birthDate: new Date('1980-01-01'),
          gender: 'F',
          phone: '999000111',
        },
      })
    })
  }
})

afterAll(async () => {
  await cerrar?.()
  delete process.env['CONSULTORIOS']
  vi.resetModules()
})

/** Inicia sesión entrando por el dominio de un consultorio. */
async function sesion(dominio: string, email: string) {
  const res = await request(app)
    .post('/api/auth/login')
    .set('Host', dominio)
    .send({ email, password: CONTRASENA })

  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return { Authorization: `Bearer ${res.body.accessToken as string}`, Host: dominio }
}

describe('aislamiento entre consultorios', () => {
  it('cada dominio se presenta con su propia clínica', async () => {
    const a = await request(app).get('/api/instalacion/estado').set('Host', 'rafael.prueba')
    const b = await request(app).get('/api/instalacion/estado').set('Host', 'santiago.prueba')

    // Es lo primero que ve cualquiera: la pantalla de inicio de sesión pide
    // este dato antes de autenticar, y ya llega con el nombre correcto.
    //
    // Del consultorio A solo se comprueba que sea DISTINTO: su base es la de
    // desarrollo, con la clínica que ya tuviera, y esta prueba no es quién
    // para renombrarla.
    expect(b.body.clinica.nombre).toBe('Clínica santiago.prueba')
    expect(a.body.clinica.nombre).not.toBe(b.body.clinica.nombre)
  })

  it('la búsqueda de pacientes solo ve los del propio consultorio', async () => {
    const cabeceras = await sesion('rafael.prueba', EMAIL_A)

    const propio = await request(app).get('/api/pacientes?q=55110001').set(cabeceras)
    const ajeno = await request(app).get('/api/pacientes?q=55220002').set(cabeceras)

    expect(propio.body.pacientes).toHaveLength(1)
    expect(propio.body.pacientes[0].nombres).toBe('Aurora')
    // Lo importante: el paciente del otro consultorio no existe aquí.
    expect(ajeno.body.pacientes).toHaveLength(0)
  })

  it('y al revés, para descartar que sea casualidad del orden', async () => {
    const cabeceras = await sesion('santiago.prueba', EMAIL_B)

    const propio = await request(app).get('/api/pacientes?q=55220002').set(cabeceras)
    const ajeno = await request(app).get('/api/pacientes?q=55110001').set(cabeceras)

    expect(propio.body.pacientes[0].nombres).toBe('Basilio')
    expect(ajeno.body.pacientes).toHaveLength(0)
  })

  it('las cuentas no sirven en el consultorio de al lado', async () => {
    // El administrador de uno no es nadie en el otro. Su correo ni siquiera
    // existe en esa base.
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', 'santiago.prueba')
      .send({ email: EMAIL_A, password: CONTRASENA })

    expect(res.status).toBe(401)
  })

  it('un token emitido en un consultorio no abre el otro', async () => {
    // Los dos comparten el secreto de firma —es el mismo proceso—, así que la
    // firma del token es válida en ambos. Lo que lo detiene es que su sesión y
    // su usuario no existen en la otra base.
    const { Authorization } = await sesion('rafael.prueba', EMAIL_A)

    const res = await request(app)
      .get('/api/pacientes?q=5522')
      .set({ Authorization, Host: 'santiago.prueba' })

    expect(res.status).toBe(401)
  })

  it('un dominio no configurado no llega a ninguna base', async () => {
    const res = await request(app).get('/api/instalacion/estado').set('Host', 'otro.prueba')

    expect(res.status).toBe(404)
    expect(res.body.error.codigo).toBe('CONSULTORIO_DESCONOCIDO')
  })

  it('la salud responde aunque el dominio no sea de ningún consultorio', async () => {
    // El orquestador chequea por una dirección interna que no es el dominio de
    // nadie. Si eso devolviera el 404 de dominio desconocido, Railway daría
    // por fallido un despliegue sano y lo reiniciaría en bucle.
    const vivo = await request(app).get('/api/health').set('Host', 'healthcheck.interno')
    const listo = await request(app).get('/api/health/ready').set('Host', 'healthcheck.interno')

    expect(vivo.status).toBe(200)
    expect(vivo.body.estado).toBe('ok')

    // `ready` comprueba TODAS las bases, no la de un consultorio concreto.
    expect(listo.status).toBe(200)
    expect(listo.body.baseDeDatos).toBe('ok')
  })
})
