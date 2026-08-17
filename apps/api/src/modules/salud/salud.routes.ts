/**
 * Endpoints de salud del servicio.
 *
 * Se separan a propósito:
 *
 *  · /health responde siempre que el proceso esté vivo. Es el que mira el
 *    orquestador para decidir si reiniciar el contenedor.
 *
 *  · /health/ready comprueba además la base de datos. Es el que decide si
 *    mandarle tráfico. Si se mezclaran, una caída momentánea de PostgreSQL
 *    haría que Railway reinicie la aplicación en bucle, que es exactamente lo
 *    que no se quiere: la aplicación está bien, la dependencia no.
 */

import { Router } from 'express'
import { baseDeDatosResponde } from '../../core/prisma.js'

export const rutasSalud: Router = Router()

rutasSalud.get('/health', (_req, res) => {
  res.json({
    estado: 'ok',
    tiempoActivoSegundos: Math.floor(process.uptime()),
  })
})

rutasSalud.get('/health/ready', async (_req, res) => {
  const baseOk = await baseDeDatosResponde()

  res.status(baseOk ? 200 : 503).json({
    estado: baseOk ? 'listo' : 'no disponible',
    baseDeDatos: baseOk ? 'ok' : 'sin conexión',
  })
})
