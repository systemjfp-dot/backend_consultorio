import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
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
    // Reglas de hooks de React. Detectan dependencias mal declaradas en
    // efectos, que es de donde salen los estados obsoletos y los bucles de
    // renderizado — errores que no dan ningún síntoma hasta que la pantalla
    // muestra datos viejos sin motivo aparente.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
