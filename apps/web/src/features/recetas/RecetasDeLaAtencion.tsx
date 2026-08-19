/**
 * Recetas emitidas en esta atención.
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alerta, Boton } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { abrirPdf, recetasDeAtencion } from './api.js'

export function RecetasDeLaAtencion({ atencionId }: { atencionId: string }) {
  const [error, setError] = useState<string | null>(null)

  const consulta = useQuery({
    queryKey: ['recetas-atencion', atencionId],
    queryFn: () => recetasDeAtencion(atencionId),
  })

  const recetas = consulta.data?.recetas ?? []

  if (recetas.length === 0) {
    return <p className="text-sm text-gray-500">Sin recetas emitidas en esta atención.</p>
  }

  return (
    <>
      {error && (
        <div className="mb-3">
          <Alerta>{error}</Alerta>
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {recetas.map((receta) => (
          <li
            key={receta.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {receta.medicamentos.length}{' '}
                {receta.medicamentos.length === 1 ? 'medicamento' : 'medicamentos'}
              </p>
              <p className="truncate text-xs text-gray-500">
                {receta.medicamentos.map((m) => m.nombre).join(', ')}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                Válida hasta{' '}
                {new Date(`${receta.validaHasta}T12:00:00Z`).toLocaleDateString('es-PE', {
                  timeZone: 'UTC',
                })}
                {receta.firmadaEn ? '' : ' · sin firmar'}
              </p>
            </div>

            {receta.tienePdf && (
              <Boton
                variante="secundario"
                onClick={() => {
                  setError(null)
                  abrirPdf(receta.id).catch((fallo: unknown) =>
                    setError(
                      fallo instanceof ErrorApi ? fallo.message : 'No se pudo abrir el PDF',
                    ),
                  )
                }}
              >
                Ver PDF
              </Boton>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
