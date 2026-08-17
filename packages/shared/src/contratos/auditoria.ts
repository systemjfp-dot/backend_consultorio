/**
 * Contratos de consulta de auditoría.
 */

import { z } from 'zod'

export const ACCIONES_AUDITABLES = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'VIEW',
  'PRINT',
  'EXPORT',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'BREAK_GLASS',
] as const

export type AccionAuditable = (typeof ACCIONES_AUDITABLES)[number]

/**
 * Filtros del panel de auditoría.
 *
 * `desde` y `hasta` tienen valores por defecto a propósito: la tabla está
 * particionada por mes, así que una consulta con rango de fechas solo lee las
 * particiones de ese período. Sin rango, PostgreSQL recorrería años enteros de
 * historial en cada búsqueda.
 */
export const esquemaConsultaAuditoria = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  usuarioId: z.string().optional(),
  entidad: z.string().optional(),
  entidadId: z.string().optional(),
  accion: z.enum(ACCIONES_AUDITABLES).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
})

export type ConsultaAuditoria = z.infer<typeof esquemaConsultaAuditoria>

export interface RegistroAuditoria {
  id: string
  usuarioId: string | null
  usuarioEmail: string | null
  accion: AccionAuditable
  entidad: string
  entidadId: string | null
  permiso: string | null
  roles: string[]
  motivo: string | null
  ip: string | null
  fecha: string
}
