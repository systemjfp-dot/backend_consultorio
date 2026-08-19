/**
 * Acceso a la API de recetas.
 */

import type {
  DatosCrearReceta,
  DatosMedicamento,
  MedicamentoCatalogo,
  PlantillaReceta,
  Receta,
  RecetaResumen,
} from '@consultorio/shared'
import { api, descargarArchivo } from '../../lib/api.js'

export function crearReceta(datos: DatosCrearReceta) {
  return api.post<{ receta: Receta }>('/api/recetas', datos)
}

export function firmarReceta(id: string) {
  return api.post<{ receta: Receta }>(`/api/recetas/${id}/firmar`)
}

export function recetasDeAtencion(atencionId: string) {
  return api.get<{ recetas: Receta[] }>(`/api/recetas/atencion/${atencionId}`)
}

export function recetasDePaciente(pacienteId: string) {
  return api.get<{ recetas: RecetaResumen[] }>(`/api/recetas/paciente/${pacienteId}`)
}

export function buscarMedicamentos(q: string) {
  return api.get<{ medicamentos: MedicamentoCatalogo[] }>(
    `/api/recetas/medicamentos?q=${encodeURIComponent(q)}`,
  )
}

export function listarPlantillas() {
  return api.get<{ plantillas: PlantillaReceta[] }>('/api/recetas/plantillas')
}

export function guardarPlantilla(nombre: string, medicamentos: DatosMedicamento[]) {
  return api.post<{ plantilla: PlantillaReceta }>('/api/recetas/plantillas', {
    nombre,
    medicamentos,
  })
}

export function estadoFirma() {
  return api.get<{ registrada: boolean }>('/api/perfil/firma')
}

export function registrarFirma(imagen: string) {
  return api.put<{ registrada: boolean }>('/api/perfil/firma', { imagen })
}

/**
 * Abre el PDF de la receta en una pestaña nueva.
 *
 * No se puede usar un enlace directo: el token de acceso vive en memoria y no
 * viajaría con él, así que el navegador recibiría un 401. Se descarga con el
 * cliente autenticado y se abre el resultado.
 */
export async function abrirPdf(id: string): Promise<void> {
  const url = await descargarArchivo(`/api/recetas/${id}/pdf`)
  window.open(url, '_blank', 'noopener')

  // La URL de objeto se libera al rato: revocarla de inmediato cancelaría la
  // pestaña que acaba de abrirse.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
