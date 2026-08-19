/**
 * Panel de auditoría.
 *
 * Responde a las dos preguntas que se hacen cuando algo se cuestiona: quién
 * accedió a qué, y si alguien usó el acceso de emergencia. Los accesos de
 * emergencia salen destacados arriba precisamente porque son la excepción: si
 * aparecen varios al día, hay algo que revisar.
 */

import { ACCIONES_AUDITABLES, type AccionAuditable, type RegistroAuditoria } from '@consultorio/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alerta, Boton, Cargando, Tarjeta } from '../../components/ui/index.js'
import { accesosDeEmergencia, consultarAuditoria } from './api.js'

const ETIQUETAS_ACCION: Record<AccionAuditable, string> = {
  CREATE: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
  VIEW: 'Consultó',
  PRINT: 'Imprimió',
  EXPORT: 'Exportó',
  LOGIN: 'Inició sesión',
  LOGIN_FAILED: 'Intento fallido',
  LOGOUT: 'Cerró sesión',
  BREAK_GLASS: 'Acceso de emergencia',
}

const ETIQUETAS_ENTIDAD: Record<string, string> = {
  Patient: 'Paciente',
  Appointment: 'Cita',
  Attendance: 'Atención',
  Prescription: 'Receta',
  MedicalExam: 'Examen',
  User: 'Usuario',
  Session: 'Sesión',
  Schedule: 'Horario',
  Location: 'Sede',
  AuditLog: 'Auditoría',
  ConsultaDocumento: 'Consulta de documento',
  ScheduleException: 'Excepción de horario',
  Doctor: 'Médico',
  AttendanceAddendum: 'Addendum',
}

const COLOR_ACCION: Partial<Record<AccionAuditable, string>> = {
  BREAK_GLASS: 'bg-red-100 text-red-800',
  DELETE: 'bg-red-50 text-red-700',
  EXPORT: 'bg-amber-100 text-amber-800',
  LOGIN_FAILED: 'bg-amber-50 text-amber-700',
}

function hace(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return fecha.toISOString().slice(0, 10)
}

export function Auditoria() {
  const [desde, setDesde] = useState(hace(7))
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10))
  const [accion, setAccion] = useState<AccionAuditable | ''>('')
  const [pagina, setPagina] = useState(1)

  const emergencias = useQuery({ queryKey: ['emergencias'], queryFn: accesosDeEmergencia })

  const registros = useQuery({
    queryKey: ['auditoria', desde, hasta, accion, pagina],
    queryFn: () => consultarAuditoria({ desde, hasta, accion, pagina }),
  })

  const total = registros.data?.total ?? 0
  const porPagina = registros.data?.porPagina ?? 50
  const paginas = Math.max(1, Math.ceil(total / porPagina))

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900 sm:text-2xl">Auditoría</h1>
      <p className="mb-4 text-sm text-gray-500">
        Registro de accesos y cambios. No se puede modificar ni borrar.
      </p>

      {/* --- Accesos de emergencia --- */}
      {(emergencias.data?.accesos.length ?? 0) > 0 && (
        <div className="mb-4">
          <Alerta tono="aviso">
            <p className="mb-2 font-medium">
              {emergencias.data!.accesos.length} acceso
              {emergencias.data!.accesos.length === 1 ? '' : 's'} de emergencia en los últimos 30 días
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {emergencias.data!.accesos.slice(0, 5).map((acceso) => (
                <li key={acceso.id}>
                  <span className="font-medium">{acceso.userEmail ?? 'desconocido'}</span> ·{' '}
                  {new Date(acceso.createdAt).toLocaleString('es-PE')}
                  <span className="block text-xs">{acceso.reason}</span>
                </li>
              ))}
            </ul>
          </Alerta>
        </div>
      )}

      {/* --- Filtros --- */}
      <Tarjeta className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="aud-desde" className="text-xs font-medium text-gray-600">
              Desde
            </label>
            <input
              id="aud-desde"
              type="date"
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value)
                setPagina(1)
              }}
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="aud-hasta" className="text-xs font-medium text-gray-600">
              Hasta
            </label>
            <input
              id="aud-hasta"
              type="date"
              value={hasta}
              onChange={(e) => {
                setHasta(e.target.value)
                setPagina(1)
              }}
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="aud-accion" className="text-xs font-medium text-gray-600">
              Acción
            </label>
            <select
              id="aud-accion"
              value={accion}
              onChange={(e) => {
                setAccion(e.target.value as AccionAuditable | '')
                setPagina(1)
              }}
              className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario"
            >
              <option value="">Todas</option>
              {ACCIONES_AUDITABLES.map((valor) => (
                <option key={valor} value={valor}>
                  {ETIQUETAS_ACCION[valor]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          El rango acota la búsqueda a los meses que hagan falta: la tabla está particionada por
          mes y una consulta sin fechas recorrería todo el historial.
        </p>
      </Tarjeta>

      {registros.isLoading && <Cargando mensaje="Consultando el registro…" />}

      {registros.data && (
        <>
          <p className="mb-2 text-sm text-gray-500">
            {total} {total === 1 ? 'registro' : 'registros'}
          </p>

          <ul className="flex flex-col gap-1.5" aria-label="Registros de auditoría">
            {registros.data.registros.map((registro) => (
              <li key={registro.id}>
                <FilaRegistro registro={registro} />
              </li>
            ))}
          </ul>

          {registros.data.registros.length === 0 && (
            <Tarjeta>
              <p className="text-sm text-gray-600">No hay registros en ese rango.</p>
            </Tarjeta>
          )}

          {paginas > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Boton
                variante="secundario"
                onClick={() => setPagina((p) => p - 1)}
                disabled={pagina <= 1}
              >
                Anterior
              </Boton>
              <span className="text-sm text-gray-600">
                {pagina} de {paginas}
              </span>
              <Boton
                variante="secundario"
                onClick={() => setPagina((p) => p + 1)}
                disabled={pagina >= paginas}
              >
                Siguiente
              </Boton>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FilaRegistro({ registro }: { registro: RegistroAuditoria }) {
  const color = COLOR_ACCION[registro.accion] ?? 'bg-gray-100 text-gray-700'

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-gray-200 bg-white p-3 text-sm">
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
        {ETIQUETAS_ACCION[registro.accion]}
      </span>

      <span className="text-gray-900">
        {ETIQUETAS_ENTIDAD[registro.entidad] ?? registro.entidad}
      </span>

      {/*
        El correo se guardó tal como era en ese momento. Si el usuario cambió
        de correo después, aquí interesa el de entonces, no el actual.
      */}
      <span className="text-gray-600">· {registro.usuarioEmail ?? 'sistema'}</span>

      <span className="ml-auto shrink-0 text-xs text-gray-400">
        {new Date(registro.fecha).toLocaleString('es-PE')}
      </span>

      {registro.motivo && (
        <span className="w-full text-xs text-gray-500">{registro.motivo}</span>
      )}
    </div>
  )
}
