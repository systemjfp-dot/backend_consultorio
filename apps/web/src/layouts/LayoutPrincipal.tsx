/**
 * Estructura de la aplicación.
 *
 * Mobile-first, como pide el documento maestro:
 *
 *  · En móvil y tablet vertical, barra de pestañas ABAJO. No es una moda: en
 *    un teléfono sostenido con una mano, la parte superior de la pantalla
 *    queda fuera del alcance del pulgar, y la recepción usa esto de pie y con
 *    el teléfono en una mano.
 *
 *  · Desde `lg`, barra lateral fija, que es lo que aprovecha una pantalla
 *    ancha sin obligar a abrir un menú para cada salto.
 *
 * El menú se filtra por permisos: una recepcionista no ve "Auditoría" ni
 * "Personal". Es presentación, no seguridad — quien escriba la URL a mano se
 * topa igualmente con el servidor.
 */

import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { menuMovil, menuVisible } from '../lib/navegacion.js'

export function LayoutPrincipal() {
  const { usuario, can, cerrarSesion } = useAuth()

  const entradas = menuVisible(can)
  const entradasMovil = menuMovil(can)

  const iniciales = usuario
    ? `${usuario.firstName[0] ?? ''}${usuario.lastName[0] ?? ''}`.toUpperCase()
    : ''

  return (
    <div className="min-h-dvh bg-gray-50">
      {/* --- Barra lateral (escritorio) --- */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-gray-200 bg-white lg:flex">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primario text-white">
            ✚
          </div>
          <span className="font-semibold text-gray-900">Consultorio</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <ul className="flex flex-col gap-1">
            {entradas.map((entrada) => (
              <li key={entrada.ruta}>
                <NavLink
                  to={entrada.ruta}
                  end={entrada.ruta === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-primario'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`
                  }
                >
                  <span aria-hidden="true" className="w-5 text-center text-base">
                    {entrada.icono}
                  </span>
                  {entrada.etiqueta}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-gray-100 p-3">
          <PerfilUsuario iniciales={iniciales} onCerrarSesion={() => void cerrarSesion()} />
        </div>
      </aside>

      {/* --- Contenido --- */}
      <div className="lg:pl-64">
        {/* Cabecera solo en móvil: en escritorio la identidad ya está en la barra lateral. */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primario text-sm text-white">
              ✚
            </div>
            <span className="font-semibold text-gray-900">Consultorio</span>
          </div>

          <button
            onClick={() => void cerrarSesion()}
            className="flex size-9 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700"
            aria-label="Cerrar sesión"
          >
            {iniciales}
          </button>
        </header>

        {/*
          El relleno inferior deja sitio a la barra de pestañas y al área
          segura de los teléfonos con muesca; sin él, el último elemento de
          cualquier lista queda tapado y parece que la página se corta.
        */}
        <main className="p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-6 lg:pb-6">
          <Outlet />
        </main>
      </div>

      {/* --- Pestañas (móvil) --- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Navegación principal"
      >
        <ul className="flex">
          {entradasMovil.map((entrada) => (
            <li key={entrada.ruta} className="flex-1">
              <NavLink
                to={entrada.ruta}
                end={entrada.ruta === '/'}
                className={({ isActive }) =>
                  `flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors ${
                    isActive ? 'text-primario' : 'text-gray-500'
                  }`
                }
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  {entrada.icono}
                </span>
                {entrada.etiquetaCorta ?? entrada.etiqueta}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function PerfilUsuario({
  iniciales,
  onCerrarSesion,
}: {
  iniciales: string
  onCerrarSesion: () => void
}) {
  const { usuario } = useAuth()
  if (!usuario) return null

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
        {iniciales}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">
          {usuario.firstName} {usuario.lastName}
        </p>
        <p className="truncate text-xs text-gray-500">{traducirRoles(usuario.roles)}</p>
      </div>

      <button
        onClick={onCerrarSesion}
        className="shrink-0 rounded-md p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
      >
        ⏻
      </button>
    </div>
  )
}

const NOMBRES_ROL: Record<string, string> = {
  ADMIN: 'Administración',
  DOCTOR: 'Médico',
  RECEPTIONIST: 'Recepción',
  NURSE: 'Enfermería',
  CASHIER: 'Caja',
  AUDITOR: 'Auditoría',
}

export function traducirRoles(roles: readonly string[]): string {
  return roles.map((rol) => NOMBRES_ROL[rol] ?? rol).join(' · ')
}
