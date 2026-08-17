/**
 * Sala de espera del médico.
 *
 * Es la pantalla desde la que se empieza a atender: quiénes llegaron y en qué
 * orden. Justifica que exista el estado ARRIVED, que el diseño original no
 * contemplaba — saltaba de "confirmada" a "en atención" sin registrar la
 * llegada, y entonces no había forma de saber quién está esperando.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Alerta, Boton, Cargando, Tarjeta } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { iniciarAtencion, salaDeEspera } from './api.js'
import { useState } from 'react'

export function SalaDeEspera() {
  const navegar = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const espera = useQuery({
    queryKey: ['sala-de-espera'],
    queryFn: salaDeEspera,
    // La sala cambia sola: alguien llega, alguien entra a consulta.
    refetchInterval: 30_000,
  })

  const iniciar = useMutation({
    mutationFn: iniciarAtencion,
    onSuccess: (res) => navegar(`/atencion/${res.atencion.id}`),
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo abrir la atención')
    },
  })

  const citas = espera.data?.citas ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900 sm:text-2xl">Sala de espera</h1>
      <p className="mb-4 text-sm text-gray-500">Pacientes que ya llegaron, en orden de cita.</p>

      {error && (
        <div className="mb-4">
          <Alerta>{error}</Alerta>
        </div>
      )}

      {espera.isLoading && <Cargando mensaje="Cargando sala de espera…" />}

      {!espera.isLoading && citas.length === 0 && (
        <Tarjeta>
          <p className="text-sm text-gray-600">
            No hay pacientes esperando. Cuando recepción registre una llegada, aparecerá aquí.
          </p>
        </Tarjeta>
      )}

      <ul className="flex flex-col gap-2">
        {citas.map((cita) => (
          <li key={cita.id}>
            <Tarjeta className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{cita.pacienteNombre}</p>
                <p className="text-sm text-gray-500">
                  {cita.hora} · {cita.medicoNombre}
                  {cita.motivo ? ` · ${cita.motivo}` : ''}
                </p>
                {cita.pacienteAlergias && (
                  <p className="mt-1 text-sm text-red-700">Alergias: {cita.pacienteAlergias}</p>
                )}
              </div>

              <Boton
                onClick={() => {
                  setError(null)
                  iniciar.mutate(cita.id)
                }}
                cargando={iniciar.isPending && iniciar.variables === cita.id}
              >
                Iniciar atención
              </Boton>
            </Tarjeta>
          </li>
        ))}
      </ul>
    </div>
  )
}
