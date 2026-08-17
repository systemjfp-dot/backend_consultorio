/**
 * Panel de auditoría.
 *
 * Consultar la auditoría se audita también. Puede sonar recursivo, pero es
 * justo lo que se quiere: quien revisa quién vio qué, deja constancia de que
 * lo revisó. Sin eso, el rol AUDITOR sería el único punto ciego del sistema.
 */

import { esquemaConsultaAuditoria } from '@consultorio/shared'
import { Router, type RequestHandler } from 'express'
import { estadoParticiones } from '../../core/auditoria.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { auditarAcceso } from '../../middleware/auditar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './auditoria.service.js'

export const rutasAuditoria: Router = Router()

rutasAuditoria.use(requiereAutenticacion)

const consultar: RequestHandler = async (req, res) => {
  const filtros = esquemaConsultaAuditoria.parse(req.query)
  res.json(await servicio.consultar(filtros))
}

const historial: RequestHandler = async (req, res) => {
  const entidad = req.params['entidad'] as string
  const entidadId = req.params['entidadId'] as string

  res.json({ registros: await servicio.historialDeRegistro(entidad, entidadId) })
}

rutasAuditoria.get(
  '/',
  requierePermiso('audit:read'),
  auditarAcceso('AuditLog', 'VIEW', { permiso: 'audit:read' }),
  consultar,
)

/**
 * "¿Quién ha visto la historia de este paciente?" — la pregunta que hay que
 * poder responder ante un reclamo o una fiscalización.
 */
rutasAuditoria.get(
  '/registro/:entidad/:entidadId',
  requierePermiso('audit:read'),
  auditarAcceso('AuditLog', 'VIEW', { parametroId: 'entidadId', permiso: 'audit:read' }),
  historial,
)

/**
 * Estado de las particiones. Sirve para vigilar `AuditLog_resto`: que reciba
 * filas significa que faltó crear la partición de ese mes.
 */
rutasAuditoria.get('/particiones', requierePermiso('audit:read'), async (_req, res) => {
  res.json({ particiones: await estadoParticiones() })
})
