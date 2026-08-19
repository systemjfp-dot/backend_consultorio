/**
 * Emisión de receta desde la atención.
 *
 * El flujo está pensado para lo que ocurre de verdad: el médico añade dos o
 * tres medicamentos que casi siempre son los mismos, y quiere entregar el
 * papel antes de que el paciente se levante. Por eso las plantillas están
 * arriba y el botón de firmar hace todo de una vez.
 */

import {
  VIAS_ADMINISTRACION,
  resumirMedicamento,
  type DatosMedicamento,
  type MedicamentoCatalogo,
} from '@consultorio/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alerta, Boton, Campo } from '../../components/ui/index.js'
import { Modal } from '../agenda/Modal.js'
import { ErrorApi } from '../../lib/api.js'
import { useRetraso } from '../../lib/useRetraso.js'
import {
  abrirPdf,
  buscarMedicamentos,
  crearReceta,
  estadoFirma,
  firmarReceta,
  guardarPlantilla,
  listarPlantillas,
} from './api.js'

const MEDICAMENTO_VACIO: DatosMedicamento = {
  nombre: '',
  concentracion: '',
  forma: '',
  via: 'Oral',
  frecuencia: '',
  duracion: '',
  indicaciones: '',
}

export function NuevaReceta({
  atencionId,
  onCerrar,
  onEmitida,
}: {
  atencionId: string
  onCerrar: () => void
  onEmitida: () => void
}) {
  const [medicamentos, setMedicamentos] = useState<DatosMedicamento[]>([])
  const [indicaciones, setIndicaciones] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [nombrePlantilla, setNombrePlantilla] = useState('')
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false)

  const firma = useQuery({ queryKey: ['firma'], queryFn: estadoFirma })
  const plantillas = useQuery({ queryKey: ['plantillas'], queryFn: listarPlantillas })

  const emitir = useMutation({
    mutationFn: async () => {
      const { receta } = await crearReceta({
        atencionId,
        medicamentos,
        indicacionesGenerales: indicaciones,
        diasValidez: 30,
      } as never)

      const firmada = await firmarReceta(receta.id)
      await abrirPdf(firmada.receta.id)
      return firmada.receta
    },
    onSuccess: onEmitida,
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo emitir la receta')
    },
  })

  const plantilla = useMutation({
    mutationFn: () => guardarPlantilla(nombrePlantilla, medicamentos),
    onSuccess: async () => {
      setGuardandoPlantilla(false)
      setNombrePlantilla('')
      await plantillas.refetch()
    },
  })

  const listo = medicamentos.length > 0 && medicamentos.every((m) => m.nombre.trim().length >= 2)

  return (
    <Modal titulo="Nueva receta" onCerrar={onCerrar}>
      <div className="flex flex-col gap-5">
        {error && <Alerta>{error}</Alerta>}

        {firma.data && !firma.data.registrada && (
          <Alerta tono="info">
            No tienes una firma registrada: la receta saldrá con el espacio en blanco para que la
            firmes a mano. Si prefieres que salga ya firmada, regístrala en{' '}
            <Link to="/perfil/firma" className="font-medium underline underline-offset-2">
              Mi firma
            </Link>
            .
          </Alerta>
        )}

        {/* --- Plantillas --- */}
        {(plantillas.data?.plantillas.length ?? 0) > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium text-gray-700">Mis recetas frecuentes</h3>
            <div className="flex flex-wrap gap-2">
              {plantillas.data!.plantillas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setMedicamentos(p.medicamentos)
                    if (p.indicacionesGenerales) setIndicaciones(p.indicacionesGenerales)
                  }}
                  className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 transition-colors hover:border-primario hover:bg-blue-50/40"
                >
                  {p.nombre}
                  <span className="ml-1.5 text-xs text-gray-400">
                    ({p.medicamentos.length})
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* --- Medicamentos --- */}
        <section>
          <h3 className="mb-2 text-sm font-medium text-gray-700">Medicamentos</h3>

          <ul className="mb-3 flex flex-col gap-3">
            {medicamentos.map((medicamento, indice) => (
              <li key={indice}>
                <FilaMedicamento
                  medicamento={medicamento}
                  onCambio={(nuevo) =>
                    setMedicamentos((lista) =>
                      lista.map((m, i) => (i === indice ? nuevo : m)),
                    )
                  }
                  onQuitar={() =>
                    setMedicamentos((lista) => lista.filter((_, i) => i !== indice))
                  }
                />
              </li>
            ))}
          </ul>

          <Boton
            variante="secundario"
            onClick={() => setMedicamentos((lista) => [...lista, { ...MEDICAMENTO_VACIO }])}
          >
            Añadir medicamento
          </Boton>
        </section>

        {/* --- Indicaciones generales --- */}
        <section>
          <label htmlFor="indicaciones-generales" className="mb-1.5 block text-sm font-medium text-gray-700">
            Indicaciones generales (opcional)
          </label>
          <textarea
            id="indicaciones-generales"
            rows={2}
            value={indicaciones}
            onChange={(e) => setIndicaciones(e.target.value)}
            placeholder="Reposo relativo, abundante líquido…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
          />
        </section>

        {/* --- Guardar como plantilla --- */}
        {listo && (
          <section className="rounded-lg bg-gray-50 p-3">
            {guardandoPlantilla ? (
              <div className="flex flex-col gap-2">
                <Campo
                  etiqueta="Nombre de la plantilla"
                  value={nombrePlantilla}
                  onChange={(e) => setNombrePlantilla(e.target.value)}
                  placeholder="Faringitis bacteriana"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Boton
                    variante="secundario"
                    onClick={() => plantilla.mutate()}
                    disabled={nombrePlantilla.trim().length < 2}
                    cargando={plantilla.isPending}
                  >
                    Guardar
                  </Boton>
                  <Boton variante="fantasma" onClick={() => setGuardandoPlantilla(false)}>
                    Cancelar
                  </Boton>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setGuardandoPlantilla(true)}
                className="text-sm text-primario hover:underline"
              >
                Guardar esta combinación como plantilla
              </button>
            )}
          </section>
        )}

        <div className="flex gap-3">
          <Boton
            onClick={() => {
              setError(null)
              emitir.mutate()
            }}
            disabled={!listo}
            cargando={emitir.isPending}
          >
            Emitir e imprimir
          </Boton>
          <Boton variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
        </div>

        <p className="text-xs text-gray-500">
          Al emitir se genera el PDF y se abre en una pestaña nueva, listo para imprimir. Si tienes
          firma registrada sale ya firmado; si no, con espacio para firmarlo a mano.
        </p>
      </div>
    </Modal>
  )
}

function FilaMedicamento({
  medicamento,
  onCambio,
  onQuitar,
}: {
  medicamento: DatosMedicamento
  onCambio: (medicamento: DatosMedicamento) => void
  onQuitar: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const retrasada = useRetraso(busqueda)

  const catalogo = useQuery({
    queryKey: ['medicamentos', retrasada],
    queryFn: () => buscarMedicamentos(retrasada),
    enabled: retrasada.trim().length >= 2 && medicamento.nombre === '',
  })

  function elegir(item: MedicamentoCatalogo) {
    onCambio({
      ...medicamento,
      nombre: item.nombre,
      concentracion: item.concentracion ?? '',
      forma: item.forma ?? '',
    })
    setBusqueda('')
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      {medicamento.nombre === '' ? (
        <>
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar medicamento (paracetamol, amoxi…)"
            aria-label="Buscar medicamento"
            autoFocus
            className="min-h-[48px] w-full rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
          />

          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {(catalogo.data?.medicamentos ?? []).map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => elegir(item)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:border-primario hover:bg-blue-50/40"
                >
                  <span className="font-medium text-gray-900">{item.nombre}</span>
                  {item.concentracion && (
                    <span className="ml-1 text-gray-600">{item.concentracion}</span>
                  )}
                  {item.forma && <span className="ml-1 text-gray-400">· {item.forma}</span>}
                </button>
              </li>
            ))}
          </ul>

          {retrasada.trim().length >= 2 && (catalogo.data?.medicamentos.length ?? 0) === 0 && (
            <button
              onClick={() => onCambio({ ...medicamento, nombre: retrasada })}
              className="mt-2 text-sm text-primario hover:underline"
            >
              Usar «{retrasada}» tal cual
            </button>
          )}

          <button onClick={onQuitar} className="mt-2 block text-sm text-gray-400 hover:text-red-600">
            Quitar
          </button>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="font-medium text-gray-900">{resumirMedicamento(medicamento)}</p>
            <button
              onClick={onQuitar}
              aria-label={`Quitar ${medicamento.nombre}`}
              className="shrink-0 text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select
              value={medicamento.via}
              onChange={(e) => onCambio({ ...medicamento, via: e.target.value })}
              aria-label="Vía de administración"
              className="min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
            >
              {VIAS_ADMINISTRACION.map((via) => (
                <option key={via} value={via}>
                  {via}
                </option>
              ))}
            </select>

            <input
              value={medicamento.frecuencia}
              onChange={(e) => onCambio({ ...medicamento, frecuencia: e.target.value })}
              placeholder="Cada 8 horas"
              aria-label="Frecuencia"
              className="min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
            />

            <input
              value={medicamento.duracion}
              onChange={(e) => onCambio({ ...medicamento, duracion: e.target.value })}
              placeholder="5 días"
              aria-label="Duración"
              className="min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
            />

            <input
              type="number"
              inputMode="numeric"
              value={medicamento.cantidad ?? ''}
              onChange={(e) =>
                onCambio({
                  ...medicamento,
                  ...(e.target.value ? { cantidad: Number(e.target.value) } : { cantidad: undefined }),
                })
              }
              placeholder="Cant."
              aria-label="Cantidad"
              className="min-h-[44px] rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
            />
          </div>

          <input
            value={medicamento.indicaciones}
            onChange={(e) => onCambio({ ...medicamento, indicaciones: e.target.value })}
            placeholder="Indicaciones adicionales (con alimentos, no conducir…)"
            aria-label="Indicaciones adicionales"
            className="mt-2 min-h-[44px] w-full rounded-lg border border-gray-300 px-2 text-sm outline-none focus:border-primario"
          />
        </>
      )}
    </div>
  )
}
