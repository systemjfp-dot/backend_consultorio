/**
 * Pruebas de reportes y auditoría en la web.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'

const ADMIN = {
  id: 'u1',
  email: 'admin@clinica.demo',
  firstName: 'Luis',
  lastName: 'Soto',
  roles: ['ADMIN'],
  permisos: ['report:appointments', 'report:patients', 'audit:read', 'appointment:read'],
  twoFactorEnabled: true,
}

const MEDICO = {
  ...ADMIN,
  email: 'ana@clinica.demo',
  firstName: 'Ana',
  lastName: 'Ruiz',
  roles: ['DOCTOR'],
  doctorId: 'd1',
  permisos: ['report:appointments', 'report:patients', 'appointment:read'],
}

const REPORTE_CITAS = {
  desde: '2026-08-01',
  hasta: '2026-08-18',
  total: 40,
  porEstado: { agendadas: 10, confirmadas: 4, atendidas: 20, noAsistieron: 4, canceladas: 2 },
  tasaAsistencia: 83.3,
  tasaInasistencia: 16.7,
  tasaCancelacion: 5,
  porMedico: [
    {
      medicoId: 'd1',
      medicoNombre: 'Ana Ruiz',
      total: 25,
      atendidas: 14,
      noAsistieron: 3,
      canceladas: 1,
      tasaAsistencia: 82.4,
      tasaInasistencia: 17.6,
    },
    {
      medicoId: 'd2',
      medicoNombre: 'Bruno Paz',
      total: 15,
      atendidas: 6,
      noAsistieron: 1,
      canceladas: 1,
      tasaAsistencia: 85.7,
      tasaInasistencia: 14.3,
    },
  ],
  porDiaSemana: [
    { dia: 0, total: 0, noAsistieron: 0 },
    { dia: 1, total: 12, noAsistieron: 2 },
    { dia: 2, total: 8, noAsistieron: 1 },
    { dia: 3, total: 7, noAsistieron: 0 },
    { dia: 4, total: 6, noAsistieron: 1 },
    { dia: 5, total: 5, noAsistieron: 0 },
    { dia: 6, total: 2, noAsistieron: 0 },
  ],
  motivosCancelacion: [{ motivo: 'Se enfermó', cantidad: 2 }],
  cancelacionesPorOrigen: { paciente: 2, clinica: 0 },
}

const REPORTE_PACIENTES = {
  desde: '2026-08-01',
  hasta: '2026-08-18',
  nuevos: 5,
  recurrentes: 15,
  totalAtendidos: 20,
  porGenero: [{ genero: 'F', cantidad: 12 }],
  porRangoEdad: [
    { rango: '18-39', cantidad: 8 },
    { rango: '40-59', cantidad: 12 },
  ],
}

function simularApi(rutas: Record<string, { estado?: number; cuerpo: unknown }>, usuario: unknown = ADMIN) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string | URL | Request) => {
      const url = typeof entrada === 'string' ? entrada : entrada.toString()

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

const RUTAS = {
  '/api/reportes/citas?': { cuerpo: REPORTE_CITAS },
  '/api/reportes/pacientes?': { cuerpo: REPORTE_PACIENTES },
  '/api/agenda/medicos': {
    cuerpo: {
      medicos: [
        { id: 'd1', nombre: 'Ana Ruiz', especialidad: 'Cardiología', color: '#2563EB', duracionCitaMinutos: 20, activo: true },
        { id: 'd2', nombre: 'Bruno Paz', especialidad: 'Pediatría', color: '#10B981', duracionCitaMinutos: 20, activo: true },
      ],
    },
  },
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reportes', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/reportes')
  })

  it('muestra las cifras principales', async () => {
    simularApi(RUTAS)
    render(<App />)

    expect(await screen.findByText('83.3%')).toBeDefined()
    expect(screen.getByText('16.7%')).toBeDefined()
  })

  it('explica sobre qué se calculan las tasas', async () => {
    // Una tasa de asistencia sin decir su base es un número que cada quien
    // interpreta a su manera.
    simularApi(RUTAS)
    render(<App />)

    expect(await screen.findByText(/citas ya resueltas/)).toBeDefined()
  })

  it('desglosa por médico', async () => {
    simularApi(RUTAS)
    render(<App />)

    expect(await screen.findByRole('table')).toBeDefined()
    const tabla = within(screen.getByRole('table'))
    expect(tabla.getByText('Ana Ruiz')).toBeDefined()
    expect(tabla.getByText('Bruno Paz')).toBeDefined()
  })

  it('muestra los motivos de cancelación', async () => {
    // Es lo que justifica que cancelar exija un motivo.
    simularApi(RUTAS)
    render(<App />)

    expect(await screen.findByText('Se enfermó')).toBeDefined()
    expect(screen.getByText(/2 canceladas por el paciente/)).toBeDefined()
  })

  it('el médico no ve el selector de otros médicos', async () => {
    // Su alcance es propio: el reporte solo puede ser el suyo.
    simularApi(RUTAS, MEDICO)
    render(<App />)

    await screen.findByText('83.3%')
    expect(screen.queryByLabelText('Médico')).toBeNull()
  })

  it('ofrece exportar a Excel', async () => {
    simularApi(RUTAS)
    render(<App />)

    expect((await screen.findAllByRole('button', { name: 'Exportar a Excel' })).length).toBe(2)
  })

  it('muestra el error del servidor en vez de una pantalla en blanco', async () => {
    simularApi({
      ...RUTAS,
      '/api/reportes/citas?': {
        estado: 400,
        cuerpo: { error: { codigo: 'PETICION_INVALIDA', mensaje: 'El rango no puede superar los 3 años' } },
      },
    })
    render(<App />)

    expect(await screen.findByText(/3 años/)).toBeDefined()
  })
})

describe('auditoría', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/auditoria')
  })

  const RUTAS_AUDITORIA = {
    '/api/emergencia/recientes': { cuerpo: { accesos: [] } },
    '/api/auditoria?': {
      cuerpo: {
        registros: [
          {
            id: 'a1',
            usuarioId: 'u9',
            usuarioEmail: 'ana@clinica.demo',
            accion: 'VIEW',
            entidad: 'Attendance',
            entidadId: 'at1',
            permiso: 'encounter:read',
            roles: ['DOCTOR'],
            motivo: null,
            ip: '190.0.0.1',
            fecha: '2026-08-18T14:00:00.000Z',
          },
        ],
        total: 1,
        pagina: 1,
        porPagina: 50,
        desde: '2026-08-11',
        hasta: '2026-08-18',
      },
    },
  }

  it('traduce acciones y entidades al castellano', async () => {
    simularApi(RUTAS_AUDITORIA)
    render(<App />)

    // Se acota al listado: "Consultó" aparece también como opción del filtro,
    // y encontrarlo ahí no prueba que el registro se haya pintado.
    const lista = within(await screen.findByRole('list', { name: 'Registros de auditoría' }))

    expect(lista.getByText('Consultó')).toBeDefined()
    expect(lista.getByText('Atención')).toBeDefined()
    expect(lista.getByText(/ana@clinica.demo/)).toBeDefined()
  })

  it('destaca los accesos de emergencia', async () => {
    // Son la excepción por definición: si aparecen varios al día, hay algo que
    // revisar.
    simularApi({
      ...RUTAS_AUDITORIA,
      '/api/emergencia/recientes': {
        cuerpo: {
          accesos: [
            {
              id: 'e1',
              userEmail: 'bruno@clinica.demo',
              entityId: 'p1',
              reason: 'Paciente en urgencia, su médico tratante no está disponible',
              ipAddress: '190.0.0.2',
              createdAt: '2026-08-18T10:00:00.000Z',
            },
          ],
        },
      },
    })
    render(<App />)

    expect(await screen.findByText(/1 acceso de emergencia/)).toBeDefined()
    expect(screen.getByText(/su médico tratante no está disponible/)).toBeDefined()
  })

  it('advierte de que el registro no se puede modificar', async () => {
    simularApi(RUTAS_AUDITORIA)
    render(<App />)

    expect(await screen.findByText(/No se puede modificar ni borrar/)).toBeDefined()
  })

  it('explica por qué hay que acotar el rango', async () => {
    simularApi(RUTAS_AUDITORIA)
    render(<App />)

    expect(await screen.findByText(/particionada por mes/)).toBeDefined()
  })
})
