/**
 * Atención en consultorio.
 *
 * LA REGLA CENTRAL: una atención completada se CONGELA. A partir de ahí no se
 * reescribe nada; las correcciones se registran como addendum, con su autor y
 * su fecha.
 *
 * No es una preferencia de diseño. Una historia clínica es un documento legal:
 * si el texto puede cambiarse después sin dejar rastro, no prueba nada — ni a
 * favor del paciente ni del médico. El addendum es como funciona un EMR real
 * justamente por eso.
 */

import {
  calcularEdad,
  calcularImc,
  edadLegible,
  type Addendum,
  type Atencion,
  type AtencionResumen,
  type CodigoCie10,
  type DatosGuardarAtencion,
  type DatosSignosVitales,
  type DiagnosticoCodificado,
} from '@consultorio/shared'
import type { Prisma } from '@prisma/client'
import { registrarAuditoria } from '../../core/auditoria.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorConflicto, ErrorNoEncontrado, ErrorProhibido } from '../../core/errores.js'
import { contextoPuede, exigirPermiso, filtroDeAlcance } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'
import { aFechaLocal, aMinutosLocales, formatearMinutos } from '../../core/tiempo.js'
import { configuracionAgenda } from '../agenda/agenda.service.js'
import { tieneAccesoVigente } from '../emergencia/emergencia.service.js'

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

const INCLUIR = {
  patient: {
    select: { id: true, firstName: true, lastName: true, document: true, birthDate: true, allergies: true },
  },
  doctor: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
  diagnoses: { include: { icd: { select: { description: true } } } },
  addenda: {
    include: { author: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.AttendanceInclude

type FilaAtencion = Prisma.AttendanceGetPayload<{ include: typeof INCLUIR }>

// --- Conversión --------------------------------------------------------------

const numero = (valor: Prisma.Decimal | null): number | null => (valor === null ? null : Number(valor))

function aAtencion(fila: FilaAtencion): Atencion {
  const edad = calcularEdad(fila.patient.birthDate)
  const pesoKg = numero(fila.weightKg)
  const tallaCm = numero(fila.heightCm)

  const diagnosticos: DiagnosticoCodificado[] = fila.diagnoses
    .map((d) => ({ codigo: d.code, descripcion: d.icd.description, esPrincipal: d.isPrimary }))
    .sort((a, b) => Number(b.esPrincipal) - Number(a.esPrincipal))

  const addenda: Addendum[] = fila.addenda.map((a) => ({
    id: a.id,
    contenido: a.content,
    motivo: a.reason,
    autorNombre: `${a.author.firstName} ${a.author.lastName}`,
    creadoEn: a.createdAt.toISOString(),
  }))

  return {
    id: fila.id,
    citaId: fila.appointmentId,

    pacienteId: fila.patient.id,
    pacienteNombre: `${fila.patient.firstName} ${fila.patient.lastName}`,
    pacienteDocumento: fila.patient.document,
    pacienteEdad: edad,
    pacienteEdadLegible: edadLegible(fila.patient.birthDate),
    pacienteAlergias: fila.patient.allergies,

    medicoId: fila.doctor.id,
    medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,

    iniciadaEn: fila.startedAt.toISOString(),
    finalizadaEn: fila.endedAt?.toISOString() ?? null,
    congeladaEn: fila.lockedAt?.toISOString() ?? null,

    signosVitales: {
      presionSistolica: fila.bloodPressureSystolic,
      presionDiastolica: fila.bloodPressureDiastolic,
      frecuenciaCardiaca: fila.heartRate,
      frecuenciaRespiratoria: fila.respiratoryRate,
      temperatura: numero(fila.temperature),
      saturacionOxigeno: fila.oxygenSaturation,
      pesoKg,
      tallaCm,
    },
    imc: calcularImc(pesoKg, tallaCm, edad),

    motivo: fila.reason,
    enfermedadActual: fila.currentIllness,
    antecedentesPersonales: fila.personalHistory,
    antecedentesFamiliares: fila.familyHistory,
    antecedentesQuirurgicos: fila.surgicalHistory,
    medicacionActual: fila.medicationsInUse,
    examenFisico: fila.physicalExam,
    diagnostico: fila.diagnosis,
    planTratamiento: fila.treatmentPlan,
    notas: fila.notes,

    diagnosticos,
    addenda,
  }
}

// --- Acceso ------------------------------------------------------------------

/**
 * Localiza una atención respetando el alcance, con la excepción del acceso de
 * emergencia.
 *
 * El break-the-glass de H0.6 se aplica AQUÍ: es el único punto del sistema
 * donde tiene sentido, porque es donde están los datos que un médico de
 * urgencia necesita ver de un paciente que no es suyo. Y amplía el acceso a
 * ESE paciente concreto, no al resto.
 */
async function localizar(ctx: ContextoAuth, id: string): Promise<FilaAtencion> {
  const alcance = filtroDeAlcance(ctx, 'encounter:read')

  const propia = await prisma.attendance.findFirst({
    where: { id, ...alcance },
    include: INCLUIR,
  })
  if (propia) return propia

  // Fuera del alcance: solo se abre con una concesión de emergencia vigente
  // sobre ese paciente.
  const cualquiera = await prisma.attendance.findUnique({
    where: { id },
    select: { patientId: true },
  })
  if (!cualquiera) throw new ErrorNoEncontrado('No se encontró la atención')

  if (!(await tieneAccesoVigente(ctx.usuarioId, cualquiera.patientId))) {
    // 404 y no 403: confirmar que existe ya revela que ese paciente fue
    // atendido por otro médico.
    throw new ErrorNoEncontrado('No se encontró la atención')
  }

  return prisma.attendance.findUniqueOrThrow({ where: { id }, include: INCLUIR })
}

function exigirNoCongelada(fila: FilaAtencion): void {
  if (fila.lockedAt) {
    throw new ErrorConflicto(
      'Esta atención ya está completada y no se puede modificar. Añade un addendum para corregir o ampliar.',
    )
  }
}

// --- Inicio ------------------------------------------------------------------

/**
 * Abre la atención de una cita.
 *
 * Si el paciente todavía no estaba marcado como llegado, se registra la
 * llegada de paso. En un consultorio pequeño el médico llama al paciente
 * directamente sin pasar por recepción, y exigir el check-in previo dejaría la
 * agenda con citas eternamente "confirmadas".
 */
export async function iniciar(
  ctx: ContextoAuth,
  citaId: string,
  cliente: DatosCliente,
): Promise<Atencion> {
  exigirPermiso(ctx, 'encounter:create')

  const cita = await prisma.appointment.findUnique({
    where: { id: citaId },
    select: { id: true, doctorId: true, patientId: true, status: true, attendance: { select: { id: true } } },
  })
  if (!cita) throw new ErrorNoEncontrado('No se encontró la cita')

  // Un médico solo atiende sus propias citas.
  if (!contextoPuede(ctx, 'encounter:create', 'all') && ctx.doctorId !== cita.doctorId) {
    throw new ErrorProhibido('Solo puedes atender a tus propios pacientes')
  }

  // Reabrir una atención ya iniciada devuelve la existente: el médico pudo
  // cerrar la pestaña sin querer, y crear una segunda partiría la consulta en
  // dos registros.
  if (cita.attendance) {
    return aAtencion(await prisma.attendance.findUniqueOrThrow({
      where: { id: cita.attendance.id },
      include: INCLUIR,
    }))
  }

  if (cita.status === 'CANCELLED' || cita.status === 'NO_SHOW' || cita.status === 'COMPLETED') {
    throw new ErrorConflicto('Esa cita ya está cerrada')
  }

  const ahora = new Date()

  const atencion = await prisma.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: citaId },
      data: {
        status: 'IN_ATTENTION',
        ...(cita.status === 'SCHEDULED' || cita.status === 'CONFIRMED'
          ? { arrivedAt: ahora }
          : {}),
      },
    })

    return tx.attendance.create({
      data: {
        appointmentId: citaId,
        doctorId: cita.doctorId,
        patientId: cita.patientId,
        startedAt: ahora,
      },
      include: INCLUIR,
    })
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'Attendance',
    entidadId: atencion.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:create',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aAtencion(atencion)
}

// --- Lectura -----------------------------------------------------------------

export async function ver(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<Atencion> {
  exigirPermiso(ctx, 'encounter:read')

  const fila = await localizar(ctx, id)

  await registrarAuditoria({
    accion: 'VIEW',
    entidad: 'Attendance',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:read',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aAtencion(fila)
}

/** Historial clínico de un paciente, en orden cronológico inverso. */
export async function historialDePaciente(
  ctx: ContextoAuth,
  pacienteId: string,
  cliente: DatosCliente,
): Promise<AtencionResumen[]> {
  exigirPermiso(ctx, 'encounter:read')

  const { zonaHoraria } = await configuracionAgenda()
  const alcance = filtroDeAlcance(ctx, 'encounter:read')

  const conEmergencia = await tieneAccesoVigente(ctx.usuarioId, pacienteId)

  const filas = await prisma.attendance.findMany({
    where: { patientId: pacienteId, ...(conEmergencia ? {} : alcance) },
    include: {
      doctor: { select: { user: { select: { firstName: true, lastName: true } } } },
      diagnoses: { include: { icd: { select: { description: true } } } },
    },
    orderBy: { startedAt: 'desc' },
  })

  await registrarAuditoria({
    accion: 'VIEW',
    entidad: 'Patient',
    entidadId: pacienteId,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:read',
    motivo: conEmergencia ? 'historial consultado con acceso de emergencia' : 'historial clínico',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return filas.map((fila) => ({
    id: fila.id,
    fecha: aFechaLocal(fila.startedAt, zonaHoraria),
    hora: formatearMinutos(aMinutosLocales(fila.startedAt, zonaHoraria)),
    medicoNombre: `${fila.doctor.user.firstName} ${fila.doctor.user.lastName}`,
    motivo: fila.reason,
    diagnostico: fila.diagnosis,
    diagnosticos: fila.diagnoses.map((d) => ({
      codigo: d.code,
      descripcion: d.icd.description,
      esPrincipal: d.isPrimary,
    })),
    congelada: fila.lockedAt !== null,
  }))
}

// --- Guardado ----------------------------------------------------------------

const oNulo = (valor: string | undefined): string | null | undefined =>
  valor === undefined ? undefined : valor.trim() || null

/**
 * Guarda el borrador de la atención.
 *
 * Se puede llamar tantas veces como haga falta mientras no esté completada: la
 * consulta dura veinte minutos y perder lo escrito por cerrar una pestaña
 * sería inaceptable.
 */
export async function guardar(
  ctx: ContextoAuth,
  id: string,
  datos: DatosGuardarAtencion,
  cliente: DatosCliente,
): Promise<Atencion> {
  exigirPermiso(ctx, 'encounter:update')

  const fila = await localizar(ctx, id)
  exigirNoCongelada(fila)

  const cambios: Prisma.AttendanceUpdateInput = {
    reason: oNulo(datos.motivo),
    currentIllness: oNulo(datos.enfermedadActual),
    personalHistory: oNulo(datos.antecedentesPersonales),
    familyHistory: oNulo(datos.antecedentesFamiliares),
    surgicalHistory: oNulo(datos.antecedentesQuirurgicos),
    medicationsInUse: oNulo(datos.medicacionActual),
    physicalExam: oNulo(datos.examenFisico),
    diagnosis: oNulo(datos.diagnostico),
    treatmentPlan: oNulo(datos.planTratamiento),
    notes: oNulo(datos.notas),
    ...(datos.signosVitales ? aCamposVitales(datos.signosVitales) : {}),
  }

  await prisma.attendance.update({ where: { id }, data: cambios })

  if (datos.diagnosticos) await reemplazarDiagnosticos(id, datos.diagnosticos)

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Attendance',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:update',
    // Qué campos, no sus valores: la auditoría no debe volverse una segunda
    // copia de la historia clínica fuera del control de acceso que la protege.
    cambios: { campos: Object.keys(cambios) },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aAtencion(await prisma.attendance.findUniqueOrThrow({ where: { id }, include: INCLUIR }))
}

function aCamposVitales(v: DatosSignosVitales): Prisma.AttendanceUpdateInput {
  return {
    bloodPressureSystolic: v.presionSistolica ?? null,
    bloodPressureDiastolic: v.presionDiastolica ?? null,
    heartRate: v.frecuenciaCardiaca ?? null,
    respiratoryRate: v.frecuenciaRespiratoria ?? null,
    temperature: v.temperatura ?? null,
    oxygenSaturation: v.saturacionOxigeno ?? null,
    weightKg: v.pesoKg ?? null,
    heightCm: v.tallaCm ?? null,
  }
}

/**
 * Signos vitales por separado.
 *
 * Existe para enfermería, que tiene `encounter:vitals` pero no puede tocar el
 * diagnóstico. Sin esta ruta, tomar la presión exigiría el permiso que abre
 * toda la historia clínica.
 */
export async function guardarSignosVitales(
  ctx: ContextoAuth,
  id: string,
  vitales: DatosSignosVitales,
  cliente: DatosCliente,
): Promise<{ registrado: true }> {
  exigirPermiso(ctx, 'encounter:vitals')

  const fila = await prisma.attendance.findUnique({
    where: { id },
    select: { id: true, lockedAt: true },
  })
  if (!fila) throw new ErrorNoEncontrado('No se encontró la atención')
  if (fila.lockedAt) throw new ErrorConflicto('Esa atención ya está completada')

  await prisma.attendance.update({ where: { id }, data: aCamposVitales(vitales) })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Attendance',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:vitals',
    cambios: { campos: ['signosVitales'] },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  // No se devuelve la atención completa: quien registra signos vitales no
  // tiene permiso para leer el contenido clínico, y devolvérselo aquí sería
  // una puerta trasera al diagnóstico.
  return { registrado: true }
}

async function reemplazarDiagnosticos(atencionId: string, codigos: string[]): Promise<void> {
  const unicos = [...new Set(codigos)]

  const existentes = await prisma.icd10Code.findMany({
    where: { code: { in: unicos } },
    select: { code: true },
  })
  const validos = new Set(existentes.map((e) => e.code))

  const desconocidos = unicos.filter((c) => !validos.has(c))
  if (desconocidos.length > 0) {
    throw new ErrorConflicto(`Código CIE-10 desconocido: ${desconocidos.join(', ')}`)
  }

  await prisma.$transaction([
    prisma.attendanceDiagnosis.deleteMany({ where: { attendanceId: atencionId } }),
    prisma.attendanceDiagnosis.createMany({
      data: unicos.map((codigo, indice) => ({
        attendanceId: atencionId,
        code: codigo,
        // El primero es el principal: es el orden en que el médico los eligió.
        isPrimary: indice === 0,
      })),
    }),
  ])
}

// --- Cierre ------------------------------------------------------------------

/**
 * Completa la atención y la CONGELA.
 *
 * Exige un diagnóstico: una consulta sin conclusión no documenta nada, y es
 * justo el campo que se pierde cuando se cierra con prisa entre pacientes.
 */
export async function completar(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<Atencion> {
  exigirPermiso(ctx, 'encounter:complete')

  const fila = await localizar(ctx, id)
  exigirNoCongelada(fila)

  const tieneDiagnostico = Boolean(fila.diagnosis?.trim()) || fila.diagnoses.length > 0
  if (!tieneDiagnostico) {
    throw new ErrorConflicto(
      'Registra un diagnóstico antes de completar la atención.',
    )
  }

  const ahora = new Date()

  await prisma.$transaction([
    prisma.attendance.update({
      where: { id },
      data: { endedAt: ahora, lockedAt: ahora },
    }),
    prisma.appointment.update({
      where: { id: fila.appointmentId },
      data: { status: 'COMPLETED' },
    }),
  ])

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Attendance',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:complete',
    motivo: 'atención completada y congelada',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aAtencion(await prisma.attendance.findUniqueOrThrow({ where: { id }, include: INCLUIR }))
}

/** Corrección o agregado posterior a una atención congelada. */
export async function agregarAddendum(
  ctx: ContextoAuth,
  id: string,
  contenido: string,
  motivo: string | undefined,
  cliente: DatosCliente,
): Promise<Atencion> {
  exigirPermiso(ctx, 'encounter:addendum')

  const fila = await localizar(ctx, id)

  if (!fila.lockedAt) {
    throw new ErrorConflicto(
      'Esa atención sigue abierta: edítala directamente en lugar de añadir un addendum.',
    )
  }

  await prisma.attendanceAddendum.create({
    data: {
      attendanceId: id,
      authorId: ctx.usuarioId,
      content: contenido,
      reason: motivo?.trim() || null,
    },
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'AttendanceAddendum',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'encounter:addendum',
    motivo: motivo || 'addendum a una atención congelada',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aAtencion(await prisma.attendance.findUniqueOrThrow({ where: { id }, include: INCLUIR }))
}

// --- Catálogo CIE-10 ---------------------------------------------------------

/**
 * Búsqueda de diagnósticos.
 *
 * Usa la misma normalización sin acentos que el buscador de pacientes: se
 * teclea "cefalea" o "diabet" y aparece lo que corresponde. Sin catálogo, el
 * campo de "autocompletado" que pide el documento maestro quedaría vacío para
 * siempre.
 */
export async function buscarCie10(
  ctx: ContextoAuth,
  termino: string,
  limite: number,
): Promise<CodigoCie10[]> {
  exigirPermiso(ctx, 'encounter:read')

  const filas = await prisma.$queryRaw<{ code: string; description: string; category: string | null }[]>`
    SELECT "code", "description", "category"
    FROM "Icd10Code"
    WHERE "isActive"
      AND (
        normalizar_busqueda("description") LIKE '%' || normalizar_busqueda(${termino}) || '%'
        OR normalizar_busqueda(${termino}) <% normalizar_busqueda("description")
        OR upper("code") LIKE upper(${termino}) || '%'
      )
    ORDER BY
      -- El código exacto primero: quien lo teclea ya sabe cuál quiere.
      (upper("code") = upper(${termino})) DESC,
      similarity(normalizar_busqueda("description"), normalizar_busqueda(${termino})) DESC,
      "code" ASC
    LIMIT ${limite}
  `

  return filas.map((f) => ({ codigo: f.code, descripcion: f.description, categoria: f.category }))
}
