/**
 * Rutas de configuración de agenda: sedes, horarios, excepciones y huecos.
 *
 * Las citas viven en su propio módulo (H2.2). Aquí está lo que define CUÁNDO
 * se puede atender; allí, lo que se agenda dentro de esas horas.
 */

import {
  esquemaConsultaDisponibilidad,
  esquemaExcepcion,
  esquemaHorario,
  esquemaSede,
} from '@consultorio/shared'
import { Router, type Request, type RequestHandler } from 'express'
import { z } from 'zod'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './agenda.service.js'

export const rutasAgenda: Router = Router()

rutasAgenda.use(requiereAutenticacion)

function contexto(req: Request) {
  if (!req.auth) throw new ErrorNoAutenticado()
  return req.auth
}

function datosCliente(req: Request): servicio.DatosCliente {
  return {
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
  }
}

// --- Médicos ------------------------------------------------------------------

const listarMedicos: RequestHandler = async (req, res) => {
  res.json({ medicos: await servicio.listarMedicos(contexto(req)) })
}

// --- Sedes --------------------------------------------------------------------

const listarSedes: RequestHandler = async (req, res) => {
  res.json({ sedes: await servicio.listarSedes(contexto(req)) })
}

const crearSede: RequestHandler = async (req, res) => {
  const datos = esquemaSede.parse(req.body)
  res.status(201).json({ sede: await servicio.crearSede(contexto(req), datos, datosCliente(req)) })
}

const actualizarSede: RequestHandler = async (req, res) => {
  const datos = esquemaSede.partial().extend({ activa: z.boolean().optional() }).parse(req.body)
  const sede = await servicio.actualizarSede(contexto(req), req.params['id'] as string, datos)
  res.json({ sede })
}

// --- Horarios -----------------------------------------------------------------

const listarHorarios: RequestHandler = async (req, res) => {
  const medicoId = typeof req.query['medicoId'] === 'string' ? req.query['medicoId'] : undefined
  res.json({ horarios: await servicio.listarHorarios(contexto(req), medicoId) })
}

const crearHorario: RequestHandler = async (req, res) => {
  const datos = esquemaHorario.parse(req.body)
  const horario = await servicio.crearHorario(contexto(req), datos, datosCliente(req))
  res.status(201).json({ horario })
}

const eliminarHorario: RequestHandler = async (req, res) => {
  await servicio.eliminarHorario(contexto(req), req.params['id'] as string, datosCliente(req))
  res.status(204).end()
}

// --- Excepciones --------------------------------------------------------------

const listarExcepciones: RequestHandler = async (req, res) => {
  const medicoId = typeof req.query['medicoId'] === 'string' ? req.query['medicoId'] : undefined
  const desde = typeof req.query['desde'] === 'string' ? req.query['desde'] : undefined
  res.json({ excepciones: await servicio.listarExcepciones(contexto(req), medicoId, desde) })
}

const crearExcepcion: RequestHandler = async (req, res) => {
  const datos = esquemaExcepcion.parse(req.body)
  const excepcion = await servicio.crearExcepcion(contexto(req), datos, datosCliente(req))
  res.status(201).json({ excepcion })
}

const eliminarExcepcion: RequestHandler = async (req, res) => {
  await servicio.eliminarExcepcion(contexto(req), req.params['id'] as string)
  res.status(204).end()
}

// --- Disponibilidad -----------------------------------------------------------

const disponibilidad: RequestHandler = async (req, res) => {
  const { medicoId, fecha, duracionMinutos } = esquemaConsultaDisponibilidad.parse(req.query)
  res.json(await servicio.disponibilidadDelDia(contexto(req), medicoId, fecha, duracionMinutos))
}

// --- Registro -----------------------------------------------------------------

rutasAgenda.get('/medicos', requierePermiso('appointment:read'), listarMedicos)

rutasAgenda.get('/sedes', requierePermiso('appointment:read'), listarSedes)
rutasAgenda.post('/sedes', requierePermiso('location:manage'), crearSede)
rutasAgenda.patch('/sedes/:id', requierePermiso('location:manage'), actualizarSede)

rutasAgenda.get('/horarios', requierePermiso('appointment:read'), listarHorarios)
rutasAgenda.post('/horarios', requierePermiso('schedule:manage'), crearHorario)
rutasAgenda.delete('/horarios/:id', requierePermiso('schedule:manage'), eliminarHorario)

rutasAgenda.get('/excepciones', requierePermiso('appointment:read'), listarExcepciones)
rutasAgenda.post('/excepciones', requierePermiso('schedule:manage'), crearExcepcion)
rutasAgenda.delete('/excepciones/:id', requierePermiso('schedule:manage'), eliminarExcepcion)

rutasAgenda.get('/disponibilidad', requierePermiso('appointment:read'), disponibilidad)
