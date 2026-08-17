/**
 * Inicio de sesión.
 *
 * Dos pasos cuando la cuenta tiene segundo factor: primero credenciales,
 * después el código. El backend no crea sesión hasta el segundo, así que aquí
 * el estado intermedio guarda únicamente el token de desafío.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Alerta, Boton, Campo, Tarjeta } from '../components/ui/index.js'
import { ErrorApi, api } from '../lib/api.js'
import { useAuth } from '../lib/auth.js'

interface EstadoInstalacion {
  instalado: boolean
  clinica?: { nombre: string; logoUrl: string | null }
}

export function Login() {
  const { iniciarSesion, completar2FA } = useAuth()

  const [clinica, setClinica] = useState<EstadoInstalacion | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [tokenDesafio, setTokenDesafio] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // El nombre de la clínica se pide antes de autenticar: es lo que convierte
  // una pantalla genérica en la puerta de ESTE consultorio.
  useEffect(() => {
    void api
      .get<EstadoInstalacion>('/api/instalacion/estado')
      .then(setClinica)
      .catch(() => setClinica({ instalado: true }))
  }, [])

  async function enviarCredenciales(evento: FormEvent) {
    evento.preventDefault()
    setError(null)
    setEnviando(true)

    try {
      const respuesta = await iniciarSesion(email, password)
      if ('requiere2FA' in respuesta) setTokenDesafio(respuesta.tokenDesafio)
      // Si no requiere 2FA, el proveedor ya guardó la sesión y el enrutador
      // saca de esta pantalla solo.
    } catch (fallo) {
      setError(
        fallo instanceof ErrorApi ? fallo.message : 'No se pudo conectar con el servidor',
      )
    } finally {
      setEnviando(false)
    }
  }

  async function enviarCodigo(evento: FormEvent) {
    evento.preventDefault()
    if (!tokenDesafio) return

    setError(null)
    setEnviando(true)

    try {
      await completar2FA(tokenDesafio, codigo)
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo verificar el código')
      setCodigo('')
    } finally {
      setEnviando(false)
    }
  }

  if (clinica && !clinica.instalado) {
    return (
      <PantallaCentrada>
        <Tarjeta>
          <h1 className="mb-2 text-lg font-semibold text-gray-900">Sistema sin instalar</h1>
          <p className="text-sm text-gray-600">
            Ejecuta <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">pnpm setup</code> en
            el servidor para configurar la clínica y crear la cuenta de administrador.
          </p>
        </Tarjeta>
      </PantallaCentrada>
    )
  }

  return (
    <PantallaCentrada>
      <div className="mb-6 text-center">
        {clinica?.clinica?.logoUrl ? (
          <img
            src={clinica.clinica.logoUrl}
            alt=""
            className="mx-auto mb-3 size-16 rounded-xl object-contain"
          />
        ) : (
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-xl bg-primario text-2xl text-white">
            ✚
          </div>
        )}
        <h1 className="text-xl font-semibold text-gray-900">
          {clinica?.clinica?.nombre ?? 'Consultorio'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {tokenDesafio ? 'Verificación en dos pasos' : 'Inicia sesión para continuar'}
        </p>
      </div>

      <Tarjeta>
        {error && (
          <div className="mb-4">
            <Alerta>{error}</Alerta>
          </div>
        )}

        {tokenDesafio ? (
          <form onSubmit={enviarCodigo} className="flex flex-col gap-4">
            <Campo
              etiqueta="Código de verificación"
              ayuda="Los 6 dígitos de tu aplicación de autenticación"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              // inputMode numérico abre el teclado de números en móvil, y
              // one-time-code deja que iOS ofrezca el código automáticamente.
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              required
              className="text-center text-2xl tracking-[0.5em]"
            />

            <Boton type="submit" cargando={enviando} anchoCompleto disabled={codigo.length !== 6}>
              Verificar
            </Boton>

            <Boton
              type="button"
              variante="fantasma"
              anchoCompleto
              onClick={() => {
                setTokenDesafio(null)
                setCodigo('')
                setError(null)
              }}
            >
              Volver
            </Boton>
          </form>
        ) : (
          <form onSubmit={enviarCredenciales} className="flex flex-col gap-4">
            <Campo
              etiqueta="Correo"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />

            <Campo
              etiqueta="Contraseña"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            <Boton type="submit" cargando={enviando} anchoCompleto>
              Iniciar sesión
            </Boton>
          </form>
        )}
      </Tarjeta>
    </PantallaCentrada>
  )
}

function PantallaCentrada({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
