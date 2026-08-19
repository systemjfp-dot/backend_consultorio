import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { asegurarParticionesAuditoria, estadoParticiones } from '../../core/auditoria.js'
import { prisma } from '../../core/prisma.js'
import { esperarA, margenParaEscrituraDiferida } from '../../pruebas/esperar.js'
import { cifrarContrasena } from '../auth/contrasenas.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const EMAIL_AUDITOR = 'auditor.panel@consultorio.test'
const EMAIL_MEDICO = 'medico.panel@consultorio.test'
const EMAIL_RECEPCION = 'recepcion.panel@consultorio.test'

async function limpiar() {
  const usuarios = await prisma.user.findMany({
    where: { email: { in: [EMAIL_AUDITOR, EMAIL_MEDICO, EMAIL_RECEPCION] } },
    select: { id: true },
  })
  const ids = usuarios.map((u) => u.id)

  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

beforeEach(async () => {
  await limpiar()
  const hash = await cifrarContrasena(CONTRASENA)

  await prisma.user.createMany({
    data: [
      {
        email: EMAIL_AUDITOR,
        password: hash,
        firstName: 'Elena',
        lastName: 'Paz',
        roles: ['AUDITOR'],
      },
      {
        email: EMAIL_RECEPCION,
        password: hash,
        firstName: 'Rosa',
        lastName: 'Díaz',
        roles: ['RECEPTIONIST'],
      },
    ],
  })
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function token(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return res.body.accessToken as string
}

const consultar = async (email: string, query = '') =>
  request(app)
    .get(`/api/auditoria${query}`)
    .set('Authorization', `Bearer ${await token(email)}`)

describe('panel de auditoría', () => {
  it('el auditor puede consultar', async () => {
    const res = await consultar(EMAIL_AUDITOR)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.registros)).toBe(true)
    expect(typeof res.body.total).toBe('number')
  })

  it('recepción no puede: no tiene audit:read', async () => {
    const res = await consultar(EMAIL_RECEPCION)
    expect(res.status).toBe(403)
  })

  it('sin sesión responde 401', async () => {
    const res = await request(app).get('/api/auditoria')
    expect(res.status).toBe(401)
  })

  it('acota el rango de fechas aunque no se pida', async () => {
    // Sin rango, la consulta recorrería todas las particiones. El servicio
    // impone una ventana por defecto y la devuelve para que quede explícito.
    const res = await consultar(EMAIL_AUDITOR)

    expect(res.body.desde).toBeTruthy()
    expect(res.body.hasta).toBeTruthy()

    const dias =
      (new Date(res.body.hasta).getTime() - new Date(res.body.desde).getTime()) /
      (24 * 60 * 60_000)
    expect(Math.round(dias)).toBe(30)
  })

  it('filtra por acción', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL_AUDITOR, password: 'Incorrecta1!' })

    const res = await consultar(EMAIL_AUDITOR, '?accion=LOGIN_FAILED')

    expect(res.status).toBe(200)
    expect(res.body.registros.length).toBeGreaterThan(0)
    for (const registro of res.body.registros) {
      expect(registro.accion).toBe('LOGIN_FAILED')
    }
  })

  it('pagina los resultados', async () => {
    const res = await consultar(EMAIL_AUDITOR, '?porPagina=2&pagina=1')

    expect(res.body.registros.length).toBeLessThanOrEqual(2)
    expect(res.body.porPagina).toBe(2)
  })

  it('rechaza una página desmesurada', async () => {
    // Sin tope, `porPagina=1000000` sería una forma trivial de tumbar el panel.
    const res = await consultar(EMAIL_AUDITOR, '?porPagina=99999')
    expect(res.status).toBe(422)
  })

  it('responde quién accedió a un registro concreto', async () => {
    // La pregunta que hay que poder contestar ante un reclamo.
    const res = await request(app)
      .get('/api/auditoria/registro/User/cualquiera')
      .set('Authorization', `Bearer ${await token(EMAIL_AUDITOR)}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.registros)).toBe(true)
  })
})

describe('la propia consulta de auditoría se audita', () => {
  it('deja constancia de quién revisó el registro', async () => {
    // Sin esto, el rol AUDITOR sería el único punto ciego del sistema.
    const antes = await prisma.auditLog.count({
      where: { entity: 'AuditLog', action: 'VIEW' },
    })

    await consultar(EMAIL_AUDITOR)

    // La auditoría se escribe tras responder: se reintenta hasta verla en vez
    // de dormir un tiempo fijo que en una máquina cargada se queda corto.
    const despues = await esperarA(
      () => prisma.auditLog.count({ where: { entity: 'AuditLog', action: 'VIEW' } }),
      (cuantos) => cuantos > antes,
    )
    expect(despues).toBeGreaterThan(antes)

    const registro = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'AuditLog', action: 'VIEW' },
      orderBy: { createdAt: 'desc' },
    })
    expect(registro.userEmail).toBe(EMAIL_AUDITOR)
    expect(registro.permission).toBe('audit:read')
  })

  it('un intento rechazado NO se registra como acceso', async () => {
    // Un 403 no es un acceso a datos. Anotarlo como tal llenaría el registro
    // de ruido que esconde los accesos reales.
    const antes = await prisma.auditLog.count({
      where: { entity: 'AuditLog', action: 'VIEW' },
    })

    await consultar(EMAIL_RECEPCION)
    await margenParaEscrituraDiferida()

    const despues = await prisma.auditLog.count({
      where: { entity: 'AuditLog', action: 'VIEW' },
    })
    expect(despues).toBe(antes)
  })
})

describe('particiones', () => {
  it('existen particiones mensuales y la de resto', async () => {
    const particiones = await estadoParticiones()
    const nombres = particiones.map((p) => p.particion)

    expect(nombres.length).toBeGreaterThan(20)
    expect(nombres).toContain('AuditLog_resto')
    expect(nombres.some((n) => /^AuditLog_\d{4}_\d{2}$/.test(n))).toBe(true)
  })

  it('asegurar particiones es idempotente', async () => {
    // Se ejecuta en cada arranque: repetirlo no debe fallar ni duplicar nada.
    const antes = (await estadoParticiones()).length
    await asegurarParticionesAuditoria()
    await asegurarParticionesAuditoria()
    const despues = (await estadoParticiones()).length

    expect(despues).toBe(antes)
  })

  it('la partición de resto está vacía', async () => {
    // Que reciba filas significa que faltó crear la partición de ese mes, y
    // entonces ya no se puede crear sin mover los datos primero.
    const resto = (await estadoParticiones()).find((p) => p.particion === 'AuditLog_resto')
    expect(resto?.filas ?? 0).toBe(0)
  })

  it('el auditor puede ver el estado de las particiones', async () => {
    const res = await request(app)
      .get('/api/auditoria/particiones')
      .set('Authorization', `Bearer ${await token(EMAIL_AUDITOR)}`)

    expect(res.status).toBe(200)
    expect(res.body.particiones.length).toBeGreaterThan(0)
  })
})
