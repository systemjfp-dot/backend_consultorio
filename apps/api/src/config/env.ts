/**
 * Configuración del proceso, validada al arrancar.
 *
 * La idea es sencilla: si falta un secreto o una URL está mal, el proceso NO
 * debe levantar. Un servidor que arranca con `JWT_ACCESS_SECRET` vacío y falla
 * recién cuando alguien intenta iniciar sesión es mucho peor que uno que no
 * arranca: el primero parece sano en el panel de Railway.
 *
 * Fuera de este archivo nadie lee `process.env`.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Carga el .env buscándolo desde este archivo hacia arriba.
 * En un monorepo el .env vive en la raíz, pero el proceso puede arrancar desde
 * apps/api (pnpm dev) o desde la raíz (pnpm -r dev); buscar hacia arriba
 * funciona en ambos casos sin rutas relativas frágiles.
 */
function cargarEnv(): void {
  let directorio = dirname(fileURLToPath(import.meta.url))
  const raizFs = resolve('/')

  while (true) {
    const candidato = join(directorio, '.env')
    if (existsSync(candidato)) {
      process.loadEnvFile(candidato)
      return
    }
    const padre = dirname(directorio)
    if (padre === directorio || padre === raizFs) return
    directorio = padre
  }
}

cargarEnv()

/** Lista separada por comas → arreglo sin vacíos. */
const listaSeparadaPorComas = z
  .string()
  .transform((valor) =>
    valor
      .split(',')
      .map((parte) => parte.trim())
      .filter(Boolean),
  )

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

    // 32 caracteres es el mínimo razonable para HS256. Generar con:
    //   openssl rand -base64 48
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    // El valor por defecto ya es la lista resuelta: en Zod 4 `.default()` se
    // aplica sobre la SALIDA de la transformación, no sobre la entrada.
    CORS_ORIGINS: listaSeparadaPorComas.default(['http://localhost:5173']),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
  })
  .refine((v) => v.JWT_ACCESS_SECRET !== v.JWT_REFRESH_SECRET, {
    message:
      'JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos: si coinciden, ' +
      'un token de acceso robado sirve también como refresh token y la expiración corta deja de proteger',
    path: ['JWT_REFRESH_SECRET'],
  })

const resultado = esquema.safeParse(process.env)

if (!resultado.success) {
  const problemas = resultado.error.issues
    .map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')

  console.error(
    `\nNo se puede arrancar: la configuración de entorno es inválida.\n\n${problemas}\n\n` +
      `Revisa tu archivo .env (puedes partir de .env.example).\n`,
  )
  process.exit(1)
}

export const env = resultado.data

export const esProduccion = env.NODE_ENV === 'production'
export const esDesarrollo = env.NODE_ENV === 'development'
export const esPrueba = env.NODE_ENV === 'test'
