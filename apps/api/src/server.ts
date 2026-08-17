/**
 * Arranque y apagado del proceso.
 *
 * Solo se ocupa del ciclo de vida; la aplicación se construye en `app.ts`.
 */

import { crearApp } from './app.js'
import { env } from './config/env.js'
import { asegurarParticionesAuditoria } from './core/auditoria.js'
import { logger } from './core/logger.js'
import { desconectarBaseDeDatos } from './core/prisma.js'

const app = crearApp()

// Las particiones de auditoría se crean por adelantado en cada arranque. Es
// idempotente y barato, y evita depender de una tarea programada para algo que
// si falta hace caer los registros en la partición de resto.
await asegurarParticionesAuditoria().catch((error: unknown) => {
  logger.error({ err: error }, 'No se pudieron asegurar las particiones de auditoría')
})

const servidor = app.listen(env.PORT, () => {
  logger.info(
    { puerto: env.PORT, entorno: env.NODE_ENV },
    `API escuchando en http://localhost:${env.PORT}`,
  )
})

/**
 * Apagado ordenado.
 *
 * Importa más de lo que parece: sin esto, un despliegue corta a mitad de
 * camino las peticiones en vuelo. Si una de ellas estaba guardando una
 * atención médica, el médico ve un error y no sabe si se guardó.
 *
 * El plazo máximo evita que una conexión colgada impida el reinicio para
 * siempre.
 */
let apagando = false

async function apagar(senal: string): Promise<void> {
  if (apagando) return
  apagando = true

  logger.info({ senal }, 'Apagando: se dejan terminar las peticiones en curso')

  const plazoMaximo = setTimeout(() => {
    logger.error('El apagado ordenado excedió los 10 s; se fuerza la salida')
    process.exit(1)
  }, 10_000)
  plazoMaximo.unref()

  servidor.close(async () => {
    await desconectarBaseDeDatos()
    logger.info('Apagado completo')
    process.exit(0)
  })
}

process.on('SIGTERM', () => void apagar('SIGTERM'))
process.on('SIGINT', () => void apagar('SIGINT'))

// Un error no capturado deja el proceso en estado desconocido: se registra y
// se sale para que el orquestador levante una instancia limpia. Seguir
// sirviendo peticiones desde un proceso corrupto es peor que un reinicio.
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Excepción no capturada')
  process.exit(1)
})

process.on('unhandledRejection', (razon) => {
  logger.fatal({ err: razon }, 'Promesa rechazada sin manejar')
  process.exit(1)
})
