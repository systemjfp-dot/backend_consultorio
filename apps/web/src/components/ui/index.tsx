/**
 * Componentes base de la interfaz.
 *
 * Mobile-first: los objetivos táctiles miden al menos 44 px (requisito de
 * accesibilidad del documento maestro) y los campos usan texto de 16 px, que
 * es lo que evita que Safari en iOS haga zoom automático al enfocarlos — un
 * detalle pequeño que en una tablet de consultorio se nota en cada uso.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro'

const ESTILOS_VARIANTE: Record<Variante, string> = {
  primario: 'bg-primario text-white hover:bg-blue-700 active:bg-blue-800',
  secundario: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  fantasma: 'bg-transparent text-gray-600 hover:bg-gray-100',
  peligro: 'bg-red-600 text-white hover:bg-red-700',
}

interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
  cargando?: boolean
  anchoCompleto?: boolean
}

export function Boton({
  variante = 'primario',
  cargando = false,
  anchoCompleto = false,
  disabled,
  children,
  className = '',
  ...resto
}: PropsBoton) {
  return (
    <button
      {...resto}
      disabled={disabled || cargando}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ESTILOS_VARIANTE[variante]} ${anchoCompleto ? 'w-full' : ''} ${className}`}
    >
      {cargando && (
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}

interface PropsCampo extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string
  error?: string | undefined
  ayuda?: string
}

export function Campo({ etiqueta, error, ayuda, id, className = '', ...resto }: PropsCampo) {
  const idCampo = id ?? `campo-${etiqueta.toLowerCase().replace(/\s+/g, '-')}`
  const idError = `${idCampo}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={idCampo} className="text-sm font-medium text-gray-700">
        {etiqueta}
      </label>
      <input
        {...resto}
        id={idCampo}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? idError : undefined}
        className={`min-h-[44px] rounded-lg border px-3 text-base outline-none transition-colors focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
            : 'border-gray-300 focus:border-primario focus:ring-blue-100'
        } ${className}`}
      />
      {error && (
        <p id={idError} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!error && ayuda && <p className="text-sm text-gray-500">{ayuda}</p>}
    </div>
  )
}

export function Alerta({
  tono = 'error',
  children,
}: {
  tono?: 'error' | 'aviso' | 'info' | 'exito'
  children: ReactNode
}) {
  const estilos = {
    error: 'bg-red-50 text-red-800 border-red-200',
    aviso: 'bg-amber-50 text-amber-900 border-amber-200',
    info: 'bg-blue-50 text-blue-900 border-blue-200',
    exito: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  }[tono]

  return (
    <div role={tono === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${estilos}`}>
      {children}
    </div>
  )
}

export function Tarjeta({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function Cargando({ mensaje = 'Cargando…' }: { mensaje?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-gray-500">
      <span
        className="size-8 animate-spin rounded-full border-3 border-gray-300 border-t-primario"
        aria-hidden="true"
      />
      <p className="text-sm">{mensaje}</p>
    </div>
  )
}
