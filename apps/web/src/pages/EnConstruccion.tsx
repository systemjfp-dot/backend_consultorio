/**
 * Marcador para los módulos que aún no existen.
 *
 * Se muestra en las rutas del menú que llegan en hitos posteriores. Es
 * preferible a ocultarlas: quien entra ve que el sistema contempla ese módulo
 * y en qué momento del plan aparece, en lugar de encontrarse un 404 y dudar de
 * si le falta un permiso.
 */

import { Tarjeta } from '../components/ui/index.js'

export function EnConstruccion({ titulo, hito }: { titulo: string; hito: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">{titulo}</h1>
      <Tarjeta>
        <p className="text-sm text-gray-600">
          Este módulo llega en el hito <span className="font-medium text-gray-900">{hito}</span> del
          plan de desarrollo.
        </p>
      </Tarjeta>
    </div>
  )
}
