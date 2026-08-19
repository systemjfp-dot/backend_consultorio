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
import { useState, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Cargando } from './components/ui/index.js'
import { Agenda } from './features/agenda/Agenda.js'
import { Auditoria } from './features/auditoria/Auditoria.js'
import { FichaAtencion } from './features/atenciones/FichaAtencion.js'
import { SalaDeEspera } from './features/atenciones/SalaDeEspera.js'
import { RegistrarFirma } from './features/recetas/RegistrarFirma.js'
import { Reportes } from './features/reportes/Reportes.js'
import { FichaPaciente } from './features/pacientes/FichaPaciente.js'
import { ListaPacientes } from './features/pacientes/ListaPacientes.js'
import { NuevoPaciente } from './features/pacientes/NuevoPaciente.js'
import { LayoutPrincipal } from './layouts/LayoutPrincipal.js'
import { ProveedorAuth, useAuth } from './lib/auth.js'
import { ConfigurarDosFactores } from './pages/ConfigurarDosFactores.js'
import { EnConstruccion } from './pages/EnConstruccion.js'
import { Inicio } from './pages/Inicio.js'
import { Login } from './pages/Login.js'
import { NoEncontrada } from './pages/NoEncontrada.js'

/**
 * Configuración de la caché de datos del servidor.
 *
 * El cliente se crea POR INSTANCIA de la aplicación, no a nivel de módulo. En
 * el navegador da igual —la aplicación se monta una sola vez— pero en las
 * pruebas un cliente compartido conserva la caché entre casos: una prueba que
 * espera un 404 recibía los datos que dejó cacheados la anterior.
 */
function crearClienteConsultas() {
  return new QueryClient({
  defaultOptions: {
    queries: {
      // Un minuto de frescura: en una recepción, los datos cambian de verdad
      // (una cita nueva, un paciente que llega) y refrescar de más es
      // preferible a mostrar una agenda desactualizada.
      staleTime: 60_000,
      retry: (intentos, error) => {
        // Ningún error 4xx se reintenta: la petición está mal o no está
        // autorizada, y repetirla dará exactamente lo mismo mientras el
        // usuario se queda mirando una pantalla de carga que no va a
        // resolverse. Solo se reintentan los fallos de red y los 5xx.
        const estado = (error as { estado?: number }).estado
        if (estado && estado >= 400 && estado < 500) return false
        return intentos < 2
      },
    },
  },
  })
}

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
              <Agenda />
            </RutaConPermiso>
          }
        />
        <Route
          path="pacientes"
          element={
            <RutaConPermiso permiso="patient:read">
              <ListaPacientes />
            </RutaConPermiso>
          }
        />
        <Route
          path="pacientes/nuevo"
          element={
            <RutaConPermiso permiso="patient:create">
              <NuevoPaciente />
            </RutaConPermiso>
          }
        />
        <Route
          path="pacientes/:id"
          element={
            <RutaConPermiso permiso="patient:read">
              <FichaPaciente />
            </RutaConPermiso>
          }
        />
        <Route
          path="atencion"
          element={
            <RutaConPermiso permiso="encounter:create">
              <SalaDeEspera />
            </RutaConPermiso>
          }
        />
        <Route
          path="atencion/:id"
          element={
            <RutaConPermiso permiso="encounter:read">
              <FichaAtencion />
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
              <Reportes />
            </RutaConPermiso>
          }
        />
        <Route
          path="auditoria"
          element={
            <RutaConPermiso permiso="audit:read">
              <Auditoria />
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
        <Route
          path="perfil/firma"
          element={
            <RutaConPermiso permiso="prescription:sign">
              <RegistrarFirma />
            </RutaConPermiso>
          }
        />
        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  )
}

export function App() {
  const [clienteConsultas] = useState(crearClienteConsultas)

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
