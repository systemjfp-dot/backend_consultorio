/**
 * Pruebas de agenda contra la base real.
 *
 * El motor de disponibilidad ya está probado de forma aislada; aquí se
 * comprueba lo que solo se ve al conectarlo: que los datos de la base lleguen
 * bien traducidos, que los constraints de exclusión salgan como mensajes
 * comprensibles, y que los permisos se apliquen.
 */

import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { aInstante } from '../../core/tiempo.js'
import { cifrarContrasena } from '../auth/contrasenas.js'
import { olvidarConfiguracion } from './agenda.service.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const EMAIL_ADMIN = 'admin.agenda@consultorio.test'
const EMAIL_RECEPCION = 'recepcion.agenda@consultorio.test'
const EMAIL_MEDICO = 'medico.agenda@consultorio.test'

const SEDE = 'Sede de prueba agenda'
const LIMA = 'America/Lima'

/** Lunes y martes futuros, para que no interfiera la hora actual. */
const LUNES = '2027-03-01'
const MARTES = '2027-03-02'

let idMedico: string
let idSede: string

async function limpiar() {
  const emails = [EMAIL_ADMIN, EMAIL_RECEPCION, EMAIL_MEDICO]
  const usuarios = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  })
  const ids = usuarios.map((u) => u.id)

  const medicos = await prisma.doctor.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  })
  const idsMedicos = medicos.map((m) => m.id)

  await prisma.appointment.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.scheduleException.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.schedule.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.location.deleteMany({ where: { name: SEDE } })
}

beforeEach(async () => {
  await limpiar()
  olvidarConfiguracion()

  const hash = await cifrarContrasena(CONTRASENA)

  await prisma.user.createMany({
    data: [
      { email: EMAIL_ADMIN, password: hash, firstName: 'Luis', lastName: 'Soto', roles: ['ADMIN'] },
      {
        email: EMAIL_RECEPCION,
        password: hash,
        firstName: 'Rosa',
        lastName: 'Díaz',
        roles: ['RECEPTIONIST'],
      },
    ],
  })

  const medico = await prisma.user.create({
    data: {
      email: EMAIL_MEDICO,
      password: hash,
      firstName: 'Ana',
      lastName: 'Ruiz',
      roles: ['DOCTOR'],
      doctor: {
        create: {
          licenseNumber: `CMP-A${Date.now()}`,
          specialty: 'Cardiología',
          defaultSlotMinutes: 30,
        },
      },
    },
    include: { doctor: true },
  })
  idMedico = medico.doctor!.id

  const sede = await prisma.location.create({
    data: { name: SEDE, address: 'Av. de prueba 123' },
  })
  idSede = sede.id
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function token(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return res.body.accessToken as string
}

const conSesion = async (email: string) => ({ Authorization: `Bearer ${await token(email)}` })

/** Lunes de 08:00 a 12:00, citas de 30 minutos. */
async function horarioDeLunes(inicio = 480, fin = 720) {
  return request(app)
    .post('/api/agenda/horarios')
    .set(await conSesion(EMAIL_ADMIN))
    .send({ medicoId: idMedico, diaSemana: 1, inicioMinuto: inicio, finMinuto: fin, sedeId: idSede })
}

const disponibilidad = async (fecha: string, email = EMAIL_RECEPCION) =>
  request(app)
    .get(`/api/agenda/disponibilidad?medicoId=${idMedico}&fecha=${fecha}`)
    .set(await conSesion(email))

const horas = (res: request.Response): string[] =>
  (res.body.huecos as { hora: string }[]).map((h) => h.hora)

// =============================================================================

describe('horarios', () => {
  it('el administrador puede crear una franja', async () => {
    const res = await horarioDeLunes()

    expect(res.status).toBe(201)
    expect(res.body.horario.medicoNombre).toBe('Ana Ruiz')
    expect(res.body.horario.sedeNombre).toBe(SEDE)
  })

  it('recepción no puede crear franjas', async () => {
    const res = await request(app)
      .post('/api/agenda/horarios')
      .set(await conSesion(EMAIL_RECEPCION))
      .send({ medicoId: idMedico, diaSemana: 1, inicioMinuto: 480, finMinuto: 720 })

    expect(res.status).toBe(403)
  })

  it('una franja superpuesta se rechaza con un mensaje comprensible', async () => {
    // El constraint de exclusión de la base es quien lo impide; lo que se
    // comprueba aquí es que no llegue a la pantalla como un volcado de
    // PostgreSQL.
    await horarioDeLunes(480, 780)

    const res = await horarioDeLunes(540, 660)

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('se superpone')
  })

  it('una franja invertida se rechaza antes de llegar a la base', async () => {
    const res = await request(app)
      .post('/api/agenda/horarios')
      .set(await conSesion(EMAIL_ADMIN))
      .send({ medicoId: idMedico, diaSemana: 1, inicioMinuto: 780, finMinuto: 480 })

    expect(res.status).toBe(422)
  })

  it('una franja más corta que una cita se rechaza', async () => {
    const res = await request(app)
      .post('/api/agenda/horarios')
      .set(await conSesion(EMAIL_ADMIN))
      .send({ medicoId: idMedico, diaSemana: 1, inicioMinuto: 480, finMinuto: 484, slotMinutos: 30 })

    expect(res.status).toBe(422)
  })

  it('no se puede eliminar una franja con citas futuras agendadas', async () => {
    // Borrarla dejaría a esos pacientes citados en una hora que el sistema
    // considera inexistente, y nadie se enteraría hasta que llegaran.
    const horario = await horarioDeLunes()

    const paciente = await prisma.patient.create({
      data: {
        document: `AG${Date.now()}`.slice(0, 12),
        firstName: 'Prueba',
        lastName: 'Agenda',
        birthDate: new Date('1990-01-01'),
        gender: 'F',
        phone: '999000111',
      },
    })

    await prisma.appointment.create({
      data: {
        patientId: paciente.id,
        doctorId: idMedico,
        startsAt: aInstante(LUNES, 540, LIMA),
        endsAt: aInstante(LUNES, 570, LIMA),
      },
    })

    const res = await request(app)
      .delete(`/api/agenda/horarios/${horario.body.horario.id}`)
      .set(await conSesion(EMAIL_ADMIN))

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('1 cita')

    await prisma.appointment.deleteMany({ where: { patientId: paciente.id } })
    await prisma.patient.delete({ where: { id: paciente.id } })
  })

  it('sí se puede eliminar una franja sin citas', async () => {
    const horario = await horarioDeLunes()

    const res = await request(app)
      .delete(`/api/agenda/horarios/${horario.body.horario.id}`)
      .set(await conSesion(EMAIL_ADMIN))

    expect(res.status).toBe(204)
  })
})

describe('disponibilidad', () => {
  it('devuelve los huecos del día en hora de la clínica', async () => {
    await horarioDeLunes()

    const res = await disponibilidad(LUNES)

    expect(res.status).toBe(200)
    expect(res.body.duracionMinutos).toBe(30)
    expect(horas(res)).toEqual([
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    ])
  })

  it('cada hueco trae el instante absoluto que se guardará', async () => {
    // Así la web no repite la conversión de husos, que es justo lo que la
    // convención del proyecto quiere impedir.
    await horarioDeLunes()

    const primero = (await disponibilidad(LUNES)).body.huecos[0]
    expect(primero.inicio).toBe('2027-03-01T13:00:00.000Z')
    expect(primero.hora).toBe('08:00')
  })

  it('una cita existente retira su hueco', async () => {
    await horarioDeLunes()

    const paciente = await prisma.patient.create({
      data: {
        document: `AG2${Date.now()}`.slice(0, 12),
        firstName: 'Prueba',
        lastName: 'Ocupa',
        birthDate: new Date('1990-01-01'),
        gender: 'F',
        phone: '999000222',
      },
    })

    await prisma.appointment.create({
      data: {
        patientId: paciente.id,
        doctorId: idMedico,
        startsAt: aInstante(LUNES, 540, LIMA),
        endsAt: aInstante(LUNES, 570, LIMA),
      },
    })

    expect(horas(await disponibilidad(LUNES))).not.toContain('09:00')

    await prisma.appointment.deleteMany({ where: { patientId: paciente.id } })
    await prisma.patient.delete({ where: { id: paciente.id } })
  })

  it('una cita cancelada devuelve su hueco', async () => {
    // Lo que el @@unique del diseño original no permitía: el horario quedaba
    // ocupado para siempre.
    await horarioDeLunes()

    const paciente = await prisma.patient.create({
      data: {
        document: `AG3${Date.now()}`.slice(0, 12),
        firstName: 'Prueba',
        lastName: 'Cancela',
        birthDate: new Date('1990-01-01'),
        gender: 'F',
        phone: '999000333',
      },
    })

    await prisma.appointment.create({
      data: {
        patientId: paciente.id,
        doctorId: idMedico,
        startsAt: aInstante(LUNES, 540, LIMA),
        endsAt: aInstante(LUNES, 570, LIMA),
        status: 'CANCELLED',
      },
    })

    expect(horas(await disponibilidad(LUNES))).toContain('09:00')

    await prisma.appointment.deleteMany({ where: { patientId: paciente.id } })
    await prisma.patient.delete({ where: { id: paciente.id } })
  })

  it('explica POR QUÉ no hay huecos: el médico no atiende ese día', async () => {
    // "No hay horas" obligaría a la recepcionista a llamar a alguien para
    // saber si el médico libra, está completo o no trabaja ese día.
    await horarioDeLunes()

    const res = await disponibilidad(MARTES)

    expect(res.body.huecos).toEqual([])
    expect(res.body.motivoSinHuecos).toBe('sin_horario')
  })

  it('explica que el médico está ausente ese día', async () => {
    await horarioDeLunes()

    await request(app)
      .post('/api/agenda/excepciones')
      .set(await conSesion(EMAIL_ADMIN))
      .send({ medicoId: idMedico, fecha: LUNES, tipo: 'AUSENTE', motivo: 'Congreso' })
      .expect(201)

    const res = await disponibilidad(LUNES)

    expect(res.body.huecos).toEqual([])
    expect(res.body.motivoSinHuecos).toBe('ausente')
  })

  it('explica que un día pasado ya no admite citas', async () => {
    await horarioDeLunes()

    const res = await disponibilidad('2020-03-02')

    expect(res.body.huecos).toEqual([])
    expect(res.body.motivoSinHuecos).toBe('dia_pasado')
  })

  it('una atención extraordinaria abre un día sin horario habitual', async () => {
    await request(app)
      .post('/api/agenda/excepciones')
      .set(await conSesion(EMAIL_ADMIN))
      .send({
        medicoId: idMedico,
        fecha: MARTES,
        tipo: 'EXTRA',
        inicioMinuto: 540,
        finMinuto: 660,
        motivo: 'Guardia',
      })
      .expect(201)

    expect(horas(await disponibilidad(MARTES))).toEqual(['09:00', '09:30', '10:00', '10:30'])
  })

  it('el auditor no puede consultar la agenda', async () => {
    const auditor = await prisma.user.create({
      data: {
        email: 'auditor.agenda@consultorio.test',
        password: await cifrarContrasena(CONTRASENA),
        firstName: 'Elena',
        lastName: 'Paz',
        roles: ['AUDITOR'],
      },
    })

    const res = await disponibilidad(LUNES, 'auditor.agenda@consultorio.test')
    expect(res.status).toBe(403)

    await prisma.session.deleteMany({ where: { userId: auditor.id } })
    await prisma.user.delete({ where: { id: auditor.id } })
  })
})

describe('sedes', () => {
  it('el administrador puede crearlas y recepción solo verlas', async () => {
    const creacion = await request(app)
      .post('/api/agenda/sedes')
      .set(await conSesion(EMAIL_ADMIN))
      .send({ nombre: 'Sede Nueva Prueba', direccion: 'Av. Nueva 456' })

    expect(creacion.status).toBe(201)

    const rechazo = await request(app)
      .post('/api/agenda/sedes')
      .set(await conSesion(EMAIL_RECEPCION))
      .send({ nombre: 'Sede Prohibida', direccion: 'Av. X' })

    expect(rechazo.status).toBe(403)

    const listado = await request(app)
      .get('/api/agenda/sedes')
      .set(await conSesion(EMAIL_RECEPCION))

    expect(listado.status).toBe(200)
    expect((listado.body.sedes as { nombre: string }[]).map((s) => s.nombre)).toContain(
      'Sede Nueva Prueba',
    )

    await prisma.location.deleteMany({ where: { name: 'Sede Nueva Prueba' } })
  })
})

describe('médicos', () => {
  it('devuelve el color y la duración de cita para pintar el calendario', async () => {
    const res = await request(app)
      .get('/api/agenda/medicos')
      .set(await conSesion(EMAIL_RECEPCION))

    const medico = (res.body.medicos as { id: string; color: string; duracionCitaMinutos: number }[]).find(
      (m) => m.id === idMedico,
    )

    expect(medico?.color).toMatch(/^#/)
    expect(medico?.duracionCitaMinutos).toBe(30)
  })
})
