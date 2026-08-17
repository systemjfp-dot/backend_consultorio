/**
 * Rutas de pacientes.
 *
 * La auditoría de lectura NO se pone aquí con `auditarAcceso`, sino dentro del
 * service: solo debe registrarse la apertura de una ficha completa, no cada
 * pulsación del buscador. Un middleware por ruta no puede distinguir ambos
 * casos, y anotar cada búsqueda ahogaría en ruido los accesos que importan.
 */

import {
  esquemaActualizarPaciente,
  esquemaBuscarPacientes,
  esquemaConsultaDocumento,
  esquemaCrearPaciente,
} from '@consultorio/shared'
import { Router, type Request, type RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { limiteEnvios } from '../../middleware/limites.js'
import { requierePermiso } from '../../middleware/permisos.js'
import * as servicio from './pacientes.service.js'

export const rutasPacientes: Router = Router()

rutasPacientes.use(requiereAutenticacion)

function datosCliente(req: Request): servicio.DatosCliente {
  return {
    ...(req.ip ? { ip: req.ip } : {}),
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
  }
}

function contexto(req: Request) {
  if (!req.auth) throw new ErrorNoAutenticado()
  return req.auth
}

const buscar: RequestHandler = async (req, res) => {
  const { q, pagina, porPagina } = esquemaBuscarPacientes.parse(req.query)
  res.json(await servicio.buscar(contexto(req), q, pagina, porPagina))
}

const verFicha: RequestHandler = async (req, res) => {
  const paciente = await servicio.verFicha(
    contexto(req),
    req.params['id'] as string,
    datosCliente(req),
  )
  res.json({ paciente })
}

const registrar: RequestHandler = async (req, res) => {
  const datos = esquemaCrearPaciente.parse(req.body)
  const resultado = await servicio.registrar(contexto(req), datos, datosCliente(req))

  // 200 y no 201 cuando ya existía: no se creó nada. La interfaz distingue por
  // `estado` y lleva a la ficha existente en lugar de mostrar un error, que es
  // lo que pide el requisito 3.1.
  res.status(resultado.estado === 'creado' ? 201 : 200).json(resultado)
}

const actualizar: RequestHandler = async (req, res) => {
  const datos = esquemaActualizarPaciente.parse(req.body)
  const paciente = await servicio.actualizar(
    contexto(req),
    req.params['id'] as string,
    datos,
    datosCliente(req),
  )
  res.json({ paciente })
}

const darDeBaja: RequestHandler = async (req, res) => {
  await servicio.darDeBaja(contexto(req), req.params['id'] as string, datosCliente(req))
  res.status(204).end()
}

const reactivar: RequestHandler = async (req, res) => {
  const paciente = await servicio.reactivar(
    contexto(req),
    req.params['id'] as string,
    datosCliente(req),
  )
  res.json({ paciente })
}

const consultarDocumento: RequestHandler = async (req, res) => {
  const { tipoDocumento, documento } = esquemaConsultaDocumento.parse(req.query)
  res.json(
    await servicio.consultarDocumento(contexto(req), tipoDocumento, documento, datosCliente(req)),
  )
}

// --- Registro de rutas -------------------------------------------------------
// La consulta de documento va ANTES de `/:id`, o Express interpretaría
// "consulta-documento" como un identificador de paciente.

rutasPacientes.get(
  '/consulta-documento',
  requierePermiso('patient:create'),
  // Cada consulta cuesta dinero al proveedor externo. El límite evita que un
  // fallo del frontend —o alguien curioseando— dispare la factura.
  limiteEnvios,
  consultarDocumento,
)

rutasPacientes.get('/', requierePermiso('patient:read'), buscar)
rutasPacientes.post('/', requierePermiso('patient:create'), registrar)

rutasPacientes.get('/:id', requierePermiso('patient:read'), verFicha)
rutasPacientes.patch('/:id', requierePermiso('patient:update'), actualizar)
rutasPacientes.delete('/:id', requierePermiso('patient:delete'), darDeBaja)
rutasPacientes.post('/:id/reactivar', requierePermiso('patient:delete'), reactivar)
