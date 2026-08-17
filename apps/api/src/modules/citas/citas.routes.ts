/**
 * Rutas de citas.
 */

import {
  esquemaActualizarCita,
  esquemaCancelar,
  esquemaConsultaCitas,
  esquemaCrearCita,
  esquemaReprogramar,
} from '@consultorio/shared'
import { Router, type Request, type RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './citas.service.js'

export const rutasCitas: Router = Router()

rutasCitas.use(requiereAutenticacion)

function contexto(req: Request) {
  if (!req.auth) throw new ErrorNoAutenticado()
  return req.auth
}

function cliente(req: Request): servicio.DatosCliente {
  return {
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
  }
}

const id = (req: Request) => req.params['id'] as string

const listar: RequestHandler = async (req, res) => {
  const filtros = esquemaConsultaCitas.parse(req.query)
  res.json(await servicio.listar(contexto(req), filtros))
}

const salaDeEspera: RequestHandler = async (req, res) => {
  const medicoId = typeof req.query['medicoId'] === 'string' ? req.query['medicoId'] : undefined
  res.json({ citas: await servicio.salaDeEspera(contexto(req), medicoId) })
}

const verCita: RequestHandler = async (req, res) => {
  res.json({ cita: await servicio.porId(contexto(req), id(req)) })
}

const crear: RequestHandler = async (req, res) => {
  const datos = esquemaCrearCita.parse(req.body)
  res.status(201).json({ cita: await servicio.crear(contexto(req), datos, cliente(req)) })
}

const actualizar: RequestHandler = async (req, res) => {
  const datos = esquemaActualizarCita.parse(req.body)
  res.json({ cita: await servicio.actualizar(contexto(req), id(req), datos, cliente(req)) })
}

const reprogramar: RequestHandler = async (req, res) => {
  const datos = esquemaReprogramar.parse(req.body)
  res.json({ cita: await servicio.reprogramar(contexto(req), id(req), datos, cliente(req)) })
}

const cancelar: RequestHandler = async (req, res) => {
  const { motivo, origen } = esquemaCancelar.parse(req.body)
  res.json({ cita: await servicio.cancelar(contexto(req), id(req), motivo, origen, cliente(req)) })
}

const confirmar: RequestHandler = async (req, res) => {
  res.json({ cita: await servicio.confirmar(contexto(req), id(req), cliente(req)) })
}

const registrarLlegada: RequestHandler = async (req, res) => {
  res.json({ cita: await servicio.registrarLlegada(contexto(req), id(req), cliente(req)) })
}

const marcarInasistencia: RequestHandler = async (req, res) => {
  res.json({ cita: await servicio.marcarInasistencia(contexto(req), id(req), cliente(req)) })
}

const proximasDePaciente: RequestHandler = async (req, res) => {
  const citas = await servicio.proximasDePaciente(contexto(req), req.params['pacienteId'] as string)
  res.json({ citas })
}

// Las rutas fijas van antes que `/:id`, o Express las tomaría por identificadores.
rutasCitas.get('/sala-de-espera', requierePermiso('appointment:read'), salaDeEspera)
rutasCitas.get('/paciente/:pacienteId', requierePermiso('appointment:read'), proximasDePaciente)

rutasCitas.get('/', requierePermiso('appointment:read'), listar)
rutasCitas.post('/', requierePermiso('appointment:create'), crear)

rutasCitas.get('/:id', requierePermiso('appointment:read'), verCita)
rutasCitas.patch('/:id', requierePermiso('appointment:update'), actualizar)

rutasCitas.post('/:id/reprogramar', requierePermiso('appointment:reschedule'), reprogramar)
rutasCitas.post('/:id/cancelar', requierePermiso('appointment:cancel'), cancelar)
rutasCitas.post('/:id/confirmar', requierePermiso('appointment:update'), confirmar)
rutasCitas.post('/:id/llegada', requierePermiso('appointment:checkin'), registrarLlegada)
rutasCitas.post('/:id/no-asistio', requierePermiso('appointment:update'), marcarInasistencia)
