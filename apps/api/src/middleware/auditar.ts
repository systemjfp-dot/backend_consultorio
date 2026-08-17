/**
 * Registro automático de accesos.
 *
 * Escribir la auditoría a mano en cada controlador garantiza que tarde o
 * temprano alguien la olvide justo en el endpoint que importaba. Este
 * middleware la ata a la RUTA, de modo que quien añade un endpoint clínico
 * declara su auditoría en la misma línea en que declara su permiso.
 *
 * Se registra DESPUÉS de responder y solo si la respuesta fue correcta: un 403
 * o un 404 no son un acceso a datos clínicos, y anotarlos como si lo fueran
 * llenaría el registro de ruido que oculta los accesos reales.
 */

import type { AuditAction } from '@prisma/client'
import type { RequestHandler } from 'express'
import { registrarAuditoria } from '../core/auditoria.js'

export interface OpcionesAuditoria {
  /** Parámetro de ruta del que sale el id del registro. Por defecto, `id`. */
  parametroId?: string
  /** Permiso que autorizó la operación. Enriquece la revisión posterior. */
  permiso?: string
}

/**
 * Registra el acceso cuando la petición termina bien.
 *
 * Uso:
 *   router.get('/:id', requierePermiso('encounter:read'),
 *              auditarAcceso('Attendance', 'VIEW'), controlador.ver)
 */
export function auditarAcceso(
  entidad: string,
  accion: AuditAction,
  opciones: OpcionesAuditoria = {},
): RequestHandler {
  const parametroId = opciones.parametroId ?? 'id'

  return (req, res, next) => {
    res.on('finish', () => {
      // Solo los accesos efectivos. Un intento rechazado ya deja rastro por
      // otras vías (el log de la aplicación, el límite de peticiones).
      if (res.statusCode >= 400) return

      // Un parámetro repetido llega como arreglo; solo se registra si es un
      // identificador simple, que es lo único que tiene sentido auditar.
      const valorParametro = req.params[parametroId]
      const entidadId = typeof valorParametro === 'string' ? valorParametro : undefined

      // No se espera al resultado: la respuesta ya se envió y la escritura de
      // auditoría nunca debe retrasar ni tumbar la operación del usuario.
      void registrarAuditoria({
        accion,
        entidad,
        ...(entidadId ? { entidadId } : {}),
        ...(req.auth
          ? {
              usuarioId: req.auth.usuarioId,
              usuarioEmail: req.auth.email,
              roles: req.auth.roles,
            }
          : {}),
        ...(opciones.permiso ? { permiso: opciones.permiso } : {}),
        ...(req.ip ? { ip: req.ip } : {}),
        ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
      })
    })

    next()
  }
}
