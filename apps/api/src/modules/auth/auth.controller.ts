/**
 * Controladores de autenticación: traducen HTTP ↔ service.
 *
 * DÓNDE VIVE CADA TOKEN, y por qué:
 *
 *  · El access token va en el cuerpo de la respuesta y la web lo guarda EN
 *    MEMORIA. No en localStorage: cualquier script inyectado puede leer
 *    localStorage, y con historias clínicas de por medio ese riesgo no se
 *    asume. Al durar 15 minutos, perderlo al recargar la página es
 *    intrascendente: se renueva con el refresh.
 *
 *  · El refresh token va en una cookie httpOnly, que JavaScript no puede leer
 *    ni aunque logren inyectar código en la página. Con SameSite=strict el
 *    navegador tampoco la envía desde otro sitio, lo que cierra el CSRF sin
 *    necesidad de tokens antifalsificación.
 */

import {
  esquemaActivar2FA,
  esquemaCambiarContrasena,
  esquemaDesactivar2FA,
  esquemaLogin,
  esquemaOlvideContrasena,
  esquemaRestablecerContrasena,
  esquemaVerificar2FA,
} from '@consultorio/shared'
import type { CookieOptions, Request, RequestHandler, Response } from 'express'
import { env, esProduccion } from '../../config/env.js'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { logger } from '../../core/logger.js'
import * as servicio from './auth.service.js'

const COOKIE_REFRESH = 'refresh_token'

function opcionesCookie(expira: Date): CookieOptions {
  return {
    httpOnly: true,
    // En desarrollo el frontend va por http; exigir `secure` impediría que el
    // navegador guardase la cookie y nada funcionaría en local.
    secure: esProduccion,
    sameSite: 'strict',
    // El navegador solo la enviará a las rutas de sesión, así que no viaja en
    // cada llamada a la API. Menos exposición por el mismo precio.
    path: '/api/auth',
    expires: expira,
  }
}

function datosCliente(req: Request): servicio.DatosCliente {
  return {
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
  }
}

function enviarSesion(res: Response, resultado: Extract<servicio.ResultadoInicioSesion, { tipo: 'sesion' }>) {
  res.cookie(
    COOKIE_REFRESH,
    resultado.tokens.refreshToken,
    opcionesCookie(resultado.tokens.expiraRefresh),
  )

  res.json({
    accessToken: resultado.tokens.accessToken,
    usuario: resultado.usuario,
    debeConfigurar2FA: resultado.debeConfigurar2FA,
  })
}

// --- Inicio de sesión --------------------------------------------------------

export const login: RequestHandler = async (req, res) => {
  const { email, password } = esquemaLogin.parse(req.body)
  const resultado = await servicio.iniciarSesion(email, password, datosCliente(req))

  if (resultado.tipo === 'desafio2fa') {
    res.json({ requiere2FA: true, tokenDesafio: resultado.tokenDesafio })
    return
  }

  enviarSesion(res, resultado)
}

export const verificar2FA: RequestHandler = async (req, res) => {
  const { tokenDesafio, codigo } = esquemaVerificar2FA.parse(req.body)
  const resultado = await servicio.verificarSegundoFactor(tokenDesafio, codigo, datosCliente(req))

  // Un desafío 2FA nunca puede resolverse en otro desafío.
  if (resultado.tipo !== 'sesion') throw new ErrorNoAutenticado('No se pudo completar el ingreso')

  enviarSesion(res, resultado)
}

// --- Renovación y cierre -----------------------------------------------------

export const renovar: RequestHandler = async (req, res) => {
  const refreshToken = req.cookies?.[COOKIE_REFRESH] as string | undefined
  if (!refreshToken) throw new ErrorNoAutenticado('No hay sesión que renovar')

  const { tokens, usuario } = await servicio.renovarSesion(refreshToken, datosCliente(req))

  res.cookie(COOKIE_REFRESH, tokens.refreshToken, opcionesCookie(tokens.expiraRefresh))
  res.json({ accessToken: tokens.accessToken, usuario })
}

export const logout: RequestHandler = async (req, res) => {
  // La cookie se borra siempre, haya sesión válida o no: si el token ya
  // caducó, dejarla puesta solo genera errores en la próxima renovación.
  res.clearCookie(COOKIE_REFRESH, { ...opcionesCookie(new Date(0)), expires: undefined })

  if (req.auth) {
    await servicio.cerrarSesion(req.auth.sesionId, req.auth.usuarioId, datosCliente(req))
  }

  res.status(204).end()
}

/**
 * Datos de la sesión actual.
 *
 * La web los recarga tras cambiar algo que afecta a la interfaz (activar el
 * segundo factor, un permiso concedido por el administrador) sin obligar a
 * cerrar y abrir sesión.
 */
export const usuarioActual: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()
  res.json({ usuario: await servicio.construirUsuarioSesion(req.auth.usuarioId) })
}

export const sesionActual: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()
  res.json({ sesiones: await servicio.listarSesiones(req.auth.usuarioId) })
}

// --- Contraseñas -------------------------------------------------------------

export const cambiarContrasena: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()

  const { contrasenaActual, contrasenaNueva } = esquemaCambiarContrasena.parse(req.body)
  await servicio.cambiarContrasena(
    req.auth.usuarioId,
    contrasenaActual,
    contrasenaNueva,
    datosCliente(req),
  )

  res.clearCookie(COOKIE_REFRESH, { ...opcionesCookie(new Date(0)), expires: undefined })
  res.status(204).end()
}

export const olvideContrasena: RequestHandler = async (req, res) => {
  const { email } = esquemaOlvideContrasena.parse(req.body)
  const solicitud = await servicio.solicitarRecuperacion(email, datosCliente(req))

  if (solicitud) {
    const enlace = `${env.FRONTEND_URL}/restablecer?token=${solicitud.token}`
    // El envío de correo llega junto con el resto de notificaciones (H6).
    // Hasta entonces el enlace queda en el log, que en desarrollo es
    // exactamente lo que hace falta para poder probar el flujo.
    logger.info({ usuarioId: solicitud.usuarioId, enlace }, 'Enlace de recuperación generado')
  }

  // Misma respuesta exista o no la cuenta: distinguirlas convertiría este
  // endpoint público en un comprobador de qué correos están registrados.
  res.json({
    mensaje: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
  })
}

export const restablecerContrasena: RequestHandler = async (req, res) => {
  const { token, contrasenaNueva } = esquemaRestablecerContrasena.parse(req.body)
  await servicio.restablecerContrasena(token, contrasenaNueva, datosCliente(req))

  res.json({ mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' })
}

// --- Segundo factor ----------------------------------------------------------

export const prepararSegundoFactor: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()
  res.json(await servicio.prepararSegundoFactor(req.auth.usuarioId))
}

export const activarSegundoFactor: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()

  const { codigo } = esquemaActivar2FA.parse(req.body)
  await servicio.activarSegundoFactor(req.auth.usuarioId, codigo, datosCliente(req))

  res.json({ mensaje: 'Segundo factor activado' })
}

export const desactivarSegundoFactor: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()

  const { password, codigo } = esquemaDesactivar2FA.parse(req.body)
  await servicio.desactivarSegundoFactor(
    req.auth.usuarioId,
    password,
    codigo,
    datosCliente(req),
  )

  res.json({ mensaje: 'Segundo factor desactivado' })
}
