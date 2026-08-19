/**
 * Orden de exámenes auxiliares desde la atención.
 *
 * Una sola orden agrupa todos los exámenes que se piden en el mismo acto: es
 * un solo papel que el paciente lleva al laboratorio, no tres que puede perder
 * por separado.
 */

import {
  ETIQUETAS_TIPO_EXAMEN,
  INDICACIONES_FRECUENTES,
  TIPOS_EXAMEN,
  type ExamenCatalogo,
  type TipoExamen,
} from '@consultorio/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alerta, Boton } from '../../components/ui/index.js'
import { Modal } from '../agenda/Modal.js'
import { ErrorApi } from '../../lib/api.js'
import { useRetraso } from '../../lib/useRetraso.js'
import { abrirOrden, buscarEnCatalogo, emitirOrden, ordenarExamenes } from './api.js'

interface ExamenElegido {
  tipo: TipoExamen
  nombre: string
  indicaciones: string
  urgente: boolean
}

export function NuevaOrden({
  atencionId,
  onCerrar,
  onEmitida,
}: {
  atencionId: string
  onCerrar: () => void
  onEmitida: () => void
}) {
  const [elegidos, setElegidos] = useState<ExamenElegido[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoExamen | ''>('')
  const [fechaLimite, setFechaLimite] = useState('')
  const [error, setError] = useState<string | null>(null)

  const retrasada = useRetraso(busqueda)

  const catalogo = useQuery({
    queryKey: ['catalogo-examenes', retrasada, tipoFiltro],
    queryFn: () => buscarEnCatalogo(retrasada, tipoFiltro || undefined),
    enabled: retrasada.trim().length >= 2,
  })

  function anadir(item: ExamenCatalogo) {
    if (elegidos.some((e) => e.nombre === item.nombre)) return

    setElegidos((lista) => [
      ...lista,
      {
        tipo: item.tipo,
        nombre: item.nombre,
        // Las indicaciones del catálogo se traen ya puestas: un ayuno mal
        // indicado obliga a repetir el examen otro día.
        indicaciones: item.indicaciones ?? '',
        urgente: false,
      },
    ])
    setBusqueda('')
  }

  function anadirLibre(nombre: string) {
    setElegidos((lista) => [
      ...lista,
      { tipo: tipoFiltro || 'OTHER', nombre, indicaciones: '', urgente: false },
    ])
    setBusqueda('')
  }

  const emitir = useMutation({
    mutationFn: async () => {
      const { ordenId } = await ordenarExamenes({
        atencionId,
        examenes: elegidos,
        fechaLimite,
      } as never)

      await emitirOrden(ordenId)
      await abrirOrden(ordenId)
    },
    onSuccess: onEmitida,
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo emitir la orden')
    },
  })

  return (
    <Modal titulo="Nueva orden de exámenes" onCerrar={onCerrar}>
      <div className="flex flex-col gap-5">
        {error && <Alerta>{error}</Alerta>}

        {/* --- Elegidos --- */}
        {elegidos.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium text-gray-700">
              En esta orden ({elegidos.length})
            </h3>

            <ul className="flex flex-col gap-2">
              {elegidos.map((examen, indice) => (
                <li key={indice} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">{examen.nombre}</p>
                      <p className="text-xs text-gray-500">{ETIQUETAS_TIPO_EXAMEN[examen.tipo]}</p>
                    </div>
                    <button
                      onClick={() => setElegidos((l) => l.filter((_, i) => i !== indice))}
                      aria-label={`Quitar ${examen.nombre}`}
                      className="shrink-0 text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>

                  <input
                    value={examen.indicaciones}
                    onChange={(e) =>
                      setElegidos((l) =>
                        l.map((x, i) => (i === indice ? { ...x, indicaciones: e.target.value } : x)),
                      )
                    }
                    placeholder="Preparación (ayuno, vejiga llena…)"
                    aria-label={`Indicaciones para ${examen.nombre}`}
                    className="min-h-[44px] w-full rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
                  />

                  <div className="mt-2 flex flex-wrap gap-1">
                    {INDICACIONES_FRECUENTES.map((texto) => (
                      <button
                        key={texto}
                        onClick={() =>
                          setElegidos((l) =>
                            l.map((x, i) => (i === indice ? { ...x, indicaciones: texto } : x)),
                          )
                        }
                        className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-primario hover:text-primario"
                      >
                        {texto}
                      </button>
                    ))}
                  </div>

                  <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={examen.urgente}
                      onChange={(e) =>
                        setElegidos((l) =>
                          l.map((x, i) => (i === indice ? { ...x, urgente: e.target.checked } : x)),
                        )
                      }
                    />
                    Urgente
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- Buscador --- */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">Añadir examen</h3>

          <div className="flex gap-2">
            <select
              value={tipoFiltro}
              onChange={(e) => setTipoFiltro(e.target.value as TipoExamen | '')}
              aria-label="Tipo de examen"
              className="min-h-[48px] rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
            >
              <option value="">Todos</option>
              {TIPOS_EXAMEN.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {ETIQUETAS_TIPO_EXAMEN[tipo]}
                </option>
              ))}
            </select>

            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Hemograma, ecografía, electrocardiograma…"
              aria-label="Buscar examen"
              className="min-h-[48px] flex-1 rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {retrasada.trim().length >= 2 && (
            <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {(catalogo.data?.examenes ?? []).map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => anadir(item)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:border-primario hover:bg-blue-50/40"
                  >
                    <span className="font-medium text-gray-900">{item.nombre}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {ETIQUETAS_TIPO_EXAMEN[item.tipo]}
                    </span>
                    {item.indicaciones && (
                      <span className="block text-xs text-gray-500">{item.indicaciones}</span>
                    )}
                  </button>
                </li>
              ))}

              {!catalogo.isFetching && (catalogo.data?.examenes.length ?? 0) === 0 && (
                <li>
                  <button
                    onClick={() => anadirLibre(retrasada)}
                    className="text-sm text-primario hover:underline"
                  >
                    Pedir «{retrasada}» aunque no esté en el catálogo
                  </button>
                </li>
              )}
            </ul>
          )}
        </section>

        {/* --- Plazo --- */}
        <section>
          <label htmlFor="fecha-limite" className="mb-1.5 block text-sm font-medium text-gray-700">
            Realizar antes de (opcional)
          </label>
          <input
            id="fecha-limite"
            type="date"
            value={fechaLimite}
            onChange={(e) => setFechaLimite(e.target.value)}
            className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
          />
        </section>

        <div className="flex gap-3">
          <Boton
            onClick={() => {
              setError(null)
              emitir.mutate()
            }}
            disabled={elegidos.length === 0}
            cargando={emitir.isPending}
          >
            Emitir e imprimir
          </Boton>
          <Boton variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
        </div>

        <p className="text-xs text-gray-500">
          Todos los exámenes salen en un solo documento con un código para localizarlo.
        </p>
      </div>
    </Modal>
  )
}
