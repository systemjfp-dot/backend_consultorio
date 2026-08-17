/**
 * Rutas de acceso de emergencia.
 */

import { esquemaAccesoEmergencia } from '@consultorio/shared'
import { Router, type RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './emergencia.service.js'

export const rutasEmergencia: Router = Router()

rutasEmergencia.use(requiereAutenticacion)

const conceder: RequestHandler = async (req, res) => {
  if (!req.auth) throw new ErrorNoAutenticado()

  const { motivo } = esquemaAccesoEmergencia.parse(req.body)
  const pacienteId = req.params['pacienteId'] as string

  const { expiraEn } = await servicio.concederAcceso(req.auth, pacienteId, motivo, {
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
  })

  res.json({
    mensaje: 'Acceso de emergencia concedido. Queda registrado en la auditoría.',
    expiraEn,
    minutosDeVigencia: servicio.MINUTOS_DE_VIGENCIA,
  })
}

rutasEmergencia.post(
  '/pacientes/:pacienteId',
  requierePermiso('patient:break_glass'),
  conceder,
)

rutasEmergencia.get(
  '/recientes',
  requierePermiso('audit:read'),
  async (_req, res) => {
    res.json({ accesos: await servicio.listarAccesosRecientes() })
  },
)
