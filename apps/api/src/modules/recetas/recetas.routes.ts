/**
 * Rutas de recetas.
 */

import {
  esquemaBuscarMedicamento,
  esquemaCrearReceta,
  esquemaGuardarPlantilla,
} from '@consultorio/shared'
import { Router, type Request, type RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './recetas.service.js'

export const rutasRecetas: Router = Router()

rutasRecetas.use(requiereAutenticacion)

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

const crear: RequestHandler = async (req, res) => {
  const datos = esquemaCrearReceta.parse(req.body)
  res.status(201).json({ receta: await servicio.crear(contexto(req), datos, cliente(req)) })
}

const firmar: RequestHandler = async (req, res) => {
  const receta = await servicio.firmarYGenerarPdf(contexto(req), id(req), cliente(req))
  res.json({ receta })
}

const descargar: RequestHandler = async (req, res) => {
  const { contenido, nombre } = await servicio.descargarPdf(contexto(req), id(req), cliente(req))

  res.type('application/pdf')
  // `inline` y no `attachment`: en una tablet el flujo natural es ver la
  // receta y mandarla a imprimir, no descargar un archivo y buscarlo después.
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`)
  res.send(contenido)
}

const ver: RequestHandler = async (req, res) => {
  res.json({ receta: await servicio.porId(contexto(req), id(req)) })
}

const deAtencion: RequestHandler = async (req, res) => {
  const recetas = await servicio.deAtencion(contexto(req), req.params['atencionId'] as string)
  res.json({ recetas })
}

const dePaciente: RequestHandler = async (req, res) => {
  const recetas = await servicio.dePaciente(contexto(req), req.params['pacienteId'] as string)
  res.json({ recetas })
}

const listarPlantillas: RequestHandler = async (req, res) => {
  res.json({ plantillas: await servicio.listarPlantillas(contexto(req)) })
}

const guardarPlantilla: RequestHandler = async (req, res) => {
  const datos = esquemaGuardarPlantilla.parse(req.body)
  const plantilla = await servicio.guardarPlantilla(contexto(req), {
    nombre: datos.nombre,
    ...(datos.indicacionesGenerales ? { indicacionesGenerales: datos.indicacionesGenerales } : {}),
    medicamentos: datos.medicamentos,
  })
  res.status(201).json({ plantilla })
}

const eliminarPlantilla: RequestHandler = async (req, res) => {
  await servicio.eliminarPlantilla(contexto(req), id(req))
  res.status(204).end()
}

const buscarMedicamentos: RequestHandler = async (req, res) => {
  const { q, limite } = esquemaBuscarMedicamento.parse(req.query)
  res.json({ medicamentos: await servicio.buscarMedicamentos(contexto(req), q, limite) })
}

// Las rutas fijas van antes que `/:id`.
rutasRecetas.get('/medicamentos', requierePermiso('prescription:create'), buscarMedicamentos)
rutasRecetas.get('/plantillas', requierePermiso('prescription:create'), listarPlantillas)
rutasRecetas.post('/plantillas', requierePermiso('prescription:create'), guardarPlantilla)
rutasRecetas.delete('/plantillas/:id', requierePermiso('prescription:create'), eliminarPlantilla)

rutasRecetas.get('/atencion/:atencionId', requierePermiso('prescription:read'), deAtencion)
rutasRecetas.get('/paciente/:pacienteId', requierePermiso('prescription:read'), dePaciente)

rutasRecetas.post('/', requierePermiso('prescription:create'), crear)
rutasRecetas.get('/:id', requierePermiso('prescription:read'), ver)
rutasRecetas.post('/:id/firmar', requierePermiso('prescription:sign'), firmar)
rutasRecetas.get('/:id/pdf', requierePermiso('prescription:print'), descargar)
