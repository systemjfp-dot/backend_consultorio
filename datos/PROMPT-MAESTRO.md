PROMPT MAESTRO PARA CLAUDE CODE
Sistema de Gestión de Consultorios Médicos (SaaS Multi-Tenant)
CONTEXTO GENERAL
Vas a desarrollar un sistema SaaS completo para la gestión de consultorios médicos. Este sistema permitirá que múltiples clínicas/consultorios independientes (multi-tenant) se registren y gestionen sus operaciones diarias. Cada clínica puede tener múltiples médicos trabajando en diferentes horarios (mañana, tarde, noche) y múltiples sedes (si tienen más de una ubicación).
El sistema debe ser profesional, escalable, seguro y fácil de usar, optimizado para tablets y celulares (mobile-first).
OBJETIVO PRINCIPAL
Desarrollar un sistema web full-stack con las siguientes capacidades:
Registro de Clínicas (Onboarding): Cualquier consultorio médico puede registrarse y obtener su propio subdominio (ej: clinica1.sistema.com).
Gestión de Pacientes: Registro, búsqueda e historial clínico completo.
Agenda Multi-Médico: Calendario inteligente que maneja múltiples médicos, horarios y sedes.
Atención en Consultorio: Ficha médica digital con signos vitales, diagnósticos y plan de tratamiento.
Recetas Médicas: Generación de recetas con firma digital y PDF profesional.
Órdenes de Exámenes: Generación de órdenes para laboratorio e imágenes.
Panel de Administración: Gestión de médicos, recepcionistas, horarios y configuración.
PILA TECNOLÓGICA
Backend
Runtime: Node.js con Express.js (o NestJS, elige el que consideres mejor)
Base de Datos: PostgreSQL
ORM: Prisma
Autenticación: JWT con bcrypt
Seguridad: CORS, Helmet, Rate Limiting
Email: Nodemailer para envío de correos
PDF: PDFKit o Puppeteer para generar recetas y órdenes
Despliegue: Railway (configuración incluida)
Frontend
Framework: React con TypeScript
Estilos: Tailwind CSS con diseño mobile-first
Estado: React Query para datos del servidor
Formularios: React Hook Form + Zod para validaciones
Calendario: React Big Calendar o FullCalendar
PWA: Progressive Web App para instalación en dispositivos
Notificaciones: Toast y WebSockets para tiempo real
Infraestructura
Hosting: Railway
Base de Datos: PostgreSQL en Railway
Dominio: Configuración con subdominios dinámicos (*.sistema.com)
Almacenamiento: Para logos y firmas digitales
ARQUITECTURA DE DATOS (ESQUEMA PRISMA)
Debes implementar el siguiente modelo de datos completo. ESTE ES EL CORAZÓN DEL SISTEMA:
prisma
// ============================================
// 1. MODELOS PRINCIPALES (MULTI-TENANT)
// ============================================
model Tenant {
  id          String   @id @default(cuid())
  name        String   // Nombre de la clínica/consultorio
  subdomain   String   @unique // Ej: "clinica1" → clinica1.sistema.com
  ruc         String   @unique // NIT/RUC
  address     String
  phone       String
  email       String
  logo        String?  // URL del logo
  timezone    String   @default("America/Lima")
  config      Json     // Configuración: duración citas, horarios por defecto, etc.
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relaciones
  users       User[]
  patients    Patient[]
  doctors     Doctor[]
  schedules   Schedule[]
  appointments Appointment[]
  attendances Attendance[]
  prescriptions Prescription[]
  medicalExams MedicalExam[]
}
// ============================================
// 2. USUARIOS Y ROLES
// ============================================
model User {
  id          String   @id @default(cuid())
  email       String   @unique
  password    String   // Hashed con bcrypt
  firstName   String
  lastName    String
  phone       String?
  role        Role     // SUPER_ADMIN, ADMIN, DOCTOR, RECEPTIONIST
  isActive    Boolean  @default(true)
  twoFactorSecret String? // Para 2FA
  tenantId    String?  // NULL para SUPER_ADMIN
  
  // Relaciones
  tenant      Tenant?  @relation(fields: [tenantId], references: [id])
  doctor      Doctor?  // Si role = DOCTOR
  receptionist Receptionist? // Si role = RECEPTIONIST
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([tenantId])
}
enum Role {
  SUPER_ADMIN
  ADMIN
  DOCTOR
  RECEPTIONIST
}
// ============================================
// 3. MODELOS MÉDICOS Y RECEPCIONISTAS
// ============================================
model Doctor {
  id                String   @id @default(cuid())
  userId            String   @unique
  licenseNumber     String   @unique // Número de registro médico
  specialty         String   // Cardiología, Pediatría, etc.
  colorCode         String   @default("#3B82F6") // Color en calendario
  consultationDuration Int   @default(20) // Minutos por consulta
  isActive          Boolean  @default(true)
  tenantId          String
  
  // Relaciones
  user              User     @relation(fields: [userId], references: [id])
  tenant            Tenant   @relation(fields: [tenantId], references: [id])
  schedules         Schedule[]
  appointments      Appointment[]
  attendances       Attendance[]
  prescriptions     Prescription[]
  medicalExams      MedicalExam[]
  
  @@index([tenantId])
}
model Receptionist {
  id          String   @id @default(cuid())
  userId      String   @unique
  tenantId    String
  
  // Relaciones
  user        User     @relation(fields: [userId], references: [id])
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  
  @@index([tenantId])
}
// ============================================
// 4. HORARIOS DE ATENCIÓN
// ============================================
model Schedule {
  id          String   @id @default(cuid())
  doctorId    String
  dayOfWeek   Int      // 0 = Domingo, 1 = Lunes, ... 6 = Sábado
  startTime   String   // "08:00" (formato 24h)
  endTime     String   // "13:00"
  slotDuration Int    @default(20) // Minutos por cita
  location    String?  // "Sede Norte" o "Sede Sur"
  isActive    Boolean  @default(true)
  tenantId    String
  
  // Relaciones
  doctor      Doctor   @relation(fields: [doctorId], references: [id])
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  
  @@unique([doctorId, dayOfWeek, startTime])
  @@index([tenantId])
}
// ============================================
// 5. PACIENTES
// ============================================
model Patient {
  id          String   @id @default(cuid())
  firstName   String
  lastName    String
  document    String   // DNI/CI
  birthDate   DateTime
  gender      String   // M, F, OTHER
  phone       String
  email       String?
  address     String?
  allergies   String?  // Alergias conocidas
  medicalHistory String? // Historial médico resumido
  tenantId    String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relaciones
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  appointments Appointment[]
  attendances Attendance[]
  
  @@unique([document, tenantId])
  @@index([tenantId])
  @@index([firstName, lastName])
}
// ============================================
// 6. CITAS
// ============================================
model Appointment {
  id          String   @id @default(cuid())
  patientId   String
  doctorId    String
  date        DateTime // Fecha y hora exacta
  duration    Int      @default(20) // Duración en minutos
  status      AppointmentStatus @default(SCHEDULED)
  reason      String?  // Motivo de consulta
  notes       String?  // Notas internas
  location    String?  // "Sede Norte" o "Sede Sur"
  reminderSent Boolean @default(false)
  reminderAttempts Int @default(0)
  tenantId    String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relaciones
  patient     Patient  @relation(fields: [patientId], references: [id])
  doctor      Doctor   @relation(fields: [doctorId], references: [id])
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  attendance  Attendance? // Una cita → una atención
  waitlist    Waitlist?
  
  @@unique([doctorId, date]) // Evitar doble reserva
  @@index([date, doctorId])
  @@index([patientId])
  @@index([status])
  @@index([tenantId])
}
enum AppointmentStatus {
  SCHEDULED
  CONFIRMED
  IN_ATTENTION
  COMPLETED
  CANCELLED
  NO_SHOW
}
// ============================================
// 7. LISTA DE ESPERA (WAITLIST)
// ============================================
model Waitlist {
  id          String   @id @default(cuid())
  patientId   String
  doctorId    String
  preferredDate DateTime
  preferredTime String  // "Mañana", "Tarde", "Noche"
  status      WaitlistStatus @default(WAITING)
  notifiedAt  DateTime?
  tenantId    String
  createdAt   DateTime @default(now())
  
  // Relaciones
  patient     Patient  @relation(fields: [patientId], references: [id])
  doctor      Doctor   @relation(fields: [doctorId], references: [id])
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  
  @@index([tenantId])
}
enum WaitlistStatus {
  WAITING
  NOTIFIED
  CANCELLED
  COMPLETED
}
// ============================================
// 8. ATENCIÓN EN CONSULTORIO
// ============================================
model Attendance {
  id              String   @id @default(cuid())
  appointmentId   String   @unique
  doctorId        String
  patientId       String
  date            DateTime @default(now())
  
  // Signos vitales
  bloodPressure   String?  // "120/80"
  heartRate       Int?
  temperature     Float?
  weight          Float?
  height          Float?
  bmi             Float?   // Calculado automáticamente
  
  // Datos clínicos
  reason          String?  // Motivo de consulta detallado
  currentIllness  String?  // Enfermedad actual
  diagnosis       String?  // Diagnóstico
  icd10Code       String?  // Código CIE-10
  treatmentPlan   String?  // Plan de tratamiento
  notes           String?  // Notas adicionales
  
  tenantId        String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relaciones
  appointment     Appointment @relation(fields: [appointmentId], references: [id])
  doctor          Doctor      @relation(fields: [doctorId], references: [id])
  patient         Patient     @relation(fields: [patientId], references: [id])
  tenant          Tenant      @relation(fields: [tenantId], references: [id])
  prescriptions   Prescription[]
  medicalExams    MedicalExam[]
  
  @@index([tenantId])
  @@index([doctorId])
  @@index([patientId])
}
// ============================================
// 9. RECETAS MÉDICAS
// ============================================
model Prescription {
  id              String   @id @default(cuid())
  attendanceId    String
  doctorId        String
  patientId       String
  issueDate       DateTime @default(now())
  validityDays    Int      @default(30)
  isDigital       Boolean  @default(true)
  signatureUrl    String?  // URL de la firma digital
  signatureData   String?  // Datos de la firma (base64)
  signedAt        DateTime?
  tenantId        String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relaciones
  attendance      Attendance @relation(fields: [attendanceId], references: [id])
  doctor          Doctor     @relation(fields: [doctorId], references: [id])
  patient         Patient    @relation(fields: [patientId], references: [id])
  tenant          Tenant     @relation(fields: [tenantId], references: [id])
  medicines       MedicineItem[]
  
  @@index([tenantId])
  @@index([patientId])
  @@index([doctorId])
}
model MedicineItem {
  id              String   @id @default(cuid())
  prescriptionId  String
  name            String   // "Paracetamol"
  concentration   String   // "500 mg"
  route           String   // "Oral"
  frequency       String   // "Cada 8 horas"
  duration        String   // "5 días"
  quantity        Int?     // Cantidad total
  instructions    String?  // Instrucciones adicionales
  tenantId        String
  
  // Relaciones
  prescription    Prescription @relation(fields: [prescriptionId], references: [id])
  tenant          Tenant       @relation(fields: [tenantId], references: [id])
  
  @@index([tenantId])
}
// ============================================
// 10. EXÁMENES AUXILIARES
// ============================================
model MedicalExam {
  id              String   @id @default(cuid())
  attendanceId    String
  doctorId        String
  patientId       String
  examType        ExamType // LABORATORY, IMAGING, SPECIAL, OTHER
  name            String   // "Hemograma completo"
  instructions    String?  // "Ayuno de 8 horas"
  result          String?  // Resultados (si ya están)
  issueDate       DateTime @default(now())
  dueDate         DateTime? // Fecha límite para realizar el examen
  isUrgent        Boolean  @default(false)
  pdfUrl          String?  // URL del PDF generado
  tenantId        String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  // Relaciones
  attendance      Attendance @relation(fields: [attendanceId], references: [id])
  doctor          Doctor     @relation(fields: [doctorId], references: [id])
  patient         Patient    @relation(fields: [patientId], references: [id])
  tenant          Tenant     @relation(fields: [tenantId], references: [id])
  
  @@index([tenantId])
  @@index([patientId])
  @@index([doctorId])
}
enum ExamType {
  LABORATORY
  IMAGING
  SPECIAL
  OTHER
}
// ============================================
// 11. AUDITORÍA (REGISTRO DE ACTIVIDADES)
// ============================================
model AuditLog {
  id          String   @id @default(cuid())
  userId      String
  action      String   // CREATE, UPDATE, DELETE, VIEW
  model       String   // Patient, Appointment, Attendance, etc.
  recordId    String   // ID del registro afectado
  changes     Json?    // Cambios realizados
  ipAddress   String?
  userAgent   String?
  tenantId    String?
  createdAt   DateTime @default(now())
  
  // Relaciones
  user        User     @relation(fields: [userId], references: [id])
  tenant      Tenant?  @relation(fields: [tenantId], references: [id])
  
  @@index([tenantId])
  @@index([userId])
  @@index([createdAt])
}
// ============================================
// 12. CONFIGURACIÓN DE NOTIFICACIONES
// ============================================
model NotificationConfig {
  id          String   @id @default(cuid())
  tenantId    String
  type        String   // EMAIL, SMS, WHATSAPP
  provider    String   // Twilio, SendGrid, etc.
  config      Json     // Configuración del proveedor
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relaciones
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  
  @@unique([tenantId, type])
  @@index([tenantId])
}
model Notification {
  id          String   @id @default(cuid())
  recipient   String   // Email o teléfono
  type        String   // REMINDER, CONFIRMATION, WELCOME
  channel     String   // EMAIL, SMS, WHATSAPP
  subject     String?
  content     String
  status      NotificationStatus @default(PENDING)
  sentAt      DateTime?
  error       String?
  tenantId    String
  relatedId   String?  // ID de la cita o paciente relacionado
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Relaciones
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  
  @@index([tenantId])
  @@index([status])
}
enum NotificationStatus {
  PENDING
  SENT
  FAILED
  CANCELLED
}
MÓDULOS FUNCIONALES (REQUERIMIENTOS DETALLADOS)
MÓDULO 1: AUTENTICACIÓN Y ONBOARDING
1.1 Registro de Nueva Clínica (Público)
URL: https://sistema.com/register
Formulario con 3 pasos:
Paso 1: Datos de la clínica (Nombre, RUC, Dirección, Teléfono, Email)
Paso 2: Configuración de subdominio (validar disponibilidad en tiempo real)
Paso 3: Crear cuenta de administrador (Email, Contraseña, confirmación)
Validaciones:
RUC único en el sistema
Subdominio único (solo letras, números y guiones)
Contraseña fuerte (mínimo 8 caracteres, mayúscula, número, especial)
Acción: Crear Tenant + Usuario ADMIN + Enviar email de bienvenida
Redirección: A https://[subdominio].sistema.com/admin
1.2 Login (Por Subdominio)
URL: https://[subdominio].sistema.com/login
Campos: Email, Contraseña
Opcional: 2FA (configurable desde perfil)
Redirección por rol:
SUPER_ADMIN → Panel global
ADMIN → Dashboard administrativo
DOCTOR → Agenda personal
RECEPTIONIST → Agenda general + registro pacientes
1.3 Recuperación de Contraseña
Flujo: Email → Enlace temporal → Nueva contraseña
Validez del enlace: 1 hora
MÓDULO 2: PANEL DE ADMINISTRACIÓN (ADMIN)
2.1 Dashboard Principal
Métricas clave:
Total de citas hoy (todas y por médico)
Pacientes nuevos esta semana
Tasa de asistencia (completadas vs programadas)
Próximas citas (próximas 4 horas)
Médicos activos
Gráficos: Diagrama de barras (citas por día de la semana)
2.2 Gestión de Médicos
Listado: Tabla con todos los médicos (Nombre, Especialidad, N° Registro, Estado)
Crear/Editar:
Datos personales (Nombres, Email, Teléfono)
Datos profesionales (N° Registro, Especialidad)
Color de identificación en calendario
Duración de consulta (15, 20, 30 min)
Asignar Horarios: Configuración por día de la semana
Ejemplo: Lunes 08:00-13:00 (Mañana), Martes 14:00-20:00 (Tarde)
Soporte para múltiples sedes
Validación: No superponer horarios
2.3 Gestión de Recepcionistas
CRUD completo: Crear, editar, desactivar, reactivar
Permisos limitados: Solo agenda, pacientes y citas
2.4 Configuración de la Clínica
Datos generales: Editar nombre, RUC, dirección, teléfono
Logo: Subir imagen (PNG/JPG, tamaño recomendado 200x200)
Horarios por defecto: Configuración global de días y horas laborales
Duración de citas por defecto: 15, 20, 30 minutos
Integraciones: Configurar SMTP para emails, API de WhatsApp/SMS
2.5 Gestión de Sedes
Crear sedes: Nombre, Dirección, Teléfono
Asignar médicos a sedes (por horarios)
MÓDULO 3: PACIENTES (RECEPCIONISTA Y MÉDICO)
3.1 Registro de Pacientes
Campos obligatorios:
Nombres, Apellidos, Documento (DNI/CI), Fecha de nacimiento, Género
Teléfono (celular)
Campos opcionales:
Email, Dirección, Alergias conocidas
Validaciones: Documento único por clínica
Acción: Verificar si ya existe → Si existe, mostrar datos y opción de crear nueva cita
3.2 Búsqueda de Pacientes
Buscador global: Por nombre, apellido, documento, teléfono
Resultados en tiempo real (mientras se escribe)
Filtros: Todos, Atendidos hoy, Con citas próximas
Acciones desde búsqueda: Ver perfil, Crear cita, Historial
3.3 Perfil del Paciente
Datos personales: Todos los campos registrados
Historial clínico: Lista cronológica de atenciones
Fecha, Médico, Motivo, Diagnóstico
Acceso directo a cada atención
Recetas previas: PDF descargable
Exámenes previos: PDF descargable
Próximas citas: Calendario con próximas atenciones
MÓDULO 4: AGENDA Y CITAS (RECEPCIONISTA Y MÉDICO)
4.1 Vista de Calendario
Vistas disponibles: Día, Semana, Mes
Filtros:
Médico específico (selector desplegable)
Todos los médicos (vista unificada)
Sede (si hay múltiples)
Colores: Cada médico tiene su color, fácil identificación
Bloques de tiempo: Mostrar horarios ocupados y disponibles
4.2 Creación de Citas
Flujo optimizado para recepcionista:
Buscar o crear paciente (desde el mismo modal)
Seleccionar médico (o "asignar automáticamente")
Seleccionar fecha y hora (solo horarios disponibles del médico)
Motivo de consulta (opcional)
Notas internas (opcional)
Asignar sede (si aplica)
Validaciones:
No doble reserva para el mismo médico/hora
Verificar que el médico tenga horario ese día/hora
Si es sobreagenda (overbooking), mostrar advertencia
4.3 Gestión de Citas
Acciones: Confirmar, Cancelar, Reprogramar, Marcar como No Asistió
Reprogramación: Arrastrar y soltar en el calendario
Cancelación: Motivo de cancelación (para estadísticas)
Recordatorios: Enviar recordatorio manual o automático
4.4 Lista de Espera (Waitlist)
Agregar paciente a lista de espera:
Fecha preferida, Turno (Mañana/Tarde/Noche)
Médico preferido o "Cualquiera"
Sistema automático:
Cuando hay una cancelación, notificar al primer paciente en lista
Opción de notificar por email/SMS
4.5 Citas para Médicos (Vista Propia)
Vista personal: Solo sus propias citas
Pacientes en espera: Ver listado de pacientes actuales
Iniciar atención: Botón directo desde la cita
MÓDULO 5: ATENCIÓN EN CONSULTORIO (MÉDICO)
5.1 Inicio de Atención
Desde agenda: Seleccionar cita → Botón "Iniciar atención"
Cambio de estado: La cita pasa a "EN_ATENCIÓN"
Pantalla optimizada para tablet: Botones grandes, táctiles
5.2 Ficha de Atención
Sección 1: Datos del Paciente
Nombre, Edad, Documento
Botón "Ver historial completo"
Sección 2: Signos Vitales
Presión arterial (ej: "120/80")
Frecuencia cardíaca (ej: "72 bpm")
Temperatura (ej: "36.5 °C")
Peso (kg)
Talla (cm)
Cálculo automático: IMC (Índice de Masa Corporal)
Sección 3: Datos Clínicos
Motivo de consulta (texto largo)
Enfermedad actual (texto largo)
Diagnóstico (texto largo)
Código CIE-10 (campo de búsqueda con autocompletado)
Plan de tratamiento (texto largo)
Notas adicionales
Sección 4: Acciones Rápidas
Generar Receta → Abre modal de recetas
Ordenar Examen → Abre modal de exámenes
Ver Recetas Previas → Lista con PDFs
Ver Exámenes Previos → Lista con PDFs
5.3 Finalizar Atención
Botón "Completar atención"
La cita pasa a "COMPLETADA"
Se guarda toda la información
Opción: Enviar resumen al paciente por email
5.4 Modo Offline (PWA)
Funcionalidad: Ver pacientes y su historial sin internet
Sincronización: Cuando vuelve la conexión, sube los datos pendientes
MÓDULO 6: RECETAS MÉDICAS (MÉDICO)
6.1 Generación de Receta
Desde: Atención actual o desde perfil del paciente
Datos automáticos:
Paciente: Nombre, Edad, Documento
Médico: Nombre, Especialidad, N° Registro
Fecha de emisión
Logo de la clínica
Lista de medicamentos:
Nombre (ej: "Paracetamol")
Concentración (ej: "500 mg")
Vía de administración (Oral, Intravenosa, Tópica, etc.)
Frecuencia (ej: "Cada 8 horas")
Duración (ej: "5 días")
Cantidad (ej: "10 tabletas")
Instrucciones adicionales
Acciones: Agregar medicamento, Eliminar medicamento
6.2 Firma Digital
En tablet: Dibujar firma con el dedo o stylus
En computadora: Usar mouse para dibujar
Almacenamiento: Guardar como imagen (PNG con transparencia)
Verificación: Mostrar firma en el PDF generado
6.3 Generación de PDF
Diseño profesional:
Membrete de la clínica (logo + datos)
Título: "RECETA MÉDICA"
Datos del paciente y médico
Tabla de medicamentos
Firma digital
Pie de página: "Documento válido para fines médicos"
Descarga: Botón "Descargar PDF"
Guardar: Se guarda en el historial del paciente
6.4 Historial de Recetas
Lista: Todas las recetas previas del paciente
Acciones: Ver PDF, Reimprimir
MÓDULO 7: EXÁMENES AUXILIARES (MÉDICO)
7.1 Generación de Orden de Examen
Desde: Atención actual o desde perfil del paciente
Tipo de examen:
Laboratorio: Hemograma, Glucosa, Perfil Lipídico, etc.
Imagenología: Rayos X, Ecografía, TAC, RMN
Estudios Especiales: Electrocardiograma, Espirometría
Otro: Campo libre
Campos:
Paciente (automático)
Médico (automático)
Fecha de emisión
Nombre del examen (selección de catálogo o personalizado)
Instrucciones (ej: "Ayuno de 8 horas")
Fecha límite (opcional)
Urgencia (checkbox: "Urgente")
7.2 Generación de PDF
Diseño profesional:
Membrete de la clínica
Título: "ORDEN DE EXAMEN AUXILIAR"
Datos del paciente y médico
Descripción del examen
Instrucciones
Código de barras o QR (para seguimiento)
Descarga: Botón "Descargar PDF"
Guardar: Se guarda en el historial del paciente
7.3 Historial de Exámenes
Lista: Todos los exámenes previos del paciente
Acciones: Ver PDF
Resultados: Campo para cargar resultados (solo ADMIN o MÉDICO)
MÓDULO 8: SUPERADMIN (GESTIÓN GLOBAL)
8.1 Dashboard Global
Métricas:
Total de clínicas activas
Total de médicos registrados
Total de pacientes en el sistema
Citas totales (por día, semana, mes)
Gráficos: Crecimiento de clínicas, pacientes por clínica
8.2 Gestión de Clínicas (Tenants)
Listado: Todas las clínicas registradas
Filtros: Activas, Inactivas, Por subdominio
Acciones:
Ver detalles
Activar/Desactivar clínica
Eliminar (con confirmación y backup)
Configurar límites (máximo de médicos, pacientes, etc.)
8.3 Monitoreo y Soporte
Logs de auditoría: Ver actividad de todas las clínicas
Reportes: Generar reportes de uso
Soporte: Enviar notificaciones a clínicas específicas
MÓDULO 9: NOTIFICACIONES Y RECORDATORIOS
9.1 Recordatorios de Citas (Automáticos)
Cuándo: 24 horas antes de la cita
Canales: Email y SMS (configurable por clínica)
Contenido del mensaje:
"Estimado [paciente], le recordamos su cita con el Dr. [médico] mañana a las [hora]."
Configuración: Activar/desactivar desde panel de administración
9.2 Confirmación de Citas
Email de confirmación: Enviado al agendar o reprogramar
WhatsApp: Integración con API de WhatsApp Business
9.3 Notificaciones Internas (WebSockets)
Al recepcionista: Cuando un médico termina una atención → "Llamar al siguiente paciente"
Al médico: Cuando un paciente está registrado y esperando
MÓDULO 10: REPORTES Y ESTADÍSTICAS
10.1 Reporte de Citas
Filtros: Rango de fechas, Médico, Estado
Métricas: Total, Asistidas, No asistieron, Canceladas
Exportar: Excel (CSV) y PDF
10.2 Reporte de Pacientes
Filtros: Rango de fechas, Médico
Métricas: Pacientes nuevos, Pacientes recurrentes
Exportar: Excel (CSV)
10.3 Reporte Financiero (Opcional)
Citas: Precio por consulta (configurable)
Ingresos: Total facturado por médico, por mes
REQUISITOS NO FUNCIONALES (OBLIGATORIOS)
Seguridad
Cifrado de contraseñas: Bcrypt (salt rounds: 10)
JWT: Expiración 24 horas, refresh token
2FA: Opcional, con Google Authenticator
CORS: Configurar solo dominios permitidos
Rate Limiting: 100 peticiones por minuto por IP
Helmet: Cabeceras de seguridad HTTP
Sanitización: De inputs (SQL injection, XSS)
Auditoría
Log de todas las acciones: Crear, Editar, Eliminar, Ver
Almacenar: Usuario, IP, User-Agent, Fecha, Cambios realizados
Vista para SUPER_ADMIN y ADMIN
Rendimiento
Optimización de consultas: Uso de índices en Prisma
Paginación: En listados largos (pacientes, citas, auditoría)
Caching: React Query para reducir peticiones
Lazy Loading: Cargar componentes bajo demanda
UX/UI (Mobile First)
Diseño responsivo: Adaptación a 360px, 768px, 1024px+
Navegación inferior: En móvil, pestañas en la parte inferior
Botones grandes: Touch-friendly (mínimo 44px)
Modo oscuro: Opcional, configurable por usuario
Feedback visual: Spinners, toasts, skeleton loading
Accesibilidad: Contraste mínimo, etiquetas ARIA
Escalabilidad
Multi-tenant: Aislamiento total de datos por clínica
Base de datos: Índices en todas las foreign keys
Arquitectura modular: Separación clara de responsabilidades (Controllers → Services → Repositories)
Preparado para microservicios: Si en futuro se requiere
FLUJOS DE USUARIO COMPLETOS
Flujo 1: Registro de Nueva Clínica
text
Usuario ingresa a sistema.com/register
→ Llena datos de la clínica
→ Elige subdominio (validación en tiempo real)
→ Crea cuenta ADMIN
→ Recibe email de bienvenida
→ Accede a clinica.sistema.com/login
Flujo 2: Recepcionista Crea una Cita
text
Recepcionista ingresa a clinica.sistema.com
→ Login (email + password)
→ Va al módulo "Agenda"
→ Busca paciente (o lo crea)
→ Selecciona médico y fecha
→ Elige hora disponible
→ Ingresa motivo
→ Guarda cita
→ Se envía email de confirmación al paciente
→ La cita aparece en el calendario del médico
Flujo 3: Médico Atiende un Paciente
text
Médico ingresa a clinica.sistema.com
→ Login
→ Va a su "Agenda Personal"
→ Selecciona cita → "Iniciar atención"
→ Registra signos vitales
→ Escribe diagnóstico y tratamiento
→ (Opcional) Genera receta
→ (Opcional) Ordena examen
→ "Completar atención"
→ La cita pasa a COMPLETADA
→ Recepcionista recibe notificación para llamar al siguiente
Flujo 4: Generación de Receta
text
Médico está en atención
→ Clic en "Generar Receta"
→ Se abre modal
→ Agrega medicamentos (nombre, dosis, frecuencia, duración)
→ Firma con el dedo/mouse
→ Clic en "Generar PDF"
→ El PDF se descarga y se guarda en historial
→ Opción: Enviar por email al paciente
CONFIGURACIÓN DE DESPLIEGUE (RAILWAY)
Archivos Necesarios
1. docker-compose.yml
yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: medico_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: medico_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
  
  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://medico_user:${DB_PASSWORD}@postgres:5432/medico_db
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
      FRONTEND_URL: ${FRONTEND_URL}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
    depends_on:
      - postgres
    ports:
      - "3000:3000"
  
  frontend:
    build: ./frontend
    environment:
      VITE_API_URL: ${API_URL}
    depends_on:
      - backend
    ports:
      - "80:80"
volumes:
  postgres_data:
2. railway.json
json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
3. Variables de Entorno en Railway
text
DATABASE_URL=postgresql://...
JWT_SECRET=tu_secreto_muy_seguro
FRONTEND_URL=https://sistema.com
API_URL=https://api.sistema.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=correo@gmail.com
SMTP_PASS=contraseña_app
NODE_ENV=production
INSTRUCCIONES DE DESARROLLO PARA CLAUDE CODE
Fase 1: Configuración Inicial
Crea la estructura de carpetas del proyecto:
text
proyecto-medico/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── middlewares/
│   │   ├── routes/
│   │   ├── utils/
│   │   ├── prisma/
│   │   └── index.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── utils/
│   │   ├── types/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── Dockerfile
├── docker-compose.yml
├── railway.json
└── README.md
Configura las dependencias del backend (Express, Prisma, bcrypt, jsonwebtoken, etc.)
Configura las dependencias del frontend (React, Tailwind, React Query, etc.)
Implementa el esquema Prisma completo (ya definido arriba)
Fase 2: Autenticación y Seguridad
Implementa registro de nueva clínica (multi-tenant)
Implementa login con JWT y roles
Implementa middleware de tenant (por subdominio)
Implementa middleware de autenticación (JWT)
Implementa middleware de autorización (por rol)
Implementa sistema de 2FA (opcional)
Implementa recuperación de contraseña
Fase 3: Backend - Módulo de Administración
CRUD de médicos
CRUD de recepcionistas
Configuración de horarios por médico
Gestión de sedes
Configuración general de la clínica
Fase 4: Backend - Módulo de Pacientes
CRUD de pacientes
Búsqueda de pacientes
Historial de paciente (atenciones, recetas, exámenes)
Fase 5: Backend - Módulo de Agenda
CRUD de citas
Validación de conflictos de horario
Gestión de lista de espera
Recordatorios automáticos (jobs con cron)
WebSockets para notificaciones en tiempo real
Fase 6: Backend - Módulo de Atención
CRUD de atenciones
Registro de signos vitales
Gestión de diagnósticos (con CIE-10)
Fase 7: Backend - Módulo de Recetas
CRUD de recetas
CRUD de medicamentos
Generación de PDF (con firma digital)
Firma digital (dibujo en canvas)
Fase 8: Backend - Módulo de Exámenes
CRUD de exámenes
Generación de PDF de órdenes
Catálogo de exámenes predefinidos
Fase 9: Backend - Auditoría y Logs
Sistema de auditoría (todas las acciones)
Panel de logs para SUPER_ADMIN
Fase 10: Backend - Reportes
Reporte de citas (Excel/PDF)
Reporte de pacientes
Dashboard de métricas
Fase 11: Frontend - Layout y Navegación
Sidebar para escritorio
Navegación inferior para móvil
Sistema de rutas (React Router)
Protección de rutas por rol
Fase 12: Frontend - Módulo de Administración
Dashboard (métricas y gráficos)
Gestión de médicos (CRUD)
Gestión de recepcionistas
Configuración de horarios
Gestión de sedes
Fase 13: Frontend - Módulo de Pacientes
Registro de pacientes
Búsqueda con autocompletado
Perfil del paciente con historial
Fase 14: Frontend - Módulo de Agenda
Calendario (vistas día, semana, mes)
Creación de citas (con selección de médico, fecha, hora)
Gestión de citas (confirmar, cancelar, reprogramar)
Lista de espera
Fase 15: Frontend - Módulo de Atención
Ficha de atención (optimizada para tablet)
Signos vitales (inputs)
Datos clínicos (texto)
Generación de recetas (modal)
Generación de exámenes (modal)
Fase 16: Frontend - Módulo de Recetas y Exámenes
Generación de receta (formulario con medicamentos)
Firma digital (canvas)
Generación de PDF (descarga automática)
Generación de orden de examen
Historial de recetas y exámenes
Fase 17: Frontend - PWA y Offline
Configuración de service worker
Sincronización offline
Instalación en dispositivos
Fase 18: Frontend - Notificaciones
WebSockets para notificaciones en tiempo real
Toast notifications
Sistema de recordatorios
Fase 19: Despliegue en Railway
Configurar archivos de despliegue
Configurar variables de entorno
Configurar dominio y subdominios
Pruebas de producción
Fase 20: Pruebas y Documentación
Pruebas unitarias (Jest)
Pruebas de integración
Documentación de API (Swagger)
Documentación de usuario (manual básico)
ENTREGABLES FINALES
Al finalizar, el sistema debe tener:
✅ Código completo y funcional (backend + frontend)
✅ Base de datos PostgreSQL con el esquema definido
✅ Sistema multi-tenant funcional (múltiples clínicas con subdominios)
✅ Autenticación y autorización con roles (SUPER_ADMIN, ADMIN, DOCTOR, RECEPTIONIST)
✅ Panel de administración completo (gestión de médicos, recepcionistas, horarios)
✅ Módulo de pacientes (CRUD, búsqueda, historial)
✅ Agenda inteligente (múltiples médicos, sin conflictos)
✅ Atención en consultorio (signos vitales, diagnósticos)
✅ Recetas médicas (PDF con firma digital)
✅ Órdenes de exámenes (PDF)
✅ Notificaciones automáticas (recordatorios de citas)
✅ Diseño mobile-first (funciona en tablets y celulares)
✅ PWA (instalable en dispositivos)
✅ Auditoría completa (log de todas las acciones)
✅ Reportes y estadísticas (citas, pacientes)
✅ Despliegue en Railway con dominio personalizado
✅ Código documentado (comentarios en español)
CONSIDERACIONES ADICIONALES
Estilos y Paleta de Colores
Primario: Azul (#2563EB)
Secundario: Verde (#10B981)
Acento: Morado (#8B5CF6)
Grises: Escala de #F9FAFB a #111827
Espaciado: Consistente (p-4, p-6, gap-4)
Tipografía: Inter o Roboto
Buenas Prácticas
Código con comentarios en español explicando la lógica de negocio
Nomenclatura clara en variables y funciones (ej: crearCita, obtenerPaciente)
Validación de datos en frontend y backend (Zod)
Manejo de errores global (try-catch en backend, Error Boundaries en frontend)
Separación de responsabilidades (controllers, services, repositories)
Uso de TypeScript estricto
Variables de entorno para datos sensibles
Pruebas con Datos de Ejemplo
Genera un seed para poblar la base de datos con:
3 clínicas de prueba
2 médicos por clínica
10 pacientes por clínica
20 citas por clínica (con diferentes estados)
Horarios de ejemplo para cada médico
¡INSTRUCCIÓN FINAL PARA CLAUDE CODE!
Querido Claude:
Desarrolla este sistema completo siguiendo TODOS los requerimientos descritos anteriormente. Comienza con la Fase 1 (Configuración Inicial) y avanza secuencialmente por cada fase hasta completar el proyecto.
Pautas importantes:
Genera el código con comentarios detallados en español.
Asegúrate de que el código sea escalable y siga las mejores prácticas.
Prioriza la experiencia de usuario en dispositivos móviles (tablets y celulares).
Implementa todas las validaciones de seguridad mencionadas.
Prueba cada módulo antes de pasar al siguiente.
Pregúntame si necesitas aclaraciones sobre algún requerimiento específico.
¡Adelante con el desarrollo! El sistema debe quedar completamente funcional y listo para ser desplegado en producción. 🚀
RESUMEN DE REQUERIMIENTOS (CHECKLIST PARA VERIFICACIÓN)