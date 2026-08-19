/**
 * Cliente de base de datos.
 *
 * Un cliente por consultorio, y uno solo: cada `new PrismaClient()` abre su
 * propio pool de conexiones, y varios pools agotan los `max_connections` de
 * PostgreSQL sin que nada lo advierta hasta que la clínica está llena.
 *
 * CÓMO SE ELIGE EL CLIENTE. `prisma` no es una instancia, es un proxy que
 * delega en el cliente del consultorio que está siendo atendido, guardado en
 * un `AsyncLocalStorage` que abre el middleware `resolverConsultorio`. Se hizo
 * así por una razón concreta: 27 archivos hacen `import { prisma }` y lo usan
 * directamente. Pasarles el cliente por parámetro habría significado tocar
 * todos los repositorios, servicios y controladores del sistema —y confiar en
 * que nadie olvidara hacerlo nunca más—. Con el proxy, ninguno cambia.
 *
 * Fuera de una petición (seed, `pnpm setup`, pruebas, tareas de arranque) no
 * hay contexto y se usa el cliente por defecto, que es el de `DATABASE_URL`.
 *
 * En desarrollo los clientes se guardan en `globalThis` para que el recargado
 * en caliente de tsx no acumule una instancia por cada vez que se guarda un
 * archivo.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'
import { esDesarrollo, esPrueba } from '../config/env.js'
import {
  consultorioUnico,
  consultorios,
  type Consultorio,
} from '../config/consultorios.js'
import { logger } from './logger.js'

const almacenGlobal = globalThis as unknown as { clientesPrisma?: Map<string, PrismaClient> }

const clientes: Map<string, PrismaClient> = almacenGlobal.clientesPrisma ?? new Map()
if (esDesarrollo) almacenGlobal.clientesPrisma = clientes

function crearCliente(consultorio: Consultorio): PrismaClient {
  return new PrismaClient({
    log: esDesarrollo ? ['warn', 'error'] : ['error'],
    datasources: { db: { url: consultorio.baseDeDatos } },
  })
}

/** Cliente de un consultorio. Se crea la primera vez y se reutiliza siempre. */
export function clienteDe(consultorio: Consultorio): PrismaClient {
  let cliente = clientes.get(consultorio.clave)
  if (!cliente) {
    cliente = crearCliente(consultorio)
    clientes.set(consultorio.clave, cliente)
  }
  return cliente
}

// --- Consultorio en curso ----------------------------------------------------

export interface ConsultorioActivo {
  consultorio: Consultorio
  cliente: PrismaClient
}

const almacen = new AsyncLocalStorage<ConsultorioActivo>()

/**
 * Ejecuta `accion` con este consultorio como el activo.
 *
 * Todo lo que ocurra dentro —incluidos los `await` encadenados y los callbacks
 * registrados ahí dentro, como la auditoría diferida de `res.on('finish')`—
 * verá su cliente y no el de otro.
 */
export function conConsultorio<T>(consultorio: Consultorio, accion: () => T): T {
  return almacen.run({ consultorio, cliente: clienteDe(consultorio) }, accion)
}

/** El consultorio que se está atendiendo, si la llamada viene de una petición. */
export function consultorioActivo(): ConsultorioActivo | undefined {
  return almacen.getStore()
}

/**
 * Clave del consultorio en curso. Fuera de una petición, la del único.
 * La usan la carpeta de archivos y los cachés en memoria para no mezclarse.
 */
export function claveActiva(): string {
  return almacen.getStore()?.consultorio.clave ?? consultorioUnico.clave
}

function clienteActivo(): PrismaClient {
  return almacen.getStore()?.cliente ?? clienteDe(consultorioUnico)
}

// --- El cliente que ve el resto del sistema ----------------------------------

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_objetivo, propiedad) {
    const cliente = clienteActivo()
    const valor = cliente[propiedad as keyof PrismaClient]
    // Los métodos se atan a su cliente: `$transaction` y compañía usan `this`,
    // y desatados operarían sobre el proxy en lugar de sobre la conexión.
    return typeof valor === 'function' ? (valor as (...a: unknown[]) => unknown).bind(cliente) : valor
  },
  has(_objetivo, propiedad) {
    return propiedad in clienteActivo()
  },
})

// --- Ciclo de vida -----------------------------------------------------------

/** Comprueba que las bases responden. La usa el endpoint de salud. */
export async function baseDeDatosResponde(): Promise<boolean> {
  try {
    // Se comprueban TODAS: con un solo despliegue sirviendo a varios
    // consultorios, que responda el primero no dice nada del segundo.
    await Promise.all(consultorios.map((c) => clienteDe(c).$queryRaw`SELECT 1`))
    return true
  } catch (error) {
    if (!esPrueba) logger.error({ err: error }, 'La base de datos no responde')
    return false
  }
}

export async function desconectarBaseDeDatos(): Promise<void> {
  await Promise.all([...clientes.values()].map((cliente) => cliente.$disconnect()))
  clientes.clear()
}
