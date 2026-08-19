/**
 * Pruebas de órdenes de examen auxiliar.
 */

import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { borrarFirma, guardarFirma } from '../../core/almacenamiento.js'
import { cerrarNavegadorPdf } from '../../core/pdf.js'
import { prisma } from '../../core/prisma.js'
import { olvidarConfiguracion } from '../agenda/agenda.service.js'
import { cifrarContrasena } from '../auth/contrasenas.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const MEDICO_A = 'medicoa.exa@consultorio.test'
const MEDICO_B = 'medicob.exa@consultorio.test'
const RECEPCION = 'recepcion.exa@consultorio.test'
const ENFERMERIA = 'enfermeria.exa@consultorio.test'

const PREFIJO_DOC = '3300'

const FIRMA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** PDF mínimo válido: empieza por %PDF-, que es lo que se comprueba. */
const PDF_FALSO = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')

let medicoA: string
let atencionA: string
let atencionB: string

async function limpiar() {
  const emails = [MEDICO_A, MEDICO_B, RECEPCION, ENFERMERIA]
  const usuarios = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
  const ids = usuarios.map((u) => u.id)

  const medicos = await prisma.doctor.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  const idsMedicos = medicos.map((m) => m.id)

  for (const medico of idsMedicos) await borrarFirma(medico)

  await prisma.medicalExam.deleteMany({ where: { doctorId: { in: idsMedicos } } })
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
  await prisma.patientConsent.deleteMany({ where: { patientId: { in: idsPacientes } } })
  await prisma.patient.deleteMany({ where: { id: { in: idsPacientes } } })
}

async function crearMedicoConAtencion(email: string, nombre: string, pacienteId: string) {
  const usuario = await prisma.user.create({
    data: {
      email,
      password: await cifrarContrasena(CONTRASENA),
      firstName: nombre,
      lastName: 'Examen',
      roles: ['DOCTOR'],
      doctor: {
        create: { licenseNumber: `CMP-E${nombre}${Date.now()}`.slice(0, 20), specialty: 'Medicina General' },
      },
    },
    include: { doctor: true },
  })
  const medicoId = usuario.doctor!.id

  const enUnaHora = new Date(Date.now() + 3_600_000)
  const cita = await prisma.appointment.create({
    data: {
      patientId: pacienteId,
      doctorId: medicoId,
      startsAt: enUnaHora,
      endsAt: new Date(enUnaHora.getTime() + 20 * 60_000),
      status: 'IN_ATTENTION',
    },
  })

  const atencion = await prisma.attendance.create({
    data: {
      appointmentId: cita.id,
      doctorId: medicoId,
      patientId: pacienteId,
      diagnosis: 'Síndrome anémico en estudio',
    },
  })

  return { medicoId, atencionId: atencion.id }
}

beforeEach(async () => {
  await limpiar()
  olvidarConfiguracion()

  const hash = await cifrarContrasena(CONTRASENA)
  await prisma.user.createMany({
    data: [
      { email: RECEPCION, password: hash, firstName: 'Rosa', lastName: 'Díaz', roles: ['RECEPTIONIST'] },
      { email: ENFERMERIA, password: hash, firstName: 'Julia', lastName: 'Pari', roles: ['NURSE'] },
    ],
  })

  const paciente = await prisma.patient.create({
    data: {
      document: `${PREFIJO_DOC}0001`,
      firstName: 'Carmen',
      lastName: 'Vega Ríos',
      birthDate: new Date('1980-05-10'),
      gender: 'F',
      phone: '999111222',
    },
  })

  const a = await crearMedicoConAtencion(MEDICO_A, 'Ana', paciente.id)
  const b = await crearMedicoConAtencion(MEDICO_B, 'Bruno', paciente.id)
  medicoA = a.medicoId
  atencionA = a.atencionId
  atencionB = b.atencionId
})

afterAll(async () => {
  await limpiar()
  await cerrarNavegadorPdf()
  await prisma.$disconnect()
})

const sesion = async (email: string) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return { Authorization: `Bearer ${res.body.accessToken as string}` }
}

const EXAMENES = [
  { tipo: 'LABORATORY', nombre: 'Hemograma completo', indicaciones: '', urgente: false },
  { tipo: 'LABORATORY', nombre: 'Glucosa en ayunas', indicaciones: 'Ayuno de 8 horas', urgente: false },
  { tipo: 'IMAGING', nombre: 'Radiografía de tórax', indicaciones: '', urgente: true },
]

async function ordenar(email = MEDICO_A, atencion = atencionA): Promise<{ ordenId: string; ids: string[] }> {
  const res = await request(app)
    .post('/api/examenes')
    .set(await sesion(email))
    .send({ atencionId: atencion, examenes: EXAMENES })

  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return {
    ordenId: res.body.ordenId as string,
    ids: (res.body.examenes as { id: string }[]).map((e) => e.id),
  }
}

// =============================================================================

describe('emisión de la orden', () => {
  it('crea una orden con varios exámenes', async () => {
    const res = await request(app)
      .post('/api/examenes')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionA, examenes: EXAMENES })

    expect(res.status).toBe(201)
    expect(res.body.examenes).toHaveLength(3)
    expect(res.body.ordenId).toBeTruthy()
  })

  it('todos comparten un solo documento', async () => {
    // Separar tres exámenes en tres papeles es exactamente como se pierde uno
    // por el camino.
    const { ordenId, ids } = await ordenar()
    expect(ids).toContain(ordenId)

    const res = await request(app)
      .get(`/api/examenes/atencion/${atencionA}`)
      .set(await sesion(MEDICO_A))

    const documentos = new Set((res.body.examenes as { tienePdf: boolean }[]).map((e) => e.tienePdf))
    expect(documentos.size).toBe(1)
  })

  it('conserva la marca de urgente y las indicaciones', async () => {
    await ordenar()

    const res = await request(app)
      .get(`/api/examenes/atencion/${atencionA}`)
      .set(await sesion(MEDICO_A))

    const examenes = res.body.examenes as { nombre: string; urgente: boolean; indicaciones: string | null }[]
    expect(examenes.find((e) => e.nombre.includes('Radiografía'))?.urgente).toBe(true)
    expect(examenes.find((e) => e.nombre.includes('Glucosa'))?.indicaciones).toBe('Ayuno de 8 horas')
  })

  it('acepta una fecha límite', async () => {
    const res = await request(app)
      .post('/api/examenes')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionA, examenes: EXAMENES, fechaLimite: '2027-01-15' })

    expect(res.body.examenes[0].fechaLimite).toBe('2027-01-15')
  })

  it('exige al menos un examen', async () => {
    const res = await request(app)
      .post('/api/examenes')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionA, examenes: [] })

    expect(res.status).toBe(422)
  })

  it('un médico no ordena en la atención de otro', async () => {
    const res = await request(app)
      .post('/api/examenes')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionB, examenes: EXAMENES })

    expect(res.status).toBe(403)
  })

  it('recepción no puede ordenar exámenes', async () => {
    const res = await request(app)
      .post('/api/examenes')
      .set(await sesion(RECEPCION))
      .send({ atencionId: atencionA, examenes: EXAMENES })

    expect(res.status).toBe(403)
  })
})

describe('PDF de la orden', () => {
  it('se emite con QR y se descarga como PDF', async () => {
    await guardarFirma(medicoA, FIRMA_PNG)
    const { ordenId } = await ordenar()

    const emision = await request(app)
      .post(`/api/examenes/${ordenId}/emitir`)
      .set(await sesion(MEDICO_A))
    expect(emision.status).toBe(200)

    const descarga = await request(app)
      .get(`/api/examenes/${ordenId}/pdf`)
      .set(await sesion(MEDICO_A))
      .buffer()
      .parse((respuesta, callback) => {
        const trozos: Buffer[] = []
        respuesta.on('data', (t: Buffer) => trozos.push(t))
        respuesta.on('end', () => callback(null, Buffer.concat(trozos)))
      })

    expect(descarga.status).toBe(200)
    expect((descarga.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  it('el PDF se emite aunque el médico no tenga firma', async () => {
    // A diferencia de la receta, una orden de examen sin firma sigue siendo
    // útil: el laboratorio necesita saber qué hacer, y bloquearla dejaría al
    // paciente sin el papel por un trámite del médico.
    const { ordenId } = await ordenar()

    const res = await request(app)
      .post(`/api/examenes/${ordenId}/emitir`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
  }, 30_000)

  it('recepción puede imprimir la orden', async () => {
    const { ordenId } = await ordenar()
    await request(app).post(`/api/examenes/${ordenId}/emitir`).set(await sesion(MEDICO_A))

    const res = await request(app)
      .get(`/api/examenes/${ordenId}/pdf`)
      .set(await sesion(RECEPCION))

    expect(res.status).toBe(200)
  }, 30_000)

  it('sin emitir no hay PDF que descargar', async () => {
    const { ordenId } = await ordenar()

    const res = await request(app)
      .get(`/api/examenes/${ordenId}/pdf`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(409)
  })
})

describe('resultados', () => {
  it('el médico registra un resultado en texto', async () => {
    const { ids } = await ordenar()

    const res = await request(app)
      .post(`/api/examenes/${ids[0]}/resultado`)
      .set(await sesion(MEDICO_A))
      .send({ texto: 'Hemoglobina 10.2 g/dL. Resto dentro de rangos.' })

    expect(res.status).toBe(200)
    expect(res.body.examen.resultado).toContain('Hemoglobina')
    expect(res.body.examen.resultadoEn).toBeTruthy()
  })

  it('enfermería también puede cargar resultados', async () => {
    // Recibir el sobre del laboratorio y adjuntarlo es parte de su trabajo.
    const { ids } = await ordenar()

    const res = await request(app)
      .post(`/api/examenes/${ids[0]}/resultado`)
      .set(await sesion(ENFERMERIA))
      .send({ texto: 'Resultado recibido del laboratorio' })

    expect(res.status).toBe(200)
  })

  it('recepción no puede cargar resultados', async () => {
    const { ids } = await ordenar()

    const res = await request(app)
      .post(`/api/examenes/${ids[0]}/resultado`)
      .set(await sesion(RECEPCION))
      .send({ texto: 'intento' })

    expect(res.status).toBe(403)
  })

  it('adjunta el PDF del laboratorio', async () => {
    const { ids } = await ordenar()

    const res = await request(app)
      .post(`/api/examenes/${ids[0]}/resultado/archivo`)
      .set(await sesion(ENFERMERIA))
      .set('Content-Type', 'application/pdf')
      .send(PDF_FALSO)

    expect(res.status).toBe(200)
    expect(res.body.examen.tieneArchivoResultado).toBe(true)
  })

  it('rechaza un archivo que no sea PDF de verdad', async () => {
    // El tipo declarado lo pone quien envía: solo la cabecera %PDF- lo
    // garantiza.
    const { ids } = await ordenar()

    const res = await request(app)
      .post(`/api/examenes/${ids[0]}/resultado/archivo`)
      .set(await sesion(ENFERMERIA))
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('esto no es un pdf'))

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('no es un PDF')
  })

  it('descargar un resultado exige permiso de LECTURA clínica', async () => {
    // Leer un resultado es leer datos clínicos: no basta con el permiso de
    // impresión que sí alcanza para la orden en blanco.
    const { ids } = await ordenar()
    await request(app)
      .post(`/api/examenes/${ids[0]}/resultado/archivo`)
      .set(await sesion(ENFERMERIA))
      .set('Content-Type', 'application/pdf')
      .send(PDF_FALSO)

    const recepcion = await request(app)
      .get(`/api/examenes/${ids[0]}/resultado/archivo`)
      .set(await sesion(RECEPCION))
    expect(recepcion.status).toBe(403)

    const medico = await request(app)
      .get(`/api/examenes/${ids[0]}/resultado/archivo`)
      .set(await sesion(MEDICO_A))
    expect(medico.status).toBe(200)
  })

  it('cargar un resultado queda auditado', async () => {
    const { ids } = await ordenar()
    await request(app)
      .post(`/api/examenes/${ids[0]}/resultado`)
      .set(await sesion(ENFERMERIA))
      .send({ texto: 'Normal' })

    const registro = await prisma.auditLog.findFirst({
      where: { entity: 'MedicalExam', entityId: ids[0], action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    })
    expect(registro?.userEmail).toBe(ENFERMERIA)
  })
})

describe('alcance', () => {
  it('un médico no ve los exámenes de otro', async () => {
    const ajena = await ordenar(MEDICO_B, atencionB)

    const res = await request(app)
      .get(`/api/examenes/${ajena.ids[0]}`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(404)
  })

  it('el historial del paciente respeta el alcance', async () => {
    await ordenar(MEDICO_A, atencionA)
    await ordenar(MEDICO_B, atencionB)

    const paciente = await prisma.patient.findFirstOrThrow({
      where: { document: `${PREFIJO_DOC}0001` },
    })

    const res = await request(app)
      .get(`/api/examenes/paciente/${paciente.id}`)
      .set(await sesion(MEDICO_A))

    expect(res.body.examenes).toHaveLength(3)
  })
})

describe('catálogo', () => {
  it('busca sin acentos', async () => {
    const res = await request(app)
      .get('/api/examenes/catalogo?q=radiografia')
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
    expect(
      (res.body.examenes as { nombre: string }[]).some((e) => e.nombre.includes('Radiografía')),
    ).toBe(true)
  })

  it('se puede filtrar por tipo', async () => {
    const res = await request(app)
      .get('/api/examenes/catalogo?q=e&tipo=IMAGING&limite=30')
      .set(await sesion(MEDICO_A))

    // El término de una letra falla la validación mínima: se usa uno válido.
    expect([200, 422]).toContain(res.status)

    const conTermino = await request(app)
      .get('/api/examenes/catalogo?q=eco&tipo=IMAGING')
      .set(await sesion(MEDICO_A))

    expect(conTermino.status).toBe(200)
    for (const examen of conTermino.body.examenes as { tipo: string }[]) {
      expect(examen.tipo).toBe('IMAGING')
    }
  })

  it('trae las indicaciones frecuentes del catálogo', async () => {
    // Un ayuno mal indicado obliga a repetir el examen otro día.
    const res = await request(app)
      .get('/api/examenes/catalogo?q=glucosa')
      .set(await sesion(MEDICO_A))

    const glucosa = (res.body.examenes as { nombre: string; indicaciones: string | null }[]).find(
      (e) => e.nombre.includes('Glucosa'),
    )
    expect(glucosa?.indicaciones).toContain('Ayuno')
  })
})
