/**
 * Reportes de citas y pacientes.
 *
 * Sin librería de gráficos: las barras son divs con un ancho porcentual. Para
 * siete días de la semana y media docena de médicos, una dependencia de 100 kB
 * añadiría más peso de carga que información.
 */

import {
  NOMBRES_DIA,
  type RangoReporte,
  type ReporteCitas,
  type ReportePacientes,
} from '@consultorio/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alerta, Boton, Cargando, Tarjeta } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.js'
import { listarMedicos } from '../agenda/api.js'
import { descargarCsv, reporteCitas, reportePacientes } from './api.js'

/** Primer día del mes actual, en el calendario local. */
function inicioDeMes(): string {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
}

function hoyLocal(): string {
  const hoy = new Date()
  return [
    hoy.getFullYear(),
    String(hoy.getMonth() + 1).padStart(2, '0'),
    String(hoy.getDate()).padStart(2, '0'),
  ].join('-')
}

export function Reportes() {
  const { can } = useAuth()

  const [desde, setDesde] = useState(inicioDeMes())
  const [hasta, setHasta] = useState(hoyLocal())
  const [medicoId, setMedicoId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rango: RangoReporte = { desde, hasta, ...(medicoId ? { medicoId } : {}) }

  const medicos = useQuery({
    queryKey: ['medicos'],
    queryFn: listarMedicos,
    enabled: can('appointment:read', 'all'),
  })

  const citas = useQuery({
    queryKey: ['reporte-citas', desde, hasta, medicoId],
    queryFn: () => reporteCitas(rango),
  })

  const pacientes = useQuery({
    queryKey: ['reporte-pacientes', desde, hasta],
    queryFn: () => reportePacientes(rango),
    enabled: can('report:patients'),
  })

  function exportar(cual: 'citas' | 'pacientes') {
    setError(null)
    descargarCsv(cual, rango).catch((fallo: unknown) =>
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo generar el archivo'),
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-xl font-semibold text-gray-900 sm:text-2xl">Reportes</h1>

      {error && (
        <div className="mb-4">
          <Alerta>{error}</Alerta>
        </div>
      )}

      {/* --- Filtros --- */}
      <Tarjeta className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="desde" className="text-xs font-medium text-gray-600">
              Desde
            </label>
            <input
              id="desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="hasta" className="text-xs font-medium text-gray-600">
              Hasta
            </label>
            <input
              id="hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
            />
          </div>

          {can('appointment:read', 'all') && (medicos.data?.medicos.length ?? 0) > 1 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="medico" className="text-xs font-medium text-gray-600">
                Médico
              </label>
              <select
                id="medico"
                value={medicoId}
                onChange={(e) => setMedicoId(e.target.value)}
                className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
              >
                <option value="">Todos</option>
                {(medicos.data?.medicos ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Tarjeta>

      {citas.isLoading && <Cargando mensaje="Calculando…" />}

      {citas.isError && (
        <Alerta>
          {citas.error instanceof ErrorApi
            ? citas.error.message
            : 'No se pudo calcular el reporte.'}
        </Alerta>
      )}

      {citas.data && <ReporteDeCitas datos={citas.data} onExportar={() => exportar('citas')} />}

      {pacientes.data && (
        <ReporteDePacientes datos={pacientes.data} onExportar={() => exportar('pacientes')} />
      )}
    </div>
  )
}

function ReporteDeCitas({ datos, onExportar }: { datos: ReporteCitas; onExportar: () => void }) {
  const maxDia = Math.max(1, ...datos.porDiaSemana.map((d) => d.total))

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-gray-900">Citas</h2>
        <Boton variante="secundario" onClick={onExportar}>
          Exportar a Excel
        </Boton>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra etiqueta="Total" valor={datos.total} />
        <Cifra etiqueta="Atendidas" valor={datos.porEstado.atendidas} tono="bien" />
        <Cifra
          etiqueta="Tasa de asistencia"
          valor={`${datos.tasaAsistencia}%`}
          tono={datos.tasaAsistencia >= 85 ? 'bien' : 'aviso'}
        />
        <Cifra
          etiqueta="Tasa de inasistencia"
          valor={`${datos.tasaInasistencia}%`}
          tono={datos.tasaInasistencia > 15 ? 'aviso' : undefined}
        />
      </div>

      <p className="text-xs text-gray-500">
        Las tasas se calculan sobre las citas ya resueltas (atendidas más inasistencias). Las que
        todavía están agendadas no cuentan.
      </p>

      {/* --- Por día de la semana --- */}
      <Tarjeta>
        <h3 className="mb-3 text-sm font-medium text-gray-700">Citas por día de la semana</h3>
        <ul className="flex flex-col gap-2">
          {datos.porDiaSemana.map((dia) => (
            <li key={dia.dia} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-gray-600">{NOMBRES_DIA[dia.dia]}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                <div
                  className="h-full bg-primario"
                  style={{ width: `${(dia.total / maxDia) * 100}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-gray-600">
                {dia.total}
                {dia.noAsistieron > 0 && (
                  <span className="ml-1 text-amber-600" title="No asistieron">
                    ({dia.noAsistieron})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Tarjeta>

      {/* --- Por médico --- */}
      {datos.porMedico.length > 1 && (
        <Tarjeta>
          <h3 className="mb-3 text-sm font-medium text-gray-700">Por médico</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-2 pr-3">Médico</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3 text-right">Atendidas</th>
                  <th className="py-2 pr-3 text-right">No asistió</th>
                  <th className="py-2 text-right">Asistencia</th>
                </tr>
              </thead>
              <tbody>
                {datos.porMedico.map((fila) => (
                  <tr key={fila.medicoId} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-900">{fila.medicoNombre}</td>
                    <td className="py-2 pr-3 text-right">{fila.total}</td>
                    <td className="py-2 pr-3 text-right">{fila.atendidas}</td>
                    <td className="py-2 pr-3 text-right">{fila.noAsistieron}</td>
                    <td className="py-2 text-right font-medium">{fila.tasaAsistencia}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

      {/* --- Cancelaciones --- */}
      {datos.motivosCancelacion.length > 0 && (
        <Tarjeta>
          <h3 className="mb-1 text-sm font-medium text-gray-700">Motivos de cancelación</h3>
          <p className="mb-3 text-xs text-gray-500">
            {datos.cancelacionesPorOrigen.paciente} canceladas por el paciente ·{' '}
            {datos.cancelacionesPorOrigen.clinica} por la clínica
          </p>

          <ul className="flex flex-col gap-1.5">
            {datos.motivosCancelacion.map((motivo) => (
              <li key={motivo.motivo} className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-gray-700">{motivo.motivo}</span>
                <span className="shrink-0 font-medium text-gray-900">{motivo.cantidad}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  )
}

function ReporteDePacientes({
  datos,
  onExportar,
}: {
  datos: ReportePacientes
  onExportar: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-gray-900">Pacientes</h2>
        <Boton variante="secundario" onClick={onExportar}>
          Exportar a Excel
        </Boton>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra etiqueta="Nuevos" valor={datos.nuevos} />
        <Cifra etiqueta="Recurrentes" valor={datos.recurrentes} />
        <Cifra etiqueta="Atendidos" valor={datos.totalAtendidos} />
      </div>

      {datos.porRangoEdad.length > 0 && (
        <Tarjeta>
          <h3 className="mb-3 text-sm font-medium text-gray-700">Por rango de edad</h3>
          <ul className="flex flex-col gap-2">
            {datos.porRangoEdad.map((rango) => (
              <li key={rango.rango} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-xs text-gray-600">{rango.rango}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-gray-100">
                  <div
                    className="h-full bg-secundario"
                    style={{
                      width: `${(rango.cantidad / Math.max(1, datos.totalAtendidos)) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs text-gray-600">
                  {rango.cantidad}
                </span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  )
}

function Cifra({
  etiqueta,
  valor,
  tono,
}: {
  etiqueta: string
  valor: string | number
  tono?: 'bien' | 'aviso'
}) {
  const color =
    tono === 'bien' ? 'text-emerald-700' : tono === 'aviso' ? 'text-amber-700' : 'text-gray-900'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{etiqueta}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{valor}</p>
    </div>
  )
}
