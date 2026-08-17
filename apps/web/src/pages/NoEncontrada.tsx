import { Link } from 'react-router-dom'
import { Tarjeta } from '../components/ui/index.js'

export function NoEncontrada() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <Tarjeta>
        <h1 className="mb-2 text-lg font-semibold text-gray-900">Página no encontrada</h1>
        <p className="mb-4 text-sm text-gray-600">
          La dirección que abriste no existe o no está disponible para tu cuenta.
        </p>
        <Link to="/" className="text-sm font-medium text-primario hover:underline">
          Volver al inicio
        </Link>
      </Tarjeta>
    </div>
  )
}
