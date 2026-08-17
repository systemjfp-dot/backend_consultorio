/**
 * Acceso a la API de atención en consultorio.
 */

import type {
  Atencion,
  AtencionResumen,
  Cita,
  CodigoCie10,
  DatosGuardarAtencion,
} from '@consultorio/shared'
import { api } from '../../lib/api.js'

export function salaDeEspera() {
  return api.get<{ citas: Cita[] }>('/api/citas/sala-de-espera')
}

export function iniciarAtencion(citaId: string) {
  return api.post<{ atencion: Atencion }>('/api/atenciones', { citaId })
}

export function obtenerAtencion(id: string) {
  return api.get<{ atencion: Atencion }>(`/api/atenciones/${id}`)
}

export function guardarAtencion(id: string, datos: DatosGuardarAtencion) {
  return api.patch<{ atencion: Atencion }>(`/api/atenciones/${id}`, datos)
}

export function completarAtencion(id: string) {
  return api.post<{ atencion: Atencion }>(`/api/atenciones/${id}/completar`)
}

export function agregarAddendum(id: string, contenido: string, motivo?: string) {
  return api.post<{ atencion: Atencion }>(`/api/atenciones/${id}/addendum`, { contenido, motivo })
}

export function historialDePaciente(pacienteId: string) {
  return api.get<{ atenciones: AtencionResumen[] }>(`/api/atenciones/paciente/${pacienteId}`)
}

export function buscarCie10(q: string) {
  return api.get<{ codigos: CodigoCie10[] }>(
    `/api/atenciones/cie10?q=${encodeURIComponent(q)}`,
  )
}
