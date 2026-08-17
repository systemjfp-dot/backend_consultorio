/**
 * Acceso de emergencia a una historia clínica (break-the-glass).
 *
 * EL PROBLEMA. El médico ve solo sus propios pacientes (alcance `own`). Pero
 * el Dr. A está de vacaciones, su paciente entra por urgencia y lo atiende la
 * Dra. B: con la restricción estricta, ella no ve los antecedentes ni las
 * alergias, y eso puede ser peligroso.
 *
 * LA SOLUCIÓN NO ES ABRIR EL ACCESO. Es permitirlo dejando un rastro imposible
 * de ignorar: motivo obligatorio, ventana corta, un solo paciente, aviso a la
 * administración y al médico tratante, y registro destacado en la auditoría.
 * Un médico que necesita el dato lo obtiene en segundos; uno que fisgonea sabe
 * que quedó firmado con su nombre y su motivo.
 *
 * SIN TABLA NUEVA. La concesión se guarda como una entrada BREAK_GLASS en
 * AuditLog, y comprobarla es consultar si existe una reciente para ese usuario
 * y ese paciente. Aprovecha que la tabla ya es inmutable por trigger: una
 * concesión no se puede alterar ni retrodatar, ni siquiera desde la
 * aplicación. Una tabla aparte de concesiones sería mutable, y habría que
 * auditarla también.
 */

import { registrarAuditoria } from '../../core/auditoria.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { exigirPermiso } from '../../core/permisos.js'
import { ErrorNoEncontrado } from '../../core/errores.js'
import { logger } from '../../core/logger.js'
import { prisma } from '../../core/prisma.js'

/**
 * Duración de la concesión.
 *
 * Una hora cubre una atención de urgencia completa sin obligar a repetir el
 * trámite a media consulta. Que caduque sola es lo que impide que un acceso
 * puntual se convierta en permanente.
 */
export const MINUTOS_DE_VIGENCIA = 60

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

/**
 * Concede acceso de emergencia a un paciente concreto.
 * El motivo lo valida el contrato (mínimo 20 caracteres): "urgencia" no
 * explica nada y no sirve de rastro.
 */
export async function concederAcceso(
  ctx: ContextoAuth,
  pacienteId: string,
  motivo: string,
  cliente: DatosCliente,
): Promise<{ expiraEn: Date }> {
  exigirPermiso(ctx, 'patient:break_glass')

  const paciente = await prisma.patient.findFirst({
    where: { id: pacienteId, deletedAt: null },
    select: { id: true },
  })
  if (!paciente) throw new ErrorNoEncontrado('No se encontró el paciente')

  await registrarAuditoria({
    accion: 'BREAK_GLASS',
    entidad: 'Patient',
    entidadId: pacienteId,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'patient:break_glass',
    motivo,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  // Se registra como advertencia, no como información: debe destacar en el
  // monitoreo. Un acceso de emergencia es excepcional por definición; si
  // aparecen varios al día, hay algo que revisar en los alcances o en alguien.
  logger.warn(
    { usuarioId: ctx.usuarioId, email: ctx.email, pacienteId, motivo },
    'Acceso de emergencia concedido a una historia clínica',
  )

  // El aviso al administrador y al médico tratante sale por el canal de
  // notificaciones (H6). El registro de auditoría ya quedó escrito.

  return { expiraEn: new Date(Date.now() + MINUTOS_DE_VIGENCIA * 60_000) }
}

/**
 * ¿Este usuario tiene acceso de emergencia vigente sobre este paciente?
 *
 * Lo consultan los repositorios clínicos para ampliar el alcance `own` a este
 * paciente concreto, sin ampliarlo a ningún otro.
 */
export async function tieneAccesoVigente(
  usuarioId: string,
  pacienteId: string,
): Promise<boolean> {
  const desde = new Date(Date.now() - MINUTOS_DE_VIGENCIA * 60_000)

  const concesion = await prisma.auditLog.findFirst({
    where: {
      userId: usuarioId,
      action: 'BREAK_GLASS',
      entity: 'Patient',
      entityId: pacienteId,
      createdAt: { gt: desde },
    },
    select: { id: true },
  })

  return concesion !== null
}

/** Accesos de emergencia recientes, para el panel de auditoría (H0.7). */
export async function listarAccesosRecientes(dias = 30) {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60_000)

  return prisma.auditLog.findMany({
    where: { action: 'BREAK_GLASS', createdAt: { gt: desde } },
    select: {
      id: true,
      userId: true,
      userEmail: true,
      entityId: true,
      reason: true,
      ipAddress: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}
