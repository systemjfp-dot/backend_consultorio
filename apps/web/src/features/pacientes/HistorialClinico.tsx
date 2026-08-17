/**
 * Historial clínico del paciente.
 *
 * Lista cronológica de atenciones, como pide el módulo 3.3. Respeta el alcance:
 * un médico ve solo las suyas, salvo que tenga un acceso de emergencia vigente
 * sobre este paciente.
 */

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Tarjeta } from '../../components/ui/index.js'
import { historialDePaciente } from '../atenciones/api.js'

export function HistorialClinico({ pacienteId }: { pacienteId: string }) {
  const consulta = useQuery({
    queryKey: ['historial', pacienteId],
    queryFn: () => historialDePaciente(pacienteId),
  })

  const atenciones = consulta.data?.atenciones ?? []

  return (
    <Tarjeta>
      <h2 className="mb-3 font-medium text-gray-900">Historial clínico</h2>

      {consulta.isLoading && <p className="text-sm text-gray-500">Cargando…</p>}

      {!consulta.isLoading && atenciones.length === 0 && (
        <p className="text-sm text-gray-500">
          Sin atenciones registradas que puedas consultar.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {atenciones.map((atencion) => (
          <li key={atencion.id}>
            <Link
              to={`/atencion/${atencion.id}`}
              className="block rounded-lg border border-gray-200 p-3 transition-colors hover:border-primario hover:bg-blue-50/40"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {new Date(`${atencion.fecha}T12:00:00Z`).toLocaleDateString('es-PE', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </span>
                <span className="text-xs text-gray-500">
                  {atencion.hora} · {atencion.medicoNombre}
                  {!atencion.congelada && ' · en curso'}
                </span>
              </div>

              {atencion.diagnostico && (
                <p className="mt-1 text-sm text-gray-700">{atencion.diagnostico}</p>
              )}

              {atencion.diagnosticos.length > 0 && (
                <p className="mt-1 flex flex-wrap gap-1">
                  {atencion.diagnosticos.map((d) => (
                    <span
                      key={d.codigo}
                      className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-600"
                      title={d.descripcion}
                    >
                      {d.codigo}
                    </span>
                  ))}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}
