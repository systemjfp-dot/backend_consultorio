/**
 * Contratos de autenticación.
 *
 * Se definen una sola vez y los usan API y web. Así el formulario del
 * navegador y el endpoint aplican literalmente la misma regla: no puede pasar
 * que el frontend acepte una contraseña que el backend rechaza, ni al revés.
 */

import { z } from 'zod'

/**
 * Política de contraseñas del documento maestro: mínimo 8 caracteres, una
 * mayúscula, un número y un carácter especial.
 *
 * Se valida cada regla por separado, y no con una sola expresión regular, para
 * poder decirle a la persona QUÉ le falta. "La contraseña no cumple los
 * requisitos" es la forma más rápida de que alguien termine usando Clinica1!
 */
export const esquemaContrasena = z
  .string()
  .min(8, 'Debe tener al menos 8 caracteres')
  .max(128, 'No puede superar los 128 caracteres')
  .regex(/[A-ZÁÉÍÓÚÑ]/, 'Debe incluir al menos una letra mayúscula')
  .regex(/[0-9]/, 'Debe incluir al menos un número')
  .regex(/[^A-Za-z0-9]/, 'Debe incluir al menos un carácter especial')

export const esquemaEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email('El correo no tiene un formato válido')

/** Código TOTP de seis dígitos. */
export const esquemaCodigo2FA = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'El código debe tener 6 dígitos')

// --- Inicio de sesión --------------------------------------------------------

export const esquemaLogin = z.object({
  email: esquemaEmail,
  // Al iniciar sesión NO se aplica la política: una contraseña antigua que ya
  // no cumple las reglas actuales debe poder usarse para entrar y cambiarla.
  password: z.string().min(1, 'Ingresa tu contraseña'),
})
export type DatosLogin = z.infer<typeof esquemaLogin>

export const esquemaVerificar2FA = z.object({
  tokenDesafio: z.string().min(1),
  codigo: esquemaCodigo2FA,
})
export type DatosVerificar2FA = z.infer<typeof esquemaVerificar2FA>

// --- Contraseñas -------------------------------------------------------------

export const esquemaCambiarContrasena = z.object({
  contrasenaActual: z.string().min(1, 'Ingresa tu contraseña actual'),
  contrasenaNueva: esquemaContrasena,
})

export const esquemaOlvideContrasena = z.object({
  email: esquemaEmail,
})

export const esquemaRestablecerContrasena = z.object({
  token: z.string().min(1),
  contrasenaNueva: esquemaContrasena,
})

// --- 2FA ---------------------------------------------------------------------

export const esquemaActivar2FA = z.object({
  codigo: esquemaCodigo2FA,
})

export const esquemaDesactivar2FA = z.object({
  // Desactivar el segundo factor exige demostrar ambos: quien roba una sesión
  // no debe poder desarmar la protección con solo tenerla abierta.
  password: z.string().min(1),
  codigo: esquemaCodigo2FA,
})

// --- Respuestas --------------------------------------------------------------

/** Datos del usuario que la web necesita para dibujar la interfaz. */
export interface UsuarioSesion {
  id: string
  email: string
  firstName: string
  lastName: string
  roles: string[]
  /** Permisos efectivos ya resueltos. La web los usa solo para ocultar botones. */
  permisos: string[]
  doctorId?: string
  twoFactorEnabled: boolean
}

export interface RespuestaLogin {
  accessToken: string
  usuario: UsuarioSesion
  /**
   * El usuario es ADMIN y todavía no configuró el segundo factor.
   * La web debe llevarlo a la pantalla de configuración antes que a nada más.
   */
  debeConfigurar2FA: boolean
}

/** Primer paso del login cuando la cuenta tiene 2FA activo. */
export interface RespuestaDesafio2FA {
  requiere2FA: true
  tokenDesafio: string
}

export type ResultadoLogin = RespuestaLogin | RespuestaDesafio2FA

export function requiere2FA(resultado: ResultadoLogin): resultado is RespuestaDesafio2FA {
  return 'requiere2FA' in resultado
}

// --- Acceso de emergencia (break-the-glass) ----------------------------------

export const esquemaAccesoEmergencia = z.object({
  /**
   * Mínimo 20 caracteres a propósito. Un campo libre que acepta "urgencia" no
   * deja rastro de nada: obligar a redactar una frase es lo que convierte el
   * registro en algo revisable, y hace que quien fisgonea se lo piense.
   */
  motivo: z
    .string()
    .trim()
    .min(20, 'Explica el motivo del acceso en al menos 20 caracteres')
    .max(500),
})
export type DatosAccesoEmergencia = z.infer<typeof esquemaAccesoEmergencia>
