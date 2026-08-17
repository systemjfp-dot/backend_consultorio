/**
 * Menú de la aplicación.
 *
 * Cada entrada declara el permiso que la habilita. El menú se filtra con la
 * misma matriz que aplica el backend, así que una recepcionista no ve
 * "Auditoría" y un médico no ve "Personal".
 *
 * Esto es presentación, no seguridad: quien conozca la URL puede escribirla, y
 * ahí lo que decide es el servidor. Lo que se gana es no ofrecer puertas que
 * al abrirse responden 403.
 */

import type { Permiso } from '@consultorio/shared'

export interface EntradaMenu {
  ruta: string
  etiqueta: string
  /** Etiqueta corta para la barra inferior del móvil. */
  etiquetaCorta?: string
  icono: string
  /** Permiso necesario. Sin él, la entrada no se muestra. */
  permiso?: Permiso
  /** Aparece en la barra inferior del móvil (donde solo caben cinco). */
  enMovil?: boolean
}

export const MENU: EntradaMenu[] = [
  { ruta: '/', etiqueta: 'Inicio', icono: '⌂', enMovil: true },
  {
    ruta: '/agenda',
    etiqueta: 'Agenda',
    icono: '▤',
    permiso: 'appointment:read',
    enMovil: true,
  },
  {
    ruta: '/pacientes',
    etiqueta: 'Pacientes',
    icono: '☺',
    permiso: 'patient:read',
    enMovil: true,
  },
  {
    ruta: '/atencion',
    etiqueta: 'Atención',
    icono: '✚',
    permiso: 'encounter:create',
    enMovil: true,
  },
  {
    ruta: '/personal',
    etiqueta: 'Personal',
    icono: '⚇',
    permiso: 'staff:read',
  },
  {
    ruta: '/reportes',
    etiqueta: 'Reportes',
    icono: '◫',
    permiso: 'report:appointments',
  },
  {
    ruta: '/auditoria',
    etiqueta: 'Auditoría',
    icono: '⎙',
    permiso: 'audit:read',
  },
  {
    ruta: '/configuracion',
    etiqueta: 'Configuración',
    etiquetaCorta: 'Ajustes',
    icono: '⚙',
    permiso: 'settings:read',
  },
]

/** Entradas visibles para quien tiene estos permisos. */
export function menuVisible(puede: (permiso: Permiso) => boolean): EntradaMenu[] {
  return MENU.filter((entrada) => !entrada.permiso || puede(entrada.permiso))
}

/**
 * Entradas de la barra inferior del móvil.
 *
 * Se limita a cinco: es lo que cabe legiblemente en 360 px con objetivos
 * táctiles de 44 px. Si alguien tiene más módulos disponibles, el resto vive
 * en el menú de "Más".
 */
export function menuMovil(puede: (permiso: Permiso) => boolean): EntradaMenu[] {
  return menuVisible(puede)
    .filter((entrada) => entrada.enMovil)
    .slice(0, 5)
}
