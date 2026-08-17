import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { ErrorConflicto } from '../../core/errores.js'
import { prisma } from '../../core/prisma.js'
import {
  esquemaInstalacion,
  estaInstalado,
  generarContrasenaSegura,
  instalar,
} from './instalacion.service.js'
import { esquemaContrasena } from '@consultorio/shared'

const app = crearApp()

const EMAIL_ADMIN = 'instalador.prueba@consultorio.test'

const DATOS = {
  clinica: {
    nombre: 'Consultorio de Prueba',
    ruc: '20123456789',
    direccion: 'Av. Siempre Viva 742',
    telefono: '(01) 555-1234',
    email: 'contacto@prueba.test',
    timezone: 'America/Lima',
    duracionCitaMinutos: 20,
  },
  administrador: {
    nombres: 'Primera',
    apellidos: 'Administradora',
    email: EMAIL_ADMIN,
    contrasena: 'Instalacion2026!',
  },
}

/**
 * La configuración de la clínica es una fila única compartida por todo el
 * sistema, así que estas pruebas la quitan y la reponen. Se guarda la original
 * (que dejó el seed) para no dejar la base de desarrollo a medias.
 */
let configuracionOriginal: Awaited<ReturnType<typeof prisma.clinicSettings.findUnique>> = null

beforeEach(async () => {
  configuracionOriginal ??= await prisma.clinicSettings.findUnique({ where: { id: 1 } })

  await prisma.session.deleteMany({ where: { user: { email: EMAIL_ADMIN } } })
  await prisma.user.deleteMany({ where: { email: EMAIL_ADMIN } })
  await prisma.clinicSettings.deleteMany({ where: { id: 1 } })
})

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { email: EMAIL_ADMIN } } })
  await prisma.user.deleteMany({ where: { email: EMAIL_ADMIN } })
  await prisma.clinicSettings.deleteMany({ where: { id: 1 } })

  if (configuracionOriginal) {
    const { id: _id, updatedAt: _u, ...resto } = configuracionOriginal
    await prisma.clinicSettings.create({ data: { id: 1, ...resto } })
  }

  await prisma.$disconnect()
})

describe('instalación', () => {
  it('crea la clínica y el primer administrador', async () => {
    const { adminId } = await instalar(esquemaInstalacion.parse(DATOS))

    const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId } })
    expect(admin.roles).toEqual(['ADMIN'])
    expect(admin.email).toBe(EMAIL_ADMIN)

    const clinica = await prisma.clinicSettings.findUniqueOrThrow({ where: { id: 1 } })
    expect(clinica.name).toBe(DATOS.clinica.nombre)
  })

  it('nunca guarda la contraseña en claro', async () => {
    const { adminId } = await instalar(esquemaInstalacion.parse(DATOS))
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: adminId } })

    expect(admin.password).not.toBe(DATOS.administrador.contrasena)
    expect(admin.password.startsWith('$2')).toBe(true)
  })

  it('NO se puede instalar dos veces', async () => {
    // Una segunda instalación que sobrescribiera la configuración o creara otro
    // administrador sería una vía de entrada al sistema.
    await instalar(esquemaInstalacion.parse(DATOS))

    await expect(instalar(esquemaInstalacion.parse(DATOS))).rejects.toThrow(ErrorConflicto)
  })

  it('rechaza un correo ya registrado', async () => {
    await prisma.user.create({
      data: {
        email: EMAIL_ADMIN,
        password: 'x',
        firstName: 'Ya',
        lastName: 'Existe',
        roles: ['RECEPTIONIST'],
      },
    })

    await expect(instalar(esquemaInstalacion.parse(DATOS))).rejects.toThrow(ErrorConflicto)
  })

  it('no deja la clínica creada si falla el administrador', async () => {
    // Va todo en una transacción: un sistema con clínica configurada y sin
    // nadie que pueda entrar quedaría instalado e inservible, y reintentar
    // fallaría por el registro ya existente.
    await prisma.user.create({
      data: {
        email: EMAIL_ADMIN,
        password: 'x',
        firstName: 'Ya',
        lastName: 'Existe',
        roles: ['RECEPTIONIST'],
      },
    })

    await instalar(esquemaInstalacion.parse(DATOS)).catch(() => undefined)

    expect(await estaInstalado()).toBe(false)
  })

  it('exige que la contraseña cumpla la política', () => {
    const debiles = ['corta1!', 'sinmayuscula1!', 'SinNumero!', 'SinSimbolo1']
    for (const contrasena of debiles) {
      const resultado = esquemaInstalacion.safeParse({
        ...DATOS,
        administrador: { ...DATOS.administrador, contrasena },
      })
      expect(resultado.success, `debió rechazar: ${contrasena}`).toBe(false)
    }
  })

  it('normaliza el correo del administrador', () => {
    const datos = esquemaInstalacion.parse({
      ...DATOS,
      administrador: { ...DATOS.administrador, email: '  ADMIN@Prueba.TEST  ' },
    })
    expect(datos.administrador.email).toBe('admin@prueba.test')
  })
})

describe('estado de la instalación', () => {
  it('antes de instalar, lo indica sin exponer nada más', async () => {
    const res = await request(app).get('/api/instalacion/estado')

    expect(res.status).toBe(200)
    expect(res.body.instalado).toBe(false)
    expect(res.body.clinica).toBeUndefined()
  })

  it('después de instalar, expone solo el nombre y el logo', async () => {
    await instalar(esquemaInstalacion.parse(DATOS))

    const res = await request(app).get('/api/instalacion/estado')

    expect(res.body.instalado).toBe(true)
    expect(res.body.clinica.nombre).toBe(DATOS.clinica.nombre)
    // El RUC, la dirección y el teléfono NO salen: es un endpoint sin sesión.
    expect(JSON.stringify(res.body)).not.toContain(DATOS.clinica.ruc)
    expect(JSON.stringify(res.body)).not.toContain(DATOS.clinica.direccion)
  })

  it('es público: la pantalla de login lo consulta antes de autenticar', async () => {
    const res = await request(app).get('/api/instalacion/estado')
    expect(res.status).not.toBe(401)
  })
})

describe('generación de contraseñas', () => {
  it('las generadas cumplen siempre la política', () => {
    // Se construyen por partes en lugar de generar y comprobar, así que esto
    // debe cumplirse en el 100 % de los casos, no en la mayoría.
    for (let i = 0; i < 200; i++) {
      const resultado = esquemaContrasena.safeParse(generarContrasenaSegura())
      expect(resultado.success).toBe(true)
    }
  })

  it('respeta la longitud pedida', () => {
    expect(generarContrasenaSegura(32)).toHaveLength(32)
  })

  it('no repite la misma contraseña', () => {
    const generadas = new Set(Array.from({ length: 50 }, () => generarContrasenaSegura()))
    expect(generadas.size).toBe(50)
  })

  it('no coloca siempre los caracteres obligatorios en el mismo sitio', () => {
    // Sin mezclar, las contraseñas empezarían todas por mayúscula, minúscula,
    // número y símbolo en ese orden, lo que reduce mucho lo que hay que probar.
    const primeras = new Set(Array.from({ length: 50 }, () => generarContrasenaSegura()[0]))
    expect(primeras.size).toBeGreaterThan(3)
  })
})
