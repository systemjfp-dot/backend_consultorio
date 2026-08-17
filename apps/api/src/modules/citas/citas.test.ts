/**
 * Pruebas de citas.
 *
 * Además del comportamiento del módulo, aquí se verifica por primera vez el
 * ALCANCE construido en H0.6: dos médicos con el mismo permiso deben ver cosas
 * distintas. Es el requisito 4.5 del documento maestro y la clase de fallo que
 * nadie detecta mirando la pantalla, porque cada médico solo ve la suya.
 */

import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { aInstante } from '../../core/tiempo.js'
import { olvidarConfiguracion } from '../agenda/agenda.service.js'
import { cifrarContrasena } from '../auth/contrasenas.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const ADMIN = 'admin.citas@consultorio.test'
const RECEPCION = 'recepcion.citas@consultorio.test'
const MEDICO_A = 'medicoa.citas@consultorio.test'
const MEDICO_B = 'medicob.citas@consultorio.test'
const ENFERMERIA = 'enfermeria.citas@consultorio.test'

const LIMA = 'America/Lima'
/** Lunes lejano en el futuro: ninguna prueba depende de la hora actual. */
const LUNES = '2027-03-01'
const PREFIJO_DOC = '6600'

let medicoA: string
let medicoB: string
let pacienteA: string
let pacienteB: string

async function limpiar() {
  const emails = [ADMIN, RECEPCION, MEDICO_A, MEDICO_B, ENFERMERIA]
  const usuarios = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
  const ids = usuarios.map((u) => u.id)

  const medicos = await prisma.doctor.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  const idsMedicos = medicos.map((m) => m.id)

  await prisma.appointment.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.schedule.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })

  const pacientes = await prisma.patient.findMany({
    where: { document: { startsWith: PREFIJO_DOC } },
    select: { id: true },
  })
  const idsPacientes = pacientes.map((p) => p.id)
  await prisma.appointment.deleteMany({ where: { patientId: { in: idsPacientes } } })
  await prisma.patientConsent.deleteMany({ where: { patientId: { in: idsPacientes } } })
  await prisma.patient.deleteMany({ where: { id: { in: idsPacientes } } })
}

async function crearMedico(email: string, nombre: string): Promise<string> {
  const usuario = await prisma.user.create({
    data: {
      email,
      password: await cifrarContrasena(CONTRASENA),
      firstName: nombre,
      lastName: 'Prueba',
      roles: ['DOCTOR'],
      doctor: {
        create: {
          licenseNumber: `CMP-C${email}${Date.now()}`.slice(0, 20),
          specialty: 'Medicina General',
          defaultSlotMinutes: 30,
        },
      },
    },
    include: { doctor: true },
  })

  // Lunes de 08:00 a 12:00.
  await prisma.schedule.create({
    data: {
      doctorId: usuario.doctor!.id,
      dayOfWeek: 1,
      startMinute: 480,
      endMinute: 720,
    },
  })

  return usuario.doctor!.id
}

async function crearPaciente(sufijo: string): Promise<string> {
  const paciente = await prisma.patient.create({
    data: {
      document: `${PREFIJO_DOC}${sufijo}`,
      firstName: `Paciente${sufijo}`,
      lastName: 'De Prueba',
      birthDate: new Date('1990-01-01'),
      gender: 'F',
      phone: `9990001${sufijo}`,
    },
  })
  return paciente.id
}

beforeEach(async () => {
  await limpiar()
  olvidarConfiguracion()

  const hash = await cifrarContrasena(CONTRASENA)
  await prisma.user.createMany({
    data: [
      { email: ADMIN, password: hash, firstName: 'Luis', lastName: 'Soto', roles: ['ADMIN'] },
      { email: RECEPCION, password: hash, firstName: 'Rosa', lastName: 'Díaz', roles: ['RECEPTIONIST'] },
      { email: ENFERMERIA, password: hash, firstName: 'Julia', lastName: 'Pari', roles: ['NURSE'] },
    ],
  })

  medicoA = await crearMedico(MEDICO_A, 'Ana')
  medicoB = await crearMedico(MEDICO_B, 'Bruno')
  pacienteA = await crearPaciente('0001')
  pacienteB = await crearPaciente('0002')
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

const sesion = async (email: string) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return { Authorization: `Bearer ${res.body.accessToken as string}` }
}

const instante = (minutos: number) => aInstante(LUNES, minutos, LIMA).toISOString()

async function agendar(
  email: string,
  opciones: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post('/api/citas')
    .set(await sesion(email))
    .send({
      pacienteId: pacienteA,
      medicoId: medicoA,
      inicio: instante(540),
      ...opciones,
    })
}

/** Agenda y comprueba que se creó. Devuelve el id. */
async function agendarOk(
  email: string,
  opciones: Record<string, unknown> = {},
): Promise<string> {
  const res = await agendar(email, opciones)
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.cita.id as string
}

const citasDe = async (email: string, query = `?desde=${LUNES}`) =>
  request(app).get(`/api/citas${query}`).set(await sesion(email))

// =============================================================================

describe('creación', () => {
  it('recepción agenda en un hueco libre', async () => {
    const res = await agendar(RECEPCION)

    expect(res.status).toBe(201)
    expect(res.body.cita.hora).toBe('09:00')
    expect(res.body.cita.horaFin).toBe('09:30')
    expect(res.body.cita.estado).toBe('SCHEDULED')
    expect(res.body.cita.medicoNombre).toBe('Ana Prueba')
  })

  it('devuelve fecha y hora ya en el calendario de la clínica', async () => {
    // La web no debe reconvertir husos: es justo lo que la convención del
    // proyecto quiere impedir.
    const res = await agendar(RECEPCION)

    expect(res.body.cita.fecha).toBe(LUNES)
    expect(res.body.cita.inicio).toBe('2027-03-01T14:00:00.000Z')
  })

  it('incluye las alergias del paciente para que se vean en la agenda', async () => {
    await prisma.patient.update({ where: { id: pacienteA }, data: { allergies: 'Penicilina' } })

    const res = await agendar(RECEPCION)
    expect(res.body.cita.pacienteAlergias).toBe('Penicilina')
  })

  it('rechaza una hora que no es un hueco disponible', async () => {
    // 09:07 no es inicio de ningún slot de 30 minutos desde las 08:00.
    const res = await agendar(RECEPCION, { inicio: instante(547) })

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('sobreagenda')
  })

  it('rechaza una hora fuera del horario del médico', async () => {
    const res = await agendar(RECEPCION, { inicio: instante(1200) })
    expect(res.status).toBe(409)
  })

  it('rechaza agendar en el pasado', async () => {
    const res = await agendar(RECEPCION, { inicio: '2020-03-02T14:00:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('pasado')
  })

  it('rechaza un paciente dado de baja', async () => {
    await prisma.patient.update({ where: { id: pacienteA }, data: { deletedAt: new Date() } })

    const res = await agendar(RECEPCION)
    expect(res.status).toBe(404)
  })

  it('rechaza un médico desactivado', async () => {
    await prisma.doctor.update({ where: { id: medicoA }, data: { isActive: false } })

    const res = await agendar(RECEPCION)
    expect(res.status).toBe(409)
  })

  it('enfermería no puede agendar', async () => {
    const res = await agendar(ENFERMERIA)
    expect(res.status).toBe(403)
  })
})

describe('doble agendamiento', () => {
  it('la misma hora no se puede ocupar dos veces', async () => {
    await agendarOk(RECEPCION)

    const segunda = await agendar(RECEPCION, { pacienteId: pacienteB })
    expect(segunda.status).toBe(409)
  })

  it('una cita solapada parcialmente también se rechaza', async () => {
    // 09:00–09:30 y 09:15–09:45 se pisan aunque empiecen a horas distintas.
    // Es el caso que el @@unique([doctorId, date]) del diseño original
    // aceptaba sin protestar, porque solo comparaba la hora de inicio.
    await agendarOk(RECEPCION)

    const solapada = await agendar(RECEPCION, {
      pacienteId: pacienteB,
      inicio: instante(555),
    })

    expect(solapada.status).toBe(409)
  })

  it('la sobreagenda SÍ permite solapar, que es lo que significa', async () => {
    // Encajar una urgencia entre dos citas es exactamente el caso de uso: el
    // constraint de exclusión deja fuera las citas marcadas como sobreagenda.
    await agendarOk(RECEPCION)

    const urgencia = await agendar(RECEPCION, {
      pacienteId: pacienteB,
      inicio: instante(555),
      sobreagendar: true,
    })

    expect(urgencia.status).toBe(201)
    expect(urgencia.body.cita.sobreagendada).toBe(true)
  })

  it('citas contiguas SÍ se permiten', async () => {
    // 09:00–09:30 y 09:30–10:00 no se solapan. Tratarlas como conflicto
    // perdería la mitad de la agenda del día.
    await agendarOk(RECEPCION)

    const contigua = await agendar(RECEPCION, { pacienteId: pacienteB, inicio: instante(570) })
    expect(contigua.status).toBe(201)
  })

  it('cancelar una cita libera su horario', async () => {
    const primera = await agendar(RECEPCION)

    await request(app)
      .post(`/api/citas/${primera.body.cita.id}/cancelar`)
      .set(await sesion(RECEPCION))
      .send({ motivo: 'El paciente no puede asistir', origen: 'PATIENT' })
      .expect(200)

    const segunda = await agendar(RECEPCION, { pacienteId: pacienteB })
    expect(segunda.status).toBe(201)
  })
})

describe('sobreagenda', () => {
  it('recepción puede sobreagendar fuera de los huecos', async () => {
    // Una urgencia que se encaja entre dos citas: el módulo 4.2 pide advertir,
    // no impedir.
    const res = await agendar(RECEPCION, { inicio: instante(547), sobreagendar: true })

    expect(res.status).toBe(201)
    expect(res.body.cita.sobreagendada).toBe(true)
  })

  it('enfermería no puede: no tiene el permiso', async () => {
    const res = await agendar(ENFERMERIA, { inicio: instante(547), sobreagendar: true })
    expect(res.status).toBe(403)
  })

  it('la sobreagenda queda registrada en la auditoría', async () => {
    const res = await agendar(RECEPCION, { inicio: instante(547), sobreagendar: true })

    const registro = await prisma.auditLog.findFirst({
      where: { entity: 'Appointment', entityId: res.body.cita.id, action: 'CREATE' },
    })
    expect(registro?.reason).toContain('sobreagenda')
  })
})

describe('alcance del médico (requisito 4.5)', () => {
  it('un médico ve solo sus propias citas', async () => {
    await agendarOk(RECEPCION)
    await agendarOk(RECEPCION, { pacienteId: pacienteB, medicoId: medicoB })

    const recepcion = await citasDe(RECEPCION)
    const doctorA = await citasDe(MEDICO_A)

    expect(recepcion.body.citas).toHaveLength(2)
    expect(doctorA.body.citas).toHaveLength(1)
    expect(doctorA.body.citas[0].medicoId).toBe(medicoA)
  })

  it('un médico no puede abrir la cita de otro ni conociendo su id', async () => {
    const ajena = await agendar(RECEPCION, { pacienteId: pacienteB, medicoId: medicoB })

    const res = await request(app)
      .get(`/api/citas/${ajena.body.cita.id}`)
      .set(await sesion(MEDICO_A))

    // 404 y no 403: decir "existe pero no puedes verla" ya revela que ese
    // médico atiende a ese paciente.
    expect(res.status).toBe(404)
  })

  it('un médico tampoco puede modificar la cita de otro', async () => {
    const ajena = await agendar(RECEPCION, { pacienteId: pacienteB, medicoId: medicoB })

    const res = await request(app)
      .patch(`/api/citas/${ajena.body.cita.id}`)
      .set(await sesion(MEDICO_A))
      .send({ notas: 'intento de modificación' })

    expect(res.status).toBe(404)

    const enBase = await prisma.appointment.findUniqueOrThrow({
      where: { id: ajena.body.cita.id },
    })
    expect(enBase.notes).toBeNull()
  })

  it('un médico no puede agendar en la agenda de otro', async () => {
    const res = await agendar(MEDICO_A, { medicoId: medicoB, pacienteId: pacienteB })

    expect(res.status).toBe(403)
    expect(res.body.error.mensaje).toContain('tu propia agenda')
  })

  it('un médico sí puede agendar en la suya', async () => {
    const res = await agendar(MEDICO_A)
    expect(res.status).toBe(201)
  })
})

describe('estados', () => {
  async function citaNueva() {
    const res = await agendar(RECEPCION)
    return res.body.cita.id as string
  }

  const accion = async (id: string, ruta: string, email = RECEPCION, cuerpo = {}) =>
    request(app).post(`/api/citas/${id}/${ruta}`).set(await sesion(email)).send(cuerpo)

  it('recorre el flujo normal: agendada → confirmada → llegó', async () => {
    const id = await citaNueva()

    expect((await accion(id, 'confirmar')).body.cita.estado).toBe('CONFIRMED')

    const llegada = await accion(id, 'llegada')
    expect(llegada.body.cita.estado).toBe('ARRIVED')
    expect(llegada.body.cita.llegadaEn).toBeTruthy()
  })

  it('enfermería puede registrar la llegada', async () => {
    // Es su función en el triaje, aunque no pueda agendar.
    const id = await citaNueva()
    expect((await accion(id, 'llegada', ENFERMERIA)).status).toBe(200)
  })

  it('una cita cancelada ya no admite cambios', async () => {
    const id = await citaNueva()
    await accion(id, 'cancelar', RECEPCION, { motivo: 'El paciente no puede', origen: 'PATIENT' })

    const res = await accion(id, 'confirmar')
    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('cerrada')
  })

  it('repetir una acción no es un error', async () => {
    // Pulsar dos veces "confirmar" es habitual cuando no se ve el primer clic.
    const id = await citaNueva()
    expect((await accion(id, 'confirmar')).status).toBe(200)

    const repetida = await accion(id, 'confirmar')
    expect(repetida.status).toBe(200)
    expect(repetida.body.cita.estado).toBe('CONFIRMED')
  })

  it('cancelar exige un motivo', async () => {
    // Sin motivo, el reporte de cancelaciones solo diría cuántas hubo.
    const id = await citaNueva()

    const res = await accion(id, 'cancelar', RECEPCION, { motivo: '' })
    expect(res.status).toBe(422)
  })

  it('la cancelación guarda motivo y origen', async () => {
    const id = await citaNueva()

    const res = await accion(id, 'cancelar', RECEPCION, {
      motivo: 'Se enfermó un familiar',
      origen: 'PATIENT',
    })

    expect(res.body.cita.motivoCancelacion).toBe('Se enfermó un familiar')
    expect(res.body.cita.canceladaEn).toBeTruthy()
  })

  it('se puede marcar que el paciente no asistió', async () => {
    const id = await citaNueva()
    expect((await accion(id, 'no-asistio')).body.cita.estado).toBe('NO_SHOW')
  })
})

describe('reprogramación', () => {
  it('mueve la cita y la devuelve a "agendada"', async () => {
    // El paciente todavía no sabe de la nueva hora, así que su confirmación
    // anterior ya no vale.
    const cita = await agendar(RECEPCION)
    await request(app)
      .post(`/api/citas/${cita.body.cita.id}/confirmar`)
      .set(await sesion(RECEPCION))

    const res = await request(app)
      .post(`/api/citas/${cita.body.cita.id}/reprogramar`)
      .set(await sesion(RECEPCION))
      .send({ inicio: instante(630) })

    expect(res.status).toBe(200)
    expect(res.body.cita.hora).toBe('10:30')
    expect(res.body.cita.estado).toBe('SCHEDULED')
    expect(res.body.cita.confirmadaEn).toBeNull()
  })

  it('libera el horario anterior', async () => {
    const cita = await agendar(RECEPCION)

    await request(app)
      .post(`/api/citas/${cita.body.cita.id}/reprogramar`)
      .set(await sesion(RECEPCION))
      .send({ inicio: instante(630) })
      .expect(200)

    const otra = await agendar(RECEPCION, { pacienteId: pacienteB })
    expect(otra.status).toBe(201)
  })

  it('mover a la hora que ya tiene no se rechaza', async () => {
    // La propia cita ocupa su hueco: sin excluirla, reprogramar al mismo sitio
    // chocaría consigo misma.
    const cita = await agendar(RECEPCION)

    const res = await request(app)
      .post(`/api/citas/${cita.body.cita.id}/reprogramar`)
      .set(await sesion(RECEPCION))
      .send({ inicio: instante(540) })

    expect(res.status).toBe(200)
  })

  it('rechaza mover a una hora ocupada', async () => {
    const primera = await agendar(RECEPCION)
    await agendarOk(RECEPCION, { pacienteId: pacienteB, inicio: instante(630) })

    const res = await request(app)
      .post(`/api/citas/${primera.body.cita.id}/reprogramar`)
      .set(await sesion(RECEPCION))
      .send({ inicio: instante(630) })

    expect(res.status).toBe(409)
  })

  it('una cita cerrada no se reprograma', async () => {
    const cita = await agendar(RECEPCION)
    await request(app)
      .post(`/api/citas/${cita.body.cita.id}/cancelar`)
      .set(await sesion(RECEPCION))
      .send({ motivo: 'Cancelada', origen: 'CLINIC' })

    const res = await request(app)
      .post(`/api/citas/${cita.body.cita.id}/reprogramar`)
      .set(await sesion(RECEPCION))
      .send({ inicio: instante(630) })

    expect(res.status).toBe(409)
  })

  it('puede cambiar de médico', async () => {
    const cita = await agendar(RECEPCION)

    const res = await request(app)
      .post(`/api/citas/${cita.body.cita.id}/reprogramar`)
      .set(await sesion(RECEPCION))
      .send({ inicio: instante(540), medicoId: medicoB })

    expect(res.status).toBe(200)
    expect(res.body.cita.medicoId).toBe(medicoB)
  })
})

describe('sala de espera', () => {
  it('solo muestra a quienes ya llegaron', async () => {
    const hoy = new Date()
    hoy.setUTCHours(hoy.getUTCHours() + 2)

    const cita = await prisma.appointment.create({
      data: {
        patientId: pacienteA,
        doctorId: medicoA,
        startsAt: hoy,
        endsAt: new Date(hoy.getTime() + 30 * 60_000),
        status: 'ARRIVED',
        arrivedAt: new Date(),
      },
    })

    await prisma.appointment.create({
      data: {
        patientId: pacienteB,
        doctorId: medicoA,
        startsAt: new Date(hoy.getTime() + 60 * 60_000),
        endsAt: new Date(hoy.getTime() + 90 * 60_000),
        status: 'SCHEDULED',
      },
    })

    const res = await request(app)
      .get('/api/citas/sala-de-espera')
      .set(await sesion(RECEPCION))

    const ids = (res.body.citas as { id: string }[]).map((c) => c.id)
    expect(ids).toContain(cita.id)
    expect(res.body.citas.every((c: { estado: string }) => c.estado === 'ARRIVED')).toBe(true)
  })
})

describe('agenda del día', () => {
  it('el rango de un solo día devuelve las citas de ese día', async () => {
    // Sin sumar un día al límite superior, un rango exclusivo devolvería vacío.
    await agendarOk(RECEPCION)

    const res = await citasDe(RECEPCION, `?desde=${LUNES}&hasta=${LUNES}`)

    expect(res.status).toBe(200)
    expect(res.body.citas).toHaveLength(1)
  })

  it('no incluye canceladas salvo que se pidan', async () => {
    const cita = await agendar(RECEPCION)
    await request(app)
      .post(`/api/citas/${cita.body.cita.id}/cancelar`)
      .set(await sesion(RECEPCION))
      .send({ motivo: 'Cancelada', origen: 'CLINIC' })

    expect((await citasDe(RECEPCION)).body.citas).toHaveLength(0)
    expect(
      (await citasDe(RECEPCION, `?desde=${LUNES}&incluirCanceladas=true`)).body.citas,
    ).toHaveLength(1)
  })

  it('se puede filtrar por médico', async () => {
    await agendarOk(RECEPCION)
    await agendarOk(RECEPCION, { pacienteId: pacienteB, medicoId: medicoB })

    const res = await citasDe(RECEPCION, `?desde=${LUNES}&medicoId=${medicoB}`)
    expect(res.body.citas).toHaveLength(1)
    expect(res.body.citas[0].medicoId).toBe(medicoB)
  })

  it('la agenda trae el color del médico para pintar el calendario', async () => {
    await agendarOk(RECEPCION)

    const res = await citasDe(RECEPCION)
    expect(res.body.citas[0].medicoColor).toMatch(/^#/)
  })
})
