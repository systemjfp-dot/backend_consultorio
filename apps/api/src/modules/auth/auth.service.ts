/**
 * Lógica de autenticación.
 *
 * Este archivo no conoce `req` ni `res`: recibe datos y devuelve resultados,
 * de modo que todo lo de aquí se puede probar sin levantar un servidor.
 */

import {
  listarPermisos,
  type Rol,
  type UsuarioSesion,
} from '@consultorio/shared'
import { authenticator } from 'otplib'
import { env } from '../../config/env.js'
import { registrarAuditoria } from '../../core/auditoria.js'
import {
  ErrorConflicto,
  ErrorNoAutenticado,
  ErrorNoEncontrado,
  ErrorProhibido,
} from '../../core/errores.js'
import { logger } from '../../core/logger.js'
import { prisma } from '../../core/prisma.js'
import {
  cifrarContrasena,
  verificarContraSenuelo,
  verificarContrasena,
} from './contrasenas.js'
import {
  firmarAccessToken,
  firmarTokenDesafio2FA,
  generarRefreshToken,
  generarTokenUnUso,
  hashRefreshToken,
  hashTokenUnUso,
  verificarTokenDesafio2FA,
} from './tokens.js'

/** Datos del dispositivo que hace la petición, para poder auditar sesiones. */
export interface DatosCliente {
  ip?: string
  userAgent?: string
}

export interface ParDeTokens {
  accessToken: string
  refreshToken: string
  expiraRefresh: Date
}

// =============================================================================
//  Sesiones
// =============================================================================

function fechaExpiracionRefresh(): Date {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() + env.REFRESH_TOKEN_TTL_DAYS)
  return fecha
}

async function crearSesion(usuarioId: string, cliente: DatosCliente): Promise<ParDeTokens> {
  const refreshToken = generarRefreshToken()
  const expiraRefresh = fechaExpiracionRefresh()

  const sesion = await prisma.session.create({
    data: {
      userId: usuarioId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: expiraRefresh,
      ipAddress: cliente.ip ?? null,
      userAgent: cliente.userAgent ?? null,
    },
    select: { id: true },
  })

  return {
    accessToken: firmarAccessToken(usuarioId, sesion.id),
    refreshToken,
    expiraRefresh,
  }
}

/** Datos que la web necesita para dibujar la interfaz tras iniciar sesión. */
export async function construirUsuarioSesion(usuarioId: string): Promise<UsuarioSesion> {
  const usuario = await prisma.user.findUniqueOrThrow({
    where: { id: usuarioId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      roles: true,
      extraPermissions: true,
      deniedPermissions: true,
      twoFactorEnabled: true,
      doctor: { select: { id: true, isActive: true } },
    },
  })

  return {
    id: usuario.id,
    email: usuario.email,
    firstName: usuario.firstName,
    lastName: usuario.lastName,
    roles: usuario.roles,
    // Se envían resueltos para que la web oculte lo que no aplica. Es
    // exclusivamente cosmético: la autoridad es siempre el backend.
    permisos: listarPermisos({
      roles: usuario.roles as Rol[],
      extraPermissions: usuario.extraPermissions,
      deniedPermissions: usuario.deniedPermissions,
    }),
    ...(usuario.doctor?.isActive ? { doctorId: usuario.doctor.id } : {}),
    twoFactorEnabled: usuario.twoFactorEnabled,
  }
}

// =============================================================================
//  Inicio de sesión
// =============================================================================

export type ResultadoInicioSesion =
  | { tipo: 'desafio2fa'; tokenDesafio: string }
  | {
      tipo: 'sesion'
      tokens: ParDeTokens
      usuario: UsuarioSesion
      debeConfigurar2FA: boolean
    }

/**
 * Verifica correo y contraseña.
 *
 * Detalles que no son negociables:
 *
 * · El mensaje de error es el mismo tanto si el correo no existe como si la
 *   contraseña está mal. "Ese correo no está registrado" le confirma a
 *   cualquiera qué personas trabajan en la clínica.
 *
 * · Cuando el usuario no existe se gasta igualmente el tiempo de un bcrypt
 *   (`verificarContraSenuelo`). Sin eso, la diferencia entre responder en 2 ms
 *   y en 100 ms delata exactamente lo mismo que el mensaje anterior.
 */
export async function iniciarSesion(
  email: string,
  contrasena: string,
  cliente: DatosCliente,
): Promise<ResultadoInicioSesion> {
  const usuario = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      password: true,
      isActive: true,
      roles: true,
      twoFactorEnabled: true,
    },
  })

  const credencialesInvalidas = new ErrorNoAutenticado('Correo o contraseña incorrectos')

  if (!usuario || !usuario.isActive) {
    await verificarContraSenuelo(contrasena)
    await registrarAuditoria({
      accion: 'LOGIN_FAILED',
      entidad: 'User',
      entidadId: usuario?.id,
      usuarioEmail: email,
      ip: cliente.ip,
      userAgent: cliente.userAgent,
      motivo: usuario ? 'cuenta desactivada' : 'correo no registrado',
    })
    throw credencialesInvalidas
  }

  if (!(await verificarContrasena(contrasena, usuario.password))) {
    await registrarAuditoria({
      accion: 'LOGIN_FAILED',
      entidad: 'User',
      entidadId: usuario.id,
      usuarioEmail: email,
      roles: usuario.roles,
      ip: cliente.ip,
      userAgent: cliente.userAgent,
      motivo: 'contraseña incorrecta',
    })
    throw credencialesInvalidas
  }

  // Con 2FA activo, la contraseña correcta solo da un token de desafío. La
  // sesión no existe todavía.
  if (usuario.twoFactorEnabled) {
    return { tipo: 'desafio2fa', tokenDesafio: firmarTokenDesafio2FA(usuario.id) }
  }

  return completarInicioSesion(usuario.id, usuario.roles as Rol[], cliente)
}

async function completarInicioSesion(
  usuarioId: string,
  roles: Rol[],
  cliente: DatosCliente,
): Promise<ResultadoInicioSesion> {
  const tokens = await crearSesion(usuarioId, cliente)
  const usuario = await construirUsuarioSesion(usuarioId)

  await registrarAuditoria({
    accion: 'LOGIN',
    entidad: 'User',
    entidadId: usuarioId,
    usuarioId,
    usuarioEmail: usuario.email,
    roles,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return {
    tipo: 'sesion',
    tokens,
    usuario,
    // ADMIN es la cuenta que gestiona al personal y las integraciones: se le
    // exige segundo factor. No se le bloquea el acceso —tiene que poder entrar
    // para configurarlo—, pero la web lo lleva directo a esa pantalla.
    debeConfigurar2FA: roles.includes('ADMIN') && !usuario.twoFactorEnabled,
  }
}

/** Segundo paso del login: valida el código TOTP contra el token de desafío. */
export async function verificarSegundoFactor(
  tokenDesafio: string,
  codigo: string,
  cliente: DatosCliente,
): Promise<ResultadoInicioSesion> {
  const { usuarioId } = verificarTokenDesafio2FA(tokenDesafio)

  const usuario = await prisma.user.findUnique({
    where: { id: usuarioId },
    select: { id: true, isActive: true, roles: true, twoFactorSecret: true },
  })

  if (!usuario?.isActive || !usuario.twoFactorSecret) {
    throw new ErrorNoAutenticado('No se pudo verificar el código')
  }

  if (!authenticator.verify({ token: codigo, secret: usuario.twoFactorSecret })) {
    await registrarAuditoria({
      accion: 'LOGIN_FAILED',
      entidad: 'User',
      entidadId: usuario.id,
      roles: usuario.roles,
      ip: cliente.ip,
      userAgent: cliente.userAgent,
      motivo: 'código 2FA incorrecto',
    })
    throw new ErrorNoAutenticado('El código no es válido o ya expiró')
  }

  return completarInicioSesion(usuario.id, usuario.roles as Rol[], cliente)
}

// =============================================================================
//  Renovación
// =============================================================================

/**
 * Renueva la sesión ROTANDO el refresh token: el usado se revoca y se emite
 * uno nuevo.
 *
 * DETECCIÓN DE REUTILIZACIÓN. Si llega un refresh token que ya fue revocado,
 * solo hay dos explicaciones: o se filtró y alguien lo está usando, o el
 * legítimo se quedó con una copia vieja. En ambos casos lo prudente es lo
 * mismo: revocar TODAS las sesiones de ese usuario y obligarlo a entrar de
 * nuevo. Es la contramedida estándar, y sin ella un refresh token robado da
 * acceso indefinido, precisamente lo que la rotación pretende evitar.
 */
export async function renovarSesion(
  refreshToken: string,
  cliente: DatosCliente,
): Promise<{ tokens: ParDeTokens; usuario: UsuarioSesion }> {
  const hash = hashRefreshToken(refreshToken)

  const sesion = await prisma.session.findUnique({
    where: { refreshTokenHash: hash },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { isActive: true, roles: true } },
    },
  })

  if (!sesion) throw new ErrorNoAutenticado('Sesión inválida. Vuelve a iniciar sesión.')

  if (sesion.revokedAt !== null) {
    await prisma.session.updateMany({
      where: { userId: sesion.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    logger.warn(
      { usuarioId: sesion.userId, ip: cliente.ip },
      'Refresh token reutilizado: se revocaron todas las sesiones del usuario',
    )

    await registrarAuditoria({
      accion: 'LOGOUT',
      entidad: 'Session',
      entidadId: sesion.id,
      usuarioId: sesion.userId,
      ip: cliente.ip,
      userAgent: cliente.userAgent,
      motivo: 'refresh token reutilizado: se cerraron todas las sesiones',
    })

    throw new ErrorNoAutenticado('Tu sesión se cerró por seguridad. Vuelve a iniciar sesión.')
  }

  if (sesion.expiresAt <= new Date() || !sesion.user.isActive) {
    throw new ErrorNoAutenticado('Tu sesión expiró. Vuelve a iniciar sesión.')
  }

  // La revocación de la anterior y la creación de la nueva van juntas: si el
  // proceso muere en medio, no puede quedar una sesión revocada sin sustituta
  // (usuario expulsado) ni dos vivas a la vez.
  const nuevoRefresh = generarRefreshToken()
  const expiraRefresh = fechaExpiracionRefresh()

  const nuevaSesion = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sesion.id },
      data: { revokedAt: new Date() },
    })

    return tx.session.create({
      data: {
        userId: sesion.userId,
        refreshTokenHash: hashRefreshToken(nuevoRefresh),
        expiresAt: expiraRefresh,
        ipAddress: cliente.ip ?? null,
        userAgent: cliente.userAgent ?? null,
      },
      select: { id: true },
    })
  })

  return {
    tokens: {
      accessToken: firmarAccessToken(sesion.userId, nuevaSesion.id),
      refreshToken: nuevoRefresh,
      expiraRefresh,
    },
    usuario: await construirUsuarioSesion(sesion.userId),
  }
}

// =============================================================================
//  Cierre de sesión
// =============================================================================

export async function cerrarSesion(
  sesionId: string,
  usuarioId: string,
  cliente: DatosCliente,
): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sesionId, userId: usuarioId, revokedAt: null },
    data: { revokedAt: new Date() },
  })

  await registrarAuditoria({
    accion: 'LOGOUT',
    entidad: 'Session',
    entidadId: sesionId,
    usuarioId,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })
}

/** Cierra todas las sesiones del usuario. Se usa al cambiar la contraseña. */
export async function cerrarTodasLasSesiones(usuarioId: string): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId: usuarioId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return count
}

// =============================================================================
//  Contraseñas
// =============================================================================

export async function cambiarContrasena(
  usuarioId: string,
  actual: string,
  nueva: string,
  cliente: DatosCliente,
): Promise<void> {
  const usuario = await prisma.user.findUniqueOrThrow({
    where: { id: usuarioId },
    select: { password: true, roles: true },
  })

  if (!(await verificarContrasena(actual, usuario.password))) {
    throw new ErrorNoAutenticado('La contraseña actual no es correcta')
  }

  if (await verificarContrasena(nueva, usuario.password)) {
    throw new ErrorConflicto('La nueva contraseña debe ser distinta de la actual')
  }

  await prisma.user.update({
    where: { id: usuarioId },
    data: { password: await cifrarContrasena(nueva) },
  })

  // Cambiar la contraseña cierra todas las sesiones. Es lo que uno espera al
  // hacerlo justamente porque sospecha que alguien más entró: si las sesiones
  // abiertas sobrevivieran, el cambio no serviría de nada.
  await cerrarTodasLasSesiones(usuarioId)

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'User',
    entidadId: usuarioId,
    usuarioId,
    roles: usuario.roles,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
    motivo: 'cambio de contraseña',
  })
}

/**
 * Genera un enlace de recuperación.
 *
 * Devuelve el token para que la capa de correo lo envíe. El controlador
 * responde siempre lo mismo exista o no la cuenta: si respondiera distinto,
 * este endpoint —que es público— se convertiría en un buscador de correos
 * registrados.
 */
export async function solicitarRecuperacion(
  email: string,
  cliente: DatosCliente,
): Promise<{ token: string; usuarioId: string } | null> {
  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isActive: true },
  })

  if (!usuario || !usuario.isActive) return null

  const { token, hash } = generarTokenUnUso()
  const expiraEn = new Date(Date.now() + 60 * 60_000) // 1 hora, como pide el 1.3

  // Se invalidan los pedidos anteriores: si alguien solicita el enlace tres
  // veces, solo el último debe funcionar.
  await prisma.$transaction([
    prisma.passwordReset.updateMany({
      where: { userId: usuario.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordReset.create({
      data: { userId: usuario.id, tokenHash: hash, expiresAt: expiraEn },
    }),
  ])

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'User',
    entidadId: usuario.id,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
    motivo: 'solicitud de recuperación de contraseña',
  })

  return { token, usuarioId: usuario.id }
}

export async function restablecerContrasena(
  token: string,
  nueva: string,
  cliente: DatosCliente,
): Promise<void> {
  const solicitud = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashTokenUnUso(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })

  if (!solicitud || solicitud.usedAt !== null || solicitud.expiresAt <= new Date()) {
    throw new ErrorNoAutenticado('El enlace no es válido o ya expiró. Solicita uno nuevo.')
  }

  await prisma.$transaction([
    prisma.passwordReset.update({
      where: { id: solicitud.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: solicitud.userId },
      data: { password: await cifrarContrasena(nueva) },
    }),
    prisma.session.updateMany({
      where: { userId: solicitud.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'User',
    entidadId: solicitud.userId,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
    motivo: 'contraseña restablecida por enlace de recuperación',
  })
}

// =============================================================================
//  Segundo factor
// =============================================================================

/**
 * Prepara el segundo factor: genera el secreto y devuelve la URI que la web
 * convierte en código QR.
 *
 * El secreto se guarda pero `twoFactorEnabled` sigue en false hasta que la
 * persona demuestre que su aplicación lo leyó bien. Activarlo de una sola vez
 * dejaría fuera a quien escaneó mal el QR.
 */
export async function prepararSegundoFactor(
  usuarioId: string,
): Promise<{ secreto: string; uri: string }> {
  const usuario = await prisma.user.findUniqueOrThrow({
    where: { id: usuarioId },
    select: { email: true, twoFactorEnabled: true },
  })

  if (usuario.twoFactorEnabled) {
    throw new ErrorConflicto('El segundo factor ya está activo. Desactívalo antes de reconfigurarlo.')
  }

  const secreto = authenticator.generateSecret()

  await prisma.user.update({
    where: { id: usuarioId },
    data: { twoFactorSecret: secreto },
  })

  return {
    secreto,
    uri: authenticator.keyuri(usuario.email, 'Consultorio', secreto),
  }
}

export async function activarSegundoFactor(
  usuarioId: string,
  codigo: string,
  cliente: DatosCliente,
): Promise<void> {
  const usuario = await prisma.user.findUniqueOrThrow({
    where: { id: usuarioId },
    select: { twoFactorSecret: true, twoFactorEnabled: true, roles: true },
  })

  if (usuario.twoFactorEnabled) throw new ErrorConflicto('El segundo factor ya está activo')
  if (!usuario.twoFactorSecret) {
    throw new ErrorNoEncontrado('Primero debes generar el código de configuración')
  }

  if (!authenticator.verify({ token: codigo, secret: usuario.twoFactorSecret })) {
    throw new ErrorNoAutenticado('El código no es válido. Revisa la hora de tu dispositivo.')
  }

  await prisma.user.update({
    where: { id: usuarioId },
    data: { twoFactorEnabled: true },
  })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'User',
    entidadId: usuarioId,
    usuarioId,
    roles: usuario.roles,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
    motivo: 'segundo factor activado',
  })
}

export async function desactivarSegundoFactor(
  usuarioId: string,
  contrasena: string,
  codigo: string,
  cliente: DatosCliente,
): Promise<void> {
  const usuario = await prisma.user.findUniqueOrThrow({
    where: { id: usuarioId },
    select: { password: true, twoFactorSecret: true, twoFactorEnabled: true, roles: true },
  })

  if (!usuario.twoFactorEnabled) throw new ErrorConflicto('El segundo factor no está activo')

  // La restricción de rol se comprueba primero: pedirle a un administrador la
  // contraseña y el código para después negarle la operación es una pérdida de
  // tiempo, y deja sus credenciales escritas para nada.
  if (usuario.roles.includes('ADMIN')) {
    throw new ErrorProhibido(
      'Las cuentas de administrador deben mantener el segundo factor activo',
    )
  }

  // Se exigen ambas pruebas: quien se apodere de una sesión abierta no debe
  // poder desarmar la protección solo por tenerla delante.
  if (!(await verificarContrasena(contrasena, usuario.password))) {
    throw new ErrorNoAutenticado('La contraseña no es correcta')
  }
  if (
    !usuario.twoFactorSecret ||
    !authenticator.verify({ token: codigo, secret: usuario.twoFactorSecret })
  ) {
    throw new ErrorNoAutenticado('El código no es válido')
  }

  await prisma.user.update({
    where: { id: usuarioId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  })

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'User',
    entidadId: usuarioId,
    usuarioId,
    roles: usuario.roles,
    ip: cliente.ip,
    userAgent: cliente.userAgent,
    motivo: 'segundo factor desactivado',
  })
}

/** Sesiones abiertas del usuario, para que pueda revisarlas y cerrarlas. */
export async function listarSesiones(usuarioId: string) {
  return prisma.session.findMany({
    where: { userId: usuarioId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { lastUsedAt: 'desc' },
  })
}
