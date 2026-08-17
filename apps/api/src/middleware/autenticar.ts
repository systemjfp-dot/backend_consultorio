/**
 * Resolución de la sesión a partir del access token.
 *
 * En cada petición se consulta la base para obtener roles, permisos, estado de
 * la cuenta y estado de la sesión. Es una consulta indexada, irrelevante a la
 * escala de un consultorio, y a cambio:
 *
 *   · desactivar a alguien surte efecto en la petición siguiente, no cuando
 *     expire su token;
 *   · cerrar sesión la corta de verdad;
 *   · quitar un permiso se aplica de inmediato.
 *
 * Guardar todo eso dentro del JWT ahorraría la consulta a costa de que echar a
 * alguien de la clínica un viernes le deje acceso hasta que caduque el token.
 */

import type { Rol } from '@consultorio/shared'
import type { RequestHandler } from 'express'
import { ErrorNoAutenticado } from '../core/errores.js'
import { prisma } from '../core/prisma.js'
import { verificarAccessToken } from '../modules/auth/tokens.js'

/** Extrae el token de la cabecera `Authorization: Bearer <token>`. */
function tokenDeLaCabecera(cabecera: string | undefined): string | undefined {
  if (!cabecera) return undefined
  const [esquema, valor] = cabecera.split(' ')
  if (esquema?.toLowerCase() !== 'bearer' || !valor) return undefined
  return valor
}

/**
 * Carga el contexto de sesión si hay un token válido; si no, sigue sin él.
 *
 * No rechaza: de eso se encarga `requiereAutenticacion`. Separarlos permite
 * que rutas públicas (confirmar una cita desde el enlace del recordatorio)
 * sepan quién llama cuando lo hay, sin exigirlo.
 */
export const cargarSesion: RequestHandler = async (req, _res, next) => {
  const token = tokenDeLaCabecera(req.get('authorization'))
  if (!token) return next()

  try {
    const { usuarioId, sesionId } = verificarAccessToken(token)

    const sesion = await prisma.session.findUnique({
      where: { id: sesionId },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            isActive: true,
            roles: true,
            extraPermissions: true,
            deniedPermissions: true,
            doctor: { select: { id: true, isActive: true } },
          },
        },
      },
    })

    // Cualquiera de estas condiciones invalida el token aunque su firma sea
    // correcta y aún no haya expirado.
    if (
      !sesion ||
      sesion.user.id !== usuarioId ||
      sesion.revokedAt !== null ||
      sesion.expiresAt <= new Date() ||
      !sesion.user.isActive
    ) {
      return next()
    }

    req.auth = {
      usuarioId: sesion.user.id,
      email: sesion.user.email,
      sesionId: sesion.id,
      roles: sesion.user.roles as Rol[],
      extraPermissions: sesion.user.extraPermissions,
      deniedPermissions: sesion.user.deniedPermissions,
      // Un médico desactivado no debe conservar el alcance `own` sobre su
      // agenda: sin doctorId, las consultas por alcance propio no devuelven nada.
      ...(sesion.user.doctor?.isActive ? { doctorId: sesion.user.doctor.id } : {}),
    }

    // La última actividad se actualiza sin esperar: sirve para mostrar las
    // sesiones abiertas, y no vale la pena retrasar cada petición por ello.
    void prisma.session
      .update({ where: { id: sesion.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined)

    next()
  } catch {
    // Token inválido o expirado: se sigue como anónimo. Si la ruta exige
    // sesión, el middleware siguiente devolverá 401.
    next()
  }
}

/** Exige sesión válida. Va después de `cargarSesion`. */
export const requiereAutenticacion: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(new ErrorNoAutenticado())
  next()
}
