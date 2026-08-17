/**
 * Cliente de base de datos.
 *
 * Una sola instancia para todo el proceso: cada `new PrismaClient()` abre su
 * propio pool de conexiones, y varios pools agotan los `max_connections` de
 * PostgreSQL sin que nada lo advierta hasta que la clínica está llena.
 *
 * En desarrollo se guarda en `globalThis` para que el recargado en caliente de
 * tsx no acumule una instancia por cada vez que se guarda un archivo.
 */

import { PrismaClient } from '@prisma/client'
import { esDesarrollo, esPrueba } from '../config/env.js'
import { logger } from './logger.js'

const almacenGlobal = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  almacenGlobal.prisma ??
  new PrismaClient({
    log: esDesarrollo ? ['warn', 'error'] : ['error'],
  })

if (esDesarrollo) almacenGlobal.prisma = prisma

/** Comprueba que la base responde. La usa el endpoint de salud. */
export async function baseDeDatosResponde(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch (error) {
    if (!esPrueba) logger.error({ err: error }, 'La base de datos no responde')
    return false
  }
}

export async function desconectarBaseDeDatos(): Promise<void> {
  await prisma.$disconnect()
}
