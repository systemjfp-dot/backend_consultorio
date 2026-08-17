/**
 * Buscador y listado de pacientes.
 *
 * Es la pantalla que más se usa en un mostrador, así que está pensada para
 * teclear: el foco entra en el campo al abrir, los resultados se actualizan
 * solos y cada fila es un objetivo táctil grande.
 */

import { edadLegible, type PacienteResumen } from '@consultorio/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alerta, Boton, Tarjeta } from '../../components/ui/index.js'
import { useAuth } from '../../lib/auth.js'
import { useRetraso } from '../../lib/useRetraso.js'
import { buscarPacientes } from './api.js'

export function ListaPacientes() {
  const { can } = useAuth()
  const [parametros, setParametros] = useSearchParams()
  const [termino, setTermino] = useState(parametros.get('q') ?? '')
  const campoRef = useRef<HTMLInputElement>(null)

  const terminoRetrasado = useRetraso(termino)

  // El término va en la URL: así una búsqueda se puede compartir, y volver
  // atrás desde una ficha devuelve a los mismos resultados en vez de a una
  // lista en blanco.
  useEffect(() => {
    setParametros(terminoRetrasado ? { q: terminoRetrasado } : {}, { replace: true })
  }, [terminoRetrasado, setParametros])

  useEffect(() => {
    campoRef.current?.focus()
  }, [])

  const consulta = useQuery({
    queryKey: ['pacientes', terminoRetrasado],
    queryFn: () => buscarPacientes(terminoRetrasado),
    // Mantener los resultados anteriores mientras llegan los nuevos evita que
    // la lista parpadee a vacío en cada tecla.
    placeholderData: (anterior) => anterior,
  })

  const pacientes = consulta.data?.pacientes ?? []
  const buscando = consulta.isFetching && terminoRetrasado !== termino

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Pacientes</h1>

        {can('patient:create') && (
          <Link to="/pacientes/nuevo" className="btn">
            <Boton>Nuevo paciente</Boton>
          </Link>
        )}
      </header>

      <div className="relative mb-4">
        <input
          ref={campoRef}
          type="search"
          value={termino}
          onChange={(e) => setTermino(e.target.value)}
          placeholder="Nombre, documento o teléfono"
          aria-label="Buscar pacientes"
          className="min-h-[48px] w-full rounded-lg border border-gray-300 px-4 text-base outline-none transition-colors focus:border-primario focus:ring-2 focus:ring-blue-100"
        />
        {buscando && (
          <span
            className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-gray-300 border-t-primario"
            aria-hidden="true"
          />
        )}
      </div>

      <p className="mb-3 text-sm text-gray-500" role="status" aria-live="polite">
        {consulta.isLoading
          ? 'Buscando…'
          : consulta.data
            ? `${consulta.data.total} ${consulta.data.total === 1 ? 'paciente' : 'pacientes'}`
            : ''}
      </p>

      {consulta.isError && (
        <div className="mb-4">
          <Alerta>No se pudo cargar la lista. Revisa tu conexión e inténtalo de nuevo.</Alerta>
        </div>
      )}

      {!consulta.isLoading && pacientes.length === 0 && (
        <Tarjeta>
          <p className="text-sm text-gray-600">
            {terminoRetrasado
              ? `No se encontró a nadie con "${terminoRetrasado}".`
              : 'Todavía no hay pacientes registrados.'}
          </p>
          {can('patient:create') && terminoRetrasado && (
            <div className="mt-3">
              <Link to={`/pacientes/nuevo?documento=${encodeURIComponent(terminoRetrasado)}`}>
                <Boton variante="secundario">Registrar a esta persona</Boton>
              </Link>
            </div>
          )}
        </Tarjeta>
      )}

      <ul className="flex flex-col gap-2">
        {pacientes.map((paciente) => (
          <li key={paciente.id}>
            <FilaPaciente paciente={paciente} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilaPaciente({ paciente }: { paciente: PacienteResumen }) {
  return (
    <Link
      to={`/pacientes/${paciente.id}`}
      className="flex min-h-[64px] items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 transition-colors hover:border-primario hover:bg-blue-50/40"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-600">
        {paciente.nombres[0]}
        {paciente.apellidos[0]}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-gray-900">{paciente.nombreCompleto}</p>
        <p className="truncate text-sm text-gray-500">
          {paciente.documento} · {edadLegible(paciente.fechaNacimiento)} · {paciente.telefono}
        </p>
      </div>

      {/*
        Las alergias se destacan en el propio listado, antes de abrir la ficha:
        es el dato que puede cambiar una prescripción, y esconderlo un clic más
        adentro es justo donde se pierden.
      */}
      {paciente.alergias && (
        <span
          className="shrink-0 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
          title={`Alergias: ${paciente.alergias}`}
        >
          Alergias
        </span>
      )}
    </Link>
  )
}
