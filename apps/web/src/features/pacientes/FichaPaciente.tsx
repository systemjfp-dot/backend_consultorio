/**
 * Ficha del paciente.
 *
 * Lo primero que se ve son las alergias, si las hay: es el dato que puede
 * cambiar una prescripción, y esconderlo entre el resto es donde se pierde.
 */

import {
  ETIQUETAS_GENERO,
  ETIQUETAS_TIPO_DOCUMENTO,
  edadLegible,
  esquemaActualizarPaciente,
  type DatosActualizarPaciente,
  type EntradaActualizarPaciente,
  type PacienteDetalle,
} from '@consultorio/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useParams } from 'react-router-dom'
import { Alerta, Boton, Campo, Cargando, Tarjeta } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.js'
import { HistorialClinico } from './HistorialClinico.js'
import { actualizarPaciente, obtenerPaciente } from './api.js'

export function FichaPaciente() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const [editando, setEditando] = useState(false)

  const consulta = useQuery({
    queryKey: ['paciente', id],
    queryFn: () => obtenerPaciente(id),
  })

  if (consulta.isLoading) return <Cargando mensaje="Abriendo ficha…" />

  if (consulta.isError) {
    const noEncontrado = consulta.error instanceof ErrorApi && consulta.error.estado === 404
    return (
      <div className="mx-auto max-w-2xl">
        <Alerta>
          {noEncontrado
            ? 'No se encontró el paciente. Puede haber sido dado de baja.'
            : 'No se pudo cargar la ficha.'}
        </Alerta>
        <div className="mt-4">
          <Link to="/pacientes" className="text-sm text-primario hover:underline">
            ← Volver a pacientes
          </Link>
        </div>
      </div>
    )
  }

  const paciente = consulta.data!.paciente

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <Link to="/pacientes" className="text-sm text-gray-500 hover:text-gray-700">
          ← Pacientes
        </Link>
      </div>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
            {paciente.nombreCompleto}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {ETIQUETAS_TIPO_DOCUMENTO[paciente.tipoDocumento]} {paciente.documento} ·{' '}
            {edadLegible(paciente.fechaNacimiento)} · {ETIQUETAS_GENERO[paciente.genero]}
          </p>
        </div>

        {can('patient:update') && !editando && (
          <Boton variante="secundario" onClick={() => setEditando(true)}>
            Editar
          </Boton>
        )}
      </header>

      {/* Antes que cualquier otro dato. */}
      {paciente.alergias && (
        <div className="mb-4">
          <Alerta tono="error">
            <span className="font-medium">Alergias:</span> {paciente.alergias}
          </Alerta>
        </div>
      )}

      {editando ? (
        <FormularioEdicion
          paciente={paciente}
          onCerrar={() => setEditando(false)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Tarjeta>
            <h2 className="mb-3 font-medium text-gray-900">Contacto</h2>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Dato etiqueta="Teléfono" valor={paciente.telefono} />
              <Dato etiqueta="Correo" valor={paciente.email} />
              <Dato etiqueta="Dirección" valor={paciente.direccion} />
              <Dato
                etiqueta="Fecha de nacimiento"
                valor={new Date(paciente.fechaNacimiento).toLocaleDateString('es-PE', {
                  timeZone: 'UTC',
                })}
              />
            </dl>
          </Tarjeta>

          <Tarjeta>
            <h2 className="mb-3 font-medium text-gray-900">Antecedentes</h2>
            <p className="text-sm whitespace-pre-wrap text-gray-700">
              {paciente.antecedentes || (
                <span className="text-gray-400">Sin antecedentes registrados</span>
              )}
            </p>
          </Tarjeta>

          {can('encounter:read') && <HistorialClinico pacienteId={paciente.id} />}

          <p className="text-xs text-gray-400">
            Ficha creada el{' '}
            {new Date(paciente.creadoEn).toLocaleDateString('es-PE')} · Última actualización el{' '}
            {new Date(paciente.actualizadoEn).toLocaleDateString('es-PE')}
          </p>
        </div>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-gray-500">{etiqueta}</dt>
      <dd className="text-gray-900">{valor || <span className="text-gray-400">—</span>}</dd>
    </div>
  )
}

function FormularioEdicion({
  paciente,
  onCerrar,
}: {
  paciente: PacienteDetalle
  onCerrar: () => void
}) {
  const clienteConsultas = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EntradaActualizarPaciente, unknown, DatosActualizarPaciente>({
    resolver: zodResolver(esquemaActualizarPaciente),
    defaultValues: {
      nombres: paciente.nombres,
      apellidos: paciente.apellidos,
      telefono: paciente.telefono,
      email: paciente.email ?? '',
      direccion: paciente.direccion ?? '',
      alergias: paciente.alergias ?? '',
      antecedentes: paciente.antecedentes ?? '',
    },
  })

  const guardar = useMutation({
    mutationFn: (datos: DatosActualizarPaciente) => actualizarPaciente(paciente.id, datos),
    onSuccess: async () => {
      // Se invalida también el listado: el nombre o el teléfono pudieron
      // cambiar, y volver atrás mostraría los datos viejos.
      await clienteConsultas.invalidateQueries({ queryKey: ['paciente', paciente.id] })
      await clienteConsultas.invalidateQueries({ queryKey: ['pacientes'] })
      onCerrar()
    },
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudieron guardar los cambios')
    },
  })

  return (
    <form
      onSubmit={handleSubmit((datos) => {
        setError(null)
        guardar.mutate(datos)
      })}
      className="flex flex-col gap-4"
    >
      {error && <Alerta>{error}</Alerta>}

      <Tarjeta>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Nombres" error={errors.nombres?.message} {...register('nombres')} />
          <Campo
            etiqueta="Apellidos"
            error={errors.apellidos?.message}
            {...register('apellidos')}
          />
          <Campo
            etiqueta="Teléfono"
            type="tel"
            error={errors.telefono?.message}
            {...register('telefono')}
          />
          <Campo
            etiqueta="Correo"
            type="email"
            error={errors.email?.message}
            {...register('email')}
          />
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <Campo
            etiqueta="Dirección"
            error={errors.direccion?.message}
            {...register('direccion')}
          />
          <Campo
            etiqueta="Alergias"
            error={errors.alergias?.message}
            {...register('alergias')}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="antecedentes" className="text-sm font-medium text-gray-700">
              Antecedentes
            </label>
            <textarea
              id="antecedentes"
              rows={4}
              {...register('antecedentes')}
              className="rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        {/*
          El documento no se puede editar aquí: identifica a la persona y es la
          clave que une su historial. Corregir una errata es una operación
          excepcional, no parte de cambiar un teléfono.
        */}
        <p className="mt-4 text-xs text-gray-500">
          El documento ({paciente.documento}) no se puede modificar desde aquí.
        </p>
      </Tarjeta>

      <div className="flex gap-3">
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar cambios
        </Boton>
        <Boton type="button" variante="secundario" onClick={onCerrar}>
          Cancelar
        </Boton>
      </div>
    </form>
  )
}
