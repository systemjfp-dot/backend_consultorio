/**
 * Roles del sistema y matriz rol → permisos.
 *
 * `Rol` debe mantenerse en paralelo con el enum `Role` de schema.prisma.
 * La prueba de la matriz falla si alguno queda sin permisos, lo que delata un
 * rol añadido en un lado y olvidado en el otro.
 */

import {
  PERMISOS,
  alcanceCubre,
  alcanceMasAmplio,
  esPermiso,
  type Alcance,
  type Permiso,
} from './permisos.js'

export const ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'CASHIER', 'AUDITOR'] as const

export type Rol = (typeof ROLES)[number]

/** Permisos que concede un rol, cada uno con su alcance. */
export type Concesiones = Partial<Record<Permiso, Alcance>>

/**
 * MATRIZ DE PERMISOS
 * ==================
 *
 * Tres celdas concentran casi todo el criterio de diseño:
 *
 *  · ADMIN **no** tiene `encounter:read`. Un administrador que gestiona
 *    horarios y facturación no tiene por qué leer un diagnóstico. Bajo la Ley
 *    29733 los datos de salud son sensibles y rige el mínimo necesario. Si el
 *    dueño de la clínica además atiende, se le asignan ADMIN y DOCTOR, y
 *    entonces sí lo ve — pero por su rol de médico, y así queda auditado.
 *
 *  · RECEPTIONIST tampoco tiene `encounter:read`, pero sí
 *    `prescription:print`: entregar la receta impresa es su trabajo.
 *
 *  · DOCTOR tiene alcance `own` en todo lo clínico y en su agenda, tal como
 *    pide el requisito 4.5. Para las urgencias existe `patient:break_glass`.
 */
export const MATRIZ_ROLES: Record<Rol, Concesiones> = {
  /** Dueño o administrador. Todo lo operativo; nada del contenido clínico. */
  ADMIN: {
    'patient:create': 'all',
    'patient:read': 'all',
    'patient:update': 'all',
    'patient:delete': 'all',
    'patient:export': 'all',

    'appointment:create': 'all',
    'appointment:read': 'all',
    'appointment:update': 'all',
    'appointment:cancel': 'all',
    'appointment:reschedule': 'all',
    'appointment:overbook': 'all',
    'waitlist:manage': 'all',

    'exam:result_upload': 'all',

    'staff:create': 'all',
    'staff:read': 'all',
    'staff:update': 'all',
    'staff:deactivate': 'all',
    'schedule:manage': 'all',
    'location:manage': 'all',

    'settings:read': 'all',
    'settings:update': 'all',
    'integration:manage': 'all',

    'invoice:create': 'all',
    'invoice:read': 'all',
    'invoice:void': 'all',

    'report:appointments': 'all',
    'report:patients': 'all',
    'report:financial': 'all',
    'audit:read': 'all',
  },

  /** Médico. Todo lo clínico, restringido a sus propios pacientes y citas. */
  DOCTOR: {
    'patient:create': 'all',
    'patient:read': 'all',
    'patient:update': 'all',
    'patient:break_glass': 'all',

    'appointment:create': 'own',
    'appointment:read': 'own',
    'appointment:update': 'own',
    'appointment:cancel': 'own',
    'appointment:reschedule': 'own',
    'appointment:overbook': 'own',

    'encounter:vitals': 'own',
    'encounter:create': 'own',
    'encounter:read': 'own',
    'encounter:update': 'own',
    'encounter:complete': 'own',
    'encounter:addendum': 'own',

    'prescription:create': 'own',
    'prescription:read': 'own',
    'prescription:sign': 'own',
    'prescription:print': 'own',

    'exam:create': 'own',
    'exam:read': 'own',
    'exam:print': 'own',
    'exam:result_upload': 'own',

    'report:appointments': 'own',
    'report:patients': 'own',
  },

  /** Recepción. Pacientes y agenda de todos los médicos; nada clínico. */
  RECEPTIONIST: {
    'patient:create': 'all',
    'patient:read': 'all',
    'patient:update': 'all',

    'appointment:create': 'all',
    'appointment:read': 'all',
    'appointment:update': 'all',
    'appointment:cancel': 'all',
    'appointment:reschedule': 'all',
    'appointment:checkin': 'all',
    'appointment:overbook': 'all',
    'waitlist:manage': 'all',

    'prescription:print': 'all',
    'exam:print': 'all',

    'invoice:create': 'all',
    'invoice:read': 'all',
  },

  /** Enfermería y triaje. Signos vitales y llegada; sin diagnósticos. */
  NURSE: {
    'patient:read': 'all',

    'appointment:read': 'all',
    'appointment:checkin': 'all',

    'encounter:vitals': 'all',
    'exam:result_upload': 'all',
  },

  /**
   * Caja y facturación.
   * Ve al paciente para poder emitir el comprobante. Qué campos concretos
   * devuelve el endpoint es decisión del service, no de la matriz: el control
   * de acceso decide SI puede leer, la proyección decide QUÉ campos.
   */
  CASHIER: {
    'patient:read': 'all',
    'appointment:read': 'all',

    'invoice:create': 'all',
    'invoice:read': 'all',
    'report:financial': 'all',
  },

  /** Auditoría o contador externo. Solo lectura, sin datos clínicos. */
  AUDITOR: {
    'audit:read': 'all',
    'invoice:read': 'all',
    'report:appointments': 'all',
    'report:patients': 'all',
    'report:financial': 'all',
  },
}

/**
 * Lo mínimo que hace falta saber de un usuario para decidir si puede algo.
 * Deliberadamente no es el modelo `User` completo: así esta lógica se puede
 * probar sin base de datos y usar igual en el navegador.
 */
export interface SujetoPermisos {
  roles: readonly Rol[]
  /** Permisos concedidos por encima de los que dan sus roles. Alcance `all`. */
  extraPermissions?: readonly string[]
  /** Permisos revocados aunque sus roles los otorguen. Siempre ganan. */
  deniedPermissions?: readonly string[]
}

/**
 * Resuelve los permisos efectivos:
 *
 *     unión(roles) + extraPermissions − deniedPermissions
 *
 * Al unir roles se toma el alcance MÁS AMPLIO. Un usuario ADMIN + DOCTOR lee
 * las citas de todos (`all` de ADMIN gana sobre `own` de DOCTOR), que es lo
 * que se espera de un director médico.
 *
 * `deniedPermissions` se aplica al final y gana siempre, incluso sobre
 * `extraPermissions`. Sirve para suspender a alguien sin desactivar su cuenta.
 */
export function permisosEfectivos(sujeto: SujetoPermisos): Map<Permiso, Alcance> {
  const efectivos = new Map<Permiso, Alcance>()

  for (const rol of sujeto.roles) {
    const concesiones = MATRIZ_ROLES[rol]
    // Un rol desconocido (p. ej. leído de un token viejo) no concede nada.
    if (!concesiones) continue

    for (const [permiso, alcance] of Object.entries(concesiones) as [Permiso, Alcance][]) {
      const actual = efectivos.get(permiso)
      efectivos.set(permiso, actual ? alcanceMasAmplio(actual, alcance) : alcance)
    }
  }

  for (const extra of sujeto.extraPermissions ?? []) {
    // Se descartan en silencio las cadenas que no son permisos conocidos: un
    // permiso renombrado no debe romper el inicio de sesión de nadie.
    if (esPermiso(extra)) efectivos.set(extra, 'all')
  }

  for (const denegado of sujeto.deniedPermissions ?? []) {
    if (esPermiso(denegado)) efectivos.delete(denegado)
  }

  return efectivos
}

/**
 * ¿El sujeto tiene el permiso, con al menos el alcance pedido?
 *
 * - `puede(s, 'encounter:read')` → lo tiene con cualquier alcance.
 * - `puede(s, 'encounter:read', 'all')` → lo tiene sobre TODAS las filas.
 *
 * El middleware usa la primera forma (¿puede tocar este recurso?) y el
 * repositorio la segunda (¿hay que filtrar por sus propias filas?).
 */
export function puede(
  sujeto: SujetoPermisos,
  permiso: Permiso,
  alcanceRequerido?: Alcance,
): boolean {
  const concedido = permisosEfectivos(sujeto).get(permiso)
  if (!concedido) return false
  return alcanceRequerido ? alcanceCubre(concedido, alcanceRequerido) : true
}

/** Alcance con el que el sujeto tiene el permiso, o `undefined` si no lo tiene. */
export function alcanceDe(sujeto: SujetoPermisos, permiso: Permiso): Alcance | undefined {
  return permisosEfectivos(sujeto).get(permiso)
}

/** Lista plana de permisos efectivos. Útil para enviarla al frontend. */
export function listarPermisos(sujeto: SujetoPermisos): Permiso[] {
  return [...permisosEfectivos(sujeto).keys()].sort()
}

/** Todos los permisos que algún rol concede. Se usa en las pruebas de la matriz. */
export function permisosCubiertosPorRoles(): Set<Permiso> {
  const cubiertos = new Set<Permiso>()
  for (const rol of ROLES) {
    for (const permiso of Object.keys(MATRIZ_ROLES[rol]) as Permiso[]) {
      cubiertos.add(permiso)
    }
  }
  return cubiertos
}

/** Permisos declarados en el catálogo que ningún rol concede. */
export function permisosHuerfanos(): Permiso[] {
  const cubiertos = permisosCubiertosPorRoles()
  return PERMISOS.filter((p) => !cubiertos.has(p))
}
