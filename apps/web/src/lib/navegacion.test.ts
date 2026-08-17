import { describe, expect, it } from 'vitest'
import { MATRIZ_ROLES, listarPermisos, type Permiso, type Rol } from '@consultorio/shared'
import { MENU, menuMovil, menuVisible } from './navegacion.js'

/** Simula el `can()` de un usuario con estos roles. */
function puedeComo(...roles: Rol[]) {
  const permisos = new Set(listarPermisos({ roles }))
  return (permiso: Permiso) => permisos.has(permiso)
}

describe('menú según el rol', () => {
  it('la recepción no ve auditoría ni personal', () => {
    const etiquetas = menuVisible(puedeComo('RECEPTIONIST')).map((e) => e.etiqueta)

    expect(etiquetas).toContain('Agenda')
    expect(etiquetas).toContain('Pacientes')
    expect(etiquetas).not.toContain('Auditoría')
    expect(etiquetas).not.toContain('Personal')
    expect(etiquetas).not.toContain('Atención')
  })

  it('el médico ve atención pero no personal ni configuración', () => {
    const etiquetas = menuVisible(puedeComo('DOCTOR')).map((e) => e.etiqueta)

    expect(etiquetas).toContain('Atención')
    expect(etiquetas).toContain('Agenda')
    expect(etiquetas).not.toContain('Personal')
    expect(etiquetas).not.toContain('Configuración')
  })

  it('el administrador ve la gestión pero no la atención clínica', () => {
    // Coherente con la matriz: ADMIN no tiene encounter:create.
    const etiquetas = menuVisible(puedeComo('ADMIN')).map((e) => e.etiqueta)

    expect(etiquetas).toContain('Personal')
    expect(etiquetas).toContain('Configuración')
    expect(etiquetas).toContain('Auditoría')
    expect(etiquetas).not.toContain('Atención')
  })

  it('el dueño que además atiende ve ambas cosas', () => {
    const etiquetas = menuVisible(puedeComo('ADMIN', 'DOCTOR')).map((e) => e.etiqueta)

    expect(etiquetas).toContain('Personal')
    expect(etiquetas).toContain('Atención')
  })

  it('el auditor solo ve lo suyo', () => {
    const etiquetas = menuVisible(puedeComo('AUDITOR')).map((e) => e.etiqueta)

    expect(etiquetas).toEqual(['Inicio', 'Reportes', 'Auditoría'])
  })

  it('todos ven Inicio', () => {
    for (const rol of Object.keys(MATRIZ_ROLES) as Rol[]) {
      expect(menuVisible(puedeComo(rol)).map((e) => e.etiqueta)).toContain('Inicio')
    }
  })
})

describe('barra inferior del móvil', () => {
  it('nunca supera las cinco entradas', () => {
    // Es lo que cabe legible en 360 px con objetivos táctiles de 44 px.
    for (const rol of Object.keys(MATRIZ_ROLES) as Rol[]) {
      expect(menuMovil(puedeComo(rol)).length).toBeLessThanOrEqual(5)
    }
  })

  it('es un subconjunto del menú completo', () => {
    const completo = menuVisible(puedeComo('ADMIN', 'DOCTOR')).map((e) => e.ruta)
    for (const entrada of menuMovil(puedeComo('ADMIN', 'DOCTOR'))) {
      expect(completo).toContain(entrada.ruta)
    }
  })
})

describe('integridad del menú', () => {
  it('no hay rutas duplicadas', () => {
    const rutas = MENU.map((e) => e.ruta)
    expect(new Set(rutas).size).toBe(rutas.length)
  })

  it('los permisos declarados existen en la matriz', () => {
    // Un permiso mal escrito ocultaría la entrada para TODOS sin avisar.
    const conocidos = new Set(listarPermisos({ roles: Object.keys(MATRIZ_ROLES) as Rol[] }))
    for (const entrada of MENU) {
      if (entrada.permiso) expect(conocidos.has(entrada.permiso), entrada.permiso).toBe(true)
    }
  })
})
