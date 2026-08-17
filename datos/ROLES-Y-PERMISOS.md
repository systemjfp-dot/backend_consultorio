# Diseño de roles y permisos (clínica única)

Complementa `PROPUESTA-MEJORAS.md`. Los roles **se conservan y se amplían**; lo único que se elimina del documento original es `SUPER_ADMIN`, cuyo propósito era administrar *otras* clínicas.

---

## 1. Tres problemas del diseño original

### 1.1 Un usuario no puede tener dos roles

```prisma
model User {
  role  Role   // ← un solo valor
}
```

En un consultorio real el dueño **es médico y administra**. Con `role` singular, el director médico tiene que elegir: o atiende pacientes o gestiona el personal. La solución de campo es crear dos cuentas para la misma persona — y ahí se rompe la auditoría (¿quién firmó la receta?) y la trazabilidad legal.

**Arreglo:** `roles Role[]`. Los permisos son la unión de los roles.

```prisma
model User {
  roles  Role[]  @default([RECEPTIONIST])
}
```

### 1.2 El rol no alcanza: falta el *alcance* (scope)

El requisito 4.5 dice *"Vista personal: **solo sus propias citas**"*. Eso no es un permiso, es un **alcance de filas**. Un `DOCTOR` y otro `DOCTOR` tienen el mismo permiso `encounter:read` pero **no pueden ver lo mismo**.

Si esto se resuelve con `if (user.role === 'DOCTOR')` esparcido por los controladores, tarde o temprano un endpoint se olvida del filtro y un médico ve la historia clínica de los pacientes de otro. Es el mismo tipo de fuga que el `tenantId` olvidado, solo que dentro de la clínica.

**Arreglo:** cada permiso lleva alcance `own` o `all`, y el filtrado se aplica **en la capa de repositorio**, no en el controlador.

### 1.3 No hay separación entre dato administrativo y dato clínico

El esquema original le da a `ADMIN` acceso implícito a todo, incluido `Attendance` (diagnósticos, notas). Bajo el principio de **mínimo necesario** de la Ley 29733 (los datos de salud son *datos sensibles*), un administrador que gestiona horarios y facturación no tiene justificación para leer el diagnóstico psiquiátrico de un paciente.

**Arreglo:** ADMIN ve el *hecho* de la atención (ocurrió, cuándo, con quién, cuánto duró) pero **no su contenido clínico**. Si el administrador además es médico, se le asignan ambos roles y entonces sí lo ve — pero por su rol de médico, y queda auditado como tal.

---

## 2. Roles propuestos

| Rol | Quién es | Núcleo |
|---|---|---|
| `ADMIN` | Dueño / administrador | Personal, horarios, sedes, configuración, reportes, facturación. **Sin contenido clínico.** |
| `DOCTOR` | Médico | Atención, diagnósticos, recetas, órdenes. Alcance propio + break-glass. |
| `RECEPTIONIST` | Recepción | Pacientes, agenda de todos los médicos, check-in, lista de espera. **Sin contenido clínico.** |
| `NURSE` | Enfermería / triaje | Signos vitales, check-in, alergias. Sin diagnósticos. |
| `CASHIER` | Caja / facturación | Comprobantes SUNAT, reporte financiero. |
| `AUDITOR` | Auditoría / contador externo | Solo lectura de logs y reportes agregados. Sin datos identificables. |

Los tres primeros son obligatorios (son los del documento). `NURSE`, `CASHIER` y `AUDITOR` cuestan casi nada al definirse desde el inicio y son imposibles de agregar limpiamente después, cuando ya hay 200 `if (role === 'ADMIN')` regados.

---

## 3. Catálogo de permisos

Formato `recurso:acción`. Definidos **en código** como constantes tipadas, no en la base de datos (ver §6 para el porqué).

```ts
export const PERMISSIONS = {
  // — Pacientes —
  'patient:create',
  'patient:read',
  'patient:update',
  'patient:delete',        // borrado lógico
  'patient:export',        // exportar datos del titular (Ley 29733)
  'patient:break_glass',   // acceso de emergencia fuera de alcance

  // — Agenda —
  'appointment:create',
  'appointment:read',
  'appointment:update',
  'appointment:cancel',
  'appointment:reschedule',
  'appointment:checkin',
  'appointment:overbook',  // sobreagendar saltando el límite de slots
  'waitlist:manage',

  // — Atención clínica —
  'encounter:vitals',      // signos vitales (enfermería)
  'encounter:create',
  'encounter:read',        // ← contenido clínico: diagnóstico, notas
  'encounter:update',
  'encounter:complete',    // congela la atención
  'encounter:addendum',    // corrige una atención ya congelada

  // — Recetas —
  'prescription:create',
  'prescription:read',
  'prescription:sign',
  'prescription:print',    // reimprimir PDF sin navegar diagnósticos

  // — Exámenes —
  'exam:create',
  'exam:read',
  'exam:print',
  'exam:result_upload',

  // — Personal y operación —
  'staff:create',
  'staff:read',
  'staff:update',
  'staff:deactivate',
  'schedule:manage',
  'location:manage',

  // — Configuración —
  'settings:read',
  'settings:update',
  'integration:manage',    // SMTP, WhatsApp, SUNAT, API de DNI

  // — Facturación —
  'invoice:create',
  'invoice:read',
  'invoice:void',

  // — Reportes y auditoría —
  'report:appointments',
  'report:patients',
  'report:financial',
  'audit:read',
} as const

export type Permission = typeof PERMISSIONS[number]
```

Notas de diseño:

- **`encounter:vitals` separado de `encounter:update`** — permite que enfermería tome presión y peso sin poder tocar el diagnóstico.
- **`prescription:print` separado de `prescription:read`** — recepción entrega al paciente la receta impresa (flujo real) sin poder navegar el historial de diagnósticos.
- **`encounter:complete` y `encounter:addendum` separados** — una atención completada se congela; corregirla genera un addendum firmado, nunca una reescritura silenciosa (ver `PROPUESTA-MEJORAS.md` §2.6).
- **`appointment:overbook` como permiso propio** — el módulo 4.2 pide advertir en sobreagenda; con esto además decides *quién* puede saltarse la advertencia.

---

## 4. Matriz rol → permisos

`all` = todas las filas · `own` = solo las propias · `—` = sin acceso

| Permiso | ADMIN | DOCTOR | RECEPTIONIST | NURSE | CASHIER | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `patient:create` | ✅ | ✅ | ✅ | — | — | — |
| `patient:read` | ✅ | all | all | all | básico | — |
| `patient:update` | ✅ | ✅ | ✅ | — | — | — |
| `patient:delete` | ✅ | — | — | — | — | — |
| `patient:export` | ✅ | — | — | — | — | — |
| `patient:break_glass` | — | ✅ | — | — | — | — |
| `appointment:create` | ✅ | own | all | — | — | — |
| `appointment:read` | all | **own** | all | all | all | — |
| `appointment:update` | all | own | all | — | — | — |
| `appointment:cancel` | all | own | all | — | — | — |
| `appointment:reschedule` | all | own | all | — | — | — |
| `appointment:checkin` | — | — | ✅ | ✅ | — | — |
| `appointment:overbook` | ✅ | own | ✅ | — | — | — |
| `waitlist:manage` | ✅ | — | ✅ | — | — | — |
| `encounter:vitals` | — | own | — | ✅ | — | — |
| `encounter:create` | — | own | — | — | — | — |
| `encounter:read` | **—** | own | **—** | — | — | — |
| `encounter:update` | — | own | — | — | — | — |
| `encounter:complete` | — | own | — | — | — | — |
| `encounter:addendum` | — | own | — | — | — | — |
| `prescription:create` | — | own | — | — | — | — |
| `prescription:read` | — | own | — | — | — | — |
| `prescription:sign` | — | own | — | — | — | — |
| `prescription:print` | — | own | ✅ | — | — | — |
| `exam:create` | — | own | — | — | — | — |
| `exam:read` | — | own | — | — | — | — |
| `exam:print` | — | own | ✅ | — | — | — |
| `exam:result_upload` | ✅ | own | — | ✅ | — | — |
| `staff:*` | ✅ | — | — | — | — | — |
| `schedule:manage` | ✅ | — | — | — | — | — |
| `location:manage` | ✅ | — | — | — | — | — |
| `settings:read` | ✅ | — | — | — | — | — |
| `settings:update` | ✅ | — | — | — | — | — |
| `integration:manage` | ✅ | — | — | — | — | — |
| `invoice:create` | ✅ | — | ✅ | — | ✅ | — |
| `invoice:read` | ✅ | — | ✅ | — | ✅ | ✅ |
| `invoice:void` | ✅ | — | — | — | — | — |
| `report:appointments` | ✅ | own | — | — | — | ✅ |
| `report:patients` | ✅ | own | — | — | — | ✅ |
| `report:financial` | ✅ | — | — | — | ✅ | ✅ |
| `audit:read` | ✅ | — | — | — | — | ✅ |

**Las tres celdas que importan:**

- `ADMIN` **no** tiene `encounter:read` — mínimo necesario. Si el dueño es médico, se le dan ambos roles.
- `RECEPTIONIST` **no** tiene `encounter:read` — puede agendar y reimprimir, no leer diagnósticos.
- `DOCTOR` tiene `appointment:read` con alcance **`own`**, exactamente como pide el requisito 4.5.

---

## 5. Excepciones por usuario

La matriz cubre el 95% de los casos. El 5% restante es real: *"esta recepcionista lleva 10 años y también arma los reportes"*. En vez de inventarle un rol nuevo:

```prisma
model User {
  roles              Role[]   @default([RECEPTIONIST])
  extraPermissions   String[] @default([])  // concedidos además del rol
  deniedPermissions  String[] @default([])  // revocados del rol
}
```

Resolución, en este orden:

```
permisos = (unión de los roles) + extraPermissions − deniedPermissions
```

`deniedPermissions` gana siempre. Sirve para suspender a alguien sin desactivar la cuenta.

---

## 6. Permisos en código, no en base de datos

Hay dos caminos:

| | Permisos en código | RBAC completo en BD (tablas `Role`, `Permission`, `RolePermission` + UI de matriz) |
|---|---|---|
| Seguridad de tipos | El compilador atrapa `'patinet:read'` | Error en runtime, en producción |
| Testeable | Sí, la matriz es un test | Depende del estado de la BD |
| Auditable | Está en el historial de git | Cambia sin dejar rastro salvo que audites la tabla |
| Configurable por el cliente | No (requiere despliegue) | Sí |
| Trabajo | ~1 día | ~1 semana + pantalla de administración |

**Recomiendo permisos en código + excepciones por usuario en BD (§5).** Una clínica sola no cambia su estructura de roles cada mes, y una pantalla donde el administrador puede otorgarse a sí mismo `encounter:read` anula todo el control de mínimo necesario que acabamos de diseñar.

---

## 7. Dónde se aplica (esto es lo que hace que funcione)

Tres capas, y **solo una es la autoridad**:

### Capa 1 — Middleware (puerta de entrada)

```ts
router.patch('/encounters/:id',
  requireAuth,
  requirePermission('encounter:update'),
  encounterController.update
)
```

Rechaza por permiso. **No sabe nada del alcance.**

### Capa 2 — Repositorio (el alcance, y es obligatoria)

El alcance **nunca** se filtra en el controlador. Se inyecta en el repositorio, de forma que sea imposible escribir una consulta sin él:

```ts
// El repositorio recibe el contexto y construye el filtro. No es opcional.
class EncounterRepository {
  constructor(private ctx: AuthContext) {}

  private scope() {
    if (this.ctx.can('encounter:read', 'all')) return {}
    if (this.ctx.can('encounter:read', 'own')) return { doctorId: this.ctx.doctorId }
    throw new ForbiddenError()
  }

  findMany(where: Prisma.AttendanceWhereInput) {
    return this.db.attendance.findMany({ where: { ...where, ...this.scope() } })
  }
}
```

Si alguien añade un endpoint nuevo y se olvida del alcance, el repositorio se lo pone igual. Es la misma disciplina que evitaba la fuga de `tenantId`, aplicada dentro de la clínica.

### Capa 3 — Frontend (solo estética)

Ocultar botones que el usuario no puede usar. **Nunca es control de acceso** — es para que la interfaz no mienta.

```tsx
{can('prescription:sign') && <BotonFirmar />}
```

---

## 8. Break-the-glass (acceso de emergencia)

Caso real: el Dr. A está de vacaciones, entra su paciente por urgencia y lo atiende la Dra. B. Con alcance `own` estricto, la Dra. B no ve los antecedentes — y eso puede ser peligroso.

La solución estándar en EMR **no es** abrir el acceso: es permitirlo dejando un rastro imposible de ignorar.

```
Médico intenta abrir una historia fuera de su alcance
  → modal: "Estás accediendo a la historia de un paciente que no es tuyo.
             Indica el motivo." (campo obligatorio, mínimo 20 caracteres)
  → acceso concedido por 60 minutos, solo a ese paciente
  → se registra en AuditLog con tipo BREAK_GLASS
  → notificación inmediata al ADMIN y al médico tratante
  → aparece destacado en el panel de auditoría
```

Sale gratis de implementar (es un permiso más, `patient:break_glass`, con un registro), y es la diferencia entre un sistema que aguanta una fiscalización y uno que no.

---

## 9. Auditoría de accesos: requisito legal, no opcional

Bajo la Ley 30024 (RENHICE) y la Ley 29733, el acceso a historias clínicas electrónicas debe quedar registrado. El documento original ya contempla `AuditLog` con acción `VIEW`, lo cual es correcto — pero (ver `PROPUESTA-MEJORAS.md` §2.6) esa tabla crece a millones de filas.

Ajustes:

- Tabla **append-only**, sin `UPDATE` ni `DELETE` (revocar esos permisos al usuario de la aplicación en PostgreSQL).
- **Particionada por mes** (`PARTITION BY RANGE (created_at)`), con retención definida.
- Registrar siempre: usuario, roles efectivos en ese momento, permiso ejercido, recurso, IP, user-agent, y si fue `BREAK_GLASS`.
- Los accesos de lectura a **contenido clínico** se registran siempre. Listados y búsquedas administrativas, no (o el log se vuelve ruido inservible).

---

## 10. Autenticación: ajustes al diseño original

| Punto | Documento | Propuesta |
|---|---|---|
| 2FA | "opcional" | **Obligatorio para `ADMIN`**, opcional para el resto. Es la cuenta que controla el personal y las integraciones. |
| Token | JWT de 24 h | Access token de **15 min** + refresh token rotativo con modelo `Session` (revocable). Con 24 h no puedes cerrar sesión de verdad ni echar a alguien el día que renuncia. |
| Permisos en el token | — | **No incrustar los permisos en el JWT.** Resolverlos por request desde `roles + extra − denied`. Si van dentro del token, quitarle un permiso a alguien tarda hasta 24 h en surtir efecto. |
| Desactivar usuario | `isActive` | Además: revocar todas sus sesiones al desactivarlo. |
| Primer usuario | Onboarding público | `npm run setup` crea el `ADMIN` inicial. |

---

## 11. Cambios concretos al esquema

```prisma
model User {
  id                String   @id @default(cuid())
  email             String   @unique
  password          String
  firstName         String
  lastName          String
  phone             String?

  roles             Role[]   @default([RECEPTIONIST])   // ← era `role Role`
  extraPermissions  String[] @default([])
  deniedPermissions String[] @default([])

  isActive          Boolean  @default(true)
  twoFactorSecret   String?
  twoFactorEnabled  Boolean  @default(false)

  doctor            Doctor?
  sessions          Session[]
  auditLogs         AuditLog[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

enum Role {
  ADMIN
  DOCTOR
  RECEPTIONIST
  NURSE
  CASHIER
  AUDITOR
}

model Session {
  id           String   @id @default(cuid())
  userId       String
  refreshToken String   @unique          // hash, no el token en claro
  userAgent    String?
  ipAddress    String?
  expiresAt    DateTime
  revokedAt    DateTime?
  createdAt    DateTime @default(now())

  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

`Receptionist` como modelo aparte (que el documento tenía) **deja de ser necesario**: no aportaba ningún campo propio más allá de la relación. `Doctor` sí se queda, porque tiene datos reales (colegiatura, especialidad, color, duración de consulta).

---

## 12. Qué hay que probar

La matriz de permisos es de las pocas cosas donde los tests se escriben solos y valen oro:

```ts
describe('permisos', () => {
  it('RECEPTIONIST no puede leer contenido clínico', () =>
    expect(can(['RECEPTIONIST'], 'encounter:read')).toBe(false))

  it('ADMIN no puede leer contenido clínico', () =>
    expect(can(['ADMIN'], 'encounter:read')).toBe(false))

  it('ADMIN + DOCTOR sí puede', () =>
    expect(can(['ADMIN', 'DOCTOR'], 'encounter:read')).toBe(true))

  it('DOCTOR solo ve sus propias citas', () =>
    expect(scopeOf(['DOCTOR'], 'appointment:read')).toBe('own'))

  it('deniedPermissions gana sobre el rol', () =>
    expect(can(['ADMIN'], 'invoice:void', { denied: ['invoice:void'] })).toBe(false))
})
```

Y una prueba de integración que recorra **todas** las rutas registradas y falle si alguna no declara `requirePermission`. Ese único test previene la vulnerabilidad más común de estos sistemas: el endpoint nuevo que alguien olvidó proteger.
