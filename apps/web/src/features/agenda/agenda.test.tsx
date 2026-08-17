/**
 * Pruebas de la agenda en la web.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'

const RECEPCION = {
  id: 'u1',
  email: 'recepcion@clinica.demo',
  firstName: 'Rosa',
  lastName: 'Díaz',
  roles: ['RECEPTIONIST'],
  permisos: [
    'appointment:read',
    'appointment:create',
    'appointment:update',
    'appointment:cancel',
    'appointment:checkin',
    'appointment:overbook',
    'patient:read',
  ],
  twoFactorEnabled: false,
}

/** Un médico: mismo permiso de lectura, pero alcance propio. */
const MEDICO = {
  ...RECEPCION,
  email: 'ana@clinica.demo',
  firstName: 'Ana',
  lastName: 'Ruiz',
  roles: ['DOCTOR'],
  doctorId: 'd1',
  permisos: ['appointment:read', 'appointment:create', 'patient:read', 'encounter:create'],
}

const MEDICOS = [
  { id: 'd1', nombre: 'Ana Ruiz', especialidad: 'Cardiología', color: '#2563EB', duracionCitaMinutos: 30, activo: true },
  { id: 'd2', nombre: 'Bruno Paz', especialidad: 'Pediatría', color: '#10B981', duracionCitaMinutos: 20, activo: true },
]

const CITA = {
  id: 'c1',
  inicio: '2027-03-01T14:00:00.000Z',
  fin: '2027-03-01T14:30:00.000Z',
  fecha: '2027-03-01',
  hora: '09:00',
  horaFin: '09:30',
  duracionMinutos: 30,
  estado: 'SCHEDULED',
  modalidad: 'PRESENCIAL',
  sobreagendada: false,
  pacienteId: 'p1',
  pacienteNombre: 'María Quispe',
  pacienteDocumento: '43215678',
  pacienteTelefono: '987654321',
  pacienteAlergias: 'Penicilina',
  medicoId: 'd1',
  medicoNombre: 'Ana Ruiz',
  medicoColor: '#2563EB',
  sedeId: null,
  sedeNombre: null,
  motivo: 'Control de presión',
  notas: null,
  llegadaEn: null,
  confirmadaEn: null,
  canceladaEn: null,
  motivoCancelacion: null,
}

let urlesPedidas: string[] = []
let cuerposEnviados: unknown[] = []

function simularApi(
  rutas: Record<string, { estado?: number; cuerpo: unknown }>,
  usuario: unknown = RECEPCION,
) {
  urlesPedidas = []
  cuerposEnviados = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string | URL | Request, opciones?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada.toString()
      urlesPedidas.push(url)
      if (opciones?.body) cuerposEnviados.push(JSON.parse(opciones.body as string))

      if (url.includes('/api/auth/refresh')) {
        return new Response(JSON.stringify({ accessToken: 't', usuario }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const clave = Object.keys(rutas).find((r) => url.includes(r))
      if (!clave) {
        return new Response(
          JSON.stringify({ error: { codigo: 'NO_ENCONTRADO', mensaje: 'no existe' } }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const { estado = 200, cuerpo } = rutas[clave]!
      return new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

const RUTAS_BASE = {
  '/api/agenda/medicos': { cuerpo: { medicos: MEDICOS } },
  '/api/citas?': { cuerpo: { citas: [CITA], desde: '2027-03-01', hasta: '2027-03-01' } },
}

beforeEach(() => {
  window.history.pushState({}, '', '/agenda?fecha=2027-03-01')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('vista de agenda', () => {
  it('muestra las citas del día agrupadas por médico', async () => {
    simularApi(RUTAS_BASE)
    render(<App />)

    expect(await screen.findByText('María Quispe')).toBeDefined()
    // El nombre del médico aparece en su columna y en el selector: se apunta
    // al encabezado, que es lo que identifica la agrupación.
    expect(screen.getByRole('heading', { name: /Ana Ruiz/ })).toBeDefined()
    expect(screen.getByText('09:00')).toBeDefined()
  })

  it('avisa de las alergias en la propia agenda', async () => {
    // Antes de abrir nada: es el dato que puede cambiar una prescripción.
    simularApi(RUTAS_BASE)
    render(<App />)

    expect(await screen.findByTitle('Alergias: Penicilina')).toBeDefined()
  })

  it('el médico no ve el selector de otros médicos', async () => {
    // Su alcance es `own`; ofrecerle cambiar de columna sugiere algo que el
    // servidor no le va a permitir.
    simularApi(RUTAS_BASE, MEDICO)
    render(<App />)

    await screen.findByText('María Quispe')
    expect(screen.queryByLabelText('Filtrar por médico')).toBeNull()
  })

  it('recepción sí ve el selector', async () => {
    simularApi(RUTAS_BASE)
    render(<App />)

    await screen.findByText('María Quispe')
    expect(screen.getByLabelText('Filtrar por médico')).toBeDefined()
  })

  it('la fecha viaja en la URL para poder compartirla y volver atrás', async () => {
    simularApi(RUTAS_BASE)
    render(<App />)

    await screen.findByText('María Quispe')
    expect(urlesPedidas.some((u) => u.includes('desde=2027-03-01'))).toBe(true)
  })

  it('sin citas lo dice en vez de mostrar una pantalla vacía', async () => {
    simularApi({
      ...RUTAS_BASE,
      '/api/citas?': { cuerpo: { citas: [], desde: '2027-03-01', hasta: '2027-03-01' } },
    })
    render(<App />)

    expect(await screen.findByText('No hay citas para este día.')).toBeDefined()
  })
})

describe('detalle y acciones', () => {
  it('ofrece solo las acciones que permite el estado', async () => {
    // Los botones salen de la misma máquina de estados que aplica el servidor.
    simularApi(RUTAS_BASE)
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByText('María Quispe'))

    // Una cita agendada puede confirmarse, marcarse llegada, no-asistió o
    // cancelarse; nunca "completarse" directamente.
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Registrar llegada' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /Completar/ })).toBeNull()
  })

  it('una cita cerrada no ofrece ninguna acción', async () => {
    simularApi({
      ...RUTAS_BASE,
      '/api/citas?': {
        cuerpo: {
          citas: [{ ...CITA, estado: 'CANCELLED', motivoCancelacion: 'El paciente no puede' }],
          desde: '2027-03-01',
          hasta: '2027-03-01',
        },
      },
    })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByText('María Quispe'))

    expect(screen.getByText('Esta cita ya está cerrada.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull()
  })

  it('cancelar exige escribir un motivo antes de habilitar el botón', async () => {
    simularApi(RUTAS_BASE)
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByText('María Quispe'))
    await usuario.click(screen.getByRole('button', { name: 'Cancelar cita' }))

    const confirmar = screen.getByRole('button', { name: 'Confirmar cancelación' })
    expect(confirmar).toHaveProperty('disabled', true)

    await usuario.type(screen.getByLabelText('Motivo de la cancelación'), 'Se enfermó')
    expect(confirmar).toHaveProperty('disabled', false)
  })

  it('sin permiso de check-in no ofrece registrar la llegada', async () => {
    simularApi(RUTAS_BASE, { ...RECEPCION, permisos: ['appointment:read', 'patient:read'] })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByText('María Quispe'))

    expect(screen.queryByRole('button', { name: 'Registrar llegada' })).toBeNull()
  })
})

describe('nueva cita', () => {
  const RUTAS_NUEVA = {
    ...RUTAS_BASE,
    '/api/pacientes?': {
      cuerpo: {
        pacientes: [
          {
            id: 'p1',
            tipoDocumento: 'DNI',
            documento: '43215678',
            nombres: 'María',
            apellidos: 'Quispe',
            nombreCompleto: 'María Quispe',
            fechaNacimiento: '1978-03-14',
            edad: 48,
            genero: 'F',
            telefono: '987654321',
            alergias: null,
          },
        ],
        total: 1,
        pagina: 1,
        porPagina: 20,
      },
    },
    '/api/agenda/disponibilidad': {
      cuerpo: {
        fecha: '2027-03-01',
        medicoId: 'd1',
        duracionMinutos: 30,
        huecos: [
          { inicio: '2027-03-01T14:00:00.000Z', fin: '2027-03-01T14:30:00.000Z', hora: '09:00', sedeId: null },
          { inicio: '2027-03-01T14:30:00.000Z', fin: '2027-03-01T15:00:00.000Z', hora: '09:30', sedeId: null },
        ],
        motivoSinHuecos: null,
      },
    },
  }

  it('solo ofrece horas que el motor calculó como libres', async () => {
    simularApi(RUTAS_NUEVA)
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Nueva cita' }))

    const modal = within(screen.getByRole('dialog'))
    await usuario.selectOptions(modal.getByLabelText('Médico'), 'd1')

    expect(await modal.findByRole('button', { name: '09:00' })).toBeDefined()
    expect(modal.getByRole('button', { name: '09:30' })).toBeDefined()
    // No hay campo de hora libre: no se puede teclear una imposible.
    expect(screen.queryByLabelText(/Hora$/)).toBeNull()
  })

  it('explica POR QUÉ no hay horas', async () => {
    // "No hay disponibilidad" obligaría a llamar a alguien para saber si el
    // médico libra, está lleno o no trabaja ese día.
    simularApi({
      ...RUTAS_NUEVA,
      '/api/agenda/disponibilidad': {
        cuerpo: {
          fecha: '2027-03-01',
          medicoId: 'd1',
          duracionMinutos: 30,
          huecos: [],
          motivoSinHuecos: 'ausente',
        },
      },
    })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Nueva cita' }))
    await usuario.selectOptions(within(screen.getByRole('dialog')).getByLabelText('Médico'), 'd1')

    expect(await screen.findByText(/vacaciones, congreso o feriado/)).toBeDefined()
  })

  it('no deja agendar hasta elegir paciente, médico y hora', async () => {
    simularApi(RUTAS_NUEVA)
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Nueva cita' }))

    // Las consultas se acotan al diálogo: la agenda de fondo contiene los
    // mismos nombres y haría ambigua cada búsqueda.
    const modal = within(screen.getByRole('dialog'))

    const agendar = modal.getByRole('button', { name: 'Agendar cita' })
    expect(agendar).toHaveProperty('disabled', true)

    await usuario.type(modal.getByLabelText('Buscar paciente'), 'quispe')
    await usuario.click(await modal.findByRole('button', { name: /María Quispe/ }))
    await usuario.selectOptions(modal.getByLabelText('Médico'), 'd1')
    await usuario.click(await modal.findByRole('button', { name: '09:00' }))

    expect(agendar).toHaveProperty('disabled', false)
  })

  it('envía el instante absoluto del hueco, no una hora reconstruida', async () => {
    // La conversión de husos la hizo el servidor: repetirla aquí es justo lo
    // que la convención del proyecto quiere impedir.
    simularApi({ ...RUTAS_NUEVA, '/api/citas': { estado: 201, cuerpo: { cita: CITA } } })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Nueva cita' }))

    const modal = within(screen.getByRole('dialog'))
    await usuario.type(modal.getByLabelText('Buscar paciente'), 'quispe')
    await usuario.click(await modal.findByRole('button', { name: /María Quispe/ }))
    await usuario.selectOptions(modal.getByLabelText('Médico'), 'd1')
    await usuario.click(await modal.findByRole('button', { name: '09:00' }))
    await usuario.click(modal.getByRole('button', { name: 'Agendar cita' }))

    await waitFor(() => {
      const enviado = cuerposEnviados.find(
        (c) => typeof c === 'object' && c !== null && 'inicio' in c,
      ) as { inicio: string } | undefined
      expect(enviado?.inicio).toBe('2027-03-01T14:00:00.000Z')
    })
  })

  it('la opción de sobreagenda solo aparece con permiso', async () => {
    simularApi(RUTAS_NUEVA)
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Nueva cita' }))
    expect(screen.getByText('Sobreagenda')).toBeDefined()

    cleanup()

    simularApi(RUTAS_NUEVA, { ...RECEPCION, permisos: ['appointment:read', 'appointment:create', 'patient:read'] })
    render(<App />)

    await usuario.click(await screen.findByRole('button', { name: 'Nueva cita' }))
    expect(screen.queryByText('Sobreagenda')).toBeNull()
  })
})
