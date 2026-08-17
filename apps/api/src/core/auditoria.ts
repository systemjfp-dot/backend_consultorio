/**
 * Registro de auditoría.
 *
 * Requisito legal (Ley 30024 / RENHICE y Ley 29733): el acceso a historias
 * clínicas electrónicas debe quedar trazado. La tabla es inmutable por trigger
 * en la base, así que ni siquiera esta aplicación puede alterar lo escrito.
 *
 * Aquí está el mínimo que necesita el módulo de autenticación. El registro
 * automático de accesos clínicos y el panel de consulta llegan en H0.7; esta
 * función es la costura por donde crecerá.
 */

import type { AuditAction, Prisma, Role } from '@prisma/client'
import { logger } from './logger.js'
import { prisma } from './prisma.js'

export interface DatosAuditoria {
  accion: AuditAction
  entidad: string
  entidadId?: string
  usuarioId?: string
  /** Correo TAL COMO ERA en este momento. La tabla no tiene clave foránea a
   *  User: debe poder leerse aunque esa cuenta ya no exista. */
  usuarioEmail?: string
  /** Roles efectivos EN ESE MOMENTO: el rol del usuario puede cambiar después. */
  roles?: Role[]
  permiso?: string
  /** Obligatorio cuando la acción es BREAK_GLASS. */
  motivo?: string
  cambios?: Prisma.InputJsonValue
  ip?: string
  userAgent?: string
}

/**
 * Escribe una entrada de auditoría.
 *
 * Nunca lanza: que falle el registro no debe tumbar la operación que el
 * usuario estaba haciendo. Un médico no puede quedarse sin guardar una
 * atención porque la tabla de auditoría tuvo un problema. El fallo se registra
 * como error para que se note en el monitoreo.
 */
export async function registrarAuditoria(datos: DatosAuditoria): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: datos.accion,
        entity: datos.entidad,
        entityId: datos.entidadId ?? null,
        userId: datos.usuarioId ?? null,
        userEmail: datos.usuarioEmail ?? null,
        roles: datos.roles ?? [],
        permission: datos.permiso ?? null,
        reason: datos.motivo ?? null,
        changes: datos.cambios,
        ipAddress: datos.ip ?? null,
        userAgent: datos.userAgent ?? null,
      },
    })
  } catch (error) {
    logger.error(
      { err: error, accion: datos.accion, entidad: datos.entidad },
      'No se pudo escribir en la auditoría',
    )
  }
}
