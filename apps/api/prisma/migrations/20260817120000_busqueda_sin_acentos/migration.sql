-- =============================================================================
--  Búsqueda insensible a acentos
-- =============================================================================
--
--  EL PROBLEMA. pg_trgm distingue acentos: buscar "huaman" no encuentra
--  "Huamán", ni "perez" a "Pérez". En un padrón peruano eso deja la búsqueda
--  inservible — la recepcionista teclea rápido y sin tildes, y el paciente que
--  tiene delante no aparece.
--
--  LA SOLUCIÓN. Normalizar (minúsculas y sin acentos) tanto lo almacenado como
--  lo buscado, e indexar la forma normalizada.
--
--  EL DETALLE QUE LO HACE POSIBLE. `unaccent()` es STABLE, no IMMUTABLE,
--  porque depende del diccionario activo; PostgreSQL no permite indexar por una
--  función así. La forma documentada de resolverlo es envolverla fijando el
--  diccionario de forma explícita, lo que sí la vuelve inmutable.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.normalizar_busqueda(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto))
$$;


-- El índice anterior era sensible a acentos: se reemplaza.
DROP INDEX IF EXISTS "Patient_busqueda_nombre_trgm";

-- Índice sobre el nombre completo normalizado.
--
-- La independencia del orden ("Quispe María" o "María Quispe") NO se resuelve
-- aquí duplicando la concatenación —con apellidos compuestos como "Quispe
-- Huamán" eso no funciona— sino en la consulta, exigiendo que cada palabra
-- buscada aparezca por separado. Ver pacientes.repository.ts.
CREATE INDEX "Patient_busqueda_nombre_trgm"
  ON "Patient" USING gin (
    public.normalizar_busqueda("firstName" || ' ' || "lastName") gin_trgm_ops
  );

-- El documento no lleva acentos, pero se normaliza igual para que la consulta
-- pueda usar una única expresión y el planificador acierte con el índice.
CREATE INDEX "Patient_busqueda_documento_norm_trgm"
  ON "Patient" USING gin (public.normalizar_busqueda("document") gin_trgm_ops);

-- El teléfono es el tercer dato por el que pregunta recepción cuando el
-- paciente no recuerda su documento.
CREATE INDEX "Patient_busqueda_telefono_trgm"
  ON "Patient" USING gin ("phone" gin_trgm_ops);

-- Nota sobre erratas: la consulta combina LIKE por palabra con el operador
-- `<%` (word_similarity), que compara el término contra CADA PALABRA del
-- nombre en vez de contra el nombre entero. Es la diferencia entre encontrar o
-- no a "Núñez Cárdenas" tecleando "nuñes": 0.67 de parecido por palabra frente
-- a 0.24 sobre la cadena completa, muy por debajo de cualquier umbral útil.
-- Este mismo índice GIN sirve a los dos operadores.

-- Los mismos catálogos se consultan escribiendo sin tildes.
DROP INDEX IF EXISTS "MedicineCatalog_busqueda_trgm";
CREATE INDEX "MedicineCatalog_busqueda_trgm"
  ON "MedicineCatalog" USING gin (
    public.normalizar_busqueda("name" || ' ' || COALESCE("genericName", '')) gin_trgm_ops
  );

CREATE INDEX "Icd10Code_busqueda_norm_trgm"
  ON "Icd10Code" USING gin (public.normalizar_busqueda("description") gin_trgm_ops);
