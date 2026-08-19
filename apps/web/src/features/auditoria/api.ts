/**
 * Acceso al panel de auditoría.
 */

import type { AccionAuditable, RegistroAuditoria } from '@consultorio/shared'
import { api } from '../../lib/api.js'

export interface FiltrosAuditoria {
  desde?: string
  hasta?: string
  accion?: AccionAuditable | ''
  entidad?: string
  usuarioId?: string
  pagina: number
}

export interface RespuestaAuditoria {
  registros: RegistroAuditoria[]
  total: number
  pagina: number
  porPagina: number
  desde: string
  hasta: string
}

export function consultarAuditoria(filtros: FiltrosAuditoria) {
  const p = new URLSearchParams({ pagina: String(filtros.pagina), porPagina: '50' })
  if (filtros.desde) p.set('desde', filtros.desde)
  if (filtros.hasta) p.set('hasta', filtros.hasta)
  if (filtros.accion) p.set('accion', filtros.accion)
  if (filtros.entidad) p.set('entidad', filtros.entidad)
  if (filtros.usuarioId) p.set('usuarioId', filtros.usuarioId)

  return api.get<RespuestaAuditoria>(`/api/auditoria?${p}`)
}

export function accesosDeEmergencia() {
  return api.get<{ accesos: { id: string; userEmail: string | null; entityId: string | null; reason: string | null; ipAddress: string | null; createdAt: string }[] }>(
    '/api/emergencia/recientes',
  )
}
