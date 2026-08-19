/**
 * Pruebas de reportes.
 *
 * Lo que más importa aquí no es que las cifras existan sino que signifiquen lo
 * que dicen: una tasa de asistencia calculada sobre el total —incluidas las
 * citas que aún no han ocurrido— parece un dato y es ruido.
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
const ADMIN = 'admin.rep@consultorio.test'
const MEDICO_A = 'medicoa.rep@consultorio.test'
const MEDICO_B = 'medicob.rep@consultorio.test'
const RECEPCION = 'recepcion.rep@consultorio.test'

const LIMA = 'America/Lima'
const PREFIJO_DOC = '2200'

/** Semana fija en el pasado: las cifras no dependen de cuándo se ejecute. */
const LUNES = '2026-03-02'
const MARTES = '2026-03-03'
const DOMINGO = '2026-03-08'

let medicoA: string
let medicoB: string
let pacientes: string[] = []

async function limpiar() {
  const emails = [ADMIN, MEDICO_A, MEDICO_B, RECEPCION]
  const usuarios = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
  const ids = usuarios.map((u) => u.id)

  const medicos = await prisma.doctor.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  const idsMedicos = medicos.map((m) => m.id)

  await prisma.appointment.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })

  const pacs = await prisma.patient.findMany({
    where: { document: { startsWith: PREFIJO_DOC } },
    select: { id: true },
  })
  const idsPacs = pacs.map((p) => p.id)
  await prisma.appointment.deleteMany({ where: { patientId: { in: idsPacs } } })
  await prisma.patientConsent.deleteMany({ where: { patientId: { in: idsPacs } } })
  await prisma.patient.deleteMany({ where: { id: { in: idsPacs } } })
}

async function crearMedico(email: string, nombre: string): Promise<string> {
  const usuario = await prisma.user.create({
    data: {
      email,
      password: await cifrarContrasena(CONTRASENA),
      firstName: nombre,
      lastName: 'Reporte',
      roles: ['DOCTOR'],
      doctor: {
        create: { licenseNumber: `CMP-P${nombre}${Date.now()}`.slice(0, 20), specialty: 'General' },
      },
    },
    include: { doctor: true },
  })
  return usuario.doctor!.id
}

interface Cita {
  medico: string
  paciente: number
  fecha: string
  minuto: number
  estado: 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'SCHEDULED'
  motivoCancelacion?: string
  origen?: 'PATIENT' | 'CLINIC'
}

async function sembrar(citas: Cita[]) {
  for (const cita of citas) {
    await prisma.appointment.create({
      data: {
        patientId: pacientes[cita.paciente]!,
        doctorId: cita.medico,
        startsAt: aInstante(cita.fecha, cita.minuto, LIMA),
        endsAt: aInstante(cita.fecha, cita.minuto + 20, LIMA),
        status: cita.estado,
        ...(cita.motivoCancelacion
          ? {
              cancelReason: cita.motivoCancelacion,
              cancelledBy: cita.origen ?? 'PATIENT',
              cancelledAt: new Date(),
            }
          : {}),
      },
    })
  }
}

beforeEach(async () => {
  await limpiar()
  olvidarConfiguracion()

  const hash = await cifrarContrasena(CONTRASENA)
  await prisma.user.createMany({
    data: [
      { email: ADMIN, password: hash, firstName: 'Luis', lastName: 'Soto', roles: ['ADMIN'] },
      { email: RECEPCION, password: hash, firstName: 'Rosa', lastName: 'Díaz', roles: ['RECEPTIONIST'] },
    ],
  })

  medicoA = await crearMedico(MEDICO_A, 'Ana')
  medicoB = await crearMedico(MEDICO_B, 'Bruno')

  pacientes = []
  for (let i = 0; i < 4; i++) {
    const paciente = await prisma.patient.create({
      data: {
        document: `${PREFIJO_DOC}000${i}`,
        firstName: `Paciente${i}`,
        lastName: 'De Prueba',
        birthDate: new Date(i === 0 ? '2020-01-01' : i === 1 ? '1995-01-01' : '1960-01-01'),
        gender: i % 2 === 0 ? 'F' : 'M',
        phone: `99900010${i}`,
      },
    })
    pacientes.push(paciente.id)
  }
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

const sesion = async (email: string) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return { Authorization: `Bearer ${res.body.accessToken as string}` }
}

const citas = async (email = ADMIN, extra = '') =>
  request(app)
    .get(`/api/reportes/citas?desde=${LUNES}&hasta=${DOMINGO}${extra}`)
    .set(await sesion(email))

// =============================================================================

describe('reporte de citas', () => {
  it('cuenta por estado', async () => {
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 1, fecha: LUNES, minuto: 540, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 2, fecha: LUNES, minuto: 600, estado: 'NO_SHOW' },
      { medico: medicoA, paciente: 3, fecha: MARTES, minuto: 480, estado: 'CANCELLED', motivoCancelacion: 'Viaje' },
    ])

    const res = await citas()

    expect(res.status).toBe(200)
    expect(res.body.total).toBe(4)
    expect(res.body.porEstado.atendidas).toBe(2)
    expect(res.body.porEstado.noAsistieron).toBe(1)
    expect(res.body.porEstado.canceladas).toBe(1)
  })

  it('la tasa de asistencia se calcula sobre citas RESUELTAS', async () => {
    // 2 atendidas y 1 inasistencia son 66,7 %. Si se incluyeran las 3 citas
    // todavía agendadas, saldría 33,3 % y parecería que la clínica va mal
    // cuando solo tiene la agenda llena.
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 1, fecha: LUNES, minuto: 540, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 2, fecha: LUNES, minuto: 600, estado: 'NO_SHOW' },
      { medico: medicoA, paciente: 3, fecha: MARTES, minuto: 480, estado: 'SCHEDULED' },
      { medico: medicoA, paciente: 0, fecha: MARTES, minuto: 540, estado: 'SCHEDULED' },
      { medico: medicoA, paciente: 1, fecha: MARTES, minuto: 600, estado: 'SCHEDULED' },
    ])

    const res = await citas()

    expect(res.body.tasaAsistencia).toBeCloseTo(66.7, 1)
    expect(res.body.tasaInasistencia).toBeCloseTo(33.3, 1)
  })

  it('sin citas resueltas devuelve 0, no un valor imposible', async () => {
    await sembrar([{ medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'SCHEDULED' }])

    const res = await citas()

    expect(res.body.tasaAsistencia).toBe(0)
    expect(Number.isNaN(res.body.tasaAsistencia)).toBe(false)
  })

  it('desglosa por médico', async () => {
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 1, fecha: LUNES, minuto: 540, estado: 'NO_SHOW' },
      { medico: medicoB, paciente: 2, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
    ])

    const res = await citas()
    const filaA = (res.body.porMedico as { medicoId: string; tasaInasistencia: number }[]).find(
      (f) => f.medicoId === medicoA,
    )

    expect(filaA?.tasaInasistencia).toBe(50)
  })

  it('agrupa por día de la semana usando la fecha LOCAL', async () => {
    // Una cita del domingo a las 20:00 de Lima ya es lunes en UTC: agrupar por
    // la fecha UTC la movería de día.
    await sembrar([{ medico: medicoA, paciente: 0, fecha: DOMINGO, minuto: 1200, estado: 'COMPLETED' }])

    const res = await citas()
    const domingo = (res.body.porDiaSemana as { dia: number; total: number }[])[0]

    expect(domingo?.dia).toBe(0)
    expect(domingo?.total).toBe(1)
  })

  it('resume los motivos de cancelación', async () => {
    // Es lo que justifica que cancelar exija un motivo: sin esto, el reporte
    // solo diría cuántas cancelaciones hubo.
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'CANCELLED', motivoCancelacion: 'Se enfermó' },
      { medico: medicoA, paciente: 1, fecha: LUNES, minuto: 540, estado: 'CANCELLED', motivoCancelacion: 'Se enfermó' },
      { medico: medicoA, paciente: 2, fecha: MARTES, minuto: 480, estado: 'CANCELLED', motivoCancelacion: 'Viaje', origen: 'CLINIC' },
    ])

    const res = await citas()

    expect(res.body.motivosCancelacion[0]).toEqual({ motivo: 'Se enfermó', cantidad: 2 })
    expect(res.body.cancelacionesPorOrigen).toEqual({ paciente: 2, clinica: 1 })
  })

  it('el médico ve solo sus propias cifras', async () => {
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoB, paciente: 1, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
    ])

    const admin = await citas(ADMIN)
    const medico = await citas(MEDICO_A)

    expect(admin.body.total).toBe(2)
    expect(medico.body.total).toBe(1)
  })

  it('recepción no accede a los reportes', async () => {
    const res = await citas(RECEPCION)
    expect(res.status).toBe(403)
  })

  it('rechaza un rango invertido', async () => {
    const res = await request(app)
      .get(`/api/reportes/citas?desde=${DOMINGO}&hasta=${LUNES}`)
      .set(await sesion(ADMIN))

    expect(res.status).toBe(400)
  })

  it('rechaza un rango desmesurado', async () => {
    // Sin tope, pedir "desde 2020" recorrería la tabla entera en cada carga.
    const res = await request(app)
      .get('/api/reportes/citas?desde=2015-01-01&hasta=2026-12-31')
      .set(await sesion(ADMIN))

    expect(res.status).toBe(400)
    expect(res.body.error.mensaje).toContain('3 años')
  })
})

describe('reporte de pacientes', () => {
  it('cuenta a cada persona una vez, aunque tenga varias consultas', async () => {
    // Sin distinguir, el reporte contaría visitas y las llamaría pacientes.
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 0, fecha: MARTES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 1, fecha: MARTES, minuto: 540, estado: 'COMPLETED' },
    ])

    const res = await request(app)
      .get(`/api/reportes/pacientes?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    expect(res.status).toBe(200)
    expect(res.body.totalAtendidos).toBe(2)
  })

  it('desglosa por rango de edad', async () => {
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
      { medico: medicoA, paciente: 2, fecha: LUNES, minuto: 540, estado: 'COMPLETED' },
    ])

    const res = await request(app)
      .get(`/api/reportes/pacientes?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    const rangos = (res.body.porRangoEdad as { rango: string }[]).map((r) => r.rango)
    expect(rangos).toContain('5-17')
    expect(rangos).toContain('60+')
  })
})

describe('exportación', () => {
  it('genera un CSV con cabecera y datos', async () => {
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
    ])

    const res = await request(app)
      .get(`/api/reportes/citas.csv?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.text).toContain('Paciente')
    expect(res.text).toContain('Paciente0 De Prueba')
  })

  it('lleva BOM y sugerencia de separador para Excel', async () => {
    // Sin el BOM, Excel destroza las tildes; sin `sep=`, usa el separador de
    // la configuración regional, que en español suele ser el punto y coma.
    const res = await request(app)
      .get(`/api/reportes/citas.csv?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    expect(res.text.startsWith('\uFEFFsep=,')).toBe(true)
  })

  it('escapa los campos con comas', async () => {
    // Un motivo de cancelación con una coma desplazaría todas las columnas.
    await sembrar([
      {
        medico: medicoA,
        paciente: 0,
        fecha: LUNES,
        minuto: 480,
        estado: 'CANCELLED',
        motivoCancelacion: 'Se enfermó, no puede venir',
      },
    ])

    const res = await request(app)
      .get(`/api/reportes/citas.csv?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    expect(res.text).toContain('"Se enfermó, no puede venir"')
  })

  it('el documento se exporta como texto para no perder el cero inicial', async () => {
    await sembrar([
      { medico: medicoA, paciente: 0, fecha: LUNES, minuto: 480, estado: 'COMPLETED' },
    ])

    const res = await request(app)
      .get(`/api/reportes/citas.csv?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    expect(res.text).toContain(`="${PREFIJO_DOC}0000"`)
  })

  it('la exportación queda auditada', async () => {
    // Sacar el padrón a un archivo es justo la operación que hay que poder
    // rastrear si esos datos aparecen donde no deben.
    await request(app)
      .get(`/api/reportes/pacientes.csv?desde=${LUNES}&hasta=${DOMINGO}`)
      .set(await sesion(ADMIN))

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'EXPORT', entity: 'Patient' },
      orderBy: { createdAt: 'desc' },
    })

    expect(registro?.userEmail).toBe(ADMIN)
    expect(registro?.reason).toContain('exportación')
  })
})
