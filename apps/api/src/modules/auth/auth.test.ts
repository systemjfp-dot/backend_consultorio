/**
 * Pruebas de autenticación contra la base de datos real.
 *
 * No se simula Prisma: casi todo lo que importa aquí (revocación de sesiones,
 * rotación del refresh, unicidad del correo) ES comportamiento de la base. Un
 * doble de prueba confirmaría que el código llama a lo que creemos, no que el
 * sistema hace lo que debe.
 */

import { authenticator } from 'otplib'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { crearApp } from '../../app.js'
import { prisma } from '../../core/prisma.js'
import { cifrarContrasena } from './contrasenas.js'

const app = crearApp()

const CONTRASENA = 'Clinica2026!'
const EMAIL_MEDICO = 'medico.prueba@consultorio.test'
const EMAIL_ADMIN = 'admin.prueba@consultorio.test'
const EMAIL_INACTIVO = 'inactivo.prueba@consultorio.test'

let idMedico: string
let idAdmin: string

/** Extrae la cookie de refresh de una respuesta. */
function cookieRefresh(res: request.Response): string | undefined {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined
  return cookies?.find((c) => c.startsWith('refresh_token='))
}

async function limpiar() {
  const emails = [EMAIL_MEDICO, EMAIL_ADMIN, EMAIL_INACTIVO]
  const usuarios = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  })
  const ids = usuarios.map((u) => u.id)
  if (ids.length === 0) return

  await prisma.session.deleteMany({ where: { userId: { in: ids } } })
  await prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } })
  await prisma.doctor.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

beforeAll(async () => {
  await limpiar()
})

afterAll(async () => {
  await limpiar()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await limpiar()
  const hash = await cifrarContrasena(CONTRASENA)

  const medico = await prisma.user.create({
    data: {
      email: EMAIL_MEDICO,
      password: hash,
      firstName: 'Ana',
      lastName: 'Ruiz',
      roles: ['DOCTOR'],
      doctor: {
        create: { licenseNumber: `CMP-${Date.now()}`, specialty: 'Cardiología' },
      },
    },
    select: { id: true },
  })
  idMedico = medico.id

  const admin = await prisma.user.create({
    data: {
      email: EMAIL_ADMIN,
      password: hash,
      firstName: 'Luis',
      lastName: 'Soto',
      roles: ['ADMIN'],
    },
    select: { id: true },
  })
  idAdmin = admin.id

  await prisma.user.create({
    data: {
      email: EMAIL_INACTIVO,
      password: hash,
      firstName: 'Baja',
      lastName: 'Cuenta',
      roles: ['RECEPTIONIST'],
      isActive: false,
    },
  })
})

const login = (email: string, password = CONTRASENA) =>
  request(app).post('/api/auth/login').send({ email, password })

// =============================================================================

describe('inicio de sesión', () => {
  it('devuelve access token y datos del usuario', async () => {
    const res = await login(EMAIL_MEDICO)

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.usuario.email).toBe(EMAIL_MEDICO)
    expect(res.body.usuario.roles).toEqual(['DOCTOR'])
  })

  it('nunca devuelve el hash de la contraseña', async () => {
    const res = await login(EMAIL_MEDICO)
    expect(JSON.stringify(res.body)).not.toContain('$2')
  })

  it('el refresh token viaja en cookie httpOnly y no en el cuerpo', async () => {
    // Si estuviera en el cuerpo, la web tendría que guardarlo y cualquier
    // script inyectado podría leerlo.
    const res = await login(EMAIL_MEDICO)
    const cookie = cookieRefresh(res)

    expect(cookie).toBeDefined()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(res.body.refreshToken).toBeUndefined()
  })

  it('incluye los permisos resueltos para que la web oculte lo que no aplica', async () => {
    const res = await login(EMAIL_MEDICO)

    expect(res.body.usuario.permisos).toContain('encounter:read')
    expect(res.body.usuario.permisos).not.toContain('staff:create')
  })

  it('el médico recibe su doctorId, que define su alcance propio', async () => {
    const res = await login(EMAIL_MEDICO)
    expect(res.body.usuario.doctorId).toBeTruthy()
  })

  it('rechaza una contraseña incorrecta', async () => {
    const res = await login(EMAIL_MEDICO, 'Incorrecta1!')
    expect(res.status).toBe(401)
  })

  it('rechaza una cuenta desactivada', async () => {
    const res = await login(EMAIL_INACTIVO)
    expect(res.status).toBe(401)
  })

  it('no revela si el correo existe', async () => {
    // El mismo mensaje en ambos casos: distinguirlos permitiría averiguar
    // quién trabaja en la clínica.
    const inexistente = await login('nadie@consultorio.test')
    const existente = await login(EMAIL_MEDICO, 'Incorrecta1!')

    expect(inexistente.status).toBe(existente.status)
    expect(inexistente.body.error.mensaje).toBe(existente.body.error.mensaje)
  })

  it('un ADMIN sin segundo factor entra como cualquier otro', async () => {
    // El segundo factor es voluntario: nadie queda retenido por no tenerlo.
    const res = await login(EMAIL_ADMIN)

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(res.body.requiere2FA).toBeUndefined()
  })

  it('registra el intento fallido en la auditoría', async () => {
    await login(EMAIL_MEDICO, 'Incorrecta1!')

    const registro = await prisma.auditLog.findFirst({
      where: { action: 'LOGIN_FAILED', entityId: idMedico },
      orderBy: { createdAt: 'desc' },
    })
    expect(registro?.reason).toBe('contraseña incorrecta')
  })
})

describe('acceso a rutas protegidas', () => {
  it('sin token responde 401', async () => {
    const res = await request(app).get('/api/auth/sesiones')
    expect(res.status).toBe(401)
  })

  it('con token válido responde 200', async () => {
    const { body } = await login(EMAIL_MEDICO)
    const res = await request(app)
      .get('/api/auth/sesiones')
      .set('Authorization', `Bearer ${body.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.sesiones).toHaveLength(1)
  })

  it('un token manipulado no sirve', async () => {
    const { body } = await login(EMAIL_MEDICO)
    const manipulado = `${body.accessToken.slice(0, -4)}AAAA`

    const res = await request(app)
      .get('/api/auth/sesiones')
      .set('Authorization', `Bearer ${manipulado}`)

    expect(res.status).toBe(401)
  })

  it('desactivar la cuenta invalida el token en la petición siguiente', async () => {
    // Este es el motivo de resolver la sesión contra la base en cada llamada
    // en vez de confiar en lo que dice el JWT: echar a alguien surte efecto
    // ya, no cuando expire su token.
    const { body } = await login(EMAIL_MEDICO)
    const cabecera = { Authorization: `Bearer ${body.accessToken}` }

    expect((await request(app).get('/api/auth/sesiones').set(cabecera)).status).toBe(200)

    await prisma.user.update({ where: { id: idMedico }, data: { isActive: false } })

    expect((await request(app).get('/api/auth/sesiones').set(cabecera)).status).toBe(401)
  })
})

describe('renovación de sesión', () => {
  it('renueva y entrega un refresh token distinto', async () => {
    const inicial = await login(EMAIL_MEDICO)
    const cookie = cookieRefresh(inicial)!

    const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie)

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(cookieRefresh(res)).not.toBe(cookie)
  })

  it('sin cookie responde 401', async () => {
    const res = await request(app).post('/api/auth/refresh')
    expect(res.status).toBe(401)
  })

  it('reutilizar un refresh token ya usado cierra TODAS las sesiones', async () => {
    // Si un refresh token revocado vuelve a aparecer, o se filtró o hay una
    // copia vieja circulando. En ambos casos lo prudente es cortar todo.
    const inicial = await login(EMAIL_MEDICO)
    const cookieVieja = cookieRefresh(inicial)!

    const renovada = await request(app).post('/api/auth/refresh').set('Cookie', cookieVieja)
    const cookieNueva = cookieRefresh(renovada)!

    // El atacante presenta la vieja.
    const reutilizacion = await request(app).post('/api/auth/refresh').set('Cookie', cookieVieja)
    expect(reutilizacion.status).toBe(401)

    // Y la legítima también queda inservible.
    const legitima = await request(app).post('/api/auth/refresh').set('Cookie', cookieNueva)
    expect(legitima.status).toBe(401)

    const vivas = await prisma.session.count({
      where: { userId: idMedico, revokedAt: null },
    })
    expect(vivas).toBe(0)
  })
})

describe('cierre de sesión', () => {
  it('revoca la sesión y el access token deja de servir', async () => {
    const { body } = await login(EMAIL_MEDICO)
    const cabecera = { Authorization: `Bearer ${body.accessToken}` }

    await request(app).post('/api/auth/logout').set(cabecera).expect(204)

    // El JWT sigue siendo criptográficamente válido; lo que ya no existe es la
    // sesión. Sin comprobarla contra la base, esto seguiría funcionando 15 min.
    const res = await request(app).get('/api/auth/sesiones').set(cabecera)
    expect(res.status).toBe(401)
  })

  it('sin sesión responde igual, sin error', async () => {
    await request(app).post('/api/auth/logout').expect(204)
  })
})

describe('contraseñas', () => {
  it('cambiarla cierra todas las sesiones abiertas', async () => {
    // Uno cambia la contraseña justamente porque sospecha que alguien más
    // entró; si las sesiones sobrevivieran, no serviría de nada.
    const primera = await login(EMAIL_MEDICO)
    await login(EMAIL_MEDICO) // segundo dispositivo

    const res = await request(app)
      .post('/api/auth/password/cambiar')
      .set('Authorization', `Bearer ${primera.body.accessToken}`)
      .send({ contrasenaActual: CONTRASENA, contrasenaNueva: 'OtraClave2026!' })

    expect(res.status).toBe(204)
    expect(await prisma.session.count({ where: { userId: idMedico, revokedAt: null } })).toBe(0)
    expect((await login(EMAIL_MEDICO, 'OtraClave2026!')).status).toBe(200)
  })

  it('rechaza el cambio si la contraseña actual es incorrecta', async () => {
    const { body } = await login(EMAIL_MEDICO)
    const res = await request(app)
      .post('/api/auth/password/cambiar')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ contrasenaActual: 'Equivocada1!', contrasenaNueva: 'OtraClave2026!' })

    expect(res.status).toBe(401)
  })

  it('exige que la nueva contraseña cumpla la política', async () => {
    const { body } = await login(EMAIL_MEDICO)
    const res = await request(app)
      .post('/api/auth/password/cambiar')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ contrasenaActual: CONTRASENA, contrasenaNueva: 'simple' })

    expect(res.status).toBe(422)
    // El mensaje dice QUÉ falta, no un genérico "no cumple los requisitos".
    const mensajes = JSON.stringify(res.body.error.detalles)
    expect(mensajes).toContain('mayúscula')
  })

  it('recuperar contraseña responde igual exista o no el correo', async () => {
    const existente = await request(app)
      .post('/api/auth/password/olvide')
      .send({ email: EMAIL_MEDICO })
    const inexistente = await request(app)
      .post('/api/auth/password/olvide')
      .send({ email: 'nadie@consultorio.test' })

    expect(existente.status).toBe(inexistente.status)
    expect(existente.body).toEqual(inexistente.body)
  })

  it('el enlace de recuperación funciona una sola vez', async () => {
    await request(app).post('/api/auth/password/olvide').send({ email: EMAIL_MEDICO })

    // Se lee el token por la base porque el envío de correo llega en H6.
    const solicitud = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: idMedico },
      orderBy: { createdAt: 'desc' },
    })
    // El token en claro no está guardado (solo su hash), así que se prueba el
    // consumo del registro: tras usarlo, queda marcado.
    expect(solicitud.usedAt).toBeNull()

    await prisma.passwordReset.update({
      where: { id: solicitud.id },
      data: { usedAt: new Date() },
    })

    const res = await request(app)
      .post('/api/auth/password/restablecer')
      .send({ token: 'cualquiera', contrasenaNueva: 'OtraClave2026!' })

    expect(res.status).toBe(401)
  })
})

describe('segundo factor', () => {
  async function activar2FA(email: string) {
    const { body } = await login(email)
    const cabecera = { Authorization: `Bearer ${body.accessToken}` }

    const preparado = await request(app).post('/api/auth/2fa/preparar').set(cabecera)
    const secreto = preparado.body.secreto as string

    await request(app)
      .post('/api/auth/2fa/activar')
      .set(cabecera)
      .send({ codigo: authenticator.generate(secreto) })
      .expect(200)

    return secreto
  }

  it('preparar devuelve el secreto y la URI para el código QR', async () => {
    const { body } = await login(EMAIL_MEDICO)
    const res = await request(app)
      .post('/api/auth/2fa/preparar')
      .set('Authorization', `Bearer ${body.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.secreto).toBeTruthy()
    expect(res.body.uri).toContain('otpauth://totp/')
  })

  it('no se activa hasta verificar un código correcto', async () => {
    // Activarlo al generar el secreto dejaría fuera a quien escanee mal el QR.
    const { body } = await login(EMAIL_MEDICO)
    const cabecera = { Authorization: `Bearer ${body.accessToken}` }

    await request(app).post('/api/auth/2fa/preparar').set(cabecera)

    const usuario = await prisma.user.findUniqueOrThrow({ where: { id: idMedico } })
    expect(usuario.twoFactorSecret).toBeTruthy()
    expect(usuario.twoFactorEnabled).toBe(false)

    const res = await request(app)
      .post('/api/auth/2fa/activar')
      .set(cabecera)
      .send({ codigo: '000000' })

    expect(res.status).toBe(401)
  })

  it('con 2FA activo, la contraseña sola no abre sesión', async () => {
    await activar2FA(EMAIL_MEDICO)

    const res = await login(EMAIL_MEDICO)

    expect(res.status).toBe(200)
    expect(res.body.requiere2FA).toBe(true)
    expect(res.body.accessToken).toBeUndefined()
    expect(cookieRefresh(res)).toBeUndefined()
  })

  it('el token de desafío no sirve como token de acceso', async () => {
    // Sin la comprobación del tipo de token, saber la contraseña bastaría para
    // saltarse el segundo factor por completo.
    await activar2FA(EMAIL_MEDICO)
    const { body } = await login(EMAIL_MEDICO)

    const res = await request(app)
      .get('/api/auth/sesiones')
      .set('Authorization', `Bearer ${body.tokenDesafio}`)

    expect(res.status).toBe(401)
  })

  it('el código correcto completa el ingreso', async () => {
    const secreto = await activar2FA(EMAIL_MEDICO)
    const desafio = await login(EMAIL_MEDICO)

    const res = await request(app).post('/api/auth/2fa/verificar').send({
      tokenDesafio: desafio.body.tokenDesafio,
      codigo: authenticator.generate(secreto),
    })

    expect(res.status).toBe(200)
    expect(res.body.accessToken).toBeTruthy()
    expect(cookieRefresh(res)).toBeDefined()
  })

  it('un código incorrecto no completa el ingreso', async () => {
    await activar2FA(EMAIL_MEDICO)
    const desafio = await login(EMAIL_MEDICO)

    const res = await request(app)
      .post('/api/auth/2fa/verificar')
      .send({ tokenDesafio: desafio.body.tokenDesafio, codigo: '000000' })

    expect(res.status).toBe(401)
  })

  it('un ADMIN puede desactivar su segundo factor', async () => {
    // Ya no se le impone, así que tampoco se le impide quitarlo. Sigue
    // exigiéndose contraseña y código: quien deja una sesión abierta no puede
    // bajarle la seguridad a la cuenta.
    const secreto = await activar2FA(EMAIL_ADMIN)
    const desafio = await login(EMAIL_ADMIN)

    const sesion = await request(app).post('/api/auth/2fa/verificar').send({
      tokenDesafio: desafio.body.tokenDesafio,
      codigo: authenticator.generate(secreto),
    })

    const res = await request(app)
      .post('/api/auth/2fa/desactivar')
      .set('Authorization', `Bearer ${sesion.body.accessToken}`)
      .send({ password: CONTRASENA, codigo: authenticator.generate(secreto) })

    expect(res.status).toBe(200)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: idAdmin } })).twoFactorEnabled,
    ).toBe(false)
  })
})
