/**
 * Rutas de reportes.
 *
 * Las exportaciones se auditan como EXPORT: sacar el padrón de pacientes a un
 * archivo es precisamente la operación que hay que poder rastrear si esos
 * datos aparecen donde no deben.
 */

import { esquemaRangoReporte } from '@consultorio/shared'
import { Router, type Request, type RequestHandler } from 'express'
import { registrarAuditoria } from '../../core/auditoria.js'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './reportes.service.js'

export const rutasReportes: Router = Router()

rutasReportes.use(requiereAutenticacion)

function contexto(req: Request) {
  if (!req.auth) throw new ErrorNoAutenticado()
  return req.auth
}

const reporteCitas: RequestHandler = async (req, res) => {
  const filtros = esquemaRangoReporte.parse(req.query)
  res.json(await servicio.reporteCitas(contexto(req), filtros))
}

const reportePacientes: RequestHandler = async (req, res) => {
  const filtros = esquemaRangoReporte.parse(req.query)
  res.json(await servicio.reportePacientes(contexto(req), filtros))
}

function enviarCsv(res: Parameters<RequestHandler>[1], nombre: string, contenido: string) {
  res.type('text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
  res.send(contenido)
}

const citasCsv: RequestHandler = async (req, res) => {
  const filtros = esquemaRangoReporte.parse(req.query)
  const ctx = contexto(req)

  const contenido = await servicio.citasEnCsv(ctx, filtros)

  await registrarAuditoria({
    accion: 'EXPORT',
    entidad: 'Appointment',
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'report:appointments',
    motivo: `exportación de citas ${filtros.desde} a ${filtros.hasta}`,
    ...(req.ip ? { ip: req.ip } : {}),
  })

  enviarCsv(res, `citas-${filtros.desde}-a-${filtros.hasta}.csv`, contenido)
}

const pacientesCsv: RequestHandler = async (req, res) => {
  const filtros = esquemaRangoReporte.parse(req.query)
  const ctx = contexto(req)

  const contenido = await servicio.pacientesEnCsv(ctx, filtros)

  await registrarAuditoria({
    accion: 'EXPORT',
    entidad: 'Patient',
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'report:patients',
    motivo: `exportación de pacientes ${filtros.desde} a ${filtros.hasta}`,
    ...(req.ip ? { ip: req.ip } : {}),
  })

  enviarCsv(res, `pacientes-${filtros.desde}-a-${filtros.hasta}.csv`, contenido)
}

rutasReportes.get('/citas', requierePermiso('report:appointments'), reporteCitas)
rutasReportes.get('/citas.csv', requierePermiso('report:appointments'), citasCsv)
rutasReportes.get('/pacientes', requierePermiso('report:patients'), reportePacientes)
rutasReportes.get('/pacientes.csv', requierePermiso('report:patients'), pacientesCsv)
