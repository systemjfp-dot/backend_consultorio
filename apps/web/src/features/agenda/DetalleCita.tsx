/**
 * Detalle de una cita y sus acciones.
 *
 * Los botones se calculan con la MISMA máquina de estados que aplica el
 * servidor (`TRANSICIONES`, en el paquete compartido). Con dos definiciones,
 * la pantalla acabaría ofreciendo acciones que la API rechaza.
 */

import {
  ETIQUETAS_ESTADO,
  TRANSICIONES,
  type Cita,
  type EstadoCita,
} from '@consultorio/shared'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alerta, Boton, Campo } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.js'
import { cancelarCita, confirmarCita, marcarInasistencia, registrarLlegada } from './api.js'
import { Modal } from './Modal.js'

export function DetalleCita({
  cita,
  onCerrar,
  onCambio,
}: {
  cita: Cita
  onCerrar: () => void
  onCambio: () => void
}) {
  const { can } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [motivoCancelacion, setMotivoCancelacion] = useState('')

  const posibles = TRANSICIONES[cita.estado]

  function conError<T>(promesa: Promise<T>) {
    return promesa.catch((fallo: unknown) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo completar la acción')
      throw fallo
    })
  }

  const confirmar = useMutation({
    mutationFn: () => conError(confirmarCita(cita.id)),
    onSuccess: onCambio,
  })
  const llegada = useMutation({
    mutationFn: () => conError(registrarLlegada(cita.id)),
    onSuccess: onCambio,
  })
  const inasistencia = useMutation({
    mutationFn: () => conError(marcarInasistencia(cita.id)),
    onSuccess: onCambio,
  })
  const cancelar = useMutation({
    mutationFn: () => conError(cancelarCita(cita.id, motivoCancelacion, 'PATIENT')),
    onSuccess: onCambio,
  })

  const puede = (estado: EstadoCita, permiso: Parameters<typeof can>[0]) =>
    posibles.includes(estado) && can(permiso)

  return (
    <Modal titulo={cita.hora + ' · ' + cita.pacienteNombre} onCerrar={onCerrar}>
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}

        {cita.pacienteAlergias && (
          <Alerta tono="error">
            <span className="font-medium">Alergias:</span> {cita.pacienteAlergias}
          </Alerta>
        )}

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Dato etiqueta="Estado" valor={ETIQUETAS_ESTADO[cita.estado]} />
          <Dato etiqueta="Médico" valor={cita.medicoNombre} />
          <Dato etiqueta="Hora" valor={`${cita.hora} – ${cita.horaFin}`} />
          <Dato etiqueta="Sede" valor={cita.sedeNombre} />
          <Dato etiqueta="Documento" valor={cita.pacienteDocumento} />
          <Dato etiqueta="Teléfono" valor={cita.pacienteTelefono} />
        </dl>

        {cita.motivo && (
          <div>
            <p className="text-sm text-gray-500">Motivo</p>
            <p className="text-sm text-gray-900">{cita.motivo}</p>
          </div>
        )}

        {cita.motivoCancelacion && (
          <div>
            <p className="text-sm text-gray-500">Motivo de cancelación</p>
            <p className="text-sm text-gray-900">{cita.motivoCancelacion}</p>
          </div>
        )}

        <Link
          to={`/pacientes/${cita.pacienteId}`}
          className="text-sm font-medium text-primario hover:underline"
        >
          Ver ficha del paciente →
        </Link>

        {cancelando ? (
          <div className="flex flex-col gap-3 border-t border-gray-100 pt-4">
            <Campo
              etiqueta="Motivo de la cancelación"
              ayuda="Se usa en el reporte de cancelaciones"
              value={motivoCancelacion}
              onChange={(e) => setMotivoCancelacion(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <Boton
                variante="peligro"
                onClick={() => cancelar.mutate()}
                disabled={motivoCancelacion.trim().length < 3}
                cargando={cancelar.isPending}
              >
                Confirmar cancelación
              </Boton>
              <Boton variante="secundario" onClick={() => setCancelando(false)}>
                Volver
              </Boton>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
            {puede('CONFIRMED', 'appointment:update') && (
              <Boton variante="secundario" onClick={() => confirmar.mutate()} cargando={confirmar.isPending}>
                Confirmar
              </Boton>
            )}
            {puede('ARRIVED', 'appointment:checkin') && (
              <Boton onClick={() => llegada.mutate()} cargando={llegada.isPending}>
                Registrar llegada
              </Boton>
            )}
            {puede('NO_SHOW', 'appointment:update') && (
              <Boton variante="secundario" onClick={() => inasistencia.mutate()} cargando={inasistencia.isPending}>
                No asistió
              </Boton>
            )}
            {puede('CANCELLED', 'appointment:cancel') && (
              <Boton variante="fantasma" onClick={() => setCancelando(true)}>
                Cancelar cita
              </Boton>
            )}
            {posibles.length === 0 && (
              <p className="text-sm text-gray-500">Esta cita ya está cerrada.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-gray-500">{etiqueta}</dt>
      <dd className="text-gray-900">{valor || <span className="text-gray-400">—</span>}</dd>
    </div>
  )
}
