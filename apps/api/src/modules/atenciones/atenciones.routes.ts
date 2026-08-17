/**
 * Rutas de atención en consultorio.
 */

import {
  esquemaAddendum,
  esquemaBuscarCie10,
  esquemaGuardarAtencion,
  esquemaIniciarAtencion,
  esquemaSignosVitales,
} from '@consultorio/shared'
import { Router, type Request, type RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './atenciones.service.js'

export const rutasAtenciones: Router = Router()

rutasAtenciones.use(requiereAutenticacion)

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

const iniciar: RequestHandler = async (req, res) => {
  const { citaId } = esquemaIniciarAtencion.parse(req.body)
  const atencion = await servicio.iniciar(contexto(req), citaId, cliente(req))
  res.status(201).json({ atencion })
}

const ver: RequestHandler = async (req, res) => {
  res.json({ atencion: await servicio.ver(contexto(req), id(req), cliente(req)) })
}

const guardar: RequestHandler = async (req, res) => {
  const datos = esquemaGuardarAtencion.parse(req.body)
  res.json({ atencion: await servicio.guardar(contexto(req), id(req), datos, cliente(req)) })
}

const guardarSignosVitales: RequestHandler = async (req, res) => {
  const vitales = esquemaSignosVitales.parse(req.body)
  res.json(await servicio.guardarSignosVitales(contexto(req), id(req), vitales, cliente(req)))
}

const completar: RequestHandler = async (req, res) => {
  res.json({ atencion: await servicio.completar(contexto(req), id(req), cliente(req)) })
}

const addendum: RequestHandler = async (req, res) => {
  const { contenido, motivo } = esquemaAddendum.parse(req.body)
  const atencion = await servicio.agregarAddendum(
    contexto(req),
    id(req),
    contenido,
    motivo || undefined,
    cliente(req),
  )
  res.status(201).json({ atencion })
}

const historial: RequestHandler = async (req, res) => {
  const atenciones = await servicio.historialDePaciente(
    contexto(req),
    req.params['pacienteId'] as string,
    cliente(req),
  )
  res.json({ atenciones })
}

const buscarCie10: RequestHandler = async (req, res) => {
  const { q, limite } = esquemaBuscarCie10.parse(req.query)
  res.json({ codigos: await servicio.buscarCie10(contexto(req), q, limite) })
}

// Las rutas fijas van antes que `/:id`.
rutasAtenciones.get('/cie10', requierePermiso('encounter:read'), buscarCie10)
rutasAtenciones.get('/paciente/:pacienteId', requierePermiso('encounter:read'), historial)

rutasAtenciones.post('/', requierePermiso('encounter:create'), iniciar)

rutasAtenciones.get('/:id', requierePermiso('encounter:read'), ver)
rutasAtenciones.patch('/:id', requierePermiso('encounter:update'), guardar)
rutasAtenciones.patch('/:id/signos-vitales', requierePermiso('encounter:vitals'), guardarSignosVitales)
rutasAtenciones.post('/:id/completar', requierePermiso('encounter:complete'), completar)
rutasAtenciones.post('/:id/addendum', requierePermiso('encounter:addendum'), addendum)
