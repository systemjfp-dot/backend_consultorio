/**
 * Consulta del registro de auditoría.
 */

import type { ConsultaAuditoria, RegistroAuditoria } from '@consultorio/shared'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../core/prisma.js'

/**
 * Ventana por defecto cuando no se indica rango.
 *
 * No es una preferencia estética. La tabla está particionada por mes, así que
 * acotar la fecha permite a PostgreSQL leer solo las particiones del período.
 * Una consulta sin rango recorrería el historial completo — que en un sistema
 * que registra cada acceso clínico son millones de filas — y dejaría el panel
 * inservible al segundo año de uso.
 */
const DIAS_POR_DEFECTO = 30

export interface ResultadoConsulta {
  registros: RegistroAuditoria[]
  total: number
  pagina: number
  porPagina: number
  desde: Date
  hasta: Date
}

export async function consultar(filtros: ConsultaAuditoria): Promise<ResultadoConsulta> {
  const hasta = filtros.hasta ?? new Date()
  const desde =
    filtros.desde ?? new Date(hasta.getTime() - DIAS_POR_DEFECTO * 24 * 60 * 60_000)

  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: desde, lte: hasta },
    ...(filtros.usuarioId ? { userId: filtros.usuarioId } : {}),
    ...(filtros.entidad ? { entity: filtros.entidad } : {}),
    ...(filtros.entidadId ? { entityId: filtros.entidadId } : {}),
    ...(filtros.accion ? { action: filtros.accion } : {}),
  }

  const [filas, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      select: {
        id: true,
        userId: true,
        userEmail: true,
        action: true,
        entity: true,
        entityId: true,
        permission: true,
        roles: true,
        reason: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    registros: filas.map((fila) => ({
      id: fila.id,
      usuarioId: fila.userId,
      usuarioEmail: fila.userEmail,
      accion: fila.action,
      entidad: fila.entity,
      entidadId: fila.entityId,
      permiso: fila.permission,
      roles: fila.roles,
      motivo: fila.reason,
      ip: fila.ipAddress,
      fecha: fila.createdAt.toISOString(),
    })),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    desde,
    hasta,
  }
}

/**
 * Historial de accesos a un registro concreto.
 *
 * Es lo que hay que poder responder ante un reclamo o una fiscalización:
 * "¿quién ha visto la historia de este paciente?".
 */
export async function historialDeRegistro(
  entidad: string,
  entidadId: string,
  limite = 100,
): Promise<RegistroAuditoria[]> {
  const filas = await prisma.auditLog.findMany({
    where: { entity: entidad, entityId: entidadId },
    orderBy: { createdAt: 'desc' },
    take: limite,
    select: {
      id: true,
      userId: true,
      userEmail: true,
      action: true,
      entity: true,
      entityId: true,
      permission: true,
      roles: true,
      reason: true,
      ipAddress: true,
      createdAt: true,
    },
  })

  return filas.map((fila) => ({
    id: fila.id,
    usuarioId: fila.userId,
    usuarioEmail: fila.userEmail,
    accion: fila.action,
    entidad: fila.entity,
    entidadId: fila.entityId,
    permiso: fila.permission,
    roles: fila.roles,
    motivo: fila.reason,
    ip: fila.ipAddress,
    fecha: fila.createdAt.toISOString(),
  }))
}
