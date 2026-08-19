/**
 * Órdenes de examen auxiliar.
 *
 * A diferencia de la receta, una orden agrupa VARIOS exámenes: es habitual
 * pedir hemograma, glucosa y perfil lipídico de una vez, y separarlos en tres
 * papeles distintos es exactamente como se pierde uno por el camino. En la
 * base cada examen es una fila —así se les puede cargar resultado por
 * separado— pero comparten el PDF y el número de orden.
 */

import {
  ETIQUETAS_TIPO_EXAMEN,
  edadLegible,
  type DatosOrdenExamen,
  type Examen,
  type ExamenCatalogo,
  type TipoExamen,
} from '@consultorio/shared'
import type { ExamType, Prisma } from '@prisma/client'
import QRCode from 'qrcode'
import { firmaComoDataUrl, guardarPdf, hayPdf, leerPdf } from '../../core/almacenamiento.js'
import { registrarAuditoria } from '../../core/auditoria.js'
import { env } from '../../config/env.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorConflicto, ErrorNoEncontrado, ErrorProhibido } from '../../core/errores.js'
import { htmlAPdf } from '../../core/pdf.js'
import { contextoPuede, exigirPermiso, filtroDeAlcance } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'
import { aFechaLocal } from '../../core/tiempo.js'
import { configuracionAgenda } from '../agenda/agenda.service.js'
import { tieneAccesoVigente } from '../emergencia/emergencia.service.js'
import { plantillaExamen } from './plantilla.js'

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

const CARPETA_PDF = 'examenes'
const CARPETA_RESULTADOS = 'resultados'

const INCLUIR = {
  patient: { select: { id: true, firstName: true, lastName: true, document: true, birthDate: true } },
  doctor: {
    select: {
      id: true,
      licenseNumber: true,
      specialty: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.MedicalExamInclude

type FilaExamen = Prisma.MedicalExamGetPayload<{ include: typeof INCLUIR }>

/**
 * Identificador de la ORDEN.
 *
 * Todos los exámenes pedidos en el mismo acto comparten PDF, así que el
 * documento se guarda con el identificador del primero. Es lo que permite que
 * un solo papel cubra los tres exámenes sin inventar una tabla intermedia.
 */
function idDeOrden(examenes: { id: string }[]): string {
  return examenes[0]!.id
}

function aExamen(fila: FilaExamen, idOrden: string): Examen {
  return {
    id: fila.id,
    atencionId: fila.attendanceId,

    pacienteId: fila.patient.id,
    pacienteNombre: `${fila.patient.firstName} ${fila.patient.lastName}`,
    pacienteDocumento: fila.patient.document,

    medicoId: fila.doctor.id,
    medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,

    tipo: fila.type as TipoExamen,
    nombre: fila.name,
    indicaciones: fila.instructions,
    urgente: fila.isUrgent,

    emitidoEn: fila.issuedAt.toISOString(),
    fechaLimite: fila.dueDate ? fila.dueDate.toISOString().slice(0, 10) : null,

    resultado: fila.result,
    tieneArchivoResultado: hayPdf(CARPETA_RESULTADOS, fila.id),
    resultadoEn: fila.resultAt?.toISOString() ?? null,

    tienePdf: hayPdf(CARPETA_PDF, idOrden),
  }
}

// --- Acceso ------------------------------------------------------------------

async function localizar(ctx: ContextoAuth, id: string): Promise<FilaExamen> {
  const alcance = filtroDeAlcance(ctx, 'exam:read')

  const propio = await prisma.medicalExam.findFirst({ where: { id, ...alcance }, include: INCLUIR })
  if (propio) return propio

  const cualquiera = await prisma.medicalExam.findUnique({
    where: { id },
    select: { patientId: true },
  })
  if (!cualquiera) throw new ErrorNoEncontrado('No se encontró el examen')

  if (!(await tieneAccesoVigente(ctx.usuarioId, cualquiera.patientId))) {
    throw new ErrorNoEncontrado('No se encontró el examen')
  }

  return prisma.medicalExam.findUniqueOrThrow({ where: { id }, include: INCLUIR })
}

// --- Emisión -----------------------------------------------------------------

export async function ordenar(
  ctx: ContextoAuth,
  datos: DatosOrdenExamen,
  cliente: DatosCliente,
): Promise<{ ordenId: string; examenes: Examen[] }> {
  exigirPermiso(ctx, 'exam:create')

  const atencion = await prisma.attendance.findUnique({
    where: { id: datos.atencionId },
    select: { id: true, doctorId: true, patientId: true },
  })
  if (!atencion) throw new ErrorNoEncontrado('No se encontró la atención')

  if (!contextoPuede(ctx, 'exam:create', 'all') && ctx.doctorId !== atencion.doctorId) {
    throw new ErrorProhibido('Solo puedes ordenar exámenes en tus propias atenciones')
  }

  const fechaLimite = datos.fechaLimite?.trim()
    ? new Date(`${datos.fechaLimite}T00:00:00Z`)
    : null

  const creados = await prisma.$transaction(
    datos.examenes.map((examen) =>
      prisma.medicalExam.create({
        data: {
          attendanceId: atencion.id,
          doctorId: atencion.doctorId,
          patientId: atencion.patientId,
          type: examen.tipo as ExamType,
          name: examen.nombre,
          instructions: examen.indicaciones?.trim() || null,
          isUrgent: examen.urgente,
          dueDate: fechaLimite,
        },
        include: INCLUIR,
      }),
    ),
  )

  const ordenId = idDeOrden(creados)

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'MedicalExam',
    entidadId: ordenId,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'exam:create',
    cambios: { examenes: creados.length },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return { ordenId, examenes: creados.map((fila) => aExamen(fila, ordenId)) }
}

/**
 * Genera el PDF de la orden.
 *
 * Se emite para TODOS los exámenes pedidos en el mismo acto, identificados por
 * compartir atención y momento de emisión.
 */
export async function generarPdf(
  ctx: ContextoAuth,
  ordenId: string,
  cliente: DatosCliente,
): Promise<{ examenes: Examen[] }> {
  exigirPermiso(ctx, 'exam:create')

  const { zonaHoraria } = await configuracionAgenda()
  const primero = await localizar(ctx, ordenId)

  if (ctx.doctorId !== primero.doctorId) {
    throw new ErrorProhibido('Solo el médico que la ordenó puede emitir este documento')
  }

  // Los exámenes de la misma orden: misma atención y mismo instante de emisión.
  const examenes = await prisma.medicalExam.findMany({
    where: { attendanceId: primero.attendanceId, issuedAt: primero.issuedAt },
    include: INCLUIR,
    orderBy: { name: 'asc' },
  })

  const [ajustes, firma, atencion] = await Promise.all([
    prisma.clinicSettings.findUnique({ where: { id: 1 } }),
    firmaComoDataUrl(primero.doctorId),
    prisma.attendance.findUnique({
      where: { id: primero.attendanceId },
      select: { diagnosis: true },
    }),
  ])
  if (!ajustes) throw new ErrorConflicto('La clínica no está configurada')

  const formatoFecha = (fecha: string) =>
    new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })

  // El QR lleva a la orden dentro del sistema: quien la reciba puede
  // escanearla en lugar de teclear el número.
  const qrDataUrl = await QRCode.toDataURL(`${env.FRONTEND_URL}/examenes/${ordenId}`, {
    margin: 0,
    width: 220,
  }).catch(() => null)

  const html = plantillaExamen({
    clinica: {
      nombre: ajustes.name,
      ruc: ajustes.ruc,
      direccion: ajustes.address,
      telefono: ajustes.phone,
      logoUrl: ajustes.logoUrl,
    },
    paciente: {
      nombre: `${primero.patient.firstName} ${primero.patient.lastName}`,
      documento: primero.patient.document,
      edad: edadLegible(primero.patient.birthDate),
    },
    medico: {
      nombre: `${primero.doctor.user.firstName} ${primero.doctor.user.lastName}`,
      colegiatura: primero.doctor.licenseNumber,
      especialidad: primero.doctor.specialty,
    },
    orden: {
      numero: ordenId.slice(-8).toUpperCase(),
      emitidaEn: formatoFecha(aFechaLocal(primero.issuedAt, zonaHoraria)),
      fechaLimite: primero.dueDate
        ? formatoFecha(primero.dueDate.toISOString().slice(0, 10))
        : null,
      diagnosticoPresuntivo: atencion?.diagnosis ?? null,
    },
    examenes: examenes.map((examen) => ({
      tipo: ETIQUETAS_TIPO_EXAMEN[examen.type as TipoExamen],
      nombre: examen.name,
      indicaciones: examen.instructions,
      urgente: examen.isUrgent,
    })),
    qrDataUrl,
    firmaDataUrl: firma,
  })

  const pdf = await htmlAPdf(html)
  await guardarPdf(CARPETA_PDF, ordenId, pdf)

  await prisma.medicalExam.updateMany({
    where: { id: { in: examenes.map((e) => e.id) } },
    data: { pdfUrl: `/api/examenes/${ordenId}/pdf` },
  })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'MedicalExam',
    entidadId: ordenId,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'exam:create',
    motivo: 'orden de examen emitida en PDF',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return { examenes: examenes.map((fila) => aExamen(fila, ordenId)) }
}

export async function descargarPdf(
  ctx: ContextoAuth,
  ordenId: string,
  cliente: DatosCliente,
): Promise<{ contenido: Buffer; nombre: string }> {
  exigirPermiso(ctx, 'exam:print')

  const fila = await prisma.medicalExam.findUnique({
    where: { id: ordenId },
    select: { doctorId: true, patient: { select: { lastName: true } } },
  })
  if (!fila) throw new ErrorNoEncontrado('No se encontró la orden')

  if (!contextoPuede(ctx, 'exam:print', 'all') && ctx.doctorId !== fila.doctorId) {
    throw new ErrorNoEncontrado('No se encontró la orden')
  }

  const contenido = await leerPdf(CARPETA_PDF, ordenId)
  if (!contenido) {
    throw new ErrorConflicto('Esta orden todavía no tiene PDF. El médico debe emitirla.')
  }

  await registrarAuditoria({
    accion: 'PRINT',
    entidad: 'MedicalExam',
    entidadId: ordenId,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'exam:print',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return {
    contenido,
    nombre: `orden-${fila.patient.lastName.split(' ')[0]}-${ordenId.slice(-8)}.pdf`.toLowerCase(),
  }
}

// --- Resultados --------------------------------------------------------------

export async function registrarResultado(
  ctx: ContextoAuth,
  id: string,
  texto: string | undefined,
  cliente: DatosCliente,
): Promise<Examen> {
  exigirPermiso(ctx, 'exam:result_upload')

  const fila = await prisma.medicalExam.findUnique({
    where: { id },
    select: { id: true, doctorId: true },
  })
  if (!fila) throw new ErrorNoEncontrado('No se encontró el examen')

  if (!contextoPuede(ctx, 'exam:result_upload', 'all') && ctx.doctorId !== fila.doctorId) {
    throw new ErrorNoEncontrado('No se encontró el examen')
  }

  await prisma.medicalExam.update({
    where: { id },
    data: {
      result: texto?.trim() || null,
      resultAt: new Date(),
    },
  })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'MedicalExam',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'exam:result_upload',
    motivo: 'resultado registrado',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aExamen(await prisma.medicalExam.findUniqueOrThrow({ where: { id }, include: INCLUIR }), id)
}

/** Guarda el PDF que envía el laboratorio. */
export async function adjuntarResultado(
  ctx: ContextoAuth,
  id: string,
  contenido: Buffer,
  cliente: DatosCliente,
): Promise<Examen> {
  exigirPermiso(ctx, 'exam:result_upload')

  const fila = await prisma.medicalExam.findUnique({
    where: { id },
    select: { id: true, doctorId: true },
  })
  if (!fila) throw new ErrorNoEncontrado('No se encontró el examen')

  if (!contextoPuede(ctx, 'exam:result_upload', 'all') && ctx.doctorId !== fila.doctorId) {
    throw new ErrorNoEncontrado('No se encontró el examen')
  }

  // Se comprueba que sea realmente un PDF y no algo renombrado: la cabecera
  // %PDF- es lo único que lo garantiza, porque el tipo declarado lo pone quien
  // envía el archivo.
  if (contenido.subarray(0, 5).toString() !== '%PDF-') {
    throw new ErrorConflicto('El archivo no es un PDF válido')
  }

  await guardarPdf(CARPETA_RESULTADOS, id, contenido)

  await prisma.medicalExam.update({
    where: { id },
    data: { resultUrl: `/api/examenes/${id}/resultado/archivo`, resultAt: new Date() },
  })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'MedicalExam',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'exam:result_upload',
    motivo: 'archivo de resultado adjuntado',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aExamen(await prisma.medicalExam.findUniqueOrThrow({ where: { id }, include: INCLUIR }), id)
}

export async function descargarResultado(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<{ contenido: Buffer; nombre: string }> {
  // Leer un resultado ES leer datos clínicos: exige `exam:read`, no el permiso
  // de impresión que basta para la orden en blanco.
  exigirPermiso(ctx, 'exam:read')

  const fila = await localizar(ctx, id)

  const contenido = await leerPdf(CARPETA_RESULTADOS, id)
  if (!contenido) throw new ErrorNoEncontrado('Ese examen no tiene archivo de resultado')

  await registrarAuditoria({
    accion: 'VIEW',
    entidad: 'MedicalExam',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'exam:read',
    motivo: 'resultado consultado',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return { contenido, nombre: `resultado-${fila.name.slice(0, 20)}-${id.slice(-6)}.pdf`.toLowerCase() }
}

// --- Consulta ----------------------------------------------------------------

export async function deAtencion(ctx: ContextoAuth, atencionId: string): Promise<Examen[]> {
  exigirPermiso(ctx, 'exam:read')

  const alcance = filtroDeAlcance(ctx, 'exam:read')
  const filas = await prisma.medicalExam.findMany({
    where: { attendanceId: atencionId, ...alcance },
    include: INCLUIR,
    orderBy: [{ issuedAt: 'desc' }, { name: 'asc' }],
  })

  return agruparPorOrden(filas)
}

export async function dePaciente(ctx: ContextoAuth, pacienteId: string): Promise<Examen[]> {
  exigirPermiso(ctx, 'exam:read')

  const alcance = filtroDeAlcance(ctx, 'exam:read')
  const conEmergencia = await tieneAccesoVigente(ctx.usuarioId, pacienteId)

  const filas = await prisma.medicalExam.findMany({
    where: { patientId: pacienteId, ...(conEmergencia ? {} : alcance) },
    include: INCLUIR,
    orderBy: { issuedAt: 'desc' },
  })

  return agruparPorOrden(filas)
}

/** Asigna a cada examen el identificador de PDF de su orden. */
function agruparPorOrden(filas: FilaExamen[]): Examen[] {
  const ordenPorClave = new Map<string, string>()

  for (const fila of filas) {
    const clave = `${fila.attendanceId}|${fila.issuedAt.getTime()}`
    if (!ordenPorClave.has(clave)) ordenPorClave.set(clave, fila.id)
  }

  return filas.map((fila) =>
    aExamen(fila, ordenPorClave.get(`${fila.attendanceId}|${fila.issuedAt.getTime()}`)!),
  )
}

export async function porId(ctx: ContextoAuth, id: string): Promise<Examen> {
  exigirPermiso(ctx, 'exam:read')
  return aExamen(await localizar(ctx, id), id)
}

// --- Catálogo ----------------------------------------------------------------

export async function buscarEnCatalogo(
  ctx: ContextoAuth,
  termino: string,
  tipo: TipoExamen | undefined,
  limite: number,
): Promise<ExamenCatalogo[]> {
  exigirPermiso(ctx, 'exam:create')

  const filas = tipo
    ? await prisma.$queryRaw<
        { id: string; type: string; name: string; instructions: string | null }[]
      >`
        SELECT "id", "type", "name", "instructions" FROM "ExamCatalog"
        WHERE "isActive" AND "type" = ${tipo}::"ExamType"
          AND (normalizar_busqueda("name") LIKE '%' || normalizar_busqueda(${termino}) || '%'
               OR normalizar_busqueda(${termino}) <% normalizar_busqueda("name"))
        ORDER BY similarity(normalizar_busqueda("name"), normalizar_busqueda(${termino})) DESC, "name" ASC
        LIMIT ${limite}
      `
    : await prisma.$queryRaw<
        { id: string; type: string; name: string; instructions: string | null }[]
      >`
        SELECT "id", "type", "name", "instructions" FROM "ExamCatalog"
        WHERE "isActive"
          AND (normalizar_busqueda("name") LIKE '%' || normalizar_busqueda(${termino}) || '%'
               OR normalizar_busqueda(${termino}) <% normalizar_busqueda("name"))
        ORDER BY similarity(normalizar_busqueda("name"), normalizar_busqueda(${termino})) DESC, "name" ASC
        LIMIT ${limite}
      `

  return filas.map((f) => ({
    id: f.id,
    tipo: f.type as TipoExamen,
    nombre: f.name,
    indicaciones: f.instructions,
  }))
}
