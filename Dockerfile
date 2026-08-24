# =============================================================================
#  Imagen de producción: API + interfaz web en un solo contenedor
# =============================================================================
#
#  Un contenedor sirve las dos cosas, así que cada consultorio tiene UN dominio
#  y no hay CORS de por medio.
#
#  POR QUÉ UN DOCKERFILE Y NO NIXPACKS: Puppeteer. La detección automática
#  monta bien un servidor Node, pero deja el contenedor sin Chromium, y el
#  fallo no aparece al desplegar sino al emitir la primera receta. Aquí el
#  navegador se instala con apt y su ruta queda fija; nada que adivinar.
#
#  Construcción en dos etapas: la imagen final no lleva ni las dependencias de
#  desarrollo ni el código TypeScript.

# --- Etapa 1: compilar -------------------------------------------------------
FROM node:22-slim AS constructor

# Puppeteer NO debe descargar su Chromium: la imagen final usa el del sistema.
# Son ~170 MB que no harían falta y una versión más que mantener.
#
# CI=true además hace que pnpm no pida confirmación al vaciar node_modules en
# `prune`: sin terminal interactiva aborta la operación y tumba el build.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CI=true

RUN corepack enable

WORKDIR /app

# Los manifiestos primero: mientras no cambien, Docker reutiliza la capa de
# dependencias y no vuelve a instalar en cada despliegue.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json    apps/api/
COPY apps/web/package.json    apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

COPY . .

# El cliente de Prisma se genera a partir del esquema; sin esto el build falla
# al no encontrar los tipos.
RUN pnpm --filter @consultorio/api db:generate

# El orden importa: la web y la API importan el paquete compartido ya compilado.
RUN pnpm --filter @consultorio/shared build \
 && pnpm --filter @consultorio/web build \
 && pnpm --filter @consultorio/api build

# Las dependencias de desarrollo se quedan fuera reinstalando solo las de
# producción sobre un árbol limpio.
#
# NO se usa `pnpm prune --prod`: en un monorepo deja los enlaces de los
# paquetes hijos a medias, y el contenedor arranca hasta que Node intenta
# resolver el primer import y no encuentra el paquete. Reinstalar es unos
# segundos más de build a cambio de un árbol coherente.
RUN rm -rf node_modules apps/api/node_modules apps/web/node_modules packages/shared/node_modules \
 && pnpm install --frozen-lockfile --prod

# El cliente de Prisma se genera DENTRO de node_modules, así que la
# reinstalación anterior se lo llevó por delante. Sin regenerarlo, el paquete
# @prisma/client queda como un módulo CommonJS vacío y el proceso muere al
# importar PrismaClient.
RUN pnpm --filter @consultorio/api db:generate

# --- Etapa 2: ejecutar -------------------------------------------------------
FROM node:22-slim AS ejecucion

# chromium      → generación de PDF (recetas y órdenes de examen)
# fonts-*       → sin fuentes, el PDF sale con cuadros en vez de letras, y los
#                 acentos y la "ñ" son lo primero que desaparece
# ca-certificates → HTTPS hacia las integraciones (consulta de DNI, SMTP)
# tini          → recoge los procesos zombis que deja Chromium al cerrarse
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    STORAGE_DIR=/datos/storage

WORKDIR /app

# El árbol de dependencias de pnpm son enlaces desde cada paquete al almacén
# de la raíz, así que hay que traer las dos partes o los enlaces no resuelven.
COPY --from=constructor /app/node_modules              ./node_modules
COPY --from=constructor /app/package.json              ./package.json
COPY --from=constructor /app/pnpm-workspace.yaml       ./pnpm-workspace.yaml
COPY --from=constructor /app/apps/api/node_modules     ./apps/api/node_modules
COPY --from=constructor /app/apps/api/dist             ./apps/api/dist
COPY --from=constructor /app/apps/api/package.json     ./apps/api/package.json
# El esquema y las migraciones viajan con la imagen: `migrate deploy` se ejecuta
# al arrancar y las necesita en disco.
COPY --from=constructor /app/apps/api/prisma           ./apps/api/prisma
COPY --from=constructor /app/apps/web/dist             ./apps/web/dist
COPY --from=constructor /app/packages/shared/dist      ./packages/shared/dist
COPY --from=constructor /app/packages/shared/package.json ./packages/shared/package.json
# El paquete compartido tiene sus propias dependencias (zod); sin su
# node_modules, la API arranca y muere al importar el primer contrato.
COPY --from=constructor /app/packages/shared/node_modules ./packages/shared/node_modules

# Las firmas y los PDF viven aquí. En Railway se monta un volumen en /datos:
# sin él, cada despliegue se llevaría por delante las recetas ya emitidas.
RUN mkdir -p /datos/storage && chown -R node:node /datos

# Nunca como root: si alguien encontrara la forma de ejecutar algo a través de
# Chromium, se encontraría con un usuario sin privilegios.
USER node

EXPOSE 3000

# Node como PID 1 no recoge procesos hijos; Chromium deja unos cuantos.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
