/**
 * Pruebas de recetas.
 *
 * Incluyen la generación real del PDF, sin simular Puppeteer: lo que interesa
 * comprobar es que el documento salga y que su hash quede guardado, y eso solo
 * se ve generándolo de verdad.
 */

import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { borrarFirma, rutaDePdf } from '../../core/almacenamiento.js'
import { cerrarNavegadorPdf } from '../../core/pdf.js'
import { prisma } from '../../core/prisma.js'
import { esperarA } from '../../pruebas/esperar.js'
import { olvidarConfiguracion } from '../agenda/agenda.service.js'
import { cifrarContrasena } from '../auth/contrasenas.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const MEDICO_A = 'medicoa.rec@consultorio.test'
const MEDICO_B = 'medicob.rec@consultorio.test'
const RECEPCION = 'recepcion.rec@consultorio.test'

const PREFIJO_DOC = '4400'

/** PNG de 1×1 píxel: basta para probar el circuito de la firma. */
const FIRMA_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let atencionA: string
let atencionB: string

async function limpiar() {
  const emails = [MEDICO_A, MEDICO_B, RECEPCION]
  const usuarios = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
  const ids = usuarios.map((u) => u.id)

  const medicos = await prisma.doctor.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  const idsMedicos = medicos.map((m) => m.id)

  for (const medico of idsMedicos) await borrarFirma(medico)

  await prisma.medicineItem.deleteMany({ where: { prescription: { doctorId: { in: idsMedicos } } } })
  await prisma.prescription.deleteMany({ where: { doctorId: { in: idsMedicos } } })
  await prisma.prescriptionTemplate.deleteMany({ where: { doctorId: { in: idsMedicos } } })
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
  await prisma.patientConsent.deleteMany({ where: { patientId: { in: idsPacientes } } })
  await prisma.patient.deleteMany({ where: { id: { in: idsPacientes } } })
}

async function crearMedicoConAtencion(
  email: string,
  nombre: string,
  pacienteId: string,
): Promise<{ medicoId: string; atencionId: string }> {
  const usuario = await prisma.user.create({
    data: {
      email,
      password: await cifrarContrasena(CONTRASENA),
      firstName: nombre,
      lastName: 'Receta',
      roles: ['DOCTOR'],
      doctor: {
        create: {
          licenseNumber: `CMP-R${nombre}${Date.now()}`.slice(0, 20),
          specialty: 'Medicina General',
          specialtyRegistryNumber: 'RNE-1234',
        },
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
    data: { appointmentId: cita.id, doctorId: medicoId, patientId: pacienteId },
  })

  return { medicoId, atencionId: atencion.id }
}

beforeEach(async () => {
  await limpiar()
  olvidarConfiguracion()

  await prisma.user.create({
    data: {
      email: RECEPCION,
      password: await cifrarContrasena(CONTRASENA),
      firstName: 'Rosa',
      lastName: 'Díaz',
      roles: ['RECEPTIONIST'],
    },
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

  atencionA = (await crearMedicoConAtencion(MEDICO_A, 'Ana', paciente.id)).atencionId
  atencionB = (await crearMedicoConAtencion(MEDICO_B, 'Bruno', paciente.id)).atencionId
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

const MEDICAMENTOS = [
  {
    nombre: 'Amoxicilina',
    concentracion: '500 mg',
    forma: 'Cápsula',
    via: 'Oral',
    frecuencia: 'Cada 8 horas',
    duracion: '7 días',
    cantidad: 21,
  },
  { nombre: 'Paracetamol', concentracion: '500 mg', via: 'Oral', frecuencia: 'Cada 8 horas si hay dolor' },
]

async function crearReceta(email = MEDICO_A, atencion = atencionA): Promise<string> {
  const res = await request(app)
    .post('/api/recetas')
    .set(await sesion(email))
    .send({ atencionId: atencion, medicamentos: MEDICAMENTOS, diasValidez: 30 })

  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.receta.id as string
}

async function registrarFirma(email = MEDICO_A) {
  return request(app).put('/api/perfil/firma').set(await sesion(email)).send({ imagen: FIRMA_PNG })
}

// =============================================================================

describe('creación', () => {
  it('el médico emite una receta con varios medicamentos', async () => {
    const res = await request(app)
      .post('/api/recetas')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionA, medicamentos: MEDICAMENTOS })

    expect(res.status).toBe(201)
    expect(res.body.receta.medicamentos).toHaveLength(2)
    expect(res.body.receta.pacienteNombre).toBe('Carmen Vega Ríos')
  })

  it('conserva el orden en que se añadieron', async () => {
    const id = await crearReceta()
    const res = await request(app).get(`/api/recetas/${id}`).set(await sesion(MEDICO_A))

    expect(res.body.receta.medicamentos[0].nombre).toBe('Amoxicilina')
    expect(res.body.receta.medicamentos[1].nombre).toBe('Paracetamol')
  })

  it('genera un resumen legible de cada medicamento', async () => {
    const id = await crearReceta()
    const res = await request(app).get(`/api/recetas/${id}`).set(await sesion(MEDICO_A))

    expect(res.body.receta.medicamentos[0].resumen).toBe(
      'Amoxicilina 500 mg — Oral, Cada 8 horas, 7 días',
    )
  })

  it('calcula hasta cuándo es válida', async () => {
    const res = await request(app)
      .post('/api/recetas')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionA, medicamentos: MEDICAMENTOS, diasValidez: 15 })

    const emitida = new Date(res.body.receta.emitidaEn)
    const valida = new Date(`${res.body.receta.validaHasta}T12:00:00Z`)
    const dias = Math.round((valida.getTime() - emitida.getTime()) / 86_400_000)

    expect(dias).toBeGreaterThanOrEqual(14)
    expect(dias).toBeLessThanOrEqual(16)
  })

  it('solo el nombre del medicamento es obligatorio', async () => {
    // Hay indicaciones legítimas que no encajan en el molde de concentración,
    // vía, frecuencia y duración: forzarlas lleva a escribir cualquier cosa.
    const res = await request(app)
      .post('/api/recetas')
      .set(await sesion(MEDICO_A))
      .send({
        atencionId: atencionA,
        medicamentos: [{ nombre: 'Suero fisiológico', indicaciones: 'Lavado nasal a demanda' }],
      })

    expect(res.status).toBe(201)
  })

  it('exige al menos un medicamento', async () => {
    const res = await request(app)
      .post('/api/recetas')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionA, medicamentos: [] })

    expect(res.status).toBe(422)
  })

  it('un médico no puede recetar en la atención de otro', async () => {
    const res = await request(app)
      .post('/api/recetas')
      .set(await sesion(MEDICO_A))
      .send({ atencionId: atencionB, medicamentos: MEDICAMENTOS })

    expect(res.status).toBe(403)
  })

  it('recepción no puede emitir recetas', async () => {
    const res = await request(app)
      .post('/api/recetas')
      .set(await sesion(RECEPCION))
      .send({ atencionId: atencionA, medicamentos: MEDICAMENTOS })

    expect(res.status).toBe(403)
  })
})

describe('firma del médico', () => {
  it('se registra una vez en el perfil', async () => {
    expect((await registrarFirma()).status).toBe(200)

    const res = await request(app).get('/api/perfil/firma').set(await sesion(MEDICO_A))
    expect(res.body.registrada).toBe(true)
  })

  it('rechaza algo que no sea PNG', async () => {
    const res = await request(app)
      .put('/api/perfil/firma')
      .set(await sesion(MEDICO_A))
      .send({ imagen: 'data:image/jpeg;base64,AAAA' })

    expect(res.status).toBe(422)
  })

  it('recepción no tiene firma que registrar', async () => {
    const res = await request(app)
      .put('/api/perfil/firma')
      .set(await sesion(RECEPCION))
      .send({ imagen: FIRMA_PNG })

    expect(res.status).toBe(403)
  })

  it('se puede borrar y volver a registrar', async () => {
    await registrarFirma()
    await request(app).delete('/api/perfil/firma').set(await sesion(MEDICO_A)).expect(204)

    const res = await request(app).get('/api/perfil/firma').set(await sesion(MEDICO_A))
    expect(res.body.registrada).toBe(false)
  })
})

describe('firma de la receta y PDF', () => {
  it('sin firma registrada emite igual, para firmar a mano', async () => {
    // Registrar la firma es una comodidad, no un requisito: firmar el papel a
    // mano es el flujo de siempre y sigue siendo válido. Bloquear la emisión
    // dejaría al paciente sin receta por un trámite pendiente del médico.
    const id = await crearReceta()

    const res = await request(app)
      .post(`/api/recetas/${id}/firmar`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
    expect(res.body.receta.tipoFirma).toBe('HANDWRITTEN')
    expect(res.body.receta.tienePdf).toBe(true)
  }, 30_000)

  it('con firma registrada genera el PDF y guarda su hash', async () => {
    await registrarFirma()
    const id = await crearReceta()

    const res = await request(app)
      .post(`/api/recetas/${id}/firmar`)
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
    expect(res.body.receta.firmadaEn).toBeTruthy()
    expect(res.body.receta.tipoFirma).toBe('DRAWN')
    // SHA-256 en hexadecimal: lo que permite demostrar que el documento
    // entregado no fue alterado.
    expect(res.body.receta.hashPdf).toMatch(/^[a-f0-9]{64}$/)
    expect(res.body.receta.tienePdf).toBe(true)
  }, 30_000)

  it('el PDF se descarga y es un PDF de verdad', async () => {
    await registrarFirma()
    const id = await crearReceta()
    await request(app).post(`/api/recetas/${id}/firmar`).set(await sesion(MEDICO_A))

    const res = await request(app)
      .get(`/api/recetas/${id}/pdf`)
      .set(await sesion(MEDICO_A))
      .buffer()
      .parse((response, callback) => {
        const trozos: Buffer[] = []
        response.on('data', (t: Buffer) => trozos.push(t))
        response.on('end', () => callback(null, Buffer.concat(trozos)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    // Firma del formato: todo PDF empieza por %PDF-.
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  it('el hash corresponde al PDF realmente guardado', async () => {
    await registrarFirma()
    const id = await crearReceta()

    const res = await request(app).post(`/api/recetas/${id}/firmar`).set(await sesion(MEDICO_A))

    const { createHash } = await import('node:crypto')
    const contenido = readFileSync(rutaDePdf('recetas', id))
    const calculado = createHash('sha256').update(contenido).digest('hex')

    expect(calculado).toBe(res.body.receta.hashPdf)
  }, 30_000)

  it('nadie firma por otro médico', async () => {
    // La firma identifica a quien se responsabiliza de la receta.
    await registrarFirma(MEDICO_B)
    const ajena = await crearReceta(MEDICO_B, atencionB)

    const res = await request(app)
      .post(`/api/recetas/${ajena}/firmar`)
      .set(await sesion(MEDICO_A))

    // No la encuentra siquiera: está fuera de su alcance.
    expect([403, 404]).toContain(res.status)
  })

  it('recepción puede imprimir la receta pero no leerla', async () => {
    // Entregar al paciente el documento impreso es su trabajo; navegar el
    // historial de diagnósticos, no. Por eso `prescription:print` está
    // separado de `prescription:read`.
    await registrarFirma()
    const id = await crearReceta()
    await request(app).post(`/api/recetas/${id}/firmar`).set(await sesion(MEDICO_A))

    const impresion = await request(app)
      .get(`/api/recetas/${id}/pdf`)
      .set(await sesion(RECEPCION))
    expect(impresion.status).toBe(200)

    const lectura = await request(app).get(`/api/recetas/${id}`).set(await sesion(RECEPCION))
    expect(lectura.status).toBe(403)
  }, 30_000)

  it('una receta sin firmar no tiene PDF que descargar', async () => {
    const id = await crearReceta()

    const res = await request(app).get(`/api/recetas/${id}/pdf`).set(await sesion(MEDICO_A))

    expect(res.status).toBe(409)
    expect(res.body.error.mensaje).toContain('firmarla')
  })

  it('descargar el PDF queda auditado', async () => {
    await registrarFirma()
    const id = await crearReceta()
    await request(app).post(`/api/recetas/${id}/firmar`).set(await sesion(MEDICO_A))
    await request(app).get(`/api/recetas/${id}/pdf`).set(await sesion(RECEPCION))

    // La auditoría se escribe después de responder, así que se espera a que
    // aparezca en vez de leerla una sola vez y perder la carrera.
    const registro = await esperarA(() =>
      prisma.auditLog.findFirst({
        where: { entity: 'Prescription', entityId: id, action: 'PRINT' },
      }),
    )
    expect(registro?.userEmail).toBe(RECEPCION)
  }, 30_000)
})

describe('alcance', () => {
  it('un médico no ve las recetas de otro', async () => {
    const ajena = await crearReceta(MEDICO_B, atencionB)

    const res = await request(app).get(`/api/recetas/${ajena}`).set(await sesion(MEDICO_A))
    expect(res.status).toBe(404)
  })

  it('el historial de recetas del paciente respeta el alcance', async () => {
    await crearReceta(MEDICO_A, atencionA)
    await crearReceta(MEDICO_B, atencionB)

    const paciente = await prisma.patient.findFirstOrThrow({
      where: { document: `${PREFIJO_DOC}0001` },
    })

    const res = await request(app)
      .get(`/api/recetas/paciente/${paciente.id}`)
      .set(await sesion(MEDICO_A))

    expect(res.body.recetas).toHaveLength(1)
  })
})

describe('plantillas', () => {
  it('guarda y reutiliza una combinación frecuente', async () => {
    // Un médico repite las mismas diez o veinte: aplicarlas de un botón ahorra
    // más tiempo al día que cualquier otra función del módulo.
    const guardar = await request(app)
      .post('/api/recetas/plantillas')
      .set(await sesion(MEDICO_A))
      .send({ nombre: 'Faringitis bacteriana', medicamentos: MEDICAMENTOS })

    expect(guardar.status).toBe(201)

    const listado = await request(app)
      .get('/api/recetas/plantillas')
      .set(await sesion(MEDICO_A))

    expect(listado.body.plantillas).toHaveLength(1)
    expect(listado.body.plantillas[0].medicamentos).toHaveLength(2)
  })

  it('las plantillas son de cada médico', async () => {
    await request(app)
      .post('/api/recetas/plantillas')
      .set(await sesion(MEDICO_A))
      .send({ nombre: 'Mía', medicamentos: MEDICAMENTOS })

    const otro = await request(app).get('/api/recetas/plantillas').set(await sesion(MEDICO_B))
    expect(otro.body.plantillas).toHaveLength(0)
  })

  it('guardar con el mismo nombre reemplaza en vez de duplicar', async () => {
    const enviar = async (medicamentos: unknown[]) =>
      request(app)
        .post('/api/recetas/plantillas')
        .set(await sesion(MEDICO_A))
        .send({ nombre: 'Resfriado', medicamentos })

    await enviar(MEDICAMENTOS)
    await enviar([{ nombre: 'Loratadina', concentracion: '10 mg' }])

    const listado = await request(app).get('/api/recetas/plantillas').set(await sesion(MEDICO_A))
    expect(listado.body.plantillas).toHaveLength(1)
    expect(listado.body.plantillas[0].medicamentos).toHaveLength(1)
  })
})

describe('catálogo de medicamentos', () => {
  it('busca sin acentos ni mayúsculas', async () => {
    const res = await request(app)
      .get('/api/recetas/medicamentos?q=amoxi')
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(200)
    expect(
      (res.body.medicamentos as { nombre: string }[]).some((m) => m.nombre.includes('Amoxicilina')),
    ).toBe(true)
  })

  it('busca por principio activo', async () => {
    const res = await request(app)
      .get('/api/recetas/medicamentos?q=clavulanato')
      .set(await sesion(MEDICO_A))

    expect(res.body.medicamentos.length).toBeGreaterThan(0)
  })

  it('exige al menos dos caracteres', async () => {
    const res = await request(app)
      .get('/api/recetas/medicamentos?q=a')
      .set(await sesion(MEDICO_A))

    expect(res.status).toBe(422)
  })
})
