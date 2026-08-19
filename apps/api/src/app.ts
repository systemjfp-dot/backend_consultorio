/**
 * Construcción de la aplicación Express.
 *
 * Separada de `server.ts` a propósito: las pruebas pueden crear la app y hacer
 * peticiones contra ella con supertest sin abrir un puerto, lo que permite
 * correr muchas suites en paralelo sin colisiones.
 */

import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, esProduccion } from './config/env.js'
import { logger } from './core/logger.js'
import { cargarSesion } from './middleware/autenticar.js'
import { resolverConsultorio } from './middleware/consultorio.js'
import { manejadorErrores, manejadorNoEncontrado } from './middleware/errores.js'
import { limiteGeneral } from './middleware/limites.js'
import { MODULOS_DE_RUTAS } from './rutas.js'

export function crearApp(): Express {
  const app = express()

  // Railway y cualquier proxy inverso entregan la IP real en X-Forwarded-For.
  // Sin esto, todas las peticiones parecerían venir del balanceador y el
  // límite por IP del inicio de sesión dejaría de tener sentido.
  // El valor 1 (un solo proxy delante) evita que un cliente pueda falsificar
  // su IP encadenando cabeceras.
  if (esProduccion) app.set('trust proxy', 1)

  app.disable('x-powered-by')

  // --- Identificador de petición -------------------------------------------
  // Aparece en los logs y en cada respuesta de error, de modo que cuando la
  // clínica reporta "me salió un error", ese código lleva directo a la traza.
  app.use((req, res, next) => {
    const entrante = req.get('x-request-id')
    req.idPeticion = entrante && entrante.length <= 64 ? entrante : randomUUID()
    res.setHeader('x-request-id', req.idPeticion)
    next()
  })

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).idPeticion,
      // El ruido de los chequeos de salud taparía todo lo demás.
      autoLogging: {
        ignore: (req) => req.url?.startsWith('/api/health') ?? false,
      },
    }),
  )

  // --- Seguridad ------------------------------------------------------------
  app.use(
    helmet({
      // La API no sirve HTML; la CSP la aplica el frontend, que sí lo hace.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  )

  app.use(
    cors({
      origin(origen, callback) {
        // Sin cabecera Origin: peticiones del mismo servidor, curl o health
        // checks. No son navegadores, así que CORS no aplica.
        if (!origen) return callback(null, true)
        if (env.CORS_ORIGINS.includes(origen)) return callback(null, true)

        logger.warn({ origen }, 'Origen bloqueado por CORS')
        return callback(null, false)
      },
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  )

  // Límite de tamaño: sin él, una petición gigante puede agotar la memoria del
  // proceso. Las imágenes (logo, firma) irán por su propia ruta de subida.
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(cookieParser())

  // --- Consultorio ----------------------------------------------------------
  // Antes que la sesión: cargarla ya consulta la base, y hay que saber cuál.
  app.use(resolverConsultorio)

  // --- Sesión ---------------------------------------------------------------
  // Va ANTES del límite de peticiones a propósito: así el límite general puede
  // aplicarse por usuario autenticado en vez de por IP (ver middleware/limites).
  app.use(cargarSesion)
  app.use('/api', limiteGeneral)

  // --- Rutas ----------------------------------------------------------------
  for (const modulo of MODULOS_DE_RUTAS) {
    app.use(modulo.prefijo, modulo.router)
  }

  // --- Cierre ---------------------------------------------------------------
  // Estos dos van siempre al final: Express elige el primer manejador que
  // coincide, y el de errores debe ver todo lo que lanzaron los anteriores.
  app.use(manejadorNoEncontrado)
  app.use(manejadorErrores)

  return app
}
