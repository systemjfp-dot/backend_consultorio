# Plan de desarrollo

Sistema de gestión de consultorio médico — clínica única, multi-médico, multi-sede.
Basado en `PROMPT-MAESTRO.md` con las correcciones de `PROPUESTA-MEJORAS.md` y `ROLES-Y-PERMISOS.md`.

---

## Decisiones fijadas

| Área | Decisión |
|---|---|
| Arquitectura | **Clínica única** (sin multi-tenant). `ClinicSettings` singleton. |
| Backend | Express + TypeScript (ESM), capas `routes → controllers → services → repositories` |
| Base de datos | PostgreSQL 15 (local en desarrollo, Railway en producción) |
| ORM | Prisma |
| Frontend | React + TypeScript + Vite + Tailwind (mobile-first) |
| Datos servidor | React Query · Formularios: React Hook Form + Zod |
| Calendario | React Big Calendar (`resources` es MIT; en FullCalendar es de pago) |
| Contratos | Zod compartido en `packages/shared` entre API y web |
| PDF | Puppeteer (plantillas HTML+CSS) |
| Jobs | BullMQ + Redis (desde H6; antes no hace falta) |
| Búsqueda | `pg_trgm` (pacientes, CIE-10, medicamentos) |
| Auth | Access token 15 min + refresh rotativo con `Session` revocable. 2FA obligatorio para ADMIN. |
| Despliegue | Railway (Nixpacks) |

**Entorno local verificado:** Node 25.9.0 · pnpm 10.33.3 · PostgreSQL 15.17 corriendo · git 2.54. Sin Docker (no es necesario).

---

## Estructura del repositorio

```
ConsultarioMedico/
├── apps/
│   ├── api/                 # Express + Prisma
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── config/      # env tipado, constantes
│   │       ├── core/        # errores, logger, AuthContext, resultado
│   │       ├── middleware/  # auth, permisos, errores, rate limit
│   │       ├── modules/     # un directorio por dominio
│   │       │   └── <dominio>/ {routes, controller, service, repository}
│   │       ├── app.ts
│   │       └── server.ts
│   └── web/                 # React + Vite
│       └── src/
│           ├── components/  # ui/ compartidos
│           ├── features/    # un directorio por dominio
│           ├── hooks/
│           ├── lib/         # cliente api, auth, permisos
│           ├── layouts/
│           └── pages/
├── packages/
│   └── shared/              # Zod, tipos, catálogo de permisos, matriz de roles
├── datos/                   # documentación (este archivo)
├── pnpm-workspace.yaml
└── README.md
```

**Por qué monorepo:** el catálogo de permisos y los esquemas Zod se definen **una vez** y los consumen API y web. Elimina la clase entera de bugs de contrato desalineado y hace que el frontend sepa, con tipos, qué puede hacer cada rol.

---

## Convenciones

- **Idioma:** código y comentarios en español para lógica de negocio (`crearCita`, `calcularSlotsDisponibles`); nombres de tablas/campos Prisma en inglés (convención del ORM).
- **Fechas:** todo `DateTime` en UTC (`@db.Timestamptz`). Horarios plantilla en **minutos desde medianoche** (`Int`), interpretados en el timezone de `ClinicSettings`. **Una sola** utilidad hace la conversión.
- **Errores:** clases tipadas (`NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError`) + un único middleware que las traduce a HTTP.
- **Validación:** Zod en el borde (request), siempre. El service recibe datos ya válidos y tipados.
- **Alcance (scope):** se aplica en el **repositorio**, nunca en el controlador.
- **Commits:** uno por paso del plan, con el identificador (`H0.4: middleware de permisos`).

---

## Hitos

Cortes **verticales**: cada hito entrega backend + frontend funcionando de punta a punta. Después de **H2** la clínica ya puede usar el sistema en paralelo a su método actual.

### H0 — Cimientos (auth + RBAC + auditoría)

| Paso | Contenido | Hecho cuando |
|---|---|---|
| **H0.1** | Monorepo, git, TypeScript, ESLint/Prettier, `.env`, scripts | `pnpm build` pasa en los 3 paquetes |
| **H0.2** | Esquema Prisma completo + migración + constraints SQL (exclusión de solapamiento, `CHECK` singleton, `pg_trgm`) | La migración aplica en la BD local sin errores |
| **H0.3** | `packages/shared`: catálogo de permisos, matriz de roles, resolución `roles + extra − denied` + **tests de la matriz** | Los tests de permisos pasan |
| **H0.4** | Núcleo API: env tipado, errores, logger, `app.ts`, `/health`, Helmet/CORS/rate-limit | `GET /health` responde |
| **H0.5** | Auth: login, refresh rotativo, logout, `Session`, 2FA (TOTP), recuperación de contraseña | Login devuelve tokens; refresh rota; logout revoca |
| **H0.6** | RBAC: `AuthContext`, `requirePermission`, repositorio con alcance, break-the-glass | Test: todas las rutas declaran permiso |
| **H0.7** | Auditoría: tabla append-only particionada, servicio de registro, `BREAK_GLASS` | Un acceso clínico queda registrado |
| **H0.8** | `npm run setup`: crea `ClinicSettings` + primer ADMIN. Seed de desarrollo. | Se puede instalar desde cero |
| **H0.9** | Frontend: Vite, Tailwind, router, layout (sidebar escritorio + tabs móvil), login, rutas protegidas, `can()` | Iniciar sesión y ver un panel vacío según rol |

### H1 — Pacientes
Modelo, CRUD, búsqueda con `pg_trgm`, perfil, borrado lógico, adaptador de consulta por DNI (interfaz + implementación falsa hasta tener credenciales). Frontend: registro, buscador en vivo, ficha de paciente.
**Hecho cuando:** la recepción puede registrar y encontrar pacientes reales.

### H2 — Agenda ← *aquí el sistema empieza a ser útil*
`Location`, `Schedule` (minutos, sin solapamiento), **motor de disponibilidad** (TDD estricto), `Appointment` con constraint de exclusión, estados incluido `ARRIVED`, sobreagenda con permiso, reprogramación. Frontend: calendario día/semana/mes, columna por médico con color, modal de creación, arrastrar para reprogramar.
**Hecho cuando:** se agenda un día completo sin conflictos y el médico ve solo lo suyo.

### H3 — Atención en consultorio
`Attendance` (revisada contra NTS 139: antecedentes, examen físico), signos vitales + IMC calculado, catálogo CIE-10 cargado con búsqueda difusa, congelar al completar + addendum. Frontend: ficha mobile-first para tablet, botones grandes.
**Hecho cuando:** un médico documenta una consulta completa desde una tablet.

### H4 — Recetas → **fin del MVP**
`Prescription` + `MedicineItem`, catálogo de medicamentos, plantillas del médico, firma registrada en el perfil (no dibujada por receta), PDF con Puppeteer y membrete, hash del PDF y campos listos para firma con certificado.
**Hecho cuando:** el paciente se lleva una receta impresa correcta.

### H5 — Exámenes
`MedicalExam`, catálogo por tipo, plantillas, PDF con QR, carga de resultados.

### H6 — Notificaciones y reducción de inasistencias
BullMQ + Redis, recordatorios 24 h, **link firmado de confirmación/cancelación/reprogramación sin login**, WhatsApp Business + email, gatillo automático a lista de espera al cancelar, WebSockets (sala de espera, "llamar al siguiente").
**Hecho cuando:** un paciente confirma su cita desde el celular sin iniciar sesión.

### H7 — Cierre
Reportes (citas, pacientes) con exportación, panel de auditoría, PWA (lectura offline + borrador local), Swagger, despliegue en Railway con backups.

> **FHIR R4 queda fuera del alcance** (decisión del 18/08/2026). Es un consultorio pequeño: el esfuerzo de mapeo no se paga con nadie con quien interoperar. La exportación a Excel cubre lo que hoy se necesita sacar del sistema.

### Después del MVP (evaluar con el sistema ya en uso)
Portal de auto-agendamiento · Teleconsulta · Facturación electrónica SUNAT · Escriba clínico con IA · Sugerencia de CIE-10 · Resumen del paciente · Predicción de inasistencia.

---

## Ritmo de trabajo

Un paso a la vez. Al terminar cada paso: qué se hizo, qué verifiqué, qué falta — y sigues tú antes de continuar. Cada paso queda en un commit propio para poder revertir.
