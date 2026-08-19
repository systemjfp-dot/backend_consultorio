/**
 * Acceso a la API de reportes.
 */

import type { RangoReporte, ReporteCitas, ReportePacientes } from '@consultorio/shared'
import { api, descargarArchivo } from '../../lib/api.js'

function parametros(rango: RangoReporte): string {
  const p = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta })
  if (rango.medicoId) p.set('medicoId', rango.medicoId)
  return p.toString()
}

export function reporteCitas(rango: RangoReporte) {
  return api.get<ReporteCitas>(`/api/reportes/citas?${parametros(rango)}`)
}

export function reportePacientes(rango: RangoReporte) {
  return api.get<ReportePacientes>(`/api/reportes/pacientes?${parametros(rango)}`)
}

/**
 * Descarga un CSV.
 *
 * Se pide con el cliente autenticado y se entrega como URL de objeto: un
 * enlace directo saldría sin la cabecera de autorización, porque el token vive
 * en memoria.
 */
export async function descargarCsv(cual: 'citas' | 'pacientes', rango: RangoReporte) {
  const url = await descargarArchivo(`/api/reportes/${cual}.csv?${parametros(rango)}`)

  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `${cual}-${rango.desde}-a-${rango.hasta}.csv`
  enlace.click()

  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
