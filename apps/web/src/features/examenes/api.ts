/**
 * Acceso a la API de órdenes de examen.
 */

import type { DatosOrdenExamen, Examen, ExamenCatalogo, TipoExamen } from '@consultorio/shared'
import { api, descargarArchivo, subirArchivo } from '../../lib/api.js'

export function ordenarExamenes(datos: DatosOrdenExamen) {
  return api.post<{ ordenId: string; examenes: Examen[] }>('/api/examenes', datos)
}

export function emitirOrden(ordenId: string) {
  return api.post<{ examenes: Examen[] }>(`/api/examenes/${ordenId}/emitir`)
}

export function examenesDeAtencion(atencionId: string) {
  return api.get<{ examenes: Examen[] }>(`/api/examenes/atencion/${atencionId}`)
}

export function examenesDePaciente(pacienteId: string) {
  return api.get<{ examenes: Examen[] }>(`/api/examenes/paciente/${pacienteId}`)
}

export function buscarEnCatalogo(q: string, tipo?: TipoExamen) {
  const p = new URLSearchParams({ q })
  if (tipo) p.set('tipo', tipo)
  return api.get<{ examenes: ExamenCatalogo[] }>(`/api/examenes/catalogo?${p}`)
}

export function registrarResultado(id: string, texto: string) {
  return api.post<{ examen: Examen }>(`/api/examenes/${id}/resultado`, { texto })
}

/** Envía el PDF del laboratorio como cuerpo crudo, sin multipart. */
export function adjuntarResultado(id: string, archivo: File) {
  return subirArchivo<{ examen: Examen }>(`/api/examenes/${id}/resultado/archivo`, archivo)
}

export async function abrirOrden(ordenId: string): Promise<void> {
  const url = await descargarArchivo(`/api/examenes/${ordenId}/pdf`)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function abrirResultado(id: string): Promise<void> {
  const url = await descargarArchivo(`/api/examenes/${id}/resultado/archivo`)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
