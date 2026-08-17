/**
 * Rutas de autenticación.
 *
 * Cada ruta declara explícitamente su nivel de acceso con `rutaPublica` o
 * `rutaPropia`. Ninguna necesita un permiso de la matriz: o son el punto de
 * entrada al sistema, o actúan sobre la cuenta de quien llama.
 *
 * La prueba de cobertura de rutas falla si alguna se queda sin declarar, así
 * que añadir un endpoint aquí obliga a decidir conscientemente qué protección
 * lleva.
 */

import { Router } from 'express'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { limiteAutenticacion, limiteEnvios } from '../../middleware/limites.js'
import { rutaPropia, rutaPublica } from '../../middleware/permisos.js'
import * as controlador from './auth.controller.js'

export const rutasAuth: Router = Router()

// --- Públicas ----------------------------------------------------------------

rutasAuth.post(
  '/login',
  rutaPublica('Punto de entrada al sistema: por definición no puede exigir sesión'),
  limiteAutenticacion,
  controlador.login,
)

rutasAuth.post(
  '/2fa/verificar',
  rutaPublica('Segundo paso del login; se autoriza con el token de desafío'),
  limiteAutenticacion,
  controlador.verificar2FA,
)

rutasAuth.post(
  '/refresh',
  // Sin límite de autenticación: es una llamada legítima cada 15 minutos por
  // sesión, y quien la protege es el propio refresh token de la cookie.
  rutaPublica('Se autoriza con la cookie de refresh, no con el access token'),
  controlador.renovar,
)

rutasAuth.post(
  '/logout',
  rutaPublica('Debe poder limpiar la cookie aunque el access token ya expirara'),
  controlador.logout,
)

rutasAuth.post(
  '/password/olvide',
  rutaPublica('Quien olvidó su contraseña no puede iniciar sesión para pedirla'),
  limiteEnvios,
  controlador.olvideContrasena,
)

rutasAuth.post(
  '/password/restablecer',
  rutaPublica('Se autoriza con el token de un solo uso del enlace'),
  limiteAutenticacion,
  controlador.restablecerContrasena,
)

// --- Sobre la propia cuenta --------------------------------------------------

rutasAuth.use(requiereAutenticacion)

rutasAuth.get(
  '/sesiones',
  rutaPropia('Cada usuario ve únicamente sus propias sesiones abiertas'),
  controlador.sesionActual,
)

rutasAuth.post(
  '/password/cambiar',
  rutaPropia('Cambia la contraseña de quien llama, verificando la actual'),
  controlador.cambiarContrasena,
)

rutasAuth.post(
  '/2fa/preparar',
  rutaPropia('Configura el segundo factor de la propia cuenta'),
  controlador.prepararSegundoFactor,
)

rutasAuth.post(
  '/2fa/activar',
  rutaPropia('Activa el segundo factor de la propia cuenta'),
  controlador.activarSegundoFactor,
)

rutasAuth.post(
  '/2fa/desactivar',
  rutaPropia('Desactiva el segundo factor propio, exigiendo contraseña y código'),
  controlador.desactivarSegundoFactor,
)
