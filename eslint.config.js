import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // La consistencia de tipos importa más que el estilo en un sistema clínico.
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Scripts de consola (instalación y datos de ejemplo): aquí la salida por
    // consola no es un descuido de depuración, es la interfaz del programa.
    files: ['apps/api/prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
