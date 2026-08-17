/**
 * Agenda del día.
 *
 * DECISIÓN: calendario propio en lugar de React Big Calendar, que era lo que
 * proponía el plan.
 *
 * Tres razones concretas:
 *
 *  · El motor de disponibilidad ya calcula los huecos exactos de cada médico.
 *    Una librería genérica dibujaría su propia rejilla de horas y habría que
 *    pelearse con ella para que coincidan.
 *
 *  · El requisito es mobile-first y RBC no lo es: en 360 px su vista de
 *    recursos no entra, y adaptarla cuesta más que dibujarla.
 *
 *  · Reprogramar arrastrando es incómodo en una tablet. Un selector de hueco
 *    —que además solo ofrece horas realmente libres— es más fiable con el
 *    dedo, y no puede soltar una cita en un hueco ocupado.
 *
 * Es reversible: la API devuelve las citas con instante, hora local y color,
 * que es lo que cualquier calendario necesitaría.
 */

import { ETIQUETAS_ESTADO, type Cita, type EstadoCita } from '@consultorio/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alerta, Boton, Cargando, Tarjeta } from '../../components/ui/index.js'
import { useAuth } from '../../lib/auth.js'
import { citasDelRango, listarMedicos } from './api.js'
import { DetalleCita } from './DetalleCita.js'
import { NuevaCita } from './NuevaCita.js'

/** Hoy en el calendario local del navegador, que es el de la clínica. */
function hoyLocal(): string {
  const ahora = new Date()
  return [
    ahora.getFullYear(),
    String(ahora.getMonth() + 1).padStart(2, '0'),
    String(ahora.getDate()).padStart(2, '0'),
  ].join('-')
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number]
  const resultado = new Date(Date.UTC(a, m - 1, d + dias))
  return resultado.toISOString().slice(0, 10)
}

function fechaLegible(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/** Colores por estado. El color del médico identifica la columna, no la cita. */
const ESTILO_ESTADO: Record<EstadoCita, string> = {
  SCHEDULED: 'bg-white border-gray-200',
  CONFIRMED: 'bg-blue-50 border-blue-200',
  ARRIVED: 'bg-amber-50 border-amber-300',
  IN_ATTENTION: 'bg-emerald-50 border-emerald-300',
  COMPLETED: 'bg-gray-50 border-gray-200 opacity-70',
  CANCELLED: 'bg-gray-50 border-gray-200 opacity-50 line-through',
  NO_SHOW: 'bg-red-50 border-red-200 opacity-70',
}

export function Agenda() {
  const { can, usuario } = useAuth()
  const [parametros, setParametros] = useSearchParams()

  const fecha = parametros.get('fecha') ?? hoyLocal()
  const medicoFiltro = parametros.get('medico') ?? ''

  const [citaAbierta, setCitaAbierta] = useState<Cita | null>(null)
  const [creando, setCreando] = useState(false)

  const medicos = useQuery({ queryKey: ['medicos'], queryFn: listarMedicos })

  const citas = useQuery({
    queryKey: ['citas', fecha, medicoFiltro],
    queryFn: () => citasDelRango(fecha, fecha, medicoFiltro || undefined),
    // La agenda cambia constantemente: alguien llega, se cancela una cita.
    // Media hora de datos viejos en un mostrador es inaceptable.
    refetchInterval: 60_000,
  })

  function irA(nuevaFecha: string) {
    const siguiente = new URLSearchParams(parametros)
    siguiente.set('fecha', nuevaFecha)
    setParametros(siguiente, { replace: true })
  }

  function filtrarPor(medicoId: string) {
    const siguiente = new URLSearchParams(parametros)
    if (medicoId) siguiente.set('medico', medicoId)
    else siguiente.delete('medico')
    setParametros(siguiente, { replace: true })
  }

  // Un médico ve solo su agenda: mostrarle un selector con todos los demás
  // sugiere que puede cambiar de columna, y el servidor no se lo va a permitir.
  const puedeVerTodos = can('appointment:read', 'all')
  const listaMedicos = medicos.data?.medicos ?? []

  const citasVisibles = citas.data?.citas ?? []
  const porMedico = agruparPorMedico(citasVisibles, listaMedicos, puedeVerTodos, usuario?.doctorId)

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Agenda</h1>

          {can('appointment:create') && (
            <Boton onClick={() => setCreando(true)}>Nueva cita</Boton>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Boton variante="secundario" onClick={() => irA(sumarDias(fecha, -1))} aria-label="Día anterior">
              ‹
            </Boton>
            <Boton variante="secundario" onClick={() => irA(hoyLocal())}>
              Hoy
            </Boton>
            <Boton variante="secundario" onClick={() => irA(sumarDias(fecha, 1))} aria-label="Día siguiente">
              ›
            </Boton>
          </div>

          <input
            type="date"
            value={fecha}
            onChange={(e) => irA(e.target.value)}
            aria-label="Fecha de la agenda"
            className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
          />

          {puedeVerTodos && listaMedicos.length > 1 && (
            <select
              value={medicoFiltro}
              onChange={(e) => filtrarPor(e.target.value)}
              aria-label="Filtrar por médico"
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Todos los médicos</option>
              {listaMedicos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          )}
        </div>

        <p className="mt-2 text-sm text-gray-500 first-letter:uppercase">{fechaLegible(fecha)}</p>
      </header>

      {citas.isLoading && <Cargando mensaje="Cargando agenda…" />}

      {citas.isError && (
        <Alerta>No se pudo cargar la agenda. Revisa tu conexión e inténtalo de nuevo.</Alerta>
      )}

      {!citas.isLoading && citasVisibles.length === 0 && (
        <Tarjeta>
          <p className="text-sm text-gray-600">No hay citas para este día.</p>
        </Tarjeta>
      )}

      {/*
        Una columna por médico en pantalla ancha; apiladas en móvil. Es la
        vista que usa un mostrador el 90 % del tiempo: quién atiende a quién,
        ahora.
      */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {porMedico.map(({ medico, citas: suyas }) => (
          <section key={medico.id} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: medico.color }}
                aria-hidden="true"
              />
              {medico.nombre}
              <span className="text-gray-400">
                ({suyas.length} {suyas.length === 1 ? 'cita' : 'citas'})
              </span>
            </h2>

            <ul className="flex flex-col gap-2">
              {suyas.map((cita) => (
                <li key={cita.id}>
                  <BotonCita cita={cita} onAbrir={() => setCitaAbierta(cita)} />
                </li>
              ))}
              {suyas.length === 0 && (
                <li className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-400">
                  Sin citas
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>

      {creando && (
        <NuevaCita
          fechaInicial={fecha}
          onCerrar={() => setCreando(false)}
          onCreada={() => {
            setCreando(false)
            void citas.refetch()
          }}
        />
      )}

      {citaAbierta && (
        <DetalleCita
          cita={citaAbierta}
          onCerrar={() => setCitaAbierta(null)}
          onCambio={() => {
            setCitaAbierta(null)
            void citas.refetch()
          }}
        />
      )}
    </div>
  )
}

function BotonCita({ cita, onAbrir }: { cita: Cita; onAbrir: () => void }) {
  return (
    <button
      onClick={onAbrir}
      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primario ${ESTILO_ESTADO[cita.estado]}`}
    >
      <span className="shrink-0 font-mono text-sm font-medium text-gray-700">{cita.hora}</span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-900">{cita.pacienteNombre}</span>
        <span className="block truncate text-xs text-gray-500">
          {ETIQUETAS_ESTADO[cita.estado]}
          {cita.motivo ? ` · ${cita.motivo}` : ''}
          {cita.sobreagendada ? ' · sobreagenda' : ''}
        </span>
      </span>

      {/* Las alergias se ven en la propia agenda, antes de entrar a la ficha. */}
      {cita.pacienteAlergias && (
        <span
          className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
          title={`Alergias: ${cita.pacienteAlergias}`}
        >
          !
        </span>
      )}
    </button>
  )
}

/** Agrupa las citas por médico, conservando a los que no tienen ninguna. */
function agruparPorMedico(
  citas: Cita[],
  medicos: { id: string; nombre: string; color: string }[],
  puedeVerTodos: boolean,
  doctorIdPropio?: string,
) {
  const visibles = puedeVerTodos
    ? medicos
    : medicos.filter((m) => m.id === doctorIdPropio)

  // Si el filtro deja fuera a un médico que sí tiene citas —por ejemplo tras
  // cambiar de rol— igualmente se muestra: es peor esconder una cita real.
  const conCitas = new Set(citas.map((c) => c.medicoId))
  const lista = [
    ...visibles,
    ...medicos.filter((m) => !visibles.includes(m) && conCitas.has(m.id)),
  ]

  return lista
    .map((medico) => ({
      medico,
      citas: citas.filter((c) => c.medicoId === medico.id),
    }))
    .filter((grupo) => grupo.citas.length > 0 || lista.length <= 4)
}
