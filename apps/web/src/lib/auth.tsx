/**
 * Estado de sesión de la aplicación.
 *
 * Expone `can()`, que resuelve permisos con EXACTAMENTE la misma matriz que el
 * backend, importada de @consultorio/shared. Que no haya dos definiciones es
 * lo que evita el desajuste clásico: un botón visible que al pulsarlo devuelve
 * 403, o —peor— uno oculto para alguien que sí podía usarlo.
 *
 * AUNQUE: esto es SOLO para dibujar la interfaz. La autoridad es siempre el
 * servidor. Ocultar un botón no protege nada; cualquiera puede llamar al
 * endpoint directamente. Aquí solo se evita ofrecer lo que no se puede hacer.
 */

import {
  puede as puedeConPermiso,
  type Alcance,
  type Permiso,
  type UsuarioSesion,
} from '@consultorio/shared'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { alPerderLaSesion, api, guardarAccessToken, recuperarSesion } from './api.js'

interface RespuestaSesion {
  accessToken: string
  usuario: UsuarioSesion
}

interface RespuestaDesafio {
  requiere2FA: true
  tokenDesafio: string
}

type RespuestaLogin = RespuestaSesion | RespuestaDesafio

export interface EstadoAuth {
  usuario: UsuarioSesion | null
  cargando: boolean
  /** ¿Puede realizar esta acción? Para mostrar u ocultar, nunca para proteger. */
  can: (permiso: Permiso, alcance?: Alcance) => boolean
  iniciarSesion: (email: string, password: string) => Promise<RespuestaLogin>
  completar2FA: (tokenDesafio: string, codigo: string) => Promise<void>
  cerrarSesion: () => Promise<void>
  refrescarUsuario: () => Promise<void>
}

const ContextoAuth = createContext<EstadoAuth | null>(null)

export function ProveedorAuth({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null)
  const [cargando, setCargando] = useState(true)

  const aplicarSesion = useCallback((datos: RespuestaSesion) => {
    guardarAccessToken(datos.accessToken)
    setUsuario(datos.usuario)
  }, [])

  const limpiarSesion = useCallback(() => {
    guardarAccessToken(null)
    setUsuario(null)
  }, [])

  // Al arrancar se intenta recuperar la sesión con la cookie de refresh. Es lo
  // que hace que recargar la página no eche a nadie, pese a que el access
  // token vive solo en memoria.
  useEffect(() => {
    let vigente = true

    void (async () => {
      const sesion = await recuperarSesion()
      if (!vigente) return

      if (sesion) setUsuario(sesion.usuario as UsuarioSesion)
      setCargando(false)
    })()

    return () => {
      vigente = false
    }
  }, [limpiarSesion])

  // Cuando el cliente de API agota los reintentos, la sesión se acabó.
  useEffect(() => {
    alPerderLaSesion(() => limpiarSesion())
  }, [limpiarSesion])

  const iniciarSesion = useCallback(
    async (email: string, password: string): Promise<RespuestaLogin> => {
      const respuesta = await api.post<RespuestaLogin>('/api/auth/login', { email, password })

      // Con 2FA activo, la contraseña correcta solo da un token de desafío:
      // todavía no hay sesión.
      if (!('requiere2FA' in respuesta)) aplicarSesion(respuesta)

      return respuesta
    },
    [aplicarSesion],
  )

  const completar2FA = useCallback(
    async (tokenDesafio: string, codigo: string) => {
      const respuesta = await api.post<RespuestaSesion>('/api/auth/2fa/verificar', {
        tokenDesafio,
        codigo,
      })
      aplicarSesion(respuesta)
    },
    [aplicarSesion],
  )

  const cerrarSesion = useCallback(async () => {
    // Se limpia el estado local aunque la llamada falle: si el servidor no
    // responde, dejar la sesión abierta en pantalla es lo último que se quiere
    // en un equipo compartido de recepción.
    await api.post('/api/auth/logout').catch(() => undefined)
    limpiarSesion()
  }, [limpiarSesion])

  const refrescarUsuario = useCallback(async () => {
    const datos = await api.get<{ usuario: UsuarioSesion }>('/api/auth/yo')
    setUsuario(datos.usuario)
  }, [])

  const can = useCallback(
    (permiso: Permiso, alcance?: Alcance) => {
      if (!usuario) return false

      // Se usa la lista ya resuelta por el servidor (roles + extra − denied) en
      // lugar de recalcularla aquí: las excepciones por usuario solo las conoce
      // la base de datos.
      const concedido = usuario.permisos.includes(permiso)
      if (!concedido) return false
      if (!alcance) return true

      // Para el alcance sí hace falta la matriz, que es idéntica en ambos lados.
      return puedeConPermiso({ roles: usuario.roles as never }, permiso, alcance)
    },
    [usuario],
  )

  const valor = useMemo<EstadoAuth>(
    () => ({
      usuario,
      cargando,
      can,
      iniciarSesion,
      completar2FA,
      cerrarSesion,
      refrescarUsuario,
    }),
    [usuario, cargando, can, iniciarSesion, completar2FA, cerrarSesion, refrescarUsuario],
  )

  return <ContextoAuth value={valor}>{children}</ContextoAuth>
}

export function useAuth(): EstadoAuth {
  const contexto = use(ContextoAuth)
  if (!contexto) throw new Error('useAuth debe usarse dentro de <ProveedorAuth>')
  return contexto
}
