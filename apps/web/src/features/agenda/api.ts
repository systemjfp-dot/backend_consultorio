/**
 * Acceso a la API de agenda y citas.
 */

import type {
  Cita,
  DatosCrearCita,
  DisponibilidadDelDia,
  MedicoResumen,
  OrigenCancelacion,
  Sede,
} from '@consultorio/shared'
import { api } from '../../lib/api.js'

export function listarMedicos() {
  return api.get<{ medicos: MedicoResumen[] }>('/api/agenda/medicos')
}

export function listarSedes() {
  return api.get<{ sedes: Sede[] }>('/api/agenda/sedes')
}

export function citasDelRango(desde: string, hasta?: string, medicoId?: string) {
  const p = new URLSearchParams({ desde })
  if (hasta) p.set('hasta', hasta)
  if (medicoId) p.set('medicoId', medicoId)

  return api.get<{ citas: Cita[]; desde: string; hasta: string }>(`/api/citas?${p}`)
}

export function disponibilidad(medicoId: string, fecha: string, duracionMinutos?: number) {
  const p = new URLSearchParams({ medicoId, fecha })
  if (duracionMinutos) p.set('duracionMinutos', String(duracionMinutos))

  return api.get<DisponibilidadDelDia>(`/api/agenda/disponibilidad?${p}`)
}

export function crearCita(datos: DatosCrearCita) {
  return api.post<{ cita: Cita }>('/api/citas', datos)
}

export function confirmarCita(id: string) {
  return api.post<{ cita: Cita }>(`/api/citas/${id}/confirmar`)
}

export function registrarLlegada(id: string) {
  return api.post<{ cita: Cita }>(`/api/citas/${id}/llegada`)
}

export function marcarInasistencia(id: string) {
  return api.post<{ cita: Cita }>(`/api/citas/${id}/no-asistio`)
}

export function cancelarCita(id: string, motivo: string, origen: OrigenCancelacion) {
  return api.post<{ cita: Cita }>(`/api/citas/${id}/cancelar`, { motivo, origen })
}

export function reprogramarCita(id: string, inicio: string, medicoId?: string) {
  return api.post<{ cita: Cita }>(`/api/citas/${id}/reprogramar`, { inicio, medicoId })
}
