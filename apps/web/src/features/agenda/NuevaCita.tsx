/**
 * Creación de cita.
 *
 * El orden sigue la conversación del mostrador: primero a quién se atiende,
 * después con quién y cuándo. Las horas que se ofrecen son SOLO las que el
 * motor calculó como libres, así que la recepcionista no puede elegir una
 * imposible — y si aun así cambió algo mientras decidía, el servidor lo
 * rechaza con un mensaje que lo explica.
 */

import type { PacienteResumen } from '@consultorio/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Alerta, Boton, Cargando } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.js'
import { useRetraso } from '../../lib/useRetraso.js'
import { buscarPacientes } from '../pacientes/api.js'
import { crearCita, disponibilidad, listarMedicos } from './api.js'
import { Modal } from './Modal.js'

const MOTIVOS_SIN_HUECOS: Record<string, string> = {
  sin_horario: 'Ese médico no atiende ese día.',
  ausente: 'Ese médico no atiende ese día (vacaciones, congreso o feriado).',
  completo: 'La agenda de ese día está completa.',
  dia_pasado: 'No se pueden agendar citas en el pasado.',
}

export function NuevaCita({
  fechaInicial,
  pacienteInicial,
  onCerrar,
  onCreada,
}: {
  fechaInicial: string
  pacienteInicial?: PacienteResumen
  onCerrar: () => void
  onCreada: () => void
}) {
  const { can } = useAuth()

  const [paciente, setPaciente] = useState<PacienteResumen | null>(pacienteInicial ?? null)
  const [busqueda, setBusqueda] = useState('')
  const [medicoId, setMedicoId] = useState('')
  const [fecha, setFecha] = useState(fechaInicial)
  const [horaElegida, setHoraElegida] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [sobreagendar, setSobreagendar] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const busquedaRetrasada = useRetraso(busqueda)

  const medicos = useQuery({ queryKey: ['medicos'], queryFn: listarMedicos })

  // Con un solo médico no tiene sentido preguntar cuál.
  useEffect(() => {
    const lista = medicos.data?.medicos ?? []
    if (!medicoId && lista.length === 1) setMedicoId(lista[0]!.id)
  }, [medicos.data, medicoId])

  const pacientes = useQuery({
    queryKey: ['pacientes', busquedaRetrasada],
    queryFn: () => buscarPacientes(busquedaRetrasada),
    enabled: !paciente && busquedaRetrasada.length >= 2,
  })

  const huecos = useQuery({
    queryKey: ['disponibilidad', medicoId, fecha],
    queryFn: () => disponibilidad(medicoId, fecha),
    enabled: Boolean(medicoId && fecha),
  })

  // Cambiar de médico o de día invalida la hora que se había elegido.
  useEffect(() => {
    setHoraElegida(null)
  }, [medicoId, fecha])

  const guardar = useMutation({
    mutationFn: () =>
      crearCita({
        pacienteId: paciente!.id,
        medicoId,
        inicio: horaElegida!,
        modalidad: 'PRESENCIAL',
        motivo,
        sobreagendar,
      } as Parameters<typeof crearCita>[0]),
    onSuccess: onCreada,
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo agendar la cita')
      // La hora pudo ocuparse mientras se decidía: se recargan los huecos para
      // que la siguiente elección parta de la realidad.
      void huecos.refetch()
      setHoraElegida(null)
    },
  })

  const listo = paciente && medicoId && horaElegida

  return (
    <Modal titulo="Nueva cita" onCerrar={onCerrar}>
      <div className="flex flex-col gap-5">
        {error && <Alerta>{error}</Alerta>}

        {/* --- 1. Paciente --- */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">1. Paciente</h3>

          {paciente ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{paciente.nombreCompleto}</p>
                <p className="truncate text-sm text-gray-500">
                  {paciente.documento} · {paciente.telefono}
                </p>
              </div>
              <Boton variante="fantasma" onClick={() => setPaciente(null)}>
                Cambiar
              </Boton>
            </div>
          ) : (
            <>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre, documento o teléfono"
                aria-label="Buscar paciente"
                autoFocus
                className="min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
              />

              <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                {(pacientes.data?.pacientes ?? []).map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setPaciente(p)}
                      className="w-full rounded-lg border border-gray-200 p-2.5 text-left text-sm transition-colors hover:border-primario hover:bg-blue-50/40"
                    >
                      <span className="block font-medium text-gray-900">{p.nombreCompleto}</span>
                      <span className="block text-xs text-gray-500">
                        {p.documento} · {p.telefono}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {busquedaRetrasada.length >= 2 &&
                !pacientes.isFetching &&
                (pacientes.data?.pacientes.length ?? 0) === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    No se encontró a nadie. Regístralo desde Pacientes antes de agendar.
                  </p>
                )}
            </>
          )}
        </section>

        {/* --- 2. Médico y día --- */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">2. Médico y día</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={medicoId}
              onChange={(e) => setMedicoId(e.target.value)}
              aria-label="Médico"
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Elige un médico</option>
              {(medicos.data?.medicos ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} — {m.especialidad}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              aria-label="Fecha de la cita"
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </section>

        {/* --- 3. Hora --- */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">3. Hora</h3>

          {!medicoId && <p className="text-sm text-gray-500">Elige un médico para ver sus horas.</p>}

          {medicoId && huecos.isLoading && <Cargando mensaje="Buscando horas libres…" />}

          {medicoId && huecos.data && huecos.data.huecos.length === 0 && (
            <Alerta tono="aviso">
              {/*
                Se explica POR QUÉ no hay horas. Un "no hay disponibilidad" a
                secas obliga a llamar a alguien para saber si el médico libra,
                está lleno o no trabaja ese día.
              */}
              {MOTIVOS_SIN_HUECOS[huecos.data.motivoSinHuecos ?? ''] ??
                'No hay horas disponibles ese día.'}
            </Alerta>
          )}

          {medicoId && huecos.data && huecos.data.huecos.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {huecos.data.huecos.map((hueco) => (
                <button
                  key={hueco.inicio}
                  onClick={() => setHoraElegida(hueco.inicio)}
                  className={`min-h-[44px] rounded-lg border text-sm font-medium transition-colors ${
                    horaElegida === hueco.inicio
                      ? 'border-primario bg-primario text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-primario'
                  }`}
                >
                  {hueco.hora}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* --- 4. Detalles --- */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">4. Motivo (opcional)</h3>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Control de presión, dolor abdominal…"
            aria-label="Motivo de la consulta"
            className="min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
          />

          {can('appointment:overbook') && (
            <label className="mt-3 flex items-start gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={sobreagendar}
                onChange={(e) => setSobreagendar(e.target.checked)}
                className="mt-1"
              />
              <span>
                Sobreagenda
                <span className="block text-xs text-gray-400">
                  Permite encajar una urgencia fuera de las horas disponibles. Queda registrado.
                </span>
              </span>
            </label>
          )}
        </section>

        <div className="flex gap-3">
          <Boton
            onClick={() => {
              setError(null)
              guardar.mutate()
            }}
            disabled={!listo}
            cargando={guardar.isPending}
          >
            Agendar cita
          </Boton>
          <Boton variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
        </div>
      </div>
    </Modal>
  )
}
