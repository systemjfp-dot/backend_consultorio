# Propuesta: de SaaS multi-tenant a sistema de clínica única + mejoras

Análisis del `PROMPT-MAESTRO.md` con investigación de mercado y normativa peruana (agosto 2026).

---

## PARTE 1 — Cómo quitar el multi-tenant

### 1.1 Qué se elimina

| Elemento | Acción |
|---|---|
| `model Tenant` | Eliminar |
| `tenantId` en 14 modelos | Eliminar (con sus 14 `@@index([tenantId])`) |
| Rol `SUPER_ADMIN` | Eliminar del enum `Role` |
| Módulo 8 completo (SuperAdmin) | Eliminar |
| Módulo 1.1 (registro público de clínicas) | Eliminar |
| Middleware de resolución de subdominio | Eliminar |
| DNS wildcard `*.sistema.com` + certificado wildcard | Eliminar |
| `User.tenantId String?` ("NULL para SUPER_ADMIN") | Eliminar |

**El beneficio real no es escribir menos código, es eliminar una clase entera de bugs.** En un multi-tenant con `tenantId` por fila, olvidar un `where: { tenantId }` en *una sola* consulta expone datos de una clínica a otra. Con datos de salud eso es una brecha reportable bajo la Ley 29733. Son ~200 consultas donde no te puedes equivocar ni una vez.

### 1.2 Qué reemplaza al `Tenant`

`Tenant` no desaparece del todo: la configuración de la clínica (nombre, RUC, logo, horarios por defecto, duración de citas) sigue siendo necesaria y editable desde el panel. Se convierte en un **singleton**:

```prisma
model ClinicSettings {
  id                  Int      @id @default(1)  // fila única
  name                String
  ruc                 String
  address             String
  phone               String
  email               String
  logo                String?
  timezone            String   @default("America/Lima")
  defaultSlotMinutes  Int      @default(20)
  config              Json
  updatedAt           DateTime @updatedAt

  @@map("clinic_settings")
}
```

Se fuerza la fila única con un `CHECK (id = 1)` en una migración manual. Un `getSettings()` cacheado en memoria y ya.

### 1.3 Qué se simplifica

- **`Patient.document`** pasa de `@@unique([document, tenantId])` a `@unique`. La búsqueda por DNI se vuelve trivial y con índice directo.
- **Instalación**: en vez de onboarding público de 3 pasos, un comando `npm run setup` (o un seed) que pide datos de la clínica y crea el primer ADMIN. 20 líneas en vez de un módulo.
- **Despliegue**: un servicio, un dominio, un certificado. Railway sin configuración de wildcard.
- **Login**: `clinica.com/login` directo, sin resolver subdominio antes de autenticar.

### 1.4 Qué SÍ conservar

**Las sedes (`Location`) siguen teniendo sentido** — una clínica con local en Miraflores y otro en San Isidro. Y aquí hay que corregir una inconsistencia del documento original: pide "Módulo 2.5: Gestión de Sedes (CRUD)" pero en el esquema la sede es un `String?` suelto en `Schedule` y `Appointment` (`"Sede Norte"`). Sin tabla no hay CRUD, ni integridad, ni forma de renombrar una sede sin actualizar miles de filas de texto.

```prisma
model Location {
  id        String   @id @default(cuid())
  name      String   @unique
  address   String
  phone     String?
  isActive  Boolean  @default(true)

  schedules    Schedule[]
  appointments Appointment[]
}
```

Igual con **multi-médico y roles ADMIN/DOCTOR/RECEPTIONIST**: eso no era multi-tenancy, es el corazón del producto. Se queda intacto.

### 1.5 Puerta de salida (si algún día quieres multi-clínica)

No reintroduzcas `tenantId`. El patrón barato es **una base de datos por clínica**, misma aplicación: resuelves el `DATABASE_URL` por subdominio y creas un `PrismaClient` por conexión. Aislamiento físico, cero riesgo de fuga, cero cambios de esquema. Es como escalan la mayoría de los EMR de nicho.

---

## PARTE 2 — Problemas del diseño actual (antes de escribir código)

Estos son errores reales en el esquema Prisma del documento, no opiniones de estilo.

### 2.1 El esquema Prisma no compila

Prisma exige que **ambos lados** de una relación estén declarados. Faltan:

- `Tenant` declara 8 relaciones pero 14 modelos apuntan a él. Faltan `receptionists`, `waitlists`, `medicineItems`, `auditLogs`, `notificationConfigs`, `notifications`.
- `Appointment` declara `waitlist Waitlist?` pero `Waitlist` **no tiene `appointmentId`**. La relación es imposible.
- `Patient` y `Doctor` no declaran `waitlists Waitlist[]`.
- `User` no declara `auditLogs AuditLog[]`.

### 2.2 `@@unique([doctorId, date])` es un falso seguro y además rompe requisitos

```prisma
@@unique([doctorId, date]) // Evitar doble reserva
```

Tres problemas:

1. **No previene solapamientos.** Una cita a las 09:00 de 20 min y otra a las 09:10 de 20 min se pisan, pero las fechas son distintas → el constraint las acepta. El campo `duration` existe pero el constraint lo ignora.
2. **Bloquea la sobreagenda que el propio documento pide.** El módulo 4.2 dice *"si es sobreagenda (overbooking), mostrar advertencia"* — advertencia implica que se permite. El constraint lo hace imposible.
3. **Las citas canceladas siguen ocupando el slot.** Cancelas la cita de las 10:00 y no puedes agendar otra a esa hora nunca más.

**Solución correcta** — constraint de exclusión de PostgreSQL sobre rangos de tiempo:

```sql
ALTER TABLE appointments ADD COLUMN time_range tstzrange
  GENERATED ALWAYS AS (tstzrange(date, date + (duration || ' minutes')::interval)) STORED;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (doctor_id WITH =, time_range WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW'));
```

La base de datos garantiza el no-solapamiento incluso con dos recepcionistas agendando en el mismo milisegundo. Para permitir sobreagenda explícita, se añade `allowOverbook` y se excluye del constraint. Esto es imposible de lograr correctamente solo con validación en el service.

### 2.3 `Schedule` tampoco previene lo que dice prevenir

`@@unique([doctorId, dayOfWeek, startTime])` deja pasar Lunes 08:00–13:00 y Lunes 09:00–11:00. El requisito 2.2 dice explícitamente *"Validación: No superponer horarios"*. Mismo remedio (exclusión) o validación en transacción.

Además, `startTime String // "08:00"` debería ser `Int` (minutos desde medianoche: `480`). Comparar `"9:00" < "10:00"` como texto da falso. Con enteros toda la matemática de slots es aritmética simple.

### 2.4 Zonas horarias: la fuente #1 de bugs de agenda

El esquema mezcla `DateTime` absolutos (`Appointment.date`) con horas locales en texto (`Schedule.startTime`). Regla a fijar **antes de la primera línea**:

- Todo `DateTime` se guarda en **UTC** (`@db.Timestamptz`).
- Los horarios plantilla son **minutos locales** (`Int`), interpretados en el timezone de `ClinicSettings`.
- **Una sola función** convierte plantilla → instantes UTC. Nadie más hace aritmética de fechas.

Sin esto, el sistema falla en cambios de horario, en pacientes que abren el link desde otro país, y en cualquier reporte agrupado por día.

### 2.5 La firma digital dibujada no tiene valor legal en Perú

El documento propone dibujar la firma con el dedo y guardarla como PNG base64 (`Prescription.signatureData`). Dos problemas:

1. **Legal.** El D.S. 098-2025-PCM (julio 2025) y la Directiva MINSA 343-2023 empujan la **firma electrónica con certificado digital** para documentos de salud. Una imagen dibujada es un dibujo, no una firma electrónica: no prueba autoría ni integridad del documento.
2. **Técnico.** Guardar base64 en una columna infla cada fila y ralentiza toda consulta que toque la tabla.

**Recomendación:** la firma pertenece al **médico**, no a cada receta. Se registra una vez en su perfil (imagen en storage + referencia). Y se diseña `Prescription` para soportar firma criptográfica (PAdES sobre el PDF) desde el inicio, aunque arranques solo con la imagen:

```prisma
model Prescription {
  // ...
  pdfUrl          String?
  pdfHash         String?    // SHA-256 del PDF firmado
  signatureType   SignatureType @default(DRAWN)  // DRAWN | CERTIFICATE
  certSerial      String?
  signedAt        DateTime?
}
```

Migrar a firma con certificado después es fácil si el modelo lo contempla; es una reescritura si no.

### 2.6 Otros puntos

| Punto | Problema | Arreglo |
|---|---|---|
| `bmi Float?` "calculado automáticamente" | Campo editable → se desincroniza de peso/talla | Columna generada de PostgreSQL, o calcular en el service y nunca aceptarlo del cliente |
| Sin `onDelete` en ninguna relación | El requisito 8.2 pide "eliminar con backup" → fallará por FK | `onDelete: Restrict` explícito en todo lo clínico |
| Sin borrado lógico | Una historia clínica **no se borra** legalmente | `deletedAt DateTime?` + política de retención |
| Atención editable para siempre | Un EMR real no permite reescribir el pasado | Al completar, la atención se congela; correcciones vía **addendum** con autor y fecha |
| Rate limit "100/min por IP" | La clínica entera sale por un solo NAT: 5 recepcionistas comparten cuota | Límite **por usuario autenticado**; por IP solo en `/login` y rutas públicas |
| JWT 24h + "refresh token" | No hay modelo para refresh tokens ni revocación → no puedes cerrar sesión de verdad | Modelo `Session` con rotación y revocación; access token de 15 min |
| Auditar `VIEW` en tabla con `Json` | Crece a millones de filas en meses | Tabla append-only **particionada por mes** + retención (pero el log de accesos **sí es obligatorio** en HCE) |
| "Jobs con cron" en el proceso web | Si Railway reinicia o escalas a 2 réplicas: recordatorios duplicados o ninguno | **BullMQ + Redis**, jobs idempotentes con clave única por cita |

### 2.7 Cuidado con la licencia de FullCalendar

El documento propone "React Big Calendar o FullCalendar". Para la vista multi-médico (una columna por doctor) FullCalendar requiere el plugin **`resourceTimeGrid`, que es de licencia comercial de pago**. Las vistas gratuitas (MIT) no incluyen recursos.

**React Big Calendar tiene `resources` en su versión MIT** → es la opción correcta aquí. Alternativa moderna: `@schedule-x/calendar`.

---

## PARTE 3 — Qué añadir (priorizado por impacto/esfuerzo)

### A. Alto impacto, bajo esfuerzo — hazlo en el MVP

**A1. Confirmación del paciente por link firmado (no solo recordatorio)**
El documento envía el recordatorio pero no captura la respuesta. Ahí está el 80% del valor: los recordatorios automáticos con auto-confirmación del paciente reducen no-shows **30–40%**. Solo email tiene ~30% de apertura; email + mensajería sube la confirmación por encima del **80%**. Un consultorio pierde en promedio ~US$150.000 por médico al año en inasistencias.

Implementación: el recordatorio incluye un link con token firmado (JWT corto, sin login) → página con tres botones: **Confirmar / Cancelar / Reprogramar**. Si cancela, se dispara automáticamente la notificación a la lista de espera (que el documento ya contempla pero sin gatillo).

**A2. WhatsApp como canal primario, no SMS**
En Perú el SMS tiene costo y baja lectura; WhatsApp es donde la gente responde. `NotificationConfig` ya lo menciona pero el flujo 9.1 solo dice "Email y SMS". Usa WhatsApp Business Cloud API con plantillas aprobadas (las plantillas de utilidad para recordatorios de cita están explícitamente permitidas).

**A3. Autocompletar paciente por DNI**
El registro pide DNI; con una API de consulta autocompletas nombres y apellidos y el registro baja de 90 a 15 segundos. Ojo: **RENIEC no expone API pública directa**. Opciones: servicio oficial de RENIEC (~S/ 0.40 por consulta, requiere convenio) o intermediarios (`apis.net.pe`, `json.pe`, `decolecta`, `Factiliza`) con planes gratuitos limitados. Diseña esto como un adaptador reemplazable.

**A4. Catálogo CIE-10 precargado**
El documento pide "campo de búsqueda con autocompletado" pero no dice de dónde salen los códigos. Sin catálogo el campo queda vacío para siempre. Carga el CIE-10 en español (MINSA lo publica) en una tabla con `pg_trgm` para búsqueda difusa: escribes "diabet" y salen los códigos E10–E14.

**A5. Vademécum de medicamentos**
Mismo problema: sin catálogo el médico teclea "Paracetamol 500mg" a mano cada vez, con errores. DIGEMID publica el catálogo de productos farmacéuticos registrados. Autocompleta nombre + concentración + forma farmacéutica.

**A6. Plantillas del médico ("mis recetas frecuentes")**
Un médico receta las mismas 10–20 combinaciones. Un botón "aplicar plantilla" ahorra más tiempo diario que cualquier otra función de esta lista. Vale también para órdenes de examen e indicaciones.

**A7. Estado `ARRIVED` + pantalla de sala de espera**
El flujo del documento va de `CONFIRMED` a `IN_ATTENTION` sin registrar la llegada. Falta: recepción marca "llegó" → el médico ve su cola en tiempo real → al terminar, WebSocket avisa a recepción "llamar al siguiente". La infraestructura de WebSockets ya está prevista; solo falta el estado.

### B. Alto impacto, esfuerzo medio

**B1. Portal del paciente con auto-agendamiento**
El añadido funcional más grande posible. **~80% de los pacientes prefiere reservar online**, y las clínicas que lo activan ven **35–45% menos llamadas de agenda en 90 días**. Página pública `/reservar` que muestra solo slots realmente libres. Reutiliza al 100% el motor de disponibilidad que ya tienes que construir para recepción.

**B2. Teleconsulta**
El mercado de telemedicina en LatAm creció a US$7.6 mil millones en 2025, proyectado a US$38.2 mil millones en 2034 (~19% anual), con Perú entre los países líderes. El cambio de modelo es mínimo:

```prisma
enum Modality { PRESENCIAL, TELECONSULTA }
// Appointment: modality Modality @default(PRESENCIAL), roomUrl String?
```

No construyas WebRTC desde cero: usa Daily.co, Twilio Video o LiveKit.

**B3. Facturación electrónica SUNAT**
El documento lo marca "Reporte Financiero (Opcional)". Para un consultorio que cobra, emitir boleta/factura electrónica **es obligatorio** si está en el RUC y supera los umbrales. No lo construyas: intégrate por API con un PSE/OSE (NubeFacT, Factpro, apisunat) o usa la librería Greenter. Modelo `Invoice` ligado a `Attendance`, con almacenamiento del XML firmado y del CDR de respuesta de SUNAT.

**B4. Cola de trabajos real (BullMQ + Redis)**
Ver 2.6. Es infraestructura, pero sin ella los recordatorios son poco fiables — y un recordatorio poco fiable es peor que ninguno.

### C. Diferenciadores con IA

**C1. Escriba clínico ambiental (el de mayor impacto medido)**
La evidencia es contundente: tras 30 días con un escriba ambiental, el burnout bajó de **51.9% a 38.8%** en clínicos ambulatorios de seis sistemas de salud de EE.UU. (JAMA Network Open, 2025). El tiempo de documentación cae **41%**, cerca de una hora al día. El 84% de médicos reportó efecto positivo en la comunicación con el paciente.

En tu sistema encaja exactamente en la Sección 3 de la ficha de atención: botón **"grabar consulta"** en la tablet → transcripción (Whisper) → un LLM genera borrador de motivo / enfermedad actual / diagnóstico / plan → **el médico revisa y edita antes de guardar**. Nunca se guarda sin revisión humana.

Requisitos no negociables: **consentimiento explícito del paciente** registrado en el sistema, aviso visible de grabación, y política de retención del audio (recomendado: borrar el audio tras generar la nota).

**C2. Sugerencia de CIE-10 desde el texto del diagnóstico**
El médico escribe en prosa; el sistema propone 3 códigos y él elige. Riesgo bajo (siempre hay confirmación humana), ahorro alto. Complementa A4.

**C3. Resumen del paciente al abrir la ficha**
*"Mujer de 54 años. HTA en tratamiento con enalapril 10mg desde 2024. Alergia a penicilina. Última consulta hace 3 meses por cefalea; se ordenó TAC (sin resultado cargado)."* Generado del historial. Evita leer 10 atenciones previas en cada consulta.

**C4. Predicción de inasistencia** (fase 2, necesita histórico)
Marcar citas de alto riesgo para sobreagendar o llamar antes.

### D. Cumplimiento normativo peruano — decide temprano, cuesta caro después

**D1. RENHICE / Ley 30024**
El Registro Nacional de Historias Clínicas Electrónicas avanza: el reglamento se modificó por **D.S. 020-2025-SA** y el MINSA aprobó el plan de implementación. Los sistemas de HCE deben poder **interoperar con RENHICE** usando los estándares del MINSA, con registros codificados en CIE-10 y firma electrónica por profesional responsable.

**Recomendación pragmática:** no reescribas tu esquema en FHIR (para una clínica sola es sobrecosto puro).

> **Decidido el 18/08/2026: nada de FHIR, tampoco el endpoint de exportación.** Es un consultorio pequeño y hoy no hay con quién interoperar; construirlo sería trabajo que envejece sin usarse. Lo que sí se mantiene es lo que RENHICE exigiría de todos modos y ya aporta valor por sí solo: diagnósticos codificados en CIE-10, firma del profesional responsable y registro de accesos. Si algún día aparece la obligación real, se hace entonces sobre un esquema limpio.

**D2. NTS 139-MINSA/2018** define los campos obligatorios de la historia clínica. Vale contrastar el modelo `Attendance` contra esa norma antes de codificar: probablemente falten antecedentes (patológicos, familiares, quirúrgicos), examen físico por sistemas y datos de filiación completos.

**D3. Ley 29733 (Protección de Datos Personales)**
Los datos de salud son **datos sensibles**: cifrado en reposo y en tránsito, consentimiento informado, y registro del banco de datos ante la ANPD. Añade al sistema: consentimiento versionado por paciente, log de accesos consultable, y exportación/eliminación a pedido del titular.

**D4. Backups y recuperación** — es requisito normativo, no solo buena práctica. Railway hace snapshots, pero configura un `pg_dump` cifrado a storage externo, con **prueba de restauración periódica** (un backup no probado no es un backup).

---

## PARTE 4 — Cambios al plan de trabajo

### 4.1 El plan de 20 fases tiene un problema de secuencia

El documento propone **Fases 1–10 = todo el backend**, luego **Fases 11–18 = todo el frontend**. Eso significa recorrer 10 fases sin absolutamente nada que un usuario pueda abrir y probar. Cuando por fin se conecta el frontend, aparecen todas las decisiones equivocadas de golpe.

**Propuesta: cortes verticales.** Cada módulo se entrega backend + frontend juntos, funcionando de punta a punta:

| Hito | Contenido | Resultado |
|---|---|---|
| **H0** | Estructura, Prisma, Docker, CI, auth + roles | Puedes iniciar sesión |
| **H1** | Pacientes (CRUD + búsqueda + perfil) | La recepción ya registra pacientes de verdad |
| **H2** | Motor de agenda + calendario | **Aquí el sistema empieza a ser útil** |
| **H3** | Atención + signos vitales + CIE-10 | El médico documenta |
| **H4** | Recetas + PDF + firma | Se imprime lo que el paciente se lleva |
| **H5** | Exámenes + PDF | |
| **H6** | Notificaciones + confirmación por link + lista de espera | Bajan los no-shows |
| **H7** | Reportes, auditoría, PWA | |

Después de **H2 la clínica ya puede usarlo** en paralelo a su método actual. Eso cambia todo: el feedback llega cuando aún es barato corregir.

### 4.2 MVP recomendado

**H0 → H4.** Auth, pacientes, agenda, atención, receta. Es un sistema que un consultorio usa de verdad. Todo lo demás (portal del paciente, teleconsulta, IA, facturación) es incremento sobre una base que ya funciona.

### 4.3 Pruebas: no en la Fase 20

El documento pone las pruebas al final. El **motor de disponibilidad y solapamiento** (calcular slots libres de N médicos con M horarios, sedes y excepciones) es donde los bugs se esconden y donde los tests pagan solo. Sugerencia: TDD estricto **únicamente** en ese módulo; el resto, tests normales.

### 4.4 Alcance realista del modo offline

El documento pide PWA que "ve pacientes sin internet" y "sube los datos pendientes al reconectar". La sincronización bidireccional con resolución de conflictos es de lo más difícil que existe y es donde estos proyectos se atascan meses.

**Recomendación por etapas:**
1. **Solo lectura offline**: cachear los pacientes y el historial del día. Cubre el 90% del caso real (se cayó el internet a media consulta).
2. **Borrador local** de la atención en curso (IndexedDB), que se envía al reconectar.
3. Sincronización bidireccional completa: solo si aparece una necesidad real.

### 4.5 Stack: ajustes

| Componente | Documento | Recomendación |
|---|---|---|
| Backend | Express o NestJS | **Express + TypeScript** — sin multi-tenant hay mucha menos infraestructura transversal que justifique NestJS |
| Calendario | RBC o FullCalendar | **React Big Calendar** — `resources` (columna por médico) es MIT; en FullCalendar es de pago |
| Contrato API | Sin definir | **Zod compartido** entre backend y frontend (monorepo) — elimina los bugs de contrato |
| PDF | PDFKit o Puppeteer | **Puppeteer** — el membrete con logo y tablas es HTML+CSS, mucho más rápido de iterar que dibujar con PDFKit |
| Jobs | node-cron | **BullMQ + Redis** |
| Búsqueda | — | **`pg_trgm`** para pacientes, CIE-10 y medicamentos (sin motor externo) |

---

## Fuentes

- [Modifican el Reglamento de la Ley RENHICE — D.S. 020-2025-SA](https://lpderecho.pe/modifican-reglamento-ley-crea-registro-nacional-historias-clinicas-electronicas-renhice-decreto-supremo-020-2025-sa/)
- [Normativa de historia clínica electrónica en Perú 2026](https://davix.ai/en/blog/normativa-historia-clinica-electronica-peru-2026/)
- [MINSA aprueba el Plan de Implementación del RENHICE](https://saluddigital.com/en/plataformas-digitales/ministerio-de-salud-del-peru-aprueba-el-plan-de-implementacion-del-renhice/)
- [Firma Digital para Médicos en Perú: Recetas Válidas 2026](https://girasol.pe/blog/medico-sin-firma-digital-en-peru-recetas-rechazadas-informes-invalidos-y-normativa-2026/)
- [DIGEMID: herramientas para emisión de documentos con firma digital](https://www.digemid.minsa.gob.pe/webDigemid/notas/2025/digemid-implementa-herramientas-tecnologicas-para-la-emision-de-documentos-con-firma-digital/)
- [MINSA: inicio de implementación de la receta electrónica nacional](https://www.gob.pe/institucion/minsa/noticias/585503-minsa-da-inicio-a-implementacion-de-la-receta-electronica-nacional)
- [RXNT — 10 Must-Have Practice Management Features for 2026](https://www.rxnt.com/10-must-have-practice-management-features-for-healthcare-practices-in-2026/)
- [DoctorConnect — Best Ways to Reduce Patient No-Shows 2026](https://doctorconnect.net/best-reduce-patient-no-shows-2026/)
- [CertifyHealth — Complete Guide to Practice Management Software 2026](https://www.certifyhealth.com/blog/medical-practice-management-software-the-complete-guide-for-2026/)
- [JAMA/PubMed — Ambient AI Scribes to Reduce Administrative Burden and Burnout](https://pubmed.ncbi.nlm.nih.gov/41037268/)
- [AMA — AI scribes save 15,000 hours](https://www.ama-assn.org/practice-management/digital-health/ai-scribes-save-15000-hours-and-restore-human-side-medicine)
- [John Snow Labs — Ambient AI Scribes: Redefining Clinical Documentation & Burnout](https://www.johnsnowlabs.com/ambient-ai-scribes-redefining-clinical-documentation-burnout/)
- [FHIR-Compliant Isn't the Same as Interoperable — 2026 Buyer's Guide](https://techbullion.com/fhir-compliant-isnt-the-same-as-interoperable-a-2026-buyers-guide-to-custom-healthcare-software/)
- [Mindbowser — FHIR Versions Explained: DSTU2, R4, R5 & R6 (2026)](https://www.mindbowser.com/fhir-versions/)
- [Market Data Forecast — Latin America Telemedicine Market](https://www.marketdataforecast.com/market-reports/la-telemedicine-market)
- [NubeFacT — Integración de facturación electrónica SUNAT](https://www.nubefact.com/integracion)
- [apis.net.pe — Consulta RUC/DNI](https://apis.net.pe/)
- [RENIEC — Solicitar acceso al servicio de verificación de identidad](https://www.gob.pe/13549-solicitar-acceso-al-servicio-de-verificacion-de-identidad-de-personas-en-reniec-utilizar-web-service-de-datos)
- [CapMinds — OpenEMR vs OpenMRS](https://www.capminds.com/blog/the-ultimate-breakdown-comparing-openemr-and-openmrs/)
