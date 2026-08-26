/**
 * Instalación del sistema — `pnpm setup`
 *
 * Crea la configuración de la clínica y la primera cuenta de administrador.
 * Sustituye al onboarding público de tres pasos del diseño multi-tenant: sin
 * múltiples clínicas, un formulario abierto de registro solo sería una puerta
 * de entrada de más.
 *
 * Funciona de dos maneras:
 *
 *   · Interactiva (`pnpm setup`): pregunta los datos por consola.
 *   · Desatendida: si están las variables CLINICA_* y ADMIN_*, no pregunta
 *     nada. Es lo que hace falta para instalar desde un despliegue automático.
 */

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { ZodError } from 'zod'
import { desconectarBaseDeDatos } from '../src/core/prisma.js'
import {
  esquemaInstalacion,
  estaInstalado,
  generarContrasenaSegura,
  instalar,
} from '../src/modules/instalacion/instalacion.service.js'

const c = {
  titulo: (t: string) => `\n\x1b[1m\x1b[36m${t}\x1b[0m`,
  ok: (t: string) => `\x1b[32m${t}\x1b[0m`,
  aviso: (t: string) => `\x1b[33m${t}\x1b[0m`,
  error: (t: string) => `\x1b[31m${t}\x1b[0m`,
  tenue: (t: string) => `\x1b[90m${t}\x1b[0m`,
}

const desatendida = Boolean(process.env['CLINICA_NOMBRE'] && process.env['ADMIN_EMAIL'])

async function recolectarDatos() {
  if (desatendida) {
    return {
      clinica: {
        nombre: process.env['CLINICA_NOMBRE'],
        ruc: process.env['CLINICA_RUC'],
        direccion: process.env['CLINICA_DIRECCION'],
        telefono: process.env['CLINICA_TELEFONO'],
        email: process.env['CLINICA_EMAIL'],
        timezone: process.env['CLINICA_TIMEZONE'] ?? 'America/Lima',
        duracionCitaMinutos: process.env['CLINICA_DURACION_CITA'] ?? 20,
      },
      administrador: {
        nombres: process.env['ADMIN_NOMBRES'],
        apellidos: process.env['ADMIN_APELLIDOS'],
        email: process.env['ADMIN_EMAIL'],
        contrasena: process.env['ADMIN_PASSWORD'] || generarContrasenaSegura(),
      },
    }
  }

  const consola = createInterface({ input: stdin, output: stdout })

  const preguntar = async (etiqueta: string, porDefecto?: string): Promise<string> => {
    const sufijo = porDefecto ? c.tenue(` [${porDefecto}]`) : ''
    const respuesta = (await consola.question(`  ${etiqueta}${sufijo}: `)).trim()
    return respuesta || porDefecto || ''
  }

  console.log(c.titulo('Datos de la clínica'))
  const clinica = {
    nombre: await preguntar('Nombre'),
    ruc: await preguntar('RUC'),
    direccion: await preguntar('Dirección'),
    telefono: await preguntar('Teléfono'),
    email: await preguntar('Correo de contacto'),
    timezone: await preguntar('Zona horaria', 'America/Lima'),
    duracionCitaMinutos: await preguntar('Duración de cita en minutos', '20'),
  }

  console.log(c.titulo('Cuenta de administrador'))
  const nombres = await preguntar('Nombres')
  const apellidos = await preguntar('Apellidos')
  const email = await preguntar('Correo')

  console.log(
    c.tenue(
      '\n  La contraseña debe tener 8+ caracteres, una mayúscula, un número y un símbolo.\n' +
        '  Deja el campo vacío para que se genere una segura automáticamente.',
    ),
  )
  const contrasenaIngresada = await preguntar('Contraseña')

  consola.close()

  return {
    clinica,
    administrador: {
      nombres,
      apellidos,
      email,
      contrasena: contrasenaIngresada || generarContrasenaSegura(),
    },
  }
}

async function principal() {
  console.log(c.titulo('Instalación del sistema de consultorio'))

  if (await estaInstalado()) {
    console.log(
      c.aviso('\n  El sistema ya está instalado.\n') +
        c.tenue(
          '  Para crear más usuarios, inicia sesión como administrador.\n' +
            '  Si necesitas empezar de cero, borra la base de datos y vuelve a migrar.\n',
        ),
    )
    return
  }

  const crudos = await recolectarDatos()

  let datos
  try {
    datos = esquemaInstalacion.parse(crudos)
  } catch (error) {
    if (error instanceof ZodError) {
      console.log(c.error('\n  Faltan datos o son inválidos:\n'))
      for (const problema of error.issues) {
        console.log(`    · ${problema.path.join('.')}: ${problema.message}`)
      }
      console.log()
      process.exitCode = 1
      return
    }
    throw error
  }

  await instalar(datos)

  console.log(c.ok('\n  Instalación completada.\n'))
  console.log(`  Clínica:       ${datos.clinica.nombre}`)
  console.log(`  Administrador: ${datos.administrador.email}`)

  // La contraseña se muestra una sola vez y solo si la generamos nosotros.
  // Nunca queda en la base en claro ni en ningún log.
  if (!process.env['ADMIN_PASSWORD'] && crudos.administrador.contrasena) {
    console.log(`  Contraseña:    ${c.ok(datos.administrador.contrasena)}`)
    console.log(c.aviso('\n  Guárdala ahora: no se volverá a mostrar.'))
  }

  console.log(
    c.tenue(
      '\n  Siguiente paso: inicia sesión y cambia esta contraseña.\n' +
        '  Si el sistema va a estar accesible desde internet, conviene activar\n' +
        '  la verificación en dos pasos desde Seguridad: esta cuenta puede leer\n' +
        '  todas las historias clínicas. Es opcional.\n',
    ),
  )
}

try {
  await principal()
} catch (error) {
  console.error(c.error(`\n  Error durante la instalación: ${(error as Error).message}\n`))
  process.exitCode = 1
} finally {
  await desconectarBaseDeDatos()
}
