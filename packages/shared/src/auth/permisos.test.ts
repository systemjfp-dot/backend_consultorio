import { describe, expect, it } from 'vitest'
import { PERMISOS, esPermiso, type Permiso } from './permisos.js'
import {
  MATRIZ_ROLES,
  ROLES,
  alcanceDe,
  listarPermisos,
  permisosHuerfanos,
  puede,
  type Rol,
  type SujetoPermisos,
} from './roles.js'

/** Atajo para construir un sujeto en las pruebas. */
const sujeto = (roles: Rol[], extra: string[] = [], denegados: string[] = []): SujetoPermisos => ({
  roles,
  extraPermissions: extra,
  deniedPermissions: denegados,
})

// =============================================================================
//  Separación entre lo administrativo y lo clínico
// =============================================================================
// Estas cuatro pruebas son el corazón del diseño. Si alguna se pone en rojo,
// alguien amplió un rol sin darse cuenta de lo que estaba abriendo.

describe('contenido clínico', () => {
  it('ADMIN no puede leer contenido clínico', () => {
    // Mínimo necesario (Ley 29733): quien gestiona horarios y facturación no
    // tiene justificación para leer diagnósticos.
    expect(puede(sujeto(['ADMIN']), 'encounter:read')).toBe(false)
    expect(puede(sujeto(['ADMIN']), 'encounter:update')).toBe(false)
    expect(puede(sujeto(['ADMIN']), 'prescription:read')).toBe(false)
  })

  it('RECEPTIONIST no puede leer contenido clínico', () => {
    expect(puede(sujeto(['RECEPTIONIST']), 'encounter:read')).toBe(false)
    expect(puede(sujeto(['RECEPTIONIST']), 'prescription:read')).toBe(false)
  })

  it('RECEPTIONIST sí puede imprimir recetas y órdenes', () => {
    // Entregar al paciente el documento impreso es su trabajo real.
    expect(puede(sujeto(['RECEPTIONIST']), 'prescription:print')).toBe(true)
    expect(puede(sujeto(['RECEPTIONIST']), 'exam:print')).toBe(true)
  })

  it('el dueño que además atiende (ADMIN + DOCTOR) sí lee lo clínico', () => {
    expect(puede(sujeto(['ADMIN', 'DOCTOR']), 'encounter:read')).toBe(true)
  })

  it('NURSE registra signos vitales pero no diagnósticos', () => {
    expect(puede(sujeto(['NURSE']), 'encounter:vitals')).toBe(true)
    expect(puede(sujeto(['NURSE']), 'encounter:read')).toBe(false)
    expect(puede(sujeto(['NURSE']), 'encounter:update')).toBe(false)
  })

  it('AUDITOR no accede a pacientes ni a lo clínico', () => {
    expect(puede(sujeto(['AUDITOR']), 'audit:read')).toBe(true)
    expect(puede(sujeto(['AUDITOR']), 'patient:read')).toBe(false)
    expect(puede(sujeto(['AUDITOR']), 'encounter:read')).toBe(false)
  })
})

// =============================================================================
//  Alcance de filas
// =============================================================================

describe('alcance', () => {
  it('el médico solo ve sus propias citas (requisito 4.5)', () => {
    expect(alcanceDe(sujeto(['DOCTOR']), 'appointment:read')).toBe('own')
    expect(puede(sujeto(['DOCTOR']), 'appointment:read', 'all')).toBe(false)
    expect(puede(sujeto(['DOCTOR']), 'appointment:read', 'own')).toBe(true)
  })

  it('recepción ve la agenda de todos los médicos', () => {
    expect(alcanceDe(sujeto(['RECEPTIONIST']), 'appointment:read')).toBe('all')
  })

  it('el médico lee la ficha de cualquier paciente, pero no su historia clínica', () => {
    // Necesita encontrar al paciente para poder atenderlo; lo que restringe el
    // alcance `own` es el contenido de las atenciones, no el padrón.
    expect(alcanceDe(sujeto(['DOCTOR']), 'patient:read')).toBe('all')
    expect(alcanceDe(sujeto(['DOCTOR']), 'encounter:read')).toBe('own')
  })

  it('al unir roles gana el alcance más amplio', () => {
    // ADMIN aporta `all` y DOCTOR `own`: un director médico ve todas las citas.
    expect(alcanceDe(sujeto(['ADMIN', 'DOCTOR']), 'appointment:read')).toBe('all')
  })

  it('el orden de los roles no altera el resultado', () => {
    expect(alcanceDe(sujeto(['DOCTOR', 'ADMIN']), 'appointment:read')).toBe(
      alcanceDe(sujeto(['ADMIN', 'DOCTOR']), 'appointment:read'),
    )
  })
})

// =============================================================================
//  Excepciones por usuario
// =============================================================================

describe('excepciones por usuario', () => {
  it('extraPermissions concede lo que el rol no da', () => {
    const recepcionistaConReportes = sujeto(['RECEPTIONIST'], ['report:appointments'])
    expect(puede(recepcionistaConReportes, 'report:appointments')).toBe(true)
    expect(alcanceDe(recepcionistaConReportes, 'report:appointments')).toBe('all')
  })

  it('deniedPermissions gana sobre el rol', () => {
    expect(puede(sujeto(['ADMIN'], [], ['invoice:void']), 'invoice:void')).toBe(false)
  })

  it('deniedPermissions gana también sobre extraPermissions', () => {
    // Permite suspender a alguien sin desactivar su cuenta.
    const s = sujeto(['RECEPTIONIST'], ['audit:read'], ['audit:read'])
    expect(puede(s, 'audit:read')).toBe(false)
  })

  it('una cadena que no es un permiso conocido se ignora sin romper nada', () => {
    // Un permiso renombrado no debe dejar a nadie sin poder iniciar sesión.
    const s = sujeto(['RECEPTIONIST'], ['permiso:inventado'], ['otro:inventado'])
    expect(() => listarPermisos(s)).not.toThrow()
    expect(listarPermisos(s)).not.toContain('permiso:inventado')
  })

  it('un usuario sin roles no puede nada', () => {
    expect(listarPermisos(sujeto([]))).toEqual([])
  })

  it('un rol desconocido no concede nada', () => {
    const s = { roles: ['SUPER_ADMIN' as unknown as Rol] }
    expect(listarPermisos(s)).toEqual([])
  })
})

// =============================================================================
//  Integridad del catálogo
// =============================================================================
// Invariantes que atrapan errores de mantenimiento, no de lógica.

describe('integridad del catálogo', () => {
  it('no hay permisos duplicados', () => {
    expect(new Set(PERMISOS).size).toBe(PERMISOS.length)
  })

  it('todo permiso sigue el formato recurso:acción', () => {
    for (const permiso of PERMISOS) {
      expect(permiso).toMatch(/^[a-z]+:[a-z_]+$/)
    }
  })

  it('ningún permiso queda huérfano', () => {
    // Un permiso que ningún rol concede está muerto: o falta asignarlo, o
    // sobra en el catálogo. Ambas cosas conviene saberlas.
    expect(permisosHuerfanos()).toEqual([])
  })

  it('todo rol concede al menos un permiso', () => {
    // Delata un rol añadido al enum y olvidado en la matriz.
    for (const rol of ROLES) {
      expect(Object.keys(MATRIZ_ROLES[rol]).length).toBeGreaterThan(0)
    }
  })

  it('la matriz solo usa permisos del catálogo', () => {
    for (const rol of ROLES) {
      for (const permiso of Object.keys(MATRIZ_ROLES[rol])) {
        expect(esPermiso(permiso)).toBe(true)
      }
    }
  })

  it('todo permiso concedido tiene un alcance válido', () => {
    for (const rol of ROLES) {
      for (const alcance of Object.values(MATRIZ_ROLES[rol])) {
        expect(['all', 'own']).toContain(alcance)
      }
    }
  })

  it('solo DOCTOR tiene break-the-glass', () => {
    // El acceso de emergencia existe para cubrir a un colega ausente. Que lo
    // tuviera un rol administrativo desvirtuaría todo el control de alcance.
    const conBreakGlass = ROLES.filter((r) => puede(sujeto([r]), 'patient:break_glass'))
    expect(conBreakGlass).toEqual(['DOCTOR'])
  })

  it('solo ADMIN administra personal, configuración e integraciones', () => {
    const sensibles: Permiso[] = [
      'staff:create',
      'staff:deactivate',
      'settings:update',
      'integration:manage',
      'patient:delete',
      'invoice:void',
    ]
    for (const permiso of sensibles) {
      const roles = ROLES.filter((r) => puede(sujeto([r]), permiso))
      expect(roles, `permiso ${permiso}`).toEqual(['ADMIN'])
    }
  })

  it('firmar una receta es exclusivo del médico', () => {
    const roles = ROLES.filter((r) => puede(sujeto([r]), 'prescription:sign'))
    expect(roles).toEqual(['DOCTOR'])
  })
})
