/**
 * Rutas de autenticación.
 *
 * Es el único módulo con rutas públicas, así que los límites de peticiones se
 * aplican aquí con cuidado: `limiteAutenticacion` en todo lo que verifica una
 * credencial (fuerza bruta) y `limiteEnvios` en lo que dispara un correo.
 */

import { Router } from 'express'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { limiteAutenticacion, limiteEnvios } from '../../middleware/limites.js'
import * as controlador from './auth.controller.js'

export const rutasAuth: Router = Router()

// --- Públicas ----------------------------------------------------------------
rutasAuth.post('/login', limiteAutenticacion, controlador.login)
rutasAuth.post('/2fa/verificar', limiteAutenticacion, controlador.verificar2FA)

// La renovación no lleva límite de autenticación: es una llamada legítima cada
// 15 minutos por sesión, y la protege el propio refresh token.
rutasAuth.post('/refresh', controlador.renovar)
rutasAuth.post('/logout', controlador.logout)

rutasAuth.post('/password/olvide', limiteEnvios, controlador.olvideContrasena)
rutasAuth.post('/password/restablecer', limiteAutenticacion, controlador.restablecerContrasena)

// --- Requieren sesión --------------------------------------------------------
rutasAuth.use(requiereAutenticacion)

rutasAuth.get('/sesiones', controlador.sesionActual)
rutasAuth.post('/password/cambiar', controlador.cambiarContrasena)

rutasAuth.post('/2fa/preparar', controlador.prepararSegundoFactor)
rutasAuth.post('/2fa/activar', controlador.activarSegundoFactor)
rutasAuth.post('/2fa/desactivar', controlador.desactivarSegundoFactor)
