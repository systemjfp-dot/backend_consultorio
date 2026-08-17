/**
 * Enrutador de la aplicación.
 *
 * Tres compuertas, en este orden:
 *
 *   1. ¿Se está recuperando la sesión? → esperar. Sin esto, al recargar la
 *      página se vería un parpadeo del login antes de restaurar la sesión.
 *   2. ¿Hay sesión? → si no, al login.
 *   3. ¿Es un administrador sin segundo factor? → a configurarlo, y a nada más.
 *
 * Y después, cada ruta declara el permiso que la habilita. Igual que en el
 * backend, aquí no hay ruta sin decisión explícita — solo que esta capa es
 * cosmética: quien escriba la URL a mano se topa con el servidor.
 */

import type { Permiso } from '@consultorio/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Cargando } from './components/ui/index.js'
import { LayoutPrincipal } from './layouts/LayoutPrincipal.js'
import { ProveedorAuth, useAuth } from './lib/auth.js'
import { ConfigurarDosFactores } from './pages/ConfigurarDosFactores.js'
import { EnConstruccion } from './pages/EnConstruccion.js'
import { Inicio } from './pages/Inicio.js'
import { Login } from './pages/Login.js'
import { NoEncontrada } from './pages/NoEncontrada.js'

const clienteConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      // Un minuto de frescura: en una recepción, los datos cambian de verdad
      // (una cita nueva, un paciente que llega) y refrescar de más es
      // preferible a mostrar una agenda desactualizada.
      staleTime: 60_000,
      retry: (intentos, error) => {
        // No tiene sentido reintentar un 401 o un 403: el resultado será el
        // mismo, y el cliente de API ya se encargó de renovar la sesión.
        const estado = (error as { estado?: number }).estado
        if (estado === 401 || estado === 403 || estado === 404) return false
        return intentos < 2
      },
    },
  },
})

/** Envuelve las rutas que requieren sesión. */
function RutaProtegida({ children }: { children: ReactNode }) {
  const { usuario, cargando, debeConfigurar2FA } = useAuth()

  if (cargando) return <Cargando mensaje="Restaurando sesión…" />
  if (!usuario) return <Navigate to="/login" replace />

  // Un administrador sin segundo factor no llega a ninguna otra pantalla.
  if (debeConfigurar2FA) return <ConfigurarDosFactores obligatorio />

  return <>{children}</>
}

/** Ruta que además exige un permiso concreto. */
function RutaConPermiso({ permiso, children }: { permiso: Permiso; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(permiso)) return <NoEncontrada />
  return <>{children}</>
}

function Rutas() {
  const { usuario, cargando } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={
          cargando ? (
            <Cargando mensaje="Restaurando sesión…" />
          ) : usuario ? (
            <Navigate to="/" replace />
          ) : (
            <Login />
          )
        }
      />

      <Route
        element={
          <RutaProtegida>
            <LayoutPrincipal />
          </RutaProtegida>
        }
      >
        <Route index element={<Inicio />} />

        <Route
          path="agenda"
          element={
            <RutaConPermiso permiso="appointment:read">
              <EnConstruccion titulo="Agenda" hito="H2" />
            </RutaConPermiso>
          }
        />
        <Route
          path="pacientes"
          element={
            <RutaConPermiso permiso="patient:read">
              <EnConstruccion titulo="Pacientes" hito="H1" />
            </RutaConPermiso>
          }
        />
        <Route
          path="atencion"
          element={
            <RutaConPermiso permiso="encounter:create">
              <EnConstruccion titulo="Atención en consultorio" hito="H3" />
            </RutaConPermiso>
          }
        />
        <Route
          path="personal"
          element={
            <RutaConPermiso permiso="staff:read">
              <EnConstruccion titulo="Personal" hito="H1" />
            </RutaConPermiso>
          }
        />
        <Route
          path="reportes"
          element={
            <RutaConPermiso permiso="report:appointments">
              <EnConstruccion titulo="Reportes" hito="H7" />
            </RutaConPermiso>
          }
        />
        <Route
          path="auditoria"
          element={
            <RutaConPermiso permiso="audit:read">
              <EnConstruccion titulo="Auditoría" hito="H7" />
            </RutaConPermiso>
          }
        />
        <Route
          path="configuracion"
          element={
            <RutaConPermiso permiso="settings:read">
              <EnConstruccion titulo="Configuración" hito="H1" />
            </RutaConPermiso>
          }
        />

        <Route path="perfil/2fa" element={<ConfigurarDosFactores />} />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <QueryClientProvider client={clienteConsultas}>
      <BrowserRouter>
        <ProveedorAuth>
          <Rutas />
        </ProveedorAuth>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
