/**
 * Aplica las migraciones pendientes antes de aceptar tráfico.
 *
 * SE MIGRAN TODAS LAS BASES, una por consultorio. Con un solo despliegue
 * sirviendo a varios, migrar únicamente `DATABASE_URL` dejaría al resto con el
 * esquema viejo: arrancarían bien y fallarían en la primera consulta que usara
 * una columna nueva.
 *
 * Se ejecuta `prisma migrate deploy`, que solo aplica lo pendiente y no genera
 * nada. Es idempotente: si no hay migraciones nuevas, no toca la base.
 *
 * SI UNA FALLA, EL PROCESO NO ARRANCA. Un servidor sirviendo un esquema a
 * medio migrar corrompe datos de forma silenciosa, y en una historia clínica
 * eso no se puede permitir; es preferible que el despliegue se marque como
 * fallido y quede la versión anterior en pie.
 *
 * Por esto el CLI de Prisma es una dependencia de PRODUCCIÓN y no de
 * desarrollo: como devDependency, `pnpm prune --prod` lo dejaba fuera de la
 * imagen y el fallo solo aparecía dentro del contenedor.
 */

import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { consultorios } from '../config/consultorios.js'
import { logger } from '../core/logger.js'

const ejecutar = promisify(execFile)

/**
 * Ruta al CLI de Prisma.
 *
 * Se resuelve como lo haría un `import`, no armando una ruta relativa al
 * directorio de trabajo: pnpm coloca los paquetes en `.pnpm` y enlaza, y el
 * proceso puede arrancar desde cualquier sitio.
 */
function cliDePrisma(): string {
  return createRequire(import.meta.url).resolve('prisma/build/index.js')
}

/**
 * Ruta al esquema, relativa a este archivo compilado
 * (`apps/api/dist/arranque/`), porque Prisma lo busca desde el directorio de
 * trabajo y ahí no está.
 */
function esquema(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma/schema.prisma')
}

export async function migrarTodasLasBases(): Promise<void> {
  const cli = cliDePrisma()
  const rutaEsquema = esquema()

  for (const consultorio of consultorios) {
    logger.info({ consultorio: consultorio.clave }, 'Aplicando migraciones')

    try {
      const { stdout } = await ejecutar(
        process.execPath,
        [cli, 'migrate', 'deploy', '--schema', rutaEsquema],
        {
          env: { ...process.env, DATABASE_URL: consultorio.baseDeDatos },
          // Un minuto es de sobra: si tarda más, algo va mal —una migración
          // bloqueada por una transacción abierta, por ejemplo— y conviene
          // enterarse ahora y no con el despliegue colgado.
          timeout: 60_000,
        },
      )

      logger.info(
        { consultorio: consultorio.clave, detalle: resumir(stdout) },
        'Migraciones al día',
      )
    } catch (error) {
      logger.error(
        { consultorio: consultorio.clave, err: error },
        'No se pudieron aplicar las migraciones: el proceso no arranca',
      )
      throw error
    }
  }
}

/** La última línea con contenido: es donde Prisma dice qué hizo. */
function resumir(salida: string): string {
  const lineas = salida
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return lineas.at(-1) ?? ''
}
