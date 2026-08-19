/**
 * Perfil del propio usuario: por ahora, la firma del médico.
 *
 * La firma se registra UNA VEZ aquí y se reutiliza en todas sus recetas. El
 * documento maestro proponía dibujarla en cada una; además de la fricción de
 * repetirlo veinte veces al día, eso significaba guardar una imagen por receta.
 */

import { esquemaFirma } from '@consultorio/shared'
import { Router, type RequestHandler } from 'express'
import { borrarFirma, guardarFirma, hayFirma, leerFirma } from '../../core/almacenamiento.js'
import { registrarAuditoria } from '../../core/auditoria.js'
import { ErrorNoAutenticado, ErrorProhibido } from '../../core/errores.js'
import { requiereAutenticacion } from '../../middleware/autenticar.js'
import { rutaPropia } from '../../middleware/permisos.js'

export const rutasPerfil: Router = Router()

rutasPerfil.use(requiereAutenticacion)

/** La firma pertenece a un médico: nadie más tiene una que registrar. */
function medicoDe(req: Parameters<RequestHandler>[0]): string {
  if (!req.auth) throw new ErrorNoAutenticado()
  if (!req.auth.doctorId) {
    throw new ErrorProhibido('Solo las cuentas de médico tienen firma')
  }
  return req.auth.doctorId
}

const MOTIVO = 'Cada usuario consulta y modifica únicamente su propia firma'

rutasPerfil.get('/firma', rutaPropia(MOTIVO), (req, res) => {
  res.json({ registrada: hayFirma(medicoDe(req)) })
})

rutasPerfil.get('/firma/imagen', rutaPropia(MOTIVO), async (req, res) => {
  const contenido = await leerFirma(medicoDe(req))
  if (!contenido) {
    res.status(404).json({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'Sin firma registrada' } })
    return
  }

  res.type('image/png').send(contenido)
})

rutasPerfil.put('/firma', rutaPropia(MOTIVO), async (req, res) => {
  const medicoId = medicoDe(req)
  const { imagen } = esquemaFirma.parse(req.body)

  await guardarFirma(medicoId, imagen)

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Doctor',
    entidadId: medicoId,
    usuarioId: req.auth!.usuarioId,
    usuarioEmail: req.auth!.email,
    roles: req.auth!.roles,
    motivo: 'firma registrada o actualizada',
    ...(req.ip ? { ip: req.ip } : {}),
  })

  res.json({ registrada: true })
})

rutasPerfil.delete('/firma', rutaPropia(MOTIVO), async (req, res) => {
  await borrarFirma(medicoDe(req))
  res.status(204).end()
})
