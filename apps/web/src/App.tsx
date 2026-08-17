import { VERSION_CONTRATOS } from '@consultorio/shared'

/**
 * Raíz de la aplicación.
 * El enrutador, el layout y las rutas protegidas llegan en el paso H0.9.
 */
export function App() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold text-primario">Consultorio</h1>
      <p className="text-sm text-gray-500">
        Esqueleto listo — contratos v{VERSION_CONTRATOS}
      </p>
    </main>
  )
}
