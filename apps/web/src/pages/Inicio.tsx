/**
 * Pantalla de inicio.
 *
 * Cambia según el rol: lo que ve un médico al entrar no es lo que necesita la
 * recepción. Los paneles con datos reales llegan con cada módulo; por ahora
 * muestra la sesión resuelta, que es justamente lo que hay que poder verificar
 * al cerrar este hito.
 */

import { Tarjeta } from '../components/ui/index.js'
import { useAuth } from '../lib/auth.js'
import { traducirRoles } from '../layouts/LayoutPrincipal.js'

export function Inicio() {
  const { usuario, can } = useAuth()
  if (!usuario) return null

  const saludo = new Date().getHours() < 12 ? 'Buenos días' : new Date().getHours() < 19 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">
          {saludo}, {usuario.firstName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{traducirRoles(usuario.roles)}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {can('appointment:read') && (
          <Tarjeta>
            <h2 className="mb-1 font-medium text-gray-900">Agenda</h2>
            <p className="text-sm text-gray-600">
              {can('appointment:read', 'all')
                ? 'Ves la agenda de todos los médicos.'
                : 'Ves únicamente tus propias citas.'}
            </p>
            <p className="mt-3 text-xs text-gray-400">El calendario llega en el hito H2.</p>
          </Tarjeta>
        )}

        {can('encounter:create') && (
          <Tarjeta>
            <h2 className="mb-1 font-medium text-gray-900">Atención</h2>
            <p className="text-sm text-gray-600">
              Puedes documentar consultas, emitir recetas y ordenar exámenes.
            </p>
            <p className="mt-3 text-xs text-gray-400">La ficha clínica llega en el hito H3.</p>
          </Tarjeta>
        )}

        {can('patient:read') && (
          <Tarjeta>
            <h2 className="mb-1 font-medium text-gray-900">Pacientes</h2>
            <p className="text-sm text-gray-600">
              {can('patient:create')
                ? 'Puedes registrar y buscar pacientes.'
                : 'Puedes consultar el padrón de pacientes.'}
            </p>
            <p className="mt-3 text-xs text-gray-400">El módulo llega en el hito H1.</p>
          </Tarjeta>
        )}

        {can('staff:read') && (
          <Tarjeta>
            <h2 className="mb-1 font-medium text-gray-900">Personal</h2>
            <p className="text-sm text-gray-600">
              Gestión de médicos, horarios, sedes y configuración de la clínica.
            </p>
            <p className="mt-3 text-xs text-gray-400">El panel llega en el hito H1.</p>
          </Tarjeta>
        )}
      </div>

      <Tarjeta className="mt-6">
        <h2 className="mb-3 font-medium text-gray-900">Tu sesión</h2>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-gray-500">Correo</dt>
            <dd className="truncate text-gray-900">{usuario.email}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-gray-500">Segundo factor</dt>
            <dd className={usuario.twoFactorEnabled ? 'text-emerald-700' : 'text-amber-700'}>
              {usuario.twoFactorEnabled ? 'Activo' : 'Sin configurar'}
            </dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-gray-500">Permisos efectivos</dt>
            <dd className="text-gray-900">{usuario.permisos.length}</dd>
          </div>
          <div className="flex justify-between gap-4 sm:block">
            <dt className="text-gray-500">Acceso a historia clínica</dt>
            <dd className={can('encounter:read') ? 'text-gray-900' : 'text-gray-400'}>
              {can('encounter:read')
                ? can('encounter:read', 'all')
                  ? 'Todas'
                  : 'Solo las propias'
                : 'Sin acceso'}
            </dd>
          </div>
        </dl>
      </Tarjeta>
    </div>
  )
}
