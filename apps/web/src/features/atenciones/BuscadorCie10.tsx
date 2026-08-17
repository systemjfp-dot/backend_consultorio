/**
 * Buscador de diagnósticos CIE-10.
 *
 * Sin catálogo, el campo de "autocompletado con CIE-10" que pide el documento
 * maestro quedaría vacío para siempre: no hay de dónde sacar los códigos.
 * Busca sin acentos, igual que el buscador de pacientes.
 */

import type { CodigoCie10 } from '@consultorio/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useRetraso } from '../../lib/useRetraso.js'
import { buscarCie10 } from './api.js'

export function BuscadorCie10({ onElegir }: { onElegir: (codigo: CodigoCie10) => void }) {
  const [termino, setTermino] = useState('')
  const retrasado = useRetraso(termino)

  const consulta = useQuery({
    queryKey: ['cie10', retrasado],
    queryFn: () => buscarCie10(retrasado),
    enabled: retrasado.trim().length >= 2,
  })

  const resultados = consulta.data?.codigos ?? []

  return (
    <div>
      <input
        type="search"
        value={termino}
        onChange={(e) => setTermino(e.target.value)}
        placeholder="Buscar diagnóstico o código (cefalea, I10…)"
        aria-label="Buscar diagnóstico CIE-10"
        className="min-h-[48px] w-full rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
      />

      {retrasado.trim().length >= 2 && (
        <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {resultados.map((codigo) => (
            <li key={codigo.codigo}>
              <button
                onClick={() => {
                  onElegir(codigo)
                  setTermino('')
                }}
                className="flex w-full min-h-[44px] items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition-colors hover:border-primario hover:bg-blue-50/40"
              >
                <span className="shrink-0 font-mono font-medium text-gray-900">{codigo.codigo}</span>
                <span className="min-w-0 flex-1 text-gray-600">{codigo.descripcion}</span>
              </button>
            </li>
          ))}

          {!consulta.isFetching && resultados.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500">
              Sin resultados. El diagnóstico se puede escribir en texto libre igualmente.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
