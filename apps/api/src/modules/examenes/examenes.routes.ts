/**
 * Rutas de órdenes de examen auxiliar.
 */

import { esquemaBuscarExamen, esquemaOrdenExamen, esquemaResultado } from '@consultorio/shared'
import express, { Router, type Request, type RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './examenes.service.js'

export const rutasExamenes: Router = Router()

rutasExamenes.use(requiereAutenticacion)

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

const ordenar: RequestHandler = async (req, res) => {
  const datos = esquemaOrdenExamen.parse(req.body)
  res.status(201).json(await servicio.ordenar(contexto(req), datos, cliente(req)))
}

const emitirPdf: RequestHandler = async (req, res) => {
  res.json(await servicio.generarPdf(contexto(req), id(req), cliente(req)))
}

const descargarPdf: RequestHandler = async (req, res) => {
  const { contenido, nombre } = await servicio.descargarPdf(contexto(req), id(req), cliente(req))

  res.type('application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`)
  res.send(contenido)
}

const registrarResultado: RequestHandler = async (req, res) => {
  const { texto } = esquemaResultado.parse(req.body)
  const examen = await servicio.registrarResultado(
    contexto(req),
    id(req),
    texto || undefined,
    cliente(req),
  )
  res.json({ examen })
}

/**
 * Adjunta el PDF del laboratorio.
 *
 * Se recibe el archivo como cuerpo crudo en vez de multipart: el navegador
 * puede enviar el `File` directamente y no hace falta una librería de parseo
 * para un solo archivo sin campos que lo acompañen.
 */
const adjuntarResultado: RequestHandler = async (req, res) => {
  const examen = await servicio.adjuntarResultado(
    contexto(req),
    id(req),
    req.body as Buffer,
    cliente(req),
  )
  res.json({ examen })
}

const descargarResultado: RequestHandler = async (req, res) => {
  const { contenido, nombre } = await servicio.descargarResultado(
    contexto(req),
    id(req),
    cliente(req),
  )

  res.type('application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`)
  res.send(contenido)
}

const deAtencion: RequestHandler = async (req, res) => {
  const examenes = await servicio.deAtencion(contexto(req), req.params['atencionId'] as string)
  res.json({ examenes })
}

const dePaciente: RequestHandler = async (req, res) => {
  const examenes = await servicio.dePaciente(contexto(req), req.params['pacienteId'] as string)
  res.json({ examenes })
}

const ver: RequestHandler = async (req, res) => {
  res.json({ examen: await servicio.porId(contexto(req), id(req)) })
}

const buscarCatalogo: RequestHandler = async (req, res) => {
  const { q, tipo, limite } = esquemaBuscarExamen.parse(req.query)
  res.json({ examenes: await servicio.buscarEnCatalogo(contexto(req), q, tipo, limite) })
}

// Las rutas fijas van antes que `/:id`.
rutasExamenes.get('/catalogo', requierePermiso('exam:create'), buscarCatalogo)
rutasExamenes.get('/atencion/:atencionId', requierePermiso('exam:read'), deAtencion)
rutasExamenes.get('/paciente/:pacienteId', requierePermiso('exam:read'), dePaciente)

rutasExamenes.post('/', requierePermiso('exam:create'), ordenar)

rutasExamenes.get('/:id', requierePermiso('exam:read'), ver)
rutasExamenes.post('/:id/emitir', requierePermiso('exam:create'), emitirPdf)
rutasExamenes.get('/:id/pdf', requierePermiso('exam:print'), descargarPdf)

rutasExamenes.post('/:id/resultado', requierePermiso('exam:result_upload'), registrarResultado)
rutasExamenes.post(
  '/:id/resultado/archivo',
  requierePermiso('exam:result_upload'),
  // 10 MB: un informe de imagenología con placas pesa bastante más que un
  // hemograma, y rechazarlo obligaría a enviarlo por otra vía sin trazabilidad.
  express.raw({ type: 'application/pdf', limit: '10mb' }),
  adjuntarResultado,
)
rutasExamenes.get('/:id/resultado/archivo', requierePermiso('exam:read'), descargarResultado)
