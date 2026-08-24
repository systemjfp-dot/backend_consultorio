/**
 * Elige el consultorio de cada petición a partir del dominio.
 *
 * Va PRIMERO, antes que la sesión: cargar la sesión ya consulta la base, y sin
 * saber cuál es todavía consultaría la que no toca.
 *
 * UN DOMINIO DESCONOCIDO SE RECHAZA. Es tentador caer en el primer consultorio
 * configurado —"total, en desarrollo siempre es el mismo"— pero eso convierte
 * cualquier despiste de DNS o de proxy en una fuga: alguien entra por un
 * dominio equivocado y recibe la lista de pacientes de otra clínica. Preferimos
 * un error claro que nadie pueda confundir con normalidad.
 */

import type { RequestHandler } from 'express'
import { consultorioDeDominio, esMultiConsultorio } from '../config/consultorios.js'
import { conConsultorio } from '../core/prisma.js'

/**
 * Rutas que no pertenecen a ningún consultorio.
 *
 * El orquestador consulta la salud por una dirección interna que no es el
 * dominio de nadie. Sin esta excepción, el chequeo recibiría el 404 de dominio
 * desconocido, Railway daría el despliegue por fallido y reiniciaría en bucle
 * un contenedor que en realidad está perfectamente sano.
 *
 * No filtra nada: `/api/health` solo dice si el proceso vive, y
 * `/api/health/ready` comprueba TODAS las bases, no la de un consultorio.
 */
function esRutaSinConsultorio(ruta: string): boolean {
  return ruta === '/api/health' || ruta === '/api/health/ready'
}

export const resolverConsultorio: RequestHandler = (req, res, next) => {
  if (esRutaSinConsultorio(req.path)) return next()

  const dominio = req.hostname

  const consultorio = consultorioDeDominio(dominio)

  if (!consultorio) {
    req.log?.warn({ dominio }, 'Dominio sin consultorio configurado')
    res.status(404).json({
      error: {
        codigo: 'CONSULTORIO_DESCONOCIDO',
        mensaje: 'Este dominio no corresponde a ningún consultorio.',
        idPeticion: req.idPeticion,
      },
    })
    return
  }

  // Con un solo consultorio la clave no aporta nada al log y lo llenaría de
  // "principal" en cada línea.
  if (esMultiConsultorio) req.log?.setBindings?.({ consultorio: consultorio.clave })

  conConsultorio(consultorio, next)
}
