/**
 * Recetas médicas.
 *
 * SOBRE LA FIRMA. El documento maestro proponía dibujarla con el dedo en cada
 * receta y guardar el PNG en la fila. Aquí la firma pertenece al MÉDICO: se
 * registra una vez en su perfil y se reutiliza. Además de quitar fricción en
 * cada consulta, evita almacenar una imagen por receta.
 *
 * Y una advertencia que conviene tener presente: una firma dibujada NO es una
 * firma electrónica. El D.S. 098-2025-PCM y la Directiva MINSA 343-2023
 * empujan hacia el certificado digital para documentos de salud. El modelo ya
 * contempla ese camino (`signatureType`, `certificateSerial`, `pdfHash`), de
 * modo que migrar sea añadir el firmado y no rehacer el módulo.
 */

import {
  edadLegible,
  resumirMedicamento,
  type DatosCrearReceta,
  type DatosMedicamento,
  type MedicamentoCatalogo,
  type PlantillaReceta,
  type Receta,
  type RecetaResumen,
  type TipoFirma,
} from '@consultorio/shared'
import type { Prisma } from '@prisma/client'
import { registrarAuditoria } from '../../core/auditoria.js'
import { firmaComoDataUrl, guardarPdf, hayFirma, hayPdf, leerPdf } from '../../core/almacenamiento.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorConflicto, ErrorNoEncontrado, ErrorProhibido } from '../../core/errores.js'
import { htmlAPdf } from '../../core/pdf.js'
import { contextoPuede, exigirPermiso, filtroDeAlcance } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'
import { aFechaLocal, sumarDiasLocal } from '../../core/tiempo.js'
import { configuracionAgenda } from '../agenda/agenda.service.js'
import { tieneAccesoVigente } from '../emergencia/emergencia.service.js'
import { plantillaReceta } from './plantilla.js'

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

const CARPETA_PDF = 'recetas'

const INCLUIR = {
  patient: { select: { id: true, firstName: true, lastName: true, document: true, birthDate: true } },
  doctor: {
    select: {
      id: true,
      licenseNumber: true,
      specialty: true,
      specialtyRegistryNumber: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  items: { orderBy: { position: 'asc' } },
} satisfies Prisma.PrescriptionInclude

type FilaReceta = Prisma.PrescriptionGetPayload<{ include: typeof INCLUIR }>

// --- Conversión --------------------------------------------------------------

function aReceta(fila: FilaReceta, zonaHoraria: string): Receta {
  const emitida = aFechaLocal(fila.issuedAt, zonaHoraria)

  return {
    id: fila.id,
    atencionId: fila.attendanceId,

    pacienteId: fila.patient.id,
    pacienteNombre: `${fila.patient.firstName} ${fila.patient.lastName}`,
    pacienteDocumento: fila.patient.document,

    medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,
    medicoColegiatura: fila.doctor.licenseNumber,
    medicoEspecialidad: fila.doctor.specialty,

    emitidaEn: fila.issuedAt.toISOString(),
    diasValidez: fila.validityDays,
    validaHasta: sumarDiasLocal(emitida, fila.validityDays),

    indicacionesGenerales: fila.instructions,
    medicamentos: fila.items.map((item) => {
      const datos: DatosMedicamento = {
        nombre: item.name,
        concentracion: item.concentration ?? '',
        forma: item.form ?? '',
        via: item.route ?? '',
        frecuencia: item.frequency ?? '',
        duracion: item.duration ?? '',
        ...(item.quantity !== null ? { cantidad: item.quantity } : {}),
        indicaciones: item.instructions ?? '',
      }
      return { id: item.id, ...datos, resumen: resumirMedicamento(datos) }
    }),

    tipoFirma: fila.signatureType as TipoFirma,
    firmadaEn: fila.signedAt?.toISOString() ?? null,
    hashPdf: fila.pdfHash,
    tienePdf: hayPdf(CARPETA_PDF, fila.id),
  }
}

// --- Acceso ------------------------------------------------------------------

async function localizar(ctx: ContextoAuth, id: string): Promise<FilaReceta> {
  const alcance = filtroDeAlcance(ctx, 'prescription:read')

  const propia = await prisma.prescription.findFirst({ where: { id, ...alcance }, include: INCLUIR })
  if (propia) return propia

  const cualquiera = await prisma.prescription.findUnique({
    where: { id },
    select: { patientId: true },
  })
  if (!cualquiera) throw new ErrorNoEncontrado('No se encontró la receta')

  if (!(await tieneAccesoVigente(ctx.usuarioId, cualquiera.patientId))) {
    throw new ErrorNoEncontrado('No se encontró la receta')
  }

  return prisma.prescription.findUniqueOrThrow({ where: { id }, include: INCLUIR })
}

// --- Creación ----------------------------------------------------------------

export async function crear(
  ctx: ContextoAuth,
  datos: DatosCrearReceta,
  cliente: DatosCliente,
): Promise<Receta> {
  exigirPermiso(ctx, 'prescription:create')

  const { zonaHoraria } = await configuracionAgenda()

  const atencion = await prisma.attendance.findUnique({
    where: { id: datos.atencionId },
    select: { id: true, doctorId: true, patientId: true, lockedAt: true },
  })
  if (!atencion) throw new ErrorNoEncontrado('No se encontró la atención')

  if (!contextoPuede(ctx, 'prescription:create', 'all') && ctx.doctorId !== atencion.doctorId) {
    throw new ErrorProhibido('Solo puedes recetar en tus propias atenciones')
  }

  // Una atención congelada admite recetas nuevas: es habitual que el paciente
  // vuelva al día siguiente por una receta que se olvidó imprimir, y la receta
  // es un documento aparte que no modifica la historia clínica.

  const receta = await prisma.prescription.create({
    data: {
      attendanceId: atencion.id,
      doctorId: atencion.doctorId,
      patientId: atencion.patientId,
      validityDays: datos.diasValidez,
      instructions: datos.indicacionesGenerales?.trim() || null,
      items: {
        create: datos.medicamentos.map((m, posicion) => ({
          name: m.nombre,
          concentration: m.concentracion?.trim() || null,
          form: m.forma?.trim() || null,
          route: m.via?.trim() || null,
          frequency: m.frecuencia?.trim() || null,
          duration: m.duracion?.trim() || null,
          quantity: m.cantidad ?? null,
          instructions: m.indicaciones?.trim() || null,
          position: posicion,
        })),
      },
    },
    include: INCLUIR,
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'Prescription',
    entidadId: receta.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'prescription:create',
    // Cuántos medicamentos, no cuáles: la auditoría no debe volverse una copia
    // de la prescripción fuera del control de acceso que la protege.
    cambios: { medicamentos: datos.medicamentos.length },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aReceta(receta, zonaHoraria)
}

// --- Firma y PDF -------------------------------------------------------------

/**
 * Firma la receta y genera su PDF.
 *
 * Exige que el médico tenga firma registrada: una receta sin firma no la
 * acepta una farmacia, y descubrirlo con el paciente delante es peor que
 * impedirlo aquí.
 */
export async function firmarYGenerarPdf(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<Receta> {
  exigirPermiso(ctx, 'prescription:sign')

  const { zonaHoraria } = await configuracionAgenda()
  const fila = await localizar(ctx, id)

  if (ctx.doctorId !== fila.doctorId) {
    // Nadie firma por otro. Ni siquiera un administrador que además sea
    // médico: la firma identifica a quien se responsabiliza de la receta.
    throw new ErrorProhibido('Solo el médico que la emitió puede firmar esta receta')
  }

  if (!hayFirma(fila.doctorId)) {
    throw new ErrorConflicto(
      'No tienes una firma registrada. Regístrala en tu perfil antes de emitir recetas.',
    )
  }

  const [ajustes, firma] = await Promise.all([
    prisma.clinicSettings.findUnique({ where: { id: 1 } }),
    firmaComoDataUrl(fila.doctorId),
  ])
  if (!ajustes) throw new ErrorConflicto('La clínica no está configurada')

  const emitida = aFechaLocal(fila.issuedAt, zonaHoraria)
  const formatoFecha = (fecha: string) =>
    new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })

  const html = plantillaReceta({
    clinica: {
      nombre: ajustes.name,
      ruc: ajustes.ruc,
      direccion: ajustes.address,
      telefono: ajustes.phone,
      logoUrl: ajustes.logoUrl,
    },
    paciente: {
      nombre: `${fila.patient.firstName} ${fila.patient.lastName}`,
      documento: fila.patient.document,
      edad: edadLegible(fila.patient.birthDate),
    },
    medico: {
      nombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,
      colegiatura: fila.doctor.licenseNumber,
      especialidad: fila.doctor.specialty,
      registroEspecialista: fila.doctor.specialtyRegistryNumber,
    },
    receta: {
      // Número legible para el paciente: los últimos ocho del identificador,
      // suficiente para localizarla y sin exponer el cuid completo.
      numero: fila.id.slice(-8).toUpperCase(),
      emitidaEn: formatoFecha(emitida),
      validaHasta: formatoFecha(sumarDiasLocal(emitida, fila.validityDays)),
      indicacionesGenerales: fila.instructions,
    },
    medicamentos: fila.items.map((item) => ({
      nombre: item.name,
      concentracion: item.concentration,
      forma: item.form,
      via: item.route,
      frecuencia: item.frequency,
      duracion: item.duration,
      cantidad: item.quantity,
      indicaciones: item.instructions,
    })),
    firmaDataUrl: firma,
  })

  const pdf = await htmlAPdf(html)
  const hash = await guardarPdf(CARPETA_PDF, fila.id, pdf)

  const actualizada = await prisma.prescription.update({
    where: { id },
    data: {
      signedAt: new Date(),
      signatureType: 'DRAWN',
      pdfHash: hash,
      pdfUrl: `/api/recetas/${id}/pdf`,
    },
    include: INCLUIR,
  })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Prescription',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'prescription:sign',
    motivo: 'receta firmada y PDF emitido',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aReceta(actualizada, zonaHoraria)
}

/**
 * Descarga el PDF.
 *
 * Basta con `prescription:print`, que tiene recepción: entregar al paciente la
 * receta impresa es su trabajo. Lo que NO puede hacer es navegar el historial
 * de diagnósticos, y por eso ese permiso está separado de `prescription:read`.
 */
export async function descargarPdf(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<{ contenido: Buffer; nombre: string }> {
  exigirPermiso(ctx, 'prescription:print')

  const fila = await prisma.prescription.findUnique({
    where: { id },
    select: {
      id: true,
      doctorId: true,
      signedAt: true,
      patient: { select: { lastName: true, document: true } },
    },
  })
  if (!fila) throw new ErrorNoEncontrado('No se encontró la receta')

  // Quien solo tiene alcance propio (un médico) no descarga las de otros.
  if (!contextoPuede(ctx, 'prescription:print', 'all') && ctx.doctorId !== fila.doctorId) {
    throw new ErrorNoEncontrado('No se encontró la receta')
  }

  const contenido = await leerPdf(CARPETA_PDF, id)
  if (!contenido) {
    throw new ErrorConflicto('Esta receta todavía no tiene PDF. El médico debe firmarla.')
  }

  await registrarAuditoria({
    accion: 'PRINT',
    entidad: 'Prescription',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'prescription:print',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return {
    contenido,
    nombre: `receta-${fila.patient.lastName.split(' ')[0]}-${id.slice(-8)}.pdf`.toLowerCase(),
  }
}

// --- Consulta ----------------------------------------------------------------

export async function porId(ctx: ContextoAuth, id: string): Promise<Receta> {
  exigirPermiso(ctx, 'prescription:read')

  const { zonaHoraria } = await configuracionAgenda()
  return aReceta(await localizar(ctx, id), zonaHoraria)
}

export async function deAtencion(ctx: ContextoAuth, atencionId: string): Promise<Receta[]> {
  exigirPermiso(ctx, 'prescription:read')

  const { zonaHoraria } = await configuracionAgenda()
  const alcance = filtroDeAlcance(ctx, 'prescription:read')

  const filas = await prisma.prescription.findMany({
    where: { attendanceId: atencionId, ...alcance },
    include: INCLUIR,
    orderBy: { issuedAt: 'desc' },
  })

  return filas.map((f) => aReceta(f, zonaHoraria))
}

/** Recetas previas del paciente. Alimenta "ver recetas previas" del módulo 6.4. */
export async function dePaciente(
  ctx: ContextoAuth,
  pacienteId: string,
): Promise<RecetaResumen[]> {
  exigirPermiso(ctx, 'prescription:read')

  const alcance = filtroDeAlcance(ctx, 'prescription:read')
  const conEmergencia = await tieneAccesoVigente(ctx.usuarioId, pacienteId)

  const filas = await prisma.prescription.findMany({
    where: { patientId: pacienteId, ...(conEmergencia ? {} : alcance) },
    include: {
      doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
      items: { orderBy: { position: 'asc' }, take: 1 },
      _count: { select: { items: true } },
    },
    orderBy: { issuedAt: 'desc' },
  })

  return filas.map((fila) => ({
    id: fila.id,
    emitidaEn: fila.issuedAt.toISOString(),
    medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,
    cantidadMedicamentos: fila._count.items,
    primerMedicamento: fila.items[0]?.name ?? '',
    firmadaEn: fila.signedAt?.toISOString() ?? null,
    tienePdf: hayPdf(CARPETA_PDF, fila.id),
  }))
}

// --- Plantillas --------------------------------------------------------------

/**
 * "Mis recetas frecuentes".
 *
 * Un médico repite las mismas diez o veinte combinaciones. Un botón que las
 * aplique ahorra más tiempo al día que cualquier otra función del módulo.
 */
export async function listarPlantillas(ctx: ContextoAuth): Promise<PlantillaReceta[]> {
  exigirPermiso(ctx, 'prescription:create')
  if (!ctx.doctorId) return []

  const filas = await prisma.prescriptionTemplate.findMany({
    where: { doctorId: ctx.doctorId },
    orderBy: { name: 'asc' },
  })

  return filas.map((fila) => ({
    id: fila.id,
    nombre: fila.name,
    indicacionesGenerales: fila.instructions,
    medicamentos: fila.items as unknown as DatosMedicamento[],
  }))
}

export async function guardarPlantilla(
  ctx: ContextoAuth,
  datos: { nombre: string; indicacionesGenerales?: string; medicamentos: DatosMedicamento[] },
): Promise<PlantillaReceta> {
  exigirPermiso(ctx, 'prescription:create')
  if (!ctx.doctorId) throw new ErrorProhibido('Solo un médico puede guardar plantillas')

  const fila = await prisma.prescriptionTemplate.upsert({
    where: { doctorId_name: { doctorId: ctx.doctorId, name: datos.nombre } },
    update: {
      instructions: datos.indicacionesGenerales?.trim() || null,
      items: datos.medicamentos as unknown as Prisma.InputJsonValue,
    },
    create: {
      doctorId: ctx.doctorId,
      name: datos.nombre,
      instructions: datos.indicacionesGenerales?.trim() || null,
      items: datos.medicamentos as unknown as Prisma.InputJsonValue,
    },
  })

  return {
    id: fila.id,
    nombre: fila.name,
    indicacionesGenerales: fila.instructions,
    medicamentos: fila.items as unknown as DatosMedicamento[],
  }
}

export async function eliminarPlantilla(ctx: ContextoAuth, id: string): Promise<void> {
  exigirPermiso(ctx, 'prescription:create')
  if (!ctx.doctorId) throw new ErrorProhibido('Solo un médico puede eliminar plantillas')

  const { count } = await prisma.prescriptionTemplate.deleteMany({
    where: { id, doctorId: ctx.doctorId },
  })
  if (count === 0) throw new ErrorNoEncontrado('No se encontró la plantilla')
}

// --- Catálogo de medicamentos ------------------------------------------------

export async function buscarMedicamentos(
  ctx: ContextoAuth,
  termino: string,
  limite: number,
): Promise<MedicamentoCatalogo[]> {
  exigirPermiso(ctx, 'prescription:create')

  const filas = await prisma.$queryRaw<
    { id: string; name: string; genericName: string | null; concentration: string | null; form: string | null }[]
  >`
    SELECT "id", "name", "genericName", "concentration", "form"
    FROM "MedicineCatalog"
    WHERE "isActive"
      AND (
        normalizar_busqueda("name" || ' ' || COALESCE("genericName", ''))
          LIKE '%' || normalizar_busqueda(${termino}) || '%'
        OR normalizar_busqueda(${termino})
          <% normalizar_busqueda("name" || ' ' || COALESCE("genericName", ''))
      )
    ORDER BY
      similarity(normalizar_busqueda("name"), normalizar_busqueda(${termino})) DESC,
      "name" ASC, "concentration" ASC
    LIMIT ${limite}
  `

  return filas.map((f) => ({
    id: f.id,
    nombre: f.name,
    nombreGenerico: f.genericName,
    concentracion: f.concentration,
    forma: f.form,
  }))
}
