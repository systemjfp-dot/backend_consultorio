import { describe, expect, it } from 'vitest'
import type { ContextoAuth } from './contexto.js'
import { ErrorProhibido } from './errores.js'
import { alcanceEsTotal, contextoPuede, exigirPermiso, filtroDeAlcance } from './permisos.js'

const contexto = (parcial: Partial<ContextoAuth>): ContextoAuth => ({
  usuarioId: 'u1',
  email: 'u1@clinica.test',
  sesionId: 's1',
  roles: [],
  extraPermissions: [],
  deniedPermissions: [],
  ...parcial,
})

const medico = contexto({ roles: ['DOCTOR'], doctorId: 'd1' })
const recepcion = contexto({ roles: ['RECEPTIONIST'] })
const admin = contexto({ roles: ['ADMIN'] })

describe('filtro de alcance', () => {
  it('alcance total no restringe filas', () => {
    expect(filtroDeAlcance(recepcion, 'appointment:read')).toEqual({})
  })

  it('alcance propio restringe al médico del contexto', () => {
    expect(filtroDeAlcance(medico, 'appointment:read')).toEqual({ doctorId: 'd1' })
  })

  it('permite indicar otro campo de pertenencia', () => {
    expect(filtroDeAlcance(medico, 'encounter:read', 'attendingDoctorId')).toEqual({
      attendingDoctorId: 'd1',
    })
  })

  it('sin el permiso, lanza en vez de devolver un filtro vacío', () => {
    // Devolver {} sería catastrófico: significa "sin restricción", es decir,
    // mostrarlo TODO a quien no tenía ni permiso para mirar.
    expect(() => filtroDeAlcance(recepcion, 'encounter:read')).toThrow(ErrorProhibido)
  })

  it('alcance propio sin médico asociado lanza en vez de abrir', () => {
    // Situación que no debería darse según la matriz. Si se diera —un rol mal
    // configurado, un médico desactivado— la única respuesta segura es negar.
    const roto = contexto({ roles: ['DOCTOR'] }) // sin doctorId
    expect(() => filtroDeAlcance(roto, 'encounter:read')).toThrow(ErrorProhibido)
  })

  it('un médico desactivado no conserva alcance sobre su agenda', () => {
    // `cargarSesion` omite doctorId cuando el médico está inactivo; el filtro
    // debe negar, no devolver la agenda completa.
    const desactivado = contexto({ roles: ['DOCTOR'] })
    expect(() => filtroDeAlcance(desactivado, 'appointment:read')).toThrow(ErrorProhibido)
  })

  it('ADMIN + DOCTOR obtiene alcance total, sin filtro por médico', () => {
    const director = contexto({ roles: ['ADMIN', 'DOCTOR'], doctorId: 'd1' })
    expect(filtroDeAlcance(director, 'appointment:read')).toEqual({})
  })

  it('un permiso denegado se comporta como si no existiera', () => {
    const limitado = contexto({
      roles: ['RECEPTIONIST'],
      deniedPermissions: ['appointment:read'],
    })
    expect(() => filtroDeAlcance(limitado, 'appointment:read')).toThrow(ErrorProhibido)
  })
})

describe('exigir permiso', () => {
  it('no lanza cuando el permiso existe', () => {
    expect(() => exigirPermiso(admin, 'staff:create')).not.toThrow()
  })

  it('lanza 403 cuando falta', () => {
    try {
      exigirPermiso(recepcion, 'staff:create')
      expect.unreachable('debió lanzar')
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorProhibido)
      expect((error as ErrorProhibido).estado).toBe(403)
    }
  })

  it('lanza cuando el alcance no alcanza', () => {
    // El médico tiene appointment:read, pero solo sobre lo suyo.
    expect(() => exigirPermiso(medico, 'appointment:read', 'all')).toThrow(ErrorProhibido)
    expect(() => exigirPermiso(medico, 'appointment:read', 'own')).not.toThrow()
  })
})

describe('consultas auxiliares', () => {
  it('contextoPuede refleja la matriz', () => {
    expect(contextoPuede(admin, 'encounter:read')).toBe(false)
    expect(contextoPuede(medico, 'encounter:read')).toBe(true)
  })

  it('alcanceEsTotal distingue quién ve todo', () => {
    expect(alcanceEsTotal(recepcion, 'appointment:read')).toBe(true)
    expect(alcanceEsTotal(medico, 'appointment:read')).toBe(false)
  })
})
