/**
 * Pruebas de la atención en consultorio.
 *
 * Lo que más importa comprobar aquí es el CONGELADO: una historia clínica que
 * se puede reescribir después no prueba nada, ni a favor del paciente ni del
 * médico. Y que enfermería pueda tomar signos vitales sin ver el diagnóstico,
 * que es la separación que justifica que `encounter:vitals` exista aparte.
 */

import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { olvidarConfiguracion } from '../agenda/agenda.service.js'
import { cifrarContrasena } from '../auth/contrasenas.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const MEDICO_A = 'medicoa.aten@consultorio.test'
const MEDICO_B = 'medicob.aten@consultorio.test'
const ENFERMERIA = 'enfermeria.aten@consultorio.test'
const RECEPCION = 'recepcion.aten@consultorio.test'

const PREFIJO_DOC = '5500'

let medicoA: string
let medicoB: string
let paciente: string
let citaA: string
let citaB: string

async function limpiar() {
  const emails = [MEDICO_A, MEDICO_B, ENFERMERIA, RECEPCION]
  const usuarios = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
  const ids = usuarios.map((u) => u.id)

  const medicos = await prisma.doctor.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  const idsMedicos = medicos.map((m) => m.id)

  await prisma.attendanceAddendum.deleteMany({ where: { attendance: { doctorId: { in: idsMedicos } } } })
  await prisma.attendanceDiagnosis.deleteMany({ where: { attendance: { doctorId: { in: idsMedicos } } } })
  await prisma.attendance.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.appointment.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })

  const pacientes = await prisma.patient.findMany({
    where: { document: { startsWith: PREFIJO_DOC } },
    select: { id: true },
  })
  const idsPacientes = pacientes.map((p) => p.id)
  await prisma.attendance.deleteMany({ where: { patientId: { in: idsPacientes } } })
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
      lastName: 'Atiende',
      roles: ['DOCTOR'],
      doctor: {
        create: { licenseNumber: `CMP-T${nombre}${Date.now()}`.slice(0, 20), specialty: 'Medicina General' },
      },
    },
    include: { doctor: true },
  })
  return usuario.doctor!.id
}

beforeEach(async () => {
  await limpiar()
  olvidarConfiguracion()

  const hash = await cifrarContrasena(CONTRASENA)
  await prisma.user.createMany({
    data: [
      { email: ENFERMERIA, password: hash, firstName: 'Julia', lastName: 'Pari', roles: ['NURSE'] },
      { email: RECEPCION, password: hash, firstName: 'Rosa', lastName: 'Díaz', roles: ['RECEPTIONIST'] },
    ],
  })

  medicoA = await crearMedico(MEDICO_A, 'Ana')
  medicoB = await crearMedico(MEDICO_B, 'Bruno')

  const p = await prisma.patient.create({
    data: {
      document: `${PREFIJO_DOC}0001`,
      firstName: 'Carmen',
      lastName: 'Vega Ríos',
      birthDate: new Date('1980-05-10'),
      gender: 'F',
      phone: '999111222',
      allergies: 'Penicilina',
    },
  })
  paciente = p.id

  const enUnaHora = new Date(Date.now() + 3_600_000)
  const cita = await prisma.appointment.create({
    data: {
      patientId: paciente,
      doctorId: medicoA,
      startsAt: enUnaHora,
      endsAt: new Date(enUnaHora.getTime() + 20 * 60_000),
      status: 'ARRIVED',
      arrivedAt: new Date(),
    },
  })
  citaA = cita.id

  const otraCita = await prisma.appointment.create({
    data: {
      patientId: paciente,
      doctorId: medicoB,
      startsAt: new Date(enUnaHora.getTime() + 3 * 3_600_000),
      endsAt: new Date(enUnaHora.getTime() + 3 * 3_600_000 + 20 * 60_000),
      status: 'ARRIVED',
    },
  })
  citaB = otraCita.id
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

const sesion = async (email: string) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return { Authorization: `Bearer ${res.body.accessToken as string}` }
}

async function iniciar(email = MEDICO_A, cita = citaA): Promise<string> {
  const res = await request(app)
    .post('/api/atenciones')
    .set(await sesion(email))
    .send({ citaId: cita })

  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.atencion.id as string
}

const guardar = async (id: string, datos: Record<string, unknown>, email = MEDICO_A) =>
  request(app).patch(`/api/atenciones/${id}`).set(await sesion(email)).send(datos)

const completar = async (id: string, email = MEDICO_A) =>
  request(app).post(`/api/atenciones/${id}/completar`).set(await sesion(email)).send({})

// =============================================================================

describe('inicio de la atención', () => {
  it('el médico abre la atención de su cita', async () => {
    const res = await request(app)
      .post('/api/atenciones')
      .set(await sesion(MEDICO_A))
      .send({ citaId: citaA })

    expect(res.status).toBe(201)
    expect(res.body.atencion.pacienteNombre).toBe('Carmen Vega Ríos')
    expect(res.body.atencion.congeladaEn).toBeNull()
  })

  it('la cita pasa a "en atención"', async () => {
    await iniciar()

    const cita = await prisma.appointment.findUniqueOrThrow({ where: { id: citaA } })
    expect(cita.status).toBe('IN_ATTENTION')
  })

  it('registra la llegada si nadie la marcó', async () => {
    // En un consultorio pequeño el médico llama al paciente sin pasar por
    // recepción; exigir el check-in previo dejaría citas eternamente
    // "confirmadas".
    await prisma.appointment.update({
      where: { id: citaA },
      data: { status: 'CONFIRMED', arrivedAt: null },
    })

    await iniciar()

    const cita = await prisma.appointment.findUniqueOrThrow({ where: { id: citaA } })
    expect(cita.status).toBe('IN_ATTENTION')
    expect(cita.arrivedAt).not.toBeNull()
  })

  it('reabrir devuelve la misma atención, no crea otra', async () => {
    // El médico pudo cerrar la pestaña sin querer: una segunda partiría la
    // consulta en dos registros.
    const primera = await iniciar()
    const segunda = await iniciar()

    expect(segunda).toBe(primera)
    expect(await prisma.attendance.count({ where: { appointmentId: citaA } })).toBe(1)
  })

  it('un médico no puede atender la cita de otro', async () => {
    const res = await request(app)
      .post('/api/atenciones')
      .set(await sesion(MEDICO_A))
      .send({ citaId: citaB })

    expect(res.status).toBe(403)
  })

  it('recepción no puede abrir una atención', async () => {
    const res = await request(app)
      .post('/api/atenciones')
      .set(await sesion(RECEPCION))
      .send({ citaId: citaA })

    expect(res.status).toBe(403)
  })

  it('una cita cancelada no se puede atender', async () => {
    await prisma.appointment.update({ where: { id: citaA }, data: { status: 'CANCELLED' } })

    const res = await request(app)
      .post('/api/atenciones')
      .set(await sesion(MEDICO_A))
      .send({ citaId: citaA })

    expect(res.status).toBe(409)
  })

  it('muestra las alergias del paciente', async () => {
    const res = await request(app)
      .post('/api/atenciones')
      .set(await sesion(MEDICO_A))
      .send({ citaId: citaA })

    expect(res.body.atencion.pacienteAlergias).toBe('Penicilina')
  })
})

describe('signos vitales e IMC', () => {
  it('calcula el IMC a partir del peso y la talla', async () => {
    const id = await iniciar()

    const res = await guardar(id, {
      signosVitales: { pesoKg: 68, tallaCm: 165 },
    })

    expect(res.status).toBe(200)
    expect(res.body.atencion.imc.valor).toBeCloseTo(25.0, 1)
    expect(res.body.atencion.imc.clasificacion).toBe('sobrepeso')
  })

  it('NO guarda el IMC: se calcula al leer', async () => {
    // Un campo almacenado quedaría desincronizado del peso y la talla que lo
    // originan, sin forma de saber cuál de los tres es correcto.
    const id = await iniciar()
    await guardar(id, { signosVitales: { pesoKg: 68, tallaCm: 165 } })

    const columnas = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'Attendance' AND lower(column_name) LIKE '%bmi%'
    `
    expect(columnas).toEqual([])
  })

  it('en menores no aplica la clasificación adulta', async () => {
    // Los cortes de IMC adultos etiquetarían de "obesidad" a niños con
    // desarrollo normal: en pediatría se usan percentiles por edad y sexo.
    const nino = await prisma.patient.create({
      data: {
        document: `${PREFIJO_DOC}0009`,
        firstName: 'Diego',
        lastName: 'Niño',
        birthDate: new Date(new Date().getFullYear() - 8, 0, 1),
        gender: 'M',
        phone: '999333444',
      },
    })
    const enDosHoras = new Date(Date.now() + 7_200_000)
    const citaNino = await prisma.appointment.create({
      data: {
        patientId: nino.id,
        doctorId: medicoA,
        startsAt: enDosHoras,
        endsAt: new Date(enDosHoras.getTime() + 20 * 60_000),
        status: 'ARRIVED',
      },
    })

    const id = await iniciar(MEDICO_A, citaNino.id)
    const res = await guardar(id, { signosVitales: { pesoKg: 30, tallaCm: 128 } })

    expect(res.body.atencion.imc.valor).toBeGreaterThan(0)
    expect(res.body.atencion.imc.clasificacion).toBe('requiere_percentiles')
  })

  it('guarda la presión en dos campos, no como texto', async () => {
    const id = await iniciar()
    await guardar(id, { signosVitales: { presionSistolica: 130, presionDiastolica: 85 } })

    const fila = await prisma.attendance.findUniqueOrThrow({ where: { id } })
    expect(fila.bloodPressureSystolic).toBe(130)
    expect(fila.bloodPressureDiastolic).toBe(85)
  })

  it('rechaza una sistólica menor que la diastólica', async () => {
    const id = await iniciar()
    const res = await guardar(id, {
      signosVitales: { presionSistolica: 80, presionDiastolica: 120 },
    })

    expect(res.status).toBe(422)
  })

  it('rechaza valores imposibles', async () => {
    const id = await iniciar()
    expect((await guardar(id, { signosVitales: { temperatura: 390 } })).status).toBe(422)
  })

  it('un campo vacío es "no se midió", no cero', async () => {
    // Registrar 0 mmHg de presión sería un dato clínicamente falso.
    const id = await iniciar()
    await guardar(id, { signosVitales: { pesoKg: 70, presionSistolica: '' } })

    const fila = await prisma.attendance.findUniqueOrThrow({ where: { id } })
    expect(fila.bloodPressureSystolic).toBeNull()
  })
})

describe('enfermería', () => {
  it('puede registrar signos vitales', async () => {
    const id = await iniciar()

    const res = await request(app)
      .patch(`/api/atenciones/${id}/signos-vitales`)
      .set(await sesion(ENFERMERIA))
      .send({ presionSistolica: 120, presionDiastolica: 80, temperatura: 36.5 })

    expect(res.status).toBe(200)

    const fila = await prisma.attendance.findUniqueOrThrow({ where: { id } })
    expect(fila.bloodPressureSystolic).toBe(120)
  })

  it('la respuesta NO incluye el contenido clínico', async () => {
    // Devolvérselo sería una puerta trasera al diagnóstico: enfermería tiene
    // encounter:vitals, no encounter:read.
    const id = await iniciar()
    await guardar(id, { diagnostico: 'Hipertensión esencial' })

    const res = await request(app)
      .patch(`/api/atenciones/${id}/signos-vitales`)
      .set(await sesion(ENFERMERIA))
      .send({ temperatura: 37 })

    expect(JSON.stringify(res.body)).not.toContain('Hipertensión')
    expect(res.body.atencion).toBeUndefined()
  })

  it('no puede leer la atención', async () => {
    const id = await iniciar()

    const res = await request(app)
      .get(`/api/atenciones/${id}`)
      .set(await sesion(ENFERMERIA))

    expect(res.status).toBe(403)
  })

  it('no puede escribir un diagnóstico', async () => {
    const id = await iniciar()

    const res = await guardar(id, { diagnostico: 'Intento de diagnóstico' }, ENFERMERIA)
    expect(res.status).toBe(403)
  })
})

describe('congelado al completar', () => {
  async function atencionCompletada(): Promise<string> {
    const id = await iniciar()
    await guardar(id, { diagnostico: 'Hipertensión esencial', planTratamiento: 'Enalapril 10 mg' })
    expect((await completar(id)).status).toBe(200)
    return id
  }

  it('completar exige un diagnóstico', async () => {
    // Una consulta sin conclusión no documenta nada, y es justo el campo que
    // se pierde al cerrar con prisa entre pacientes.
    const id = await iniciar()
    await guardar(id, { motivo: 'Dolor de cabeza' })

    const res = await completar(id)
    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('diagnóstico')
  })

  it('completar congela la atención y cierra la cita', async () => {
    const id = await atencionCompletada()

    const fila = await prisma.attendance.findUniqueOrThrow({ where: { id } })
    expect(fila.lockedAt).not.toBeNull()

    const cita = await prisma.appointment.findUniqueOrThrow({ where: { id: citaA } })
    expect(cita.status).toBe('COMPLETED')
  })

  it('una atención congelada YA NO se puede modificar', async () => {
    const id = await atencionCompletada()

    const res = await guardar(id, { diagnostico: 'Diagnóstico cambiado' })

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('addendum')

    const fila = await prisma.attendance.findUniqueOrThrow({ where: { id } })
    expect(fila.diagnosis).toBe('Hipertensión esencial')
  })

  it('tampoco por la vía de signos vitales', async () => {
    const id = await atencionCompletada()

    const res = await request(app)
      .patch(`/api/atenciones/${id}/signos-vitales`)
      .set(await sesion(ENFERMERIA))
      .send({ temperatura: 38 })

    expect(res.status).toBe(409)
  })

  it('no se puede completar dos veces', async () => {
    const id = await atencionCompletada()
    expect((await completar(id)).status).toBe(409)
  })
})

describe('addendum', () => {
  async function atencionCompletada(): Promise<string> {
    const id = await iniciar()
    await guardar(id, { diagnostico: 'Faringitis aguda' })
    await completar(id)
    return id
  }

  it('corrige una atención congelada sin reescribirla', async () => {
    const id = await atencionCompletada()

    const res = await request(app)
      .post(`/api/atenciones/${id}/addendum`)
      .set(await sesion(MEDICO_A))
      .send({ contenido: 'Se añade resultado de cultivo: positivo a estreptococo', motivo: 'Resultado tardío' })

    expect(res.status).toBe(201)
    expect(res.body.atencion.addenda).toHaveLength(1)
    expect(res.body.atencion.addenda[0].autorNombre).toBe('Ana Atiende')
    // El texto original sigue intacto.
    expect(res.body.atencion.diagnostico).toBe('Faringitis aguda')
  })

  it('no se puede añadir a una atención abierta', async () => {
    const id = await iniciar()

    const res = await request(app)
      .post(`/api/atenciones/${id}/addendum`)
      .set(await sesion(MEDICO_A))
      .send({ contenido: 'Un texto suficientemente largo para pasar la validación' })

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('sigue abierta')
  })

  it('exige un contenido con sustancia', async () => {
    const id = await atencionCompletada()

    const res = await request(app)
      .post(`/api/atenciones/${id}/addendum`)
      .set(await sesion(MEDICO_A))
      .send({ contenido: 'ok' })

    expect(res.status).toBe(422)
  })
})

describe('alcance clínico', () => {
  it('un médico no puede leer la atención de otro', async () => {
    const ajena = await iniciar(MEDICO_B, citaB)

    const res = await request(app)
      .get(`/api/atenciones/${ajena}`)
      .set(await sesion(MEDICO_A))

    // 404 y no 403: confirmar que existe ya revela que ese paciente fue
    // atendido por otro médico.
    expect(res.status).toBe(404)
  })

  it('con acceso de emergencia SÍ puede', async () => {
    // Es el único punto del sistema donde el break-the-glass tiene sentido:
    // donde están los datos que un médico de urgencia necesita.
    const ajena = await iniciar(MEDICO_B, citaB)

    await request(app)
      .post(`/api/emergencia/pacientes/${paciente}`)
      .set(await sesion(MEDICO_A))
      .send({ motivo: 'Paciente en urgencia, su médico tratante no está disponible' })
      .expect(200)

    const res = await request(app)
      .get(`/api/atenciones/${ajena}`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
  })

  it('el historial del paciente respeta el alcance', async () => {
    const id = await iniciar(MEDICO_A, citaA)
    await guardar(id, { diagnostico: 'Faringitis' })
    await iniciar(MEDICO_B, citaB)

    const res = await request(app)
      .get(`/api/atenciones/paciente/${paciente}`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
    expect(res.body.atenciones).toHaveLength(1)
  })

  it('leer una atención queda auditado', async () => {
    const id = await iniciar()
    await request(app).get(`/api/atenciones/${id}`).set(await sesion(MEDICO_A))

    const registro = await prisma.auditLog.findFirst({
      where: { entity: 'Attendance', entityId: id, action: 'VIEW' },
      orderBy: { createdAt: 'desc' },
    })
    expect(registro?.userEmail).toBe(MEDICO_A)
  })
})

describe('diagnósticos CIE-10', () => {
  it('busca sin acentos', async () => {
    const res = await request(app)
      .get('/api/atenciones/cie10?q=hipertension')
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
    expect((res.body.codigos as { codigo: string }[]).map((c) => c.codigo)).toContain('I10')
  })

  it('busca por código', async () => {
    const res = await request(app)
      .get('/api/atenciones/cie10?q=E11')
      .set(await sesion(MEDICO_A))

    expect(res.body.codigos[0].codigo).toBe('E11')
  })

  it('asocia diagnósticos codificados, el primero como principal', async () => {
    const id = await iniciar()

    const res = await guardar(id, {
      diagnostico: 'Hipertensión y diabetes',
      diagnosticos: ['I10', 'E11'],
    })

    expect(res.status).toBe(200)
    expect(res.body.atencion.diagnosticos).toHaveLength(2)
    expect(res.body.atencion.diagnosticos[0].codigo).toBe('I10')
    expect(res.body.atencion.diagnosticos[0].esPrincipal).toBe(true)
    expect(res.body.atencion.diagnosticos[1].esPrincipal).toBe(false)
  })

  it('rechaza un código inexistente', async () => {
    const id = await iniciar()

    const res = await guardar(id, { diagnosticos: ['XX99'] })
    expect(res.status).toBe(409)
  })

  it('un diagnóstico codificado basta para completar', async () => {
    const id = await iniciar()
    await guardar(id, { diagnosticos: ['J02'] })

    expect((await completar(id)).status).toBe(200)
  })
})
