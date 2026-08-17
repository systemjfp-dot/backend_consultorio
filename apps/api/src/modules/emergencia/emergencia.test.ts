import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { cifrarContrasena } from '../auth/contrasenas.js'
import { MINUTOS_DE_VIGENCIA, tieneAccesoVigente } from './emergencia.service.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const EMAIL_MEDICO = 'medico.emergencia@consultorio.test'
const EMAIL_RECEPCION = 'recepcion.emergencia@consultorio.test'
const DOCUMENTO = '88887777'

const MOTIVO = 'Paciente en urgencia, su médico tratante está de vacaciones'

let idMedico: string
let idPaciente: string

async function limpiar() {
  const usuarios = await prisma.user.findMany({
    where: { email: { in: [EMAIL_MEDICO, EMAIL_RECEPCION] } },
    select: { id: true },
  })
  const ids = usuarios.map((u) => u.id)

  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.patient.deleteMany({ where: { document: DOCUMENTO } })
}

beforeEach(async () => {
  await limpiar()
  const hash = await cifrarContrasena(CONTRASENA)

  const medico = await prisma.user.create({
    data: {
      email: EMAIL_MEDICO,
      password: hash,
      firstName: 'Beatriz',
      lastName: 'Lara',
      roles: ['DOCTOR'],
      doctor: { create: { licenseNumber: `CMP-E${Date.now()}`, specialty: 'Medicina interna' } },
    },
    select: { id: true },
  })
  idMedico = medico.id

  await prisma.user.create({
    data: {
      email: EMAIL_RECEPCION,
      password: hash,
      firstName: 'Rosa',
      lastName: 'Díaz',
      roles: ['RECEPTIONIST'],
    },
  })

  const paciente = await prisma.patient.create({
    data: {
      document: DOCUMENTO,
      firstName: 'Carlos',
      lastName: 'Mendoza',
      birthDate: new Date('1970-05-12'),
      gender: 'M',
      phone: '999888777',
    },
    select: { id: true },
  })
  idPaciente = paciente.id
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function token(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return res.body.accessToken as string
}

const conceder = (t: string, pacienteId: string, motivo = MOTIVO) =>
  request(app)
    .post(`/api/emergencia/pacientes/${pacienteId}`)
    .set('Authorization', `Bearer ${t}`)
    .send({ motivo })

describe('acceso de emergencia', () => {
  it('el médico puede concederse acceso explicando el motivo', async () => {
    const res = await conceder(await token(EMAIL_MEDICO), idPaciente)

    expect(res.status).toBe(200)
    expect(res.body.minutosDeVigencia).toBe(MINUTOS_DE_VIGENCIA)
    expect(new Date(res.body.expiraEn).getTime()).toBeGreaterThan(Date.now())
  })

  it('recepción no puede: no tiene el permiso', async () => {
    // Que un rol administrativo pudiera abrir historias de emergencia
    // desvirtuaría todo el control de alcance.
    const res = await conceder(await token(EMAIL_RECEPCION), idPaciente)
    expect(res.status).toBe(403)
  })

  it('sin sesión responde 401', async () => {
    const res = await request(app)
      .post(`/api/emergencia/pacientes/${idPaciente}`)
      .send({ motivo: MOTIVO })
    expect(res.status).toBe(401)
  })

  it('exige un motivo con sustancia', async () => {
    // "urgencia" no explica nada y no sirve como rastro revisable.
    const res = await conceder(await token(EMAIL_MEDICO), idPaciente, 'urgencia')

    expect(res.status).toBe(422)
    expect(JSON.stringify(res.body.error.detalles)).toContain('20 caracteres')
  })

  it('rechaza un paciente inexistente', async () => {
    const res = await conceder(await token(EMAIL_MEDICO), 'paciente-que-no-existe')
    expect(res.status).toBe(404)
  })

  it('deja rastro completo e imborrable en la auditoría', async () => {
    await conceder(await token(EMAIL_MEDICO), idPaciente)

    const registro = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'BREAK_GLASS', entityId: idPaciente },
      orderBy: { createdAt: 'desc' },
    })

    expect(registro.userId).toBe(idMedico)
    expect(registro.userEmail).toBe(EMAIL_MEDICO)
    expect(registro.reason).toBe(MOTIVO)
    expect(registro.permission).toBe('patient:break_glass')
    expect(registro.roles).toEqual(['DOCTOR'])

    // La concesión no se puede alterar ni retrodatar: el trigger de la base lo
    // impide incluso desde la aplicación. Es lo que permite que la propia
    // auditoría haga de registro de concesiones sin una tabla mutable aparte.
    await expect(
      prisma.auditLog.updateMany({
        where: { id: registro.id },
        data: { reason: 'motivo alterado' },
      }),
    ).rejects.toThrow(/solo inserción/)
  })

  it('la concesión aplica al paciente concedido y a ningún otro', async () => {
    // El acceso de emergencia abre UNA historia, no amplía el alcance general.
    const otro = await prisma.patient.create({
      data: {
        document: `${DOCUMENTO}9`,
        firstName: 'Otra',
        lastName: 'Persona',
        birthDate: new Date('1985-01-01'),
        gender: 'F',
        phone: '911',
      },
      select: { id: true },
    })

    await conceder(await token(EMAIL_MEDICO), idPaciente)

    expect(await tieneAccesoVigente(idMedico, idPaciente)).toBe(true)
    expect(await tieneAccesoVigente(idMedico, otro.id)).toBe(false)

    await prisma.patient.delete({ where: { id: otro.id } })
  })

  it('no hay acceso vigente si nunca se concedió', async () => {
    expect(await tieneAccesoVigente(idMedico, idPaciente)).toBe(false)
  })

  it('una concesión caducada ya no da acceso', async () => {
    // La caducidad automática es lo que impide que un acceso puntual se
    // convierta en permanente. Se escribe la concesión con fecha pasada: la
    // auditoría admite inserciones, y solo se le prohíbe modificar y borrar.
    const antigua = new Date(Date.now() - (MINUTOS_DE_VIGENCIA + 5) * 60_000)

    await prisma.auditLog.create({
      data: {
        action: 'BREAK_GLASS',
        entity: 'Patient',
        entityId: idPaciente,
        userId: idMedico,
        userEmail: EMAIL_MEDICO,
        permission: 'patient:break_glass',
        reason: MOTIVO,
        roles: ['DOCTOR'],
        createdAt: antigua,
      },
    })

    expect(await tieneAccesoVigente(idMedico, idPaciente)).toBe(false)

    // Y una concesión nueva sí lo devuelve, con la misma función.
    await conceder(await token(EMAIL_MEDICO), idPaciente)
    expect(await tieneAccesoVigente(idMedico, idPaciente)).toBe(true)
  })

  it('la concesión de un médico no sirve a otro', async () => {
    // El rastro es nominal: el acceso queda ligado a quien lo pidió.
    await conceder(await token(EMAIL_MEDICO), idPaciente)

    const otroMedico = await prisma.user.create({
      data: {
        email: 'otro.medico@consultorio.test',
        password: await cifrarContrasena(CONTRASENA),
        firstName: 'Jorge',
        lastName: 'Ríos',
        roles: ['DOCTOR'],
        doctor: { create: { licenseNumber: `CMP-O${Date.now()}`, specialty: 'Pediatría' } },
      },
      select: { id: true },
    })

    expect(await tieneAccesoVigente(otroMedico.id, idPaciente)).toBe(false)

    await prisma.doctor.deleteMany({ where: { userId: otroMedico.id } })
    await prisma.user.delete({ where: { id: otroMedico.id } })
  })

  it('el auditor puede revisar los accesos de emergencia recientes', async () => {
    await conceder(await token(EMAIL_MEDICO), idPaciente)

    const auditor = await prisma.user.create({
      data: {
        email: 'auditor.emergencia@consultorio.test',
        password: await cifrarContrasena(CONTRASENA),
        firstName: 'Ana',
        lastName: 'Vega',
        roles: ['AUDITOR'],
      },
      select: { id: true },
    })

    const res = await request(app)
      .get('/api/emergencia/recientes')
      .set('Authorization', `Bearer ${await token('auditor.emergencia@consultorio.test')}`)

    expect(res.status).toBe(200)
    expect(res.body.accesos.length).toBeGreaterThan(0)
    expect(res.body.accesos[0].reason).toBeTruthy()

    await prisma.session.deleteMany({ where: { userId: auditor.id } })
    await prisma.user.delete({ where: { id: auditor.id } })
  })

  it('el médico no puede revisar los accesos de otros', async () => {
    const res = await request(app)
      .get('/api/emergencia/recientes')
      .set('Authorization', `Bearer ${await token(EMAIL_MEDICO)}`)

    expect(res.status).toBe(403)
  })
})
