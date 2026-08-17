-- =============================================================================
--  AuditLog pasa a estar PARTICIONADA POR MES
-- =============================================================================
--
--  POR QUÉ ES NECESARIO, y no una optimización prematura:
--
--  La tabla es inmutable por trigger — no admite UPDATE ni DELETE. Eso, que es
--  justo lo que se quiere de un registro de auditoría, tiene una consecuencia:
--  las filas NO SE PUEDEN BORRAR NUNCA. Sin particionado, registrar cada
--  acceso a una historia clínica (requisito de la Ley 30024) hace crecer la
--  tabla de forma indefinida sin ninguna vía de purga.
--
--  Con particiones, aplicar una política de retención es DROP TABLE de una
--  partición entera, que no es un DELETE de filas y por tanto no choca con el
--  trigger. Es la única forma de que auditoría inmutable y retención puedan
--  convivir.
--
--  Además, las consultas del panel filtran por rango de fechas, así que
--  PostgreSQL solo lee las particiones del período pedido en lugar de recorrer
--  años de historial.
--
--  DÓNDE VIVEN LAS PARTICIONES: en el esquema `auditoria`, no en `public`.
--  Prisma gestiona únicamente el esquema de su DATABASE_URL (public), así que
--  las particiones le resultan invisibles y no puede proponer borrarlas en una
--  migración futura. Ese riesgo es real: en H0.2 comprobamos que Prisma sí
--  planifica DROP sobre objetos de `public` que no conoce.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS auditoria;

-- 1. Apartar la tabla actual --------------------------------------------------
-- Los nombres de índice son únicos por esquema, así que hay que renombrarlos
-- antes de crear la tabla nueva o colisionan.
ALTER TABLE "AuditLog" RENAME TO "AuditLog_anterior";
ALTER INDEX "AuditLog_pkey"                 RENAME TO "AuditLog_anterior_pkey";
ALTER INDEX "AuditLog_createdAt_idx"        RENAME TO "AuditLog_anterior_createdAt_idx";
ALTER INDEX "AuditLog_userId_createdAt_idx" RENAME TO "AuditLog_anterior_userId_idx";
ALTER INDEX "AuditLog_entity_entityId_idx"  RENAME TO "AuditLog_anterior_entity_idx";
ALTER INDEX "AuditLog_action_idx"           RENAME TO "AuditLog_anterior_action_idx";

-- El trigger de inmutabilidad impediría copiar y descartar la tabla vieja.
DROP TRIGGER "AuditLog_sin_modificaciones" ON "AuditLog_anterior";


-- 2. Crear la tabla particionada ----------------------------------------------
-- La clave primaria incluye createdAt porque PostgreSQL exige que la clave de
-- partición forme parte de toda restricción única.
CREATE TABLE "AuditLog" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT,
    "userEmail"  TEXT,
    "action"     "AuditAction" NOT NULL,
    "entity"     TEXT NOT NULL,
    "entityId"   TEXT,
    "permission" TEXT,
    "roles"      "Role"[] DEFAULT ARRAY[]::"Role"[],
    "reason"     TEXT,
    "changes"    JSONB,
    "ipAddress"  TEXT,
    "userAgent"  TEXT,
    "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");


-- 3. Particiones --------------------------------------------------------------
-- Se crean 24 meses por adelantado. Al arrancar, la aplicación se encarga de
-- ir añadiendo las que falten (ver core/auditoria.ts).
DO $$
DECLARE
  primer_mes date := date_trunc('month', CURRENT_DATE)::date;
  desde date;
  hasta date;
  i int;
BEGIN
  FOR i IN 0..23 LOOP
    desde := (primer_mes + (i    || ' month')::interval)::date;
    hasta := (primer_mes + (i + 1 || ' month')::interval)::date;

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS auditoria.%I PARTITION OF public."AuditLog" FOR VALUES FROM (%L) TO (%L)',
      'AuditLog_' || to_char(desde, 'YYYY_MM'), desde, hasta
    );
  END LOOP;
END $$;

-- Partición por defecto: red de seguridad. Sin ella, un INSERT cuya fecha no
-- encaje en ninguna partición FALLA, y eso significaría perder el registro de
-- auditoría — o peor, tumbar la operación que lo generó.
CREATE TABLE IF NOT EXISTS auditoria."AuditLog_resto"
  PARTITION OF public."AuditLog" DEFAULT;


-- 4. Traer los datos existentes -----------------------------------------------
INSERT INTO "AuditLog" (
  "id","userId","userEmail","action","entity","entityId",
  "permission","roles","reason","changes","ipAddress","userAgent","createdAt"
)
SELECT
  "id","userId","userEmail","action","entity","entityId",
  "permission","roles","reason","changes","ipAddress","userAgent","createdAt"
FROM "AuditLog_anterior";

DROP TABLE "AuditLog_anterior";


-- 5. Índices ------------------------------------------------------------------
-- Sobre la tabla particionada: PostgreSQL los propaga a cada partición y a las
-- que se creen después.
CREATE INDEX "AuditLog_createdAt_idx"        ON "AuditLog" ("createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog" ("userId", "createdAt");
CREATE INDEX "AuditLog_entity_entityId_idx"  ON "AuditLog" ("entity", "entityId");
CREATE INDEX "AuditLog_action_idx"           ON "AuditLog" ("action");


-- 6. Restaurar la inmutabilidad -----------------------------------------------
-- En una tabla particionada el trigger de fila se declara en la tabla padre y
-- PostgreSQL lo aplica a todas las particiones, incluidas las futuras.
CREATE TRIGGER "AuditLog_sin_modificaciones"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_es_inmutable"();
