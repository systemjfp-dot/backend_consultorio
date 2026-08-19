/**
 * Pruebas de la aplicación con el DOM real (jsdom).
 *
 * Se simula `fetch` en lugar de levantar el backend: lo que se comprueba aquí
 * es el comportamiento del cliente —qué pantalla se muestra, qué se pide y en
 * qué orden— y eso debe poder verificarse sin base de datos.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'

const USUARIO_RECEPCION = {
  id: 'u1',
  email: 'recepcion@clinica.demo',
  firstName: 'Rosa',
  lastName: 'Díaz',
  roles: ['RECEPTIONIST'],
  permisos: ['patient:read', 'patient:create', 'appointment:read', 'appointment:create'],
  twoFactorEnabled: false,
}

const USUARIO_ADMIN_SIN_2FA = {
  ...USUARIO_RECEPCION,
  email: 'admin@clinica.demo',
  firstName: 'Elena',
  lastName: 'Vásquez',
  roles: ['ADMIN'],
  permisos: ['staff:read', 'settings:read', 'audit:read'],
}

/** Respuestas por ruta. Cada prueba declara solo lo que necesita. */
function simularApi(rutas: Record<string, { estado?: number; cuerpo: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string | URL | Request) => {
      const url = typeof entrada === 'string' ? entrada : entrada.toString()
      const clave = Object.keys(rutas).find((r) => url.includes(r))

      if (!clave) {
        return new Response(JSON.stringify({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'no' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { estado = 200, cuerpo } = rutas[clave]!
      return new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

beforeEach(() => {
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  // Con `globals: false` no hay limpieza automática, y sin ella el DOM de una
  // prueba sobrevive a la siguiente: las consultas encuentran dos botones de
  // "Iniciar sesión" y fallan por un motivo que no tiene que ver con el código.
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('sin sesión', () => {
  it('muestra el inicio de sesión con el nombre de la clínica', async () => {
    simularApi({
      '/api/auth/refresh': { estado: 401, cuerpo: { error: { codigo: 'NO_AUTENTICADO', mensaje: 'no' } } },
      '/api/instalacion/estado': {
        cuerpo: { instalado: true, clinica: { nombre: 'Centro Médico San Rafael', logoUrl: null } },
      },
    })

    render(<App />)

    // El nombre se pide ANTES de autenticar: es lo que convierte una pantalla
    // genérica en la puerta de este consultorio.
    expect(await screen.findByText('Centro Médico San Rafael')).toBeDefined()
    expect(screen.getByLabelText('Correo')).toBeDefined()
    expect(screen.getByLabelText('Contraseña')).toBeDefined()
  })

  it('avisa cuando el sistema no está instalado', async () => {
    simularApi({
      '/api/auth/refresh': { estado: 401, cuerpo: { error: { codigo: 'NO_AUTENTICADO', mensaje: 'no' } } },
      '/api/instalacion/estado': { cuerpo: { instalado: false } },
    })

    render(<App />)

    expect(await screen.findByText('Sistema sin instalar')).toBeDefined()
    expect(screen.getByText(/pnpm setup/)).toBeDefined()
  })

  it('muestra el error del servidor sin romper la pantalla', async () => {
    simularApi({
      '/api/auth/refresh': { estado: 401, cuerpo: { error: { codigo: 'NO_AUTENTICADO', mensaje: 'no' } } },
      '/api/instalacion/estado': { cuerpo: { instalado: true } },
      '/api/auth/login': {
        estado: 401,
        cuerpo: { error: { codigo: 'NO_AUTENTICADO', mensaje: 'Correo o contraseña incorrectos' } },
      },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Correo'), 'nadie@clinica.demo')
    await usuario.type(screen.getByLabelText('Contraseña'), 'Incorrecta1!')
    await usuario.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Correo o contraseña incorrectos',
    )
  })

  it('pide el código cuando la cuenta tiene segundo factor', async () => {
    simularApi({
      '/api/auth/refresh': { estado: 401, cuerpo: { error: { codigo: 'NO_AUTENTICADO', mensaje: 'no' } } },
      '/api/instalacion/estado': { cuerpo: { instalado: true } },
      '/api/auth/login': { cuerpo: { requiere2FA: true, tokenDesafio: 'desafio-abc' } },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Correo'), 'admin@clinica.demo')
    await usuario.type(screen.getByLabelText('Contraseña'), 'Demo2026!')
    await usuario.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    // La contraseña correcta NO abre sesión: solo lleva al segundo paso.
    expect(await screen.findByText('Verificación en dos pasos')).toBeDefined()
    expect(screen.getByLabelText('Código de verificación')).toBeDefined()
  })
})

describe('con sesión restaurada', () => {
  it('recupera la sesión de la cookie sin volver a pedir credenciales', async () => {
    // Es lo que permite que el access token viva solo en memoria: recargar la
    // página no debe echar a nadie.
    simularApi({
      '/api/auth/refresh': { cuerpo: { accessToken: 'token-1', usuario: USUARIO_RECEPCION } },
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: /Rosa/ })).toBeDefined()
    expect(screen.queryByLabelText('Contraseña')).toBeNull()
  })

  it('el menú se filtra por permisos', async () => {
    simularApi({
      '/api/auth/refresh': { cuerpo: { accessToken: 'token-1', usuario: USUARIO_RECEPCION } },
    })

    render(<App />)
    await screen.findByRole('heading', { name: /Rosa/ })

    // La recepción ve pacientes y agenda…
    expect(screen.getAllByRole('link', { name: /Pacientes/ }).length).toBeGreaterThan(0)
    // …y no ve auditoría ni personal.
    expect(screen.queryByRole('link', { name: /Auditoría/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Personal/ })).toBeNull()
  })

  it('una ruta sin permiso no se abre aunque se escriba la URL', async () => {
    window.history.pushState({}, '', '/auditoria')

    simularApi({
      '/api/auth/refresh': { cuerpo: { accessToken: 'token-1', usuario: USUARIO_RECEPCION } },
    })

    render(<App />)

    expect(await screen.findByText('Página no encontrada')).toBeDefined()
  })
})

describe('segundo factor voluntario', () => {
  it('un administrador sin 2FA entra directo al sistema', async () => {
    // Antes quedaba retenido en la pantalla de configuración. En un
    // consultorio pequeño el administrador suele ser quien atiende: dejarlo
    // fuera por no tener la app de autenticación a mano paraba la consulta.
    simularApi({
      '/api/auth/refresh': { estado: 401, cuerpo: { error: { codigo: 'NO_AUTENTICADO', mensaje: 'no' } } },
      '/api/instalacion/estado': { cuerpo: { instalado: true } },
      '/api/auth/login': {
        cuerpo: { accessToken: 'token-1', usuario: USUARIO_ADMIN_SIN_2FA },
      },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Correo'), 'admin@clinica.demo')
    await usuario.type(screen.getByLabelText('Contraseña'), 'Demo2026!')
    await usuario.click(screen.getByRole('button', { name: 'Iniciar sesión' }))

    // Llega al sistema: hay menú y no hay pantalla de configuración.
    expect(await screen.findByRole('link', { name: /Personal/ })).toBeDefined()
    expect(screen.queryByText('Verificación en dos pasos')).toBeNull()
  })

  it('se puede configurar desde el perfil si se quiere', async () => {
    simularApi({
      '/api/auth/refresh': { cuerpo: { accessToken: 'token-1', usuario: USUARIO_ADMIN_SIN_2FA } },
      '/api/instalacion/estado': { cuerpo: { instalado: true } },
      '/api/auth/2fa/preparar': {
        cuerpo: { secreto: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Consultorio:admin' },
      },
    })
    window.history.pushState({}, '', '/perfil/2fa')

    render(<App />)

    expect(await screen.findByText('Verificación en dos pasos')).toBeDefined()
    // El secreto llega en una segunda petición, así que hay que esperarlo.
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeDefined()
  })
})
