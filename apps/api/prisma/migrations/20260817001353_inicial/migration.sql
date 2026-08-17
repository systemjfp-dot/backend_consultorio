-- =============================================================================
--  EXTENSIONES
-- =============================================================================
--  Deben crearse ANTES que cualquier tabla o índice: los índices GIN de
--  búsqueda difusa usan gin_trgm_ops, y los constraints de exclusión usan
--  btree_gist. Si esto va al final, la migración falla al crear los índices.
--
--  btree_gist: combina igualdad (=) sobre texto/entero con solapamiento de
--              rangos (&&) dentro de un mismo constraint de exclusión.
--  pg_trgm:    búsqueda difusa por trigramas ("diabet" encuentra "Diabetes").
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'CASHIER', 'AUDITOR');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('UNAVAILABLE', 'EXTRA');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DNI', 'CE', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('DATA_PROCESSING', 'AI_RECORDING', 'TELECONSULTATION');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_ATTENTION', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "Modality" AS ENUM ('PRESENCIAL', 'TELECONSULTA');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'SCHEDULED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TimePreference" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'ANY');

-- CreateEnum
CREATE TYPE "SignatureType" AS ENUM ('DRAWN', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('LABORATORY', 'IMAGING', 'SPECIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'VIEW', 'PRINT', 'EXPORT', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'BREAK_GLASS');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WELCOME', 'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'WAITLIST_SLOT_AVAILABLE', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ClinicSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Lima',
    "defaultSlotMinutes" INTEGER NOT NULL DEFAULT 20,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "roles" "Role"[] DEFAULT ARRAY['RECEPTIONIST']::"Role"[],
    "extraPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deniedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Doctor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "specialtyRegistryNumber" TEXT,
    "specialty" TEXT NOT NULL,
    "colorCode" TEXT NOT NULL DEFAULT '#2563EB',
    "defaultSlotMinutes" INTEGER NOT NULL DEFAULT 20,
    "signatureUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "locationId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "slotMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "ExceptionType" NOT NULL DEFAULT 'UNAVAILABLE',
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL DEFAULT 'DNI',
    "document" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "birthDate" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "allergies" TEXT,
    "medicalHistory" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "documentUrl" TEXT,

    CONSTRAINT "PatientConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "locationId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "modality" "Modality" NOT NULL DEFAULT 'PRESENCIAL',
    "allowOverbook" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "notes" TEXT,
    "roomUrl" TEXT,
    "arrivedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "reminderSentAt" TIMESTAMPTZ(3),
    "reminderAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "locationId" TEXT,
    "preferredDate" DATE NOT NULL,
    "preferredTime" "TimePreference" NOT NULL DEFAULT 'ANY',
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMPTZ(3),
    "appointmentId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "bloodPressureSystolic" INTEGER,
    "bloodPressureDiastolic" INTEGER,
    "heartRate" INTEGER,
    "respiratoryRate" INTEGER,
    "temperature" DECIMAL(4,1),
    "oxygenSaturation" INTEGER,
    "weightKg" DECIMAL(5,2),
    "heightCm" DECIMAL(5,2),
    "reason" TEXT,
    "currentIllness" TEXT,
    "personalHistory" TEXT,
    "familyHistory" TEXT,
    "surgicalHistory" TEXT,
    "medicationsInUse" TEXT,
    "physicalExam" TEXT,
    "diagnosis" TEXT,
    "treatmentPlan" TEXT,
    "notes" TEXT,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDiagnosis" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "AttendanceDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAddendum" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "instructions" TEXT,
    "signatureType" "SignatureType" NOT NULL DEFAULT 'DRAWN',
    "signedAt" TIMESTAMPTZ(3),
    "certificateSerial" TEXT,
    "pdfUrl" TEXT,
    "pdfHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "concentration" TEXT,
    "form" TEXT,
    "route" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "quantity" INTEGER,
    "instructions" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MedicineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionTemplate" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PrescriptionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalExam" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "ExamType" NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE,
    "result" TEXT,
    "resultUrl" TEXT,
    "resultAt" TIMESTAMPTZ(3),
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MedicalExam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Icd10Code" (
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Icd10Code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "MedicineCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "concentration" TEXT,
    "form" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MedicineCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamCatalog" (
    "id" TEXT NOT NULL,
    "type" "ExamType" NOT NULL,
    "name" TEXT NOT NULL,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExamCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "permission" TEXT,
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "reason" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id","createdAt")
);

-- CreateTable
CREATE TABLE "NotificationConfig" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject" TEXT,
    "content" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMPTZ(3),
    "error" TEXT,
    "appointmentId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_licenseNumber_key" ON "Doctor"("licenseNumber");

-- CreateIndex
CREATE INDEX "Doctor_isActive_idx" ON "Doctor"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Schedule_doctorId_dayOfWeek_idx" ON "Schedule"("doctorId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "Schedule_locationId_idx" ON "Schedule"("locationId");

-- CreateIndex
CREATE INDEX "ScheduleException_doctorId_date_idx" ON "ScheduleException"("doctorId", "date");

-- CreateIndex
CREATE INDEX "Patient_lastName_firstName_idx" ON "Patient"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Patient_deletedAt_idx" ON "Patient"("deletedAt");

-- CreateIndex
CREATE INDEX "Patient_document_idx" ON "Patient" USING GIN ("document" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_documentType_document_key" ON "Patient"("documentType", "document");

-- CreateIndex
CREATE INDEX "PatientConsent_patientId_type_idx" ON "PatientConsent"("patientId", "type");

-- CreateIndex
CREATE INDEX "Appointment_startsAt_doctorId_idx" ON "Appointment"("startsAt", "doctorId");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_locationId_idx" ON "Appointment"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Waitlist_appointmentId_key" ON "Waitlist"("appointmentId");

-- CreateIndex
CREATE INDEX "Waitlist_status_preferredDate_idx" ON "Waitlist"("status", "preferredDate");

-- CreateIndex
CREATE INDEX "Waitlist_patientId_idx" ON "Waitlist"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_appointmentId_key" ON "Attendance"("appointmentId");

-- CreateIndex
CREATE INDEX "Attendance_patientId_startedAt_idx" ON "Attendance"("patientId", "startedAt");

-- CreateIndex
CREATE INDEX "Attendance_doctorId_startedAt_idx" ON "Attendance"("doctorId", "startedAt");

-- CreateIndex
CREATE INDEX "AttendanceDiagnosis_code_idx" ON "AttendanceDiagnosis"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDiagnosis_attendanceId_code_key" ON "AttendanceDiagnosis"("attendanceId", "code");

-- CreateIndex
CREATE INDEX "AttendanceAddendum_attendanceId_idx" ON "AttendanceAddendum"("attendanceId");

-- CreateIndex
CREATE INDEX "Prescription_patientId_issuedAt_idx" ON "Prescription"("patientId", "issuedAt");

-- CreateIndex
CREATE INDEX "Prescription_doctorId_issuedAt_idx" ON "Prescription"("doctorId", "issuedAt");

-- CreateIndex
CREATE INDEX "Prescription_attendanceId_idx" ON "Prescription"("attendanceId");

-- CreateIndex
CREATE INDEX "MedicineItem_prescriptionId_idx" ON "MedicineItem"("prescriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionTemplate_doctorId_name_key" ON "PrescriptionTemplate"("doctorId", "name");

-- CreateIndex
CREATE INDEX "MedicalExam_patientId_issuedAt_idx" ON "MedicalExam"("patientId", "issuedAt");

-- CreateIndex
CREATE INDEX "MedicalExam_doctorId_issuedAt_idx" ON "MedicalExam"("doctorId", "issuedAt");

-- CreateIndex
CREATE INDEX "MedicalExam_attendanceId_idx" ON "MedicalExam"("attendanceId");

-- CreateIndex
CREATE INDEX "Icd10Code_category_idx" ON "Icd10Code"("category");

-- CreateIndex
CREATE INDEX "Icd10Code_description_idx" ON "Icd10Code" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "MedicineCatalog_name_concentration_form_key" ON "MedicineCatalog"("name", "concentration", "form");

-- CreateIndex
CREATE INDEX "ExamCatalog_name_idx" ON "ExamCatalog" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "ExamCatalog_type_name_key" ON "ExamCatalog"("type", "name");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationConfig_channel_key" ON "NotificationConfig"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_appointmentId_idx" ON "Notification"("appointmentId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConsent" ADD CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Waitlist" ADD CONSTRAINT "Waitlist_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDiagnosis" ADD CONSTRAINT "AttendanceDiagnosis_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDiagnosis" ADD CONSTRAINT "AttendanceDiagnosis_code_fkey" FOREIGN KEY ("code") REFERENCES "Icd10Code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAddendum" ADD CONSTRAINT "AttendanceAddendum_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAddendum" ADD CONSTRAINT "AttendanceAddendum_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicineItem" ADD CONSTRAINT "MedicineItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionTemplate" ADD CONSTRAINT "PrescriptionTemplate_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalExam" ADD CONSTRAINT "MedicalExam_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
--  REGLAS DE INTEGRIDAD QUE PRISMA NO PUEDE EXPRESAR
-- =============================================================================
--  Todo lo que sigue está escrito a mano. Son garantías que DEBEN vivir en la
--  base de datos: si se dejan en el código de aplicación, basta una consulta
--  concurrente o un endpoint nuevo que olvide validar para romperlas.
-- =============================================================================

-- 1. ClinicSettings: una sola fila --------------------------------------------
ALTER TABLE "ClinicSettings"
  ADD CONSTRAINT "ClinicSettings_fila_unica" CHECK (id = 1);


-- 2. Horarios: rangos válidos y sin superposición ------------------------------
ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_rango_valido" CHECK (
    "startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute"
  ),
  ADD CONSTRAINT "Schedule_dia_valido" CHECK ("dayOfWeek" BETWEEN 0 AND 6);

-- Un médico no puede tener dos franjas superpuestas el mismo día, aunque estén
-- en sedes distintas: no puede estar en dos lugares a la vez.
--
-- El @@unique([doctorId, dayOfWeek, startTime]) del diseño original dejaba
-- pasar 08:00-13:00 junto con 09:00-11:00, incumpliendo el requisito 2.2
-- ("Validación: No superponer horarios").
ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_sin_solapamiento" EXCLUDE USING gist (
    "doctorId"  WITH =,
    "dayOfWeek" WITH =,
    int4range("startMinute", "endMinute") WITH &&
  ) WHERE ("isActive");

ALTER TABLE "ScheduleException"
  ADD CONSTRAINT "ScheduleException_rango_valido" CHECK (
    ("startMinute" IS NULL AND "endMinute" IS NULL)
    OR ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
  );


-- 3. Citas: sin doble reserva --------------------------------------------------
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_rango_valido" CHECK ("endsAt" > "startsAt");

-- ESTE es el constraint que el diseño original prometía y no cumplía.
--
-- @@unique([doctorId, date]) fallaba en tres frentes:
--   · Ignoraba la duración: 09:00 y 09:10 (20 min c/u) se pisan, pero como las
--     fechas difieren, el índice único las aceptaba.
--   · Impedía la sobreagenda que el propio módulo 4.2 pide ("mostrar advertencia").
--   · Las citas canceladas seguían ocupando el horario para siempre.
--
-- La exclusión por rangos resuelve los tres: compara solapamiento real, y el
-- WHERE deja fuera lo cancelado y lo sobreagendado a propósito.
--
-- Al vivir en la base de datos, resiste dos recepcionistas agendando en el
-- mismo instante. Ninguna validación en el service puede garantizar eso.
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_sin_solapamiento" EXCLUDE USING gist (
    "doctorId" WITH =,
    tstzrange("startsAt", "endsAt") WITH &&
  ) WHERE (
    "status" NOT IN ('CANCELLED', 'NO_SHOW') AND "allowOverbook" = false
  );


-- 4. Signos vitales dentro de rangos fisiológicos ------------------------------
-- No valida criterio clínico; solo atrapa errores de tecleo (390 °C, peso 700 kg)
-- antes de que contaminen la historia y los reportes.
ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_signos_vitales_plausibles" CHECK (
    ("bloodPressureSystolic"  IS NULL OR "bloodPressureSystolic"  BETWEEN 40 AND 300)
    AND ("bloodPressureDiastolic" IS NULL OR "bloodPressureDiastolic" BETWEEN 20 AND 200)
    AND ("heartRate"        IS NULL OR "heartRate"        BETWEEN 20 AND 300)
    AND ("respiratoryRate"  IS NULL OR "respiratoryRate"  BETWEEN 4  AND 90)
    AND ("temperature"      IS NULL OR "temperature"      BETWEEN 25 AND 45)
    AND ("oxygenSaturation" IS NULL OR "oxygenSaturation" BETWEEN 30 AND 100)
    AND ("weightKg"         IS NULL OR "weightKg"         BETWEEN 0.3 AND 400)
    AND ("heightCm"         IS NULL OR "heightCm"         BETWEEN 20 AND 260)
  );


-- 5. Auditoría inmutable (append-only) -----------------------------------------
-- Requisito legal: el registro de accesos a historias clínicas no debe poder
-- alterarse ni siquiera desde la aplicación. Se implementa con trigger y no
-- con REVOKE porque en desarrollo la aplicación corre como dueña de la tabla,
-- y a un dueño no se le pueden revocar permisos sobre sus propios objetos.
CREATE OR REPLACE FUNCTION "auditoria_es_inmutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog es de solo inserción: la operación % no está permitida', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_sin_modificaciones"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_es_inmutable"();


-- 6. Búsqueda difusa (pg_trgm) -------------------------------------------------
-- Sin estos índices, los campos de "autocompletado" del documento hacen
-- recorrido completo de tabla en cada tecla que escribe la recepcionista.
--
-- Solo van aquí los índices sobre EXPRESIONES (varias columnas concatenadas),
-- que Prisma no sabe representar y por tanto ignora. Los de columna simple
-- están declarados en schema.prisma con @@index(type: Gin) para que Prisma los
-- gestione: si se dejan aquí, la siguiente migración los borra silenciosamente.
CREATE INDEX "Patient_busqueda_nombre_trgm"
  ON "Patient" USING gin (("firstName" || ' ' || "lastName") gin_trgm_ops);



CREATE INDEX "MedicineCatalog_busqueda_trgm"
  ON "MedicineCatalog" USING gin (("name" || ' ' || COALESCE("genericName", '')) gin_trgm_ops);

