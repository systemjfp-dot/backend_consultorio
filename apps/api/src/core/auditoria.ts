/**
 * Registro de auditoría.
 *
 * Requisito legal (Ley 30024 / RENHICE y Ley 29733): el acceso a historias
 * clínicas electrónicas debe quedar trazado. La tabla es inmutable por trigger
 * en la base, así que ni siquiera esta aplicación puede alterar lo escrito.
 *
 * Aquí está el mínimo que necesita el módulo de autenticación. El registro
 * automático de accesos clínicos y el panel de consulta llegan en H0.7; esta
 * función es la costura por donde crecerá.
 */

import type { AuditAction, Prisma, Role } from '@prisma/client'
import { logger } from './logger.js'
import { prisma } from './prisma.js'

export interface DatosAuditoria {
  accion: AuditAction
  entidad: string
  entidadId?: string
  usuarioId?: string
  /** Correo TAL COMO ERA en este momento. La tabla no tiene clave foránea a
   *  User: debe poder leerse aunque esa cuenta ya no exista. */
  usuarioEmail?: string
  /** Roles efectivos EN ESE MOMENTO: el rol del usuario puede cambiar después. */
  roles?: Role[]
  permiso?: string
  /** Obligatorio cuando la acción es BREAK_GLASS. */
  motivo?: string
  cambios?: Prisma.InputJsonValue
  ip?: string
  userAgent?: string
}

/**
 * Escribe una entrada de auditoría.
 *
 * Nunca lanza: que falle el registro no debe tumbar la operación que el
 * usuario estaba haciendo. Un médico no puede quedarse sin guardar una
 * atención porque la tabla de auditoría tuvo un problema. El fallo se registra
 * como error para que se note en el monitoreo.
 */
export async function registrarAuditoria(datos: DatosAuditoria): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: datos.accion,
        entity: datos.entidad,
        entityId: datos.entidadId ?? null,
        userId: datos.usuarioId ?? null,
        userEmail: datos.usuarioEmail ?? null,
        roles: datos.roles ?? [],
        permission: datos.permiso ?? null,
        reason: datos.motivo ?? null,
        changes: datos.cambios,
        ipAddress: datos.ip ?? null,
        userAgent: datos.userAgent ?? null,
      },
    })
  } catch (error) {
    logger.error(
      { err: error, accion: datos.accion, entidad: datos.entidad },
      'No se pudo escribir en la auditoría',
    )
  }
}

// =============================================================================
//  Mantenimiento de particiones
// =============================================================================
//
//  La tabla está particionada por mes y las particiones viven en el esquema
//  `auditoria` (ver la migración 20260817003000). La migración creó 24 meses;
//  esta función va añadiendo los siguientes para que nunca se agoten.
//
//  Existe una partición DEFAULT como red de seguridad: sin ella, un INSERT con
//  una fecha sin partición fallaría y se perdería el registro de auditoría, o
//  peor, se caería la operación que lo generó.

/** Meses por adelantado que se mantienen siempre creados. */
const MESES_POR_ADELANTADO = 6

/**
 * Crea las particiones mensuales que falten. Es idempotente, así que puede
 * llamarse en cada arranque sin comprobaciones previas.
 */
export async function asegurarParticionesAuditoria(): Promise<number> {
  let creadas = 0

  for (let i = 0; i <= MESES_POR_ADELANTADO; i++) {
    const desde = new Date()
    desde.setUTCDate(1)
    desde.setUTCHours(0, 0, 0, 0)
    desde.setUTCMonth(desde.getUTCMonth() + i)

    const hasta = new Date(desde)
    hasta.setUTCMonth(hasta.getUTCMonth() + 1)

    const nombre = `AuditLog_${desde.getUTCFullYear()}_${String(desde.getUTCMonth() + 1).padStart(2, '0')}`

    try {
      // Los valores son fechas calculadas aquí, no entradas del usuario.
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS auditoria."${nombre}"
         PARTITION OF public."AuditLog"
         FOR VALUES FROM ('${desde.toISOString()}') TO ('${hasta.toISOString()}')`,
      )
      creadas++
    } catch (error) {
      // Que falle una partición futura no debe impedir arrancar: la partición
      // DEFAULT recoge cualquier fila mientras tanto.
      logger.error({ err: error, particion: nombre }, 'No se pudo crear la partición de auditoría')
    }
  }

  return creadas
}

/**
 * Estado de las particiones, para el panel de administración.
 *
 * Vigilar la partición `AuditLog_resto` importa: que reciba filas significa
 * que faltó crear la partición del mes, y una vez tiene datos de ese mes ya no
 * se puede crear su partición sin moverlos primero.
 */
export async function estadoParticiones(): Promise<
  { particion: string; filas: number; tamano: string }[]
> {
  return prisma.$queryRaw`
    SELECT
      c.relname::text                                   AS particion,
      COALESCE(s.n_live_tup, 0)::int                    AS filas,
      pg_size_pretty(pg_total_relation_size(c.oid))     AS tamano
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'auditoria'
    ORDER BY c.relname
  `
}
