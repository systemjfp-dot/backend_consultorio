/**
 * Instalación inicial del sistema.
 *
 * Reemplaza al "registro público de clínicas" del diseño multi-tenant: aquí no
 * hay onboarding abierto, hay una instalación que se ejecuta una vez.
 *
 * La lógica vive aquí y no en el script de consola para poder probarla. Lo que
 * más importa comprobar es que NO se pueda ejecutar dos veces: una segunda
 * instalación que sobrescribiera la configuración o creara otro administrador
 * sería una vía de entrada al sistema.
 */

import { esquemaContrasena, esquemaEmail } from '@consultorio/shared'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { ErrorConflicto } from '../../core/errores.js'
import { prisma } from '../../core/prisma.js'
import { cifrarContrasena } from '../auth/contrasenas.js'

export const esquemaInstalacion = z.object({
  clinica: z.object({
    nombre: z.string().trim().min(3, 'El nombre de la clínica es obligatorio').max(120),
    ruc: z.string().trim().min(8, 'El RUC debe tener al menos 8 dígitos').max(20),
    direccion: z.string().trim().min(5).max(200),
    telefono: z.string().trim().min(6).max(30),
    email: esquemaEmail,
    timezone: z.string().default('America/Lima'),
    duracionCitaMinutos: z.coerce.number().int().min(5).max(240).default(20),
  }),
  administrador: z.object({
    nombres: z.string().trim().min(2).max(60),
    apellidos: z.string().trim().min(2).max(60),
    email: esquemaEmail,
    contrasena: esquemaContrasena,
  }),
})

export type DatosInstalacion = z.infer<typeof esquemaInstalacion>

/** ¿Ya se instaló el sistema? */
export async function estaInstalado(): Promise<boolean> {
  const configuracion = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { id: true },
  })
  return configuracion !== null
}

/** Datos públicos de la clínica, para la pantalla de inicio de sesión. */
export async function datosPublicos() {
  const configuracion = await prisma.clinicSettings.findUnique({
    where: { id: 1 },
    select: { name: true, logoUrl: true },
  })

  if (!configuracion) return { instalado: false as const }

  return {
    instalado: true as const,
    clinica: { nombre: configuracion.name, logoUrl: configuracion.logoUrl },
  }
}

/**
 * Crea la configuración de la clínica y la primera cuenta de administrador.
 *
 * Ambas cosas van en una transacción: un sistema con clínica configurada pero
 * sin administrador quedaría instalado y sin nadie que pudiera entrar, y
 * volver a ejecutar la instalación fallaría por el registro ya existente.
 */
export async function instalar(datos: DatosInstalacion): Promise<{ adminId: string }> {
  if (await estaInstalado()) {
    throw new ErrorConflicto(
      'El sistema ya está instalado. Para crear más usuarios, inicia sesión como administrador.',
    )
  }

  const emailEnUso = await prisma.user.findUnique({
    where: { email: datos.administrador.email },
    select: { id: true },
  })
  if (emailEnUso) throw new ErrorConflicto('Ese correo ya está registrado')

  const contrasenaCifrada = await cifrarContrasena(datos.administrador.contrasena)

  const admin = await prisma.$transaction(async (tx) => {
    await tx.clinicSettings.create({
      data: {
        id: 1,
        name: datos.clinica.nombre,
        ruc: datos.clinica.ruc,
        address: datos.clinica.direccion,
        phone: datos.clinica.telefono,
        email: datos.clinica.email,
        timezone: datos.clinica.timezone,
        defaultSlotMinutes: datos.clinica.duracionCitaMinutos,
      },
    })

    return tx.user.create({
      data: {
        email: datos.administrador.email,
        password: contrasenaCifrada,
        firstName: datos.administrador.nombres,
        lastName: datos.administrador.apellidos,
        roles: ['ADMIN'],
      },
      select: { id: true },
    })
  })

  return { adminId: admin.id }
}

/**
 * Genera una contraseña que cumple la política, para instalaciones
 * desatendidas.
 *
 * Se construye por partes (una mayúscula, un número, un símbolo, y relleno) en
 * lugar de generar al azar y comprobar: así siempre cumple a la primera y no
 * hay forma de que el bucle se alargue. Se usa `randomInt` de node:crypto y no
 * Math.random, que no sirve para nada que proteja un acceso.
 */
export function generarContrasenaSegura(longitud = 20): string {
  const mayusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const minusculas = 'abcdefghijkmnopqrstuvwxyz'
  const numeros = '23456789'
  const simbolos = '!@#$%&*+-?'
  // Se omiten I, l, O, 0 y 1: esta contraseña se lee de una consola y se
  // teclea a mano al menos una vez.

  const todos = mayusculas + minusculas + numeros + simbolos
  const elegir = (conjunto: string) => conjunto[randomInt(conjunto.length)]!

  const caracteres = [
    elegir(mayusculas),
    elegir(minusculas),
    elegir(numeros),
    elegir(simbolos),
    ...Array.from({ length: Math.max(0, longitud - 4) }, () => elegir(todos)),
  ]

  // Mezcla de Fisher-Yates: sin ella, los cuatro obligatorios quedarían
  // siempre al principio y en el mismo orden.
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[caracteres[i], caracteres[j]] = [caracteres[j]!, caracteres[i]!]
  }

  return caracteres.join('')
}
