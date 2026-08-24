# Consultorio

Sistema de gestión de consultorio médico: agenda multi-médico, historia clínica,
recetas y órdenes de examen.

Un mismo despliegue puede atender a **varios consultorios independientes**: cada
uno tiene su propia base de datos y se elige por el dominio de la petición. No
hay `tenantId` en ninguna tabla —ver `apps/api/src/config/consultorios.ts`—, así
que no existe consulta capaz de alcanzar los datos del otro.

## Repositorios

Este es el repositorio **completo**: servidor, código compartido e interfaz.

La interfaz vive además en un repositorio propio,
[frontend_consultorio](https://github.com/systemjfp-dot/frontend_consultorio),
para poder desplegarla por separado. Contiene una copia de `packages/shared`
(permisos, roles y contratos), así que **un cambio ahí hay que llevarlo a los dos
sitios**: si se desincronizan, el formulario aceptará datos que la API rechaza.

## Requisitos

- Node.js ≥ 22
- pnpm 10
- PostgreSQL 15+

## Puesta en marcha

```bash
pnpm install
cp .env.example .env        # completa DATABASE_URL y los secretos JWT
pnpm db:migrate             # crea el esquema
pnpm setup                  # crea la clínica y el primer usuario ADMIN
pnpm dev                    # API en :3000, web en :5173
```

## Estructura

| Ruta | Contenido |
|---|---|
| `apps/api` | API Express + Prisma |
| `apps/web` | Interfaz React + Vite |
| `packages/shared` | Contratos Zod y catálogo de permisos, compartidos por ambos |
| `datos/` | Documentación del proyecto |

## Documentación

- [`datos/PLAN-DESARROLLO.md`](datos/PLAN-DESARROLLO.md) — hitos, convenciones y estado
- [`datos/PROMPT-MAESTRO.md`](datos/PROMPT-MAESTRO.md) — especificación original
- [`datos/PROPUESTA-MEJORAS.md`](datos/PROPUESTA-MEJORAS.md) — correcciones de diseño y mejoras
- [`datos/ROLES-Y-PERMISOS.md`](datos/ROLES-Y-PERMISOS.md) — modelo de control de acceso

## Comandos

```bash
pnpm dev          # todo en paralelo
pnpm build        # compila los 3 paquetes
pnpm typecheck    # verifica tipos sin emitir
pnpm lint         # ESLint
pnpm test         # pruebas
pnpm db:studio    # explorador de la base de datos
```
