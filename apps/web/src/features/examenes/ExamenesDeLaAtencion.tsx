/**
 * Exámenes ordenados en esta atención, con carga de resultados.
 */

import {
  ETIQUETAS_ESTADO_EXAMEN,
  ETIQUETAS_TIPO_EXAMEN,
  estadoExamen,
  type Examen,
} from '@consultorio/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Alerta, Boton } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.js'
import {
  abrirOrden,
  abrirResultado,
  adjuntarResultado,
  examenesDeAtencion,
  registrarResultado,
} from './api.js'

const COLOR_ESTADO = {
  pendiente: 'bg-gray-100 text-gray-600',
  vencido: 'bg-amber-100 text-amber-800',
  con_resultado: 'bg-emerald-100 text-emerald-800',
} as const

export function ExamenesDeLaAtencion({ atencionId }: { atencionId: string }) {
  const { can } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const consulta = useQuery({
    queryKey: ['examenes-atencion', atencionId],
    queryFn: () => examenesDeAtencion(atencionId),
  })

  const examenes = consulta.data?.examenes ?? []

  if (examenes.length === 0) {
    return <p className="text-sm text-gray-500">Sin exámenes ordenados en esta atención.</p>
  }

  // Los que comparten documento van juntos: es un solo papel.
  const ordenes = new Map<string, Examen[]>()
  for (const examen of examenes) {
    const clave = examen.emitidoEn
    ordenes.set(clave, [...(ordenes.get(clave) ?? []), examen])
  }

  return (
    <>
      {error && (
        <div className="mb-3">
          <Alerta>{error}</Alerta>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {[...ordenes.entries()].map(([clave, grupo]) => (
          <div key={clave} className="rounded-lg border border-gray-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-500">
                Orden del {new Date(clave).toLocaleDateString('es-PE')} ·{' '}
                {grupo.length} {grupo.length === 1 ? 'examen' : 'exámenes'}
              </p>

              {grupo[0]!.tienePdf && (
                <button
                  onClick={() =>
                    abrirOrden(grupo[0]!.id).catch((fallo: unknown) =>
                      setError(
                        fallo instanceof ErrorApi ? fallo.message : 'No se pudo abrir la orden',
                      ),
                    )
                  }
                  className="text-sm text-primario hover:underline"
                >
                  Ver orden
                </button>
              )}
            </div>

            <ul className="divide-y divide-gray-100">
              {grupo.map((examen) => (
                <li key={examen.id}>
                  <FilaExamen
                    examen={examen}
                    puedeCargar={can('exam:result_upload')}
                    puedeLeer={can('exam:read')}
                    onError={setError}
                    onCambio={() => void consulta.refetch()}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
}

function FilaExamen({
  examen,
  puedeCargar,
  puedeLeer,
  onError,
  onCambio,
}: {
  examen: Examen
  puedeCargar: boolean
  puedeLeer: boolean
  onError: (mensaje: string) => void
  onCambio: () => void
}) {
  const [cargando, setCargando] = useState(false)
  const [texto, setTexto] = useState(examen.resultado ?? '')
  const archivo = useRef<HTMLInputElement>(null)

  const estado = estadoExamen(examen)

  const guardarTexto = useMutation({
    mutationFn: () => registrarResultado(examen.id, texto),
    onSuccess: () => {
      setCargando(false)
      onCambio()
    },
    onError: (fallo) =>
      onError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar el resultado'),
  })

  const subir = useMutation({
    mutationFn: (fichero: File) => adjuntarResultado(examen.id, fichero),
    onSuccess: onCambio,
    onError: (fallo) =>
      onError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo subir el archivo'),
  })

  return (
    <div className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">
            {examen.nombre}
            {examen.urgente && (
              <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                URGENTE
              </span>
            )}
          </p>
          <p className="text-xs text-gray-500">
            {ETIQUETAS_TIPO_EXAMEN[examen.tipo]}
            {examen.indicaciones ? ` · ${examen.indicaciones}` : ''}
          </p>
        </div>

        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${COLOR_ESTADO[estado]}`}>
          {ETIQUETAS_ESTADO_EXAMEN[estado]}
        </span>
      </div>

      {examen.resultado && !cargando && (
        <p className="mt-2 rounded bg-gray-50 p-2 text-sm whitespace-pre-wrap text-gray-800">
          {examen.resultado}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {examen.tieneArchivoResultado && puedeLeer && (
          <button
            onClick={() =>
              abrirResultado(examen.id).catch((fallo: unknown) =>
                onError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo abrir el resultado'),
              )
            }
            className="text-sm text-primario hover:underline"
          >
            Ver archivo del resultado
          </button>
        )}

        {puedeCargar && !cargando && (
          <button onClick={() => setCargando(true)} className="text-sm text-gray-500 hover:text-primario">
            {examen.resultado ? 'Editar resultado' : 'Cargar resultado'}
          </button>
        )}

        {puedeCargar && (
          <>
            <button
              onClick={() => archivo.current?.click()}
              className="text-sm text-gray-500 hover:text-primario"
            >
              {subir.isPending ? 'Subiendo…' : 'Adjuntar PDF'}
            </button>
            <input
              ref={archivo}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const fichero = e.target.files?.[0]
                if (fichero) subir.mutate(fichero)
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>

      {cargando && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Hemoglobina 10.2 g/dL. Resto dentro de rangos."
            aria-label={`Resultado de ${examen.nombre}`}
            autoFocus
            className="rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
          />
          <div className="flex gap-2">
            <Boton onClick={() => guardarTexto.mutate()} cargando={guardarTexto.isPending}>
              Guardar
            </Boton>
            <Boton variante="fantasma" onClick={() => setCargando(false)}>
              Cancelar
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}
