import request from 'supertest'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { cifrarContrasena } from '../auth/contrasenas.js'
import { establecerProveedorDocumentos, type ProveedorDocumentos } from './documentos.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const EMAIL_RECEPCION = 'recepcion.pac@consultorio.test'
const EMAIL_MEDICO = 'medico.pac@consultorio.test'
const EMAIL_AUDITOR = 'auditor.pac@consultorio.test'
const EMAIL_ADMIN = 'admin.pac@consultorio.test'

/** Los documentos de prueba comparten prefijo para poder limpiarlos. */
const PREFIJO = '7700'

const PACIENTES = [
  { doc: `${PREFIJO}0001`, nom: 'María', ape: 'Quispe Huamán', tel: '987111222' },
  { doc: `${PREFIJO}0002`, nom: 'Patricia', ape: 'Núñez Cárdenas', tel: '987333444' },
  { doc: `${PREFIJO}0003`, nom: 'José', ape: 'Ramírez Castro', tel: '987555666' },
  { doc: `${PREFIJO}0004`, nom: 'María', ape: 'Flores Aguirre', tel: '987777888' },
]

async function limpiar() {
  const emails = [EMAIL_RECEPCION, EMAIL_MEDICO, EMAIL_AUDITOR, EMAIL_ADMIN]
  const usuarios = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  })
  const ids = usuarios.map((u) => u.id)

  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })

  const pacientes = await prisma.patient.findMany({
    where: { document: { startsWith: PREFIJO } },
    select: { id: true },
  })
  const idsPacientes = pacientes.map((p) => p.id)
  await prisma.patientConsent.deleteMany({ where: { patientId: { in: idsPacientes } } })
  await prisma.patient.deleteMany({ where: { id: { in: idsPacientes } } })
}

beforeEach(async () => {
  await limpiar()
  const hash = await cifrarContrasena(CONTRASENA)

  await prisma.user.createMany({
    data: [
      { email: EMAIL_RECEPCION, password: hash, firstName: 'Rosa', lastName: 'Díaz', roles: ['RECEPTIONIST'] },
      { email: EMAIL_AUDITOR, password: hash, firstName: 'Elena', lastName: 'Paz', roles: ['AUDITOR'] },
      { email: EMAIL_ADMIN, password: hash, firstName: 'Luis', lastName: 'Soto', roles: ['ADMIN'] },
    ],
  })

  await prisma.user.create({
    data: {
      email: EMAIL_MEDICO,
      password: hash,
      firstName: 'Ana',
      lastName: 'Ruiz',
      roles: ['DOCTOR'],
      doctor: { create: { licenseNumber: `CMP-P${Date.now()}`, specialty: 'Medicina General' } },
    },
  })

  for (const p of PACIENTES) {
    await prisma.patient.create({
      data: {
        document: p.doc,
        firstName: p.nom,
        lastName: p.ape,
        birthDate: new Date('1985-06-15'),
        gender: 'F',
        phone: p.tel,
      },
    })
  }
})

afterEach(() => {
  establecerProveedorDocumentos(null)
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

async function token(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: CONTRASENA })
  return res.body.accessToken as string
}

const buscar = async (email: string, q: string) =>
  request(app)
    .get(`/api/pacientes?q=${encodeURIComponent(q)}`)
    .set('Authorization', `Bearer ${await token(email)}`)

/**
 * Documentos devueltos.
 *
 * Las aserciones se hacen sobre el DOCUMENTO y no sobre el nombre porque estas
 * pruebas comparten base con los datos de ejemplo, que incluyen personas con
 * los mismos nombres. Comprobar por nombre daría falsos positivos —y de hecho
 * los dio: una "María Quispe Huamán" del seed hacía fallar la prueba de baja
 * lógica aunque el filtro funcionara.
 */
const documentos = (res: request.Response): string[] =>
  (res.body.pacientes as { documento: string }[]).map((p) => p.documento)

// =============================================================================

describe('búsqueda', () => {
  it('encuentra sin tildes lo que está escrito con tildes', async () => {
    // El caso que hace o deshace un buscador en un padrón peruano: en el
    // mostrador se teclea rápido y sin acentos.
    const res = await buscar(EMAIL_RECEPCION, 'huaman')

    expect(res.status).toBe(200)
    expect(documentos(res)).toContain(PACIENTES[0]!.doc)
  })

  it('encuentra en cualquier orden de palabras', async () => {
    // Funciona con apellidos compuestos, donde concatenar el nombre al revés
    // fallaría: "Quispe Huamán" no produce "Quispe María" contiguo.
    const directo = await buscar(EMAIL_RECEPCION, 'maria quispe')
    const inverso = await buscar(EMAIL_RECEPCION, 'quispe maria')

    expect(documentos(directo)).toContain(PACIENTES[0]!.doc)
    expect(documentos(inverso)).toContain(PACIENTES[0]!.doc)
  })

  it('tolera erratas de tecleo', async () => {
    // "nuñes" por "Núñez": word_similarity compara contra cada palabra del
    // nombre, no contra "Núñez Cárdenas" entero, donde el parecido se diluye.
    const res = await buscar(EMAIL_RECEPCION, 'nuñes')

    expect(documentos(res)).toContain(PACIENTES[1]!.doc)
  })

  it('busca por documento', async () => {
    const res = await buscar(EMAIL_RECEPCION, `${PREFIJO}0003`)

    expect(documentos(res)).toEqual([PACIENTES[2]!.doc])
  })

  it('busca por teléfono', async () => {
    // El tercer dato por el que pregunta recepción cuando el paciente no
    // recuerda su documento.
    const res = await buscar(EMAIL_RECEPCION, '987333444')

    expect(documentos(res)).toContain(PACIENTES[1]!.doc)
  })

  it('exige que TODAS las palabras coincidan', async () => {
    // Con dos "María" en el padrón, añadir el apellido debe descartar la otra.
    const soloNombre = await buscar(EMAIL_RECEPCION, 'maria')
    const conApellido = await buscar(EMAIL_RECEPCION, `maria ${PREFIJO}0004`)

    expect(documentos(soloNombre).length).toBeGreaterThan(1)
    expect(documentos(conApellido)).toEqual([PACIENTES[3]!.doc])
  })

  it('un término de una sola letra devuelve el listado, no ruido', async () => {
    const res = await buscar(EMAIL_RECEPCION, 'a')

    expect(res.status).toBe(200)
    expect(res.body.pacientes.length).toBeGreaterThan(0)
  })

  it('el listado no incluye datos clínicos más allá de las alergias', async () => {
    const res = await buscar(EMAIL_RECEPCION, 'quispe')
    const paciente = res.body.pacientes[0]

    expect(paciente.antecedentes).toBeUndefined()
    expect(paciente.direccion).toBeUndefined()
    expect(paciente).toHaveProperty('alergias')
  })

  it('el auditor no puede consultar el padrón', async () => {
    const res = await buscar(EMAIL_AUDITOR, 'quispe')
    expect(res.status).toBe(403)
  })

  it('sin sesión responde 401', async () => {
    const res = await request(app).get('/api/pacientes')
    expect(res.status).toBe(401)
  })
})

describe('registro', () => {
  const nuevo = {
    documento: `${PREFIJO}9999`,
    nombres: 'Carmen',
    apellidos: 'Vega Ríos',
    fechaNacimiento: '1990-03-20',
    genero: 'F',
    telefono: '999888777',
  }

  const registrar = async (email: string, datos: Record<string, unknown> = nuevo) =>
    request(app)
      .post('/api/pacientes')
      .set('Authorization', `Bearer ${await token(email)}`)
      .send(datos)

  it('recepción puede registrar', async () => {
    const res = await registrar(EMAIL_RECEPCION)

    expect(res.status).toBe(201)
    expect(res.body.estado).toBe('creado')
    expect(res.body.paciente.nombreCompleto).toBe('Carmen Vega Ríos')
    expect(res.body.paciente.edad).toBeGreaterThan(30)
  })

  it('registra el consentimiento de datos en el mismo acto', async () => {
    // Ley 29733: los datos de salud son sensibles y requieren consentimiento
    // demostrable. Separarlo del alta garantizaría que a alguien se le olvide.
    const res = await registrar(EMAIL_RECEPCION)

    const consentimientos = await prisma.patientConsent.findMany({
      where: { patientId: res.body.paciente.id },
    })
    expect(consentimientos).toHaveLength(1)
    expect(consentimientos[0]?.type).toBe('DATA_PROCESSING')
  })

  it('un documento repetido devuelve la ficha existente en vez de un error', async () => {
    // Requisito 3.1: "verificar si ya existe → mostrar datos". Un error
    // obligaría a la recepcionista a repetir la búsqueda a mano.
    const res = await registrar(EMAIL_RECEPCION, { ...nuevo, documento: PACIENTES[0]!.doc })

    expect(res.status).toBe(200)
    expect(res.body.estado).toBe('ya_existe')
    expect(res.body.paciente.nombreCompleto).toBe('María Quispe Huamán')
  })

  it('avisa cuando el documento pertenece a una ficha dada de baja', async () => {
    // Sin este caso, el alta fallaría con un error de restricción única
    // incomprensible: el índice de la base no distingue los borrados.
    const existente = await prisma.patient.findFirstOrThrow({
      where: { document: PACIENTES[1]!.doc },
    })
    await prisma.patient.update({
      where: { id: existente.id },
      data: { deletedAt: new Date() },
    })

    const res = await registrar(EMAIL_RECEPCION, { ...nuevo, documento: PACIENTES[1]!.doc })

    expect(res.status).toBe(200)
    expect(res.body.estado).toBe('dado_de_baja')
    expect(res.body.pacienteId).toBe(existente.id)
  })

  it('valida el DNI de 8 dígitos', async () => {
    const res = await registrar(EMAIL_RECEPCION, { ...nuevo, documento: '123' })
    expect(res.status).toBe(422)
  })

  it('acepta un pasaporte con formato distinto', async () => {
    // Exigir 8 dígitos a todo dejaría fuera a pacientes extranjeros reales.
    const res = await registrar(EMAIL_RECEPCION, {
      ...nuevo,
      tipoDocumento: 'PASSPORT',
      // Comparte el prefijo de las pruebas para que la limpieza lo alcance:
      // un documento fuera de él sobrevive a la ejecución y hace fallar la
      // siguiente con un "ya existe" desconcertante.
      documento: `${PREFIJO}-AB12`,
    })

    expect(res.status).toBe(201)
  })

  it('acepta nombres con tildes, ñ y apóstrofes', async () => {
    const res = await registrar(EMAIL_RECEPCION, {
      ...nuevo,
      nombres: 'José Ángel',
      apellidos: "D'Añino Peña",
    })

    expect(res.status).toBe(201)
  })

  it('rechaza una fecha de nacimiento futura', async () => {
    const res = await registrar(EMAIL_RECEPCION, { ...nuevo, fechaNacimiento: '2099-01-01' })
    expect(res.status).toBe(422)
  })

  it('el auditor no puede registrar', async () => {
    const res = await registrar(EMAIL_AUDITOR)
    expect(res.status).toBe(403)
  })

  it('queda constancia en la auditoría', async () => {
    const res = await registrar(EMAIL_RECEPCION)

    const registro = await prisma.auditLog.findFirst({
      where: { entity: 'Patient', entityId: res.body.paciente.id, action: 'CREATE' },
    })
    expect(registro?.userEmail).toBe(EMAIL_RECEPCION)
  })
})

describe('ficha', () => {
  async function idDe(documento: string) {
    const paciente = await prisma.patient.findFirstOrThrow({ where: { document: documento } })
    return paciente.id
  }

  it('devuelve los datos completos', async () => {
    const id = await idDe(PACIENTES[0]!.doc)
    const res = await request(app)
      .get(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_MEDICO)}`)

    expect(res.status).toBe(200)
    expect(res.body.paciente.nombreCompleto).toBe('María Quispe Huamán')
    expect(res.body.paciente).toHaveProperty('antecedentes')
  })

  it('abrir la ficha SÍ se audita', async () => {
    // Es un acceso a datos de salud identificados. Las búsquedas no se
    // auditan: ahogarían en ruido justo los accesos que importan.
    const id = await idDe(PACIENTES[0]!.doc)

    await request(app)
      .get(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_MEDICO)}`)

    const registro = await prisma.auditLog.findFirst({
      where: { entity: 'Patient', entityId: id, action: 'VIEW' },
      orderBy: { createdAt: 'desc' },
    })
    expect(registro?.userEmail).toBe(EMAIL_MEDICO)
  })

  it('buscar NO se audita', async () => {
    const antes = await prisma.auditLog.count({ where: { entity: 'Patient', action: 'VIEW' } })
    await buscar(EMAIL_RECEPCION, 'quispe')
    const despues = await prisma.auditLog.count({ where: { entity: 'Patient', action: 'VIEW' } })

    expect(despues).toBe(antes)
  })

  it('un id inexistente responde 404', async () => {
    const res = await request(app)
      .get('/api/pacientes/no-existe')
      .set('Authorization', `Bearer ${await token(EMAIL_RECEPCION)}`)

    expect(res.status).toBe(404)
  })
})

describe('baja lógica', () => {
  async function idDe(documento: string) {
    const paciente = await prisma.patient.findFirstOrThrow({ where: { document: documento } })
    return paciente.id
  }

  it('solo el administrador puede dar de baja', async () => {
    const id = await idDe(PACIENTES[0]!.doc)

    const recepcion = await request(app)
      .delete(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_RECEPCION)}`)
    expect(recepcion.status).toBe(403)

    const admin = await request(app)
      .delete(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_ADMIN)}`)
    expect(admin.status).toBe(204)
  })

  it('la ficha se conserva: solo se marca la fecha de baja', async () => {
    // Una historia clínica no se elimina: hay citas y atenciones que la
    // referencian, y borrarla dejaría el historial apuntando al vacío.
    const id = await idDe(PACIENTES[0]!.doc)

    await request(app)
      .delete(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_ADMIN)}`)

    const enBase = await prisma.patient.findUnique({ where: { id } })
    expect(enBase).not.toBeNull()
    expect(enBase?.deletedAt).not.toBeNull()
  })

  it('un paciente dado de baja desaparece de TODAS las consultas', async () => {
    // La comprobación del filtro base del repositorio: si un método se
    // olvidara de él, resucitaría fichas que la clínica dio de baja.
    const id = await idDe(PACIENTES[0]!.doc)
    const cabecera = { Authorization: `Bearer ${await token(EMAIL_ADMIN)}` }

    await request(app).delete(`/api/pacientes/${id}`).set(cabecera)

    expect((await request(app).get(`/api/pacientes/${id}`).set(cabecera)).status).toBe(404)
    expect(documentos(await buscar(EMAIL_RECEPCION, 'quispe'))).not.toContain(PACIENTES[0]!.doc)
    expect(documentos(await buscar(EMAIL_RECEPCION, PACIENTES[0]!.doc))).toHaveLength(0)
  })

  it('tampoco se puede modificar un paciente dado de baja', async () => {
    const id = await idDe(PACIENTES[0]!.doc)

    await request(app)
      .delete(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_ADMIN)}`)

    const res = await request(app)
      .patch(`/api/pacientes/${id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_RECEPCION)}`)
      .send({ telefono: '999000111' })

    expect(res.status).toBe(404)
  })

  it('se puede reactivar', async () => {
    const id = await idDe(PACIENTES[0]!.doc)
    const cabecera = { Authorization: `Bearer ${await token(EMAIL_ADMIN)}` }

    await request(app).delete(`/api/pacientes/${id}`).set(cabecera)
    const res = await request(app).post(`/api/pacientes/${id}/reactivar`).set(cabecera)

    expect(res.status).toBe(200)
    expect((await request(app).get(`/api/pacientes/${id}`).set(cabecera)).status).toBe(200)
  })
})

describe('actualización', () => {
  it('recepción puede corregir el teléfono', async () => {
    const paciente = await prisma.patient.findFirstOrThrow({ where: { document: PACIENTES[0]!.doc } })

    const res = await request(app)
      .patch(`/api/pacientes/${paciente.id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_RECEPCION)}`)
      .send({ telefono: '900111222' })

    expect(res.status).toBe(200)
    expect(res.body.paciente.telefono).toBe('900111222')
  })

  it('el documento NO se puede cambiar por esta vía', async () => {
    // Identifica a la persona y es la clave que une su historial: corregirlo
    // es una operación excepcional, no parte de editar un teléfono.
    const paciente = await prisma.patient.findFirstOrThrow({ where: { document: PACIENTES[0]!.doc } })

    await request(app)
      .patch(`/api/pacientes/${paciente.id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_RECEPCION)}`)
      .send({ documento: '00000000', telefono: '900111222' })

    const despues = await prisma.patient.findUniqueOrThrow({ where: { id: paciente.id } })
    expect(despues.document).toBe(PACIENTES[0]!.doc)
  })

  it('la auditoría guarda qué campos cambiaron, no sus valores', async () => {
    // El registro de auditoría no debe volverse una segunda copia de la
    // historia clínica, fuera del control de acceso que protege la original.
    const paciente = await prisma.patient.findFirstOrThrow({ where: { document: PACIENTES[0]!.doc } })

    await request(app)
      .patch(`/api/pacientes/${paciente.id}`)
      .set('Authorization', `Bearer ${await token(EMAIL_RECEPCION)}`)
      .send({ alergias: 'Penicilina' })

    const registro = await prisma.auditLog.findFirstOrThrow({
      where: { entity: 'Patient', entityId: paciente.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    })

    expect(registro.changes).toEqual({ campos: ['allergies'] })
    expect(JSON.stringify(registro.changes)).not.toContain('Penicilina')
  })
})

describe('consulta de documento', () => {
  const consultar = async (email: string, documento: string) =>
    request(app)
      .get(`/api/pacientes/consulta-documento?documento=${documento}`)
      .set('Authorization', `Bearer ${await token(email)}`)

  it('sin proveedor configurado responde que no está disponible, sin fallar', async () => {
    // Autocompletar es una comodidad: si esto lanzara, la ausencia de un
    // servicio opcional impediría registrar pacientes.
    const res = await consultar(EMAIL_RECEPCION, '88887777')

    expect(res.status).toBe(200)
    expect(res.body.disponible).toBe(false)
    expect(res.body.encontrado).toBe(false)
  })

  it('si el paciente ya existe lo devuelve sin consultar fuera', async () => {
    let consultasExternas = 0
    const espia: ProveedorDocumentos = {
      nombre: 'espia',
      disponible: true,
      consultar: async () => {
        consultasExternas++
        return { nombres: 'X', apellidos: 'Y' }
      },
    }
    establecerProveedorDocumentos(espia)

    const res = await consultar(EMAIL_RECEPCION, PACIENTES[0]!.doc)

    expect(res.body.pacienteExistente.nombreCompleto).toBe('María Quispe Huamán')
    // Cada consulta al proveedor cuesta dinero: no se paga por alguien que ya
    // está en el padrón.
    expect(consultasExternas).toBe(0)
  })

  it('devuelve los datos del proveedor cuando el paciente es nuevo', async () => {
    establecerProveedorDocumentos({
      nombre: 'falso',
      disponible: true,
      consultar: async () => ({ nombres: 'Ana Lucía', apellidos: 'Torres Vega' }),
    })

    const res = await consultar(EMAIL_RECEPCION, '11223344')

    expect(res.body.encontrado).toBe(true)
    expect(res.body.datos.nombres).toBe('Ana Lucía')
  })

  it('si el proveedor falla, se sigue pudiendo registrar a mano', async () => {
    establecerProveedorDocumentos({
      nombre: 'caido',
      disponible: true,
      consultar: async () => null,
    })

    const res = await consultar(EMAIL_RECEPCION, '11223344')

    expect(res.status).toBe(200)
    expect(res.body.encontrado).toBe(false)
  })

  it('la consulta externa queda auditada aunque no se cree la ficha', async () => {
    // Cuesta dinero y expone datos de una persona ajena a la clínica.
    establecerProveedorDocumentos({
      nombre: 'falso',
      disponible: true,
      consultar: async () => ({ nombres: 'Ana', apellidos: 'Torres' }),
    })

    await consultar(EMAIL_RECEPCION, '55667788')

    const registro = await prisma.auditLog.findFirst({
      where: { entity: 'ConsultaDocumento', entityId: '55667788' },
    })
    expect(registro?.userEmail).toBe(EMAIL_RECEPCION)
  })

  it('el médico no puede consultar documentos: no registra pacientes de alta', async () => {
    const res = await consultar(EMAIL_AUDITOR, '11223344')
    expect(res.status).toBe(403)
  })
})
