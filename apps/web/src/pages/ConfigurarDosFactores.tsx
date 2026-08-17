/**
 * Configuración del segundo factor.
 *
 * Las cuentas de administrador deben tenerlo activo, así que esta pantalla es
 * obligatoria para ellas antes de poder usar el sistema. Para el resto es
 * voluntaria y se llega desde el perfil.
 */

import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent } from 'react'
import { Alerta, Boton, Campo, Tarjeta } from '../components/ui/index.js'
import { ErrorApi, api } from '../lib/api.js'
import { useAuth } from '../lib/auth.js'

interface Preparacion {
  secreto: string
  uri: string
}

export function ConfigurarDosFactores({ obligatorio = false }: { obligatorio?: boolean }) {
  const { refrescarUsuario, cerrarSesion } = useAuth()

  const [preparacion, setPreparacion] = useState<Preparacion | null>(null)
  const [imagenQr, setImagenQr] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vigente = true

    void (async () => {
      try {
        const datos = await api.post<Preparacion>('/api/auth/2fa/preparar')
        if (!vigente) return
        setPreparacion(datos)

        // El QR se genera en el navegador: la URI contiene el secreto, y
        // mandarla a un servicio externo para dibujarla sería regalárselo.
        setImagenQr(await QRCode.toDataURL(datos.uri, { width: 220, margin: 1 }))
      } catch (fallo) {
        if (vigente) {
          setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo preparar el segundo factor')
        }
      }
    })()

    return () => {
      vigente = false
    }
  }, [])

  async function activar(evento: FormEvent) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)

    try {
      await api.post('/api/auth/2fa/activar', { codigo })
      await refrescarUsuario()
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo activar')
      setCodigo('')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md p-4 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Verificación en dos pasos</h1>
      <p className="mb-5 text-sm text-gray-600">
        {obligatorio
          ? 'Las cuentas de administrador requieren un segundo factor. Es la cuenta que gestiona al personal y las integraciones.'
          : 'Añade una capa extra de seguridad a tu cuenta.'}
      </p>

      {error && (
        <div className="mb-4">
          <Alerta>{error}</Alerta>
        </div>
      )}

      <Tarjeta>
        <ol className="mb-5 space-y-3 text-sm text-gray-700">
          <li>
            <span className="font-medium">1.</span> Instala una aplicación de autenticación (Google
            Authenticator, Authy, o el gestor de contraseñas que ya uses).
          </li>
          <li>
            <span className="font-medium">2.</span> Escanea este código:
          </li>
        </ol>

        <div className="mb-5 flex flex-col items-center gap-3">
          {imagenQr ? (
            <img
              src={imagenQr}
              alt="Código QR para configurar la verificación en dos pasos"
              className="rounded-lg border border-gray-200"
            />
          ) : (
            <div className="size-[220px] animate-pulse rounded-lg bg-gray-100" />
          )}

          {preparacion && (
            <details className="w-full text-sm">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                ¿No puedes escanear? Introduce el código manualmente
              </summary>
              <code className="mt-2 block break-all rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-800">
                {preparacion.secreto}
              </code>
            </details>
          )}
        </div>

        <form onSubmit={activar} className="flex flex-col gap-4">
          <Campo
            etiqueta="3. Escribe el código que muestra la aplicación"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className="text-center text-2xl tracking-[0.5em]"
          />

          <Boton type="submit" cargando={enviando} anchoCompleto disabled={codigo.length !== 6}>
            Activar
          </Boton>
        </form>

        {obligatorio && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <Boton variante="fantasma" anchoCompleto onClick={() => void cerrarSesion()}>
              Cerrar sesión
            </Boton>
          </div>
        )}
      </Tarjeta>

      <p className="mt-4 text-center text-xs text-gray-500">
        Guarda el código manual en un lugar seguro. Si pierdes el acceso a la aplicación, es la
        única forma de recuperar la cuenta sin ayuda del administrador.
      </p>
    </div>
  )
}
