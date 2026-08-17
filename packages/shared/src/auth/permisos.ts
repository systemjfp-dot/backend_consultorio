/**
 * Catálogo de permisos del sistema.
 *
 * Vive en código y no en la base de datos a propósito (ver
 * datos/ROLES-Y-PERMISOS.md §6): así el compilador atrapa un `'patinet:read'`
 * mal escrito, la matriz se puede probar, y todo cambio queda en el historial
 * de git. Una pantalla donde el administrador pudiera concederse a sí mismo
 * `encounter:read` anularía el control de mínimo necesario que da sentido a
 * todo esto.
 *
 * Formato: `recurso:acción`.
 */

export const PERMISOS = [
  // --- Pacientes ---
  'patient:create',
  'patient:read',
  'patient:update',
  /// Borrado lógico. Una historia clínica nunca se elimina de verdad.
  'patient:delete',
  /// Exportar los datos del titular a pedido suyo (Ley 29733).
  'patient:export',
  /// Acceso de emergencia a una historia fuera del alcance propio.
  'patient:break_glass',

  // --- Agenda ---
  'appointment:create',
  'appointment:read',
  'appointment:update',
  'appointment:cancel',
  'appointment:reschedule',
  /// Marcar que el paciente llegó y pasa a sala de espera.
  'appointment:checkin',
  /// Agendar por encima de la capacidad, saltando el control de solapamiento.
  'appointment:overbook',
  'waitlist:manage',

  // --- Atención clínica ---
  /// Signos vitales. Separado del resto para que enfermería pueda tomar
  /// presión y peso sin poder tocar el diagnóstico.
  'encounter:vitals',
  'encounter:create',
  /// Contenido clínico: anamnesis, diagnóstico, plan. El permiso más sensible
  /// del sistema.
  'encounter:read',
  'encounter:update',
  /// Congela la atención. A partir de aquí solo se corrige por addendum.
  'encounter:complete',
  'encounter:addendum',

  // --- Recetas ---
  'prescription:create',
  'prescription:read',
  'prescription:sign',
  /// Reimprimir el PDF sin poder navegar el historial de diagnósticos:
  /// entregar la receta impresa es trabajo de recepción.
  'prescription:print',

  // --- Exámenes ---
  'exam:create',
  'exam:read',
  'exam:print',
  'exam:result_upload',

  // --- Personal y operación ---
  'staff:create',
  'staff:read',
  'staff:update',
  'staff:deactivate',
  'schedule:manage',
  'location:manage',

  // --- Configuración ---
  'settings:read',
  'settings:update',
  /// SMTP, WhatsApp, SUNAT, consulta de DNI.
  'integration:manage',

  // --- Facturación ---
  'invoice:create',
  'invoice:read',
  'invoice:void',

  // --- Reportes y auditoría ---
  'report:appointments',
  'report:patients',
  'report:financial',
  'audit:read',
] as const

export type Permiso = (typeof PERMISOS)[number]

const CONJUNTO_PERMISOS: ReadonlySet<string> = new Set(PERMISOS)

/** ¿La cadena corresponde a un permiso conocido? Valida entradas externas. */
export function esPermiso(valor: string): valor is Permiso {
  return CONJUNTO_PERMISOS.has(valor)
}

/**
 * Alcance de filas sobre las que aplica un permiso.
 *
 * Esto NO es un permiso más: dos médicos tienen exactamente el mismo
 * `encounter:read` y aun así no deben ver lo mismo. El requisito 4.5 del
 * documento maestro ("el médico ve solo sus propias citas") es una regla de
 * alcance, y se aplica en la capa de repositorio para que ningún endpoint
 * nuevo pueda olvidarla.
 */
export const ALCANCES = ['all', 'own'] as const
export type Alcance = (typeof ALCANCES)[number]

/** ¿`a` es al menos tan amplio como `b`? */
export function alcanceCubre(a: Alcance, b: Alcance): boolean {
  return a === 'all' || a === b
}

/** El más amplio de dos alcances. Se usa al unir varios roles. */
export function alcanceMasAmplio(a: Alcance, b: Alcance): Alcance {
  return a === 'all' || b === 'all' ? 'all' : 'own'
}
