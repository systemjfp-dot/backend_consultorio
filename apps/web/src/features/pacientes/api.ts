/**
 * Acceso a la API de pacientes desde la web.
 */

import type {
  DatosActualizarPaciente,
  DatosCrearPaciente,
  PacienteDetalle,
  ResultadoBusquedaPacientes,
} from '@consultorio/shared'
import { api } from '../../lib/api.js'

export type ResultadoRegistro =
  | { estado: 'creado'; paciente: PacienteDetalle }
  | { estado: 'ya_existe'; paciente: PacienteDetalle }
  | { estado: 'dado_de_baja'; pacienteId: string }

export interface ResultadoConsultaDocumento {
  disponible: boolean
  encontrado: boolean
  datos?: { nombres: string; apellidos: string; fechaNacimiento?: string }
  pacienteExistente?: PacienteDetalle
}

export function buscarPacientes(q: string, pagina = 1) {
  const parametros = new URLSearchParams({ pagina: String(pagina), porPagina: '20' })
  if (q) parametros.set('q', q)

  return api.get<ResultadoBusquedaPacientes>(`/api/pacientes?${parametros}`)
}

export function obtenerPaciente(id: string) {
  return api.get<{ paciente: PacienteDetalle }>(`/api/pacientes/${id}`)
}

export function registrarPaciente(datos: DatosCrearPaciente) {
  return api.post<ResultadoRegistro>('/api/pacientes', datos)
}

export function actualizarPaciente(id: string, datos: DatosActualizarPaciente) {
  return api.patch<{ paciente: PacienteDetalle }>(`/api/pacientes/${id}`, datos)
}

export function consultarDocumento(documento: string, tipoDocumento = 'DNI') {
  const parametros = new URLSearchParams({ documento, tipoDocumento })
  return api.get<ResultadoConsultaDocumento>(`/api/pacientes/consulta-documento?${parametros}`)
}
