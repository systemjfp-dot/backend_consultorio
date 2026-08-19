/**
 * Pruebas de recetas en la web.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'

const MEDICO = {
  id: 'u1',
  email: 'ana@clinica.demo',
  firstName: 'Ana',
  lastName: 'Ruiz',
  roles: ['DOCTOR'],
  doctorId: 'd1',
  permisos: [
    'encounter:create',
    'encounter:read',
    'encounter:update',
    'encounter:complete',
    'prescription:create',
    'prescription:read',
    'prescription:sign',
    'prescription:print',
    'patient:read',
    'appointment:read',
  ],
  twoFactorEnabled: false,
}

const ATENCION = {
  id: 'a1',
  citaId: 'c1',
  pacienteId: 'p1',
  pacienteNombre: 'Carmen Vega',
  pacienteDocumento: '43215678',
  pacienteEdad: 45,
  pacienteEdadLegible: '45 años',
  pacienteAlergias: null,
  medicoId: 'd1',
  medicoNombre: 'Ana Ruiz',
  iniciadaEn: '2026-08-18T14:00:00.000Z',
  finalizadaEn: null,
  congeladaEn: null,
  signosVitales: {
    presionSistolica: null,
    presionDiastolica: null,
    frecuenciaCardiaca: null,
    frecuenciaRespiratoria: null,
    temperatura: null,
    saturacionOxigeno: null,
    pesoKg: null,
    tallaCm: null,
  },
  imc: null,
  motivo: null,
  enfermedadActual: null,
  antecedentesPersonales: null,
  antecedentesFamiliares: null,
  antecedentesQuirurgicos: null,
  medicacionActual: null,
  examenFisico: null,
  diagnostico: null,
  planTratamiento: null,
  notas: null,
  diagnosticos: [],
  addenda: [],
}

let cuerposEnviados: unknown[] = []

function simularApi(
  rutas: Record<string, { estado?: number; cuerpo: unknown }>,
  usuario: unknown = MEDICO,
) {
  cuerposEnviados = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string | URL | Request, opciones?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada.toString()
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
  '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } },
  '/api/recetas/atencion/a1': { cuerpo: { recetas: [] } },
  '/api/recetas/plantillas': { cuerpo: { plantillas: [] } },
  '/api/perfil/firma': { cuerpo: { registrada: true } },
  '/api/recetas/medicamentos': {
    cuerpo: {
      medicamentos: [
        { id: 'm1', nombre: 'Amoxicilina', nombreGenerico: 'Amoxicilina', concentracion: '500 mg', forma: 'Cápsula' },
      ],
    },
  },
}

beforeEach(() => {
  window.history.pushState({}, '', '/atencion/a1')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('emisión de receta', () => {
  async function abrirModal() {
    render(<App />)
    const usuario = userEvent.setup()
    await usuario.click(await screen.findByRole('button', { name: 'Nueva receta' }))
    return { usuario, modal: within(screen.getByRole('dialog')) }
  }

  it('avisa si el médico no tiene firma registrada', async () => {
    // Una receta sin firma no la acepta una farmacia: mejor saberlo antes de
    // escribirla que con el paciente esperando.
    simularApi({ ...RUTAS_BASE, '/api/perfil/firma': { cuerpo: { registrada: false } } })

    const { modal } = await abrirModal()

    expect(await modal.findByText(/No tienes una firma registrada/)).toBeDefined()
    expect(modal.getByRole('button', { name: 'Emitir e imprimir' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('busca en el catálogo de medicamentos', async () => {
    // Sin catálogo, el médico teclea "Paracetamol 500mg" a mano cada vez.
    simularApi(RUTAS_BASE)
    const { usuario, modal } = await abrirModal()

    await usuario.click(modal.getByRole('button', { name: 'Añadir medicamento' }))
    await usuario.type(modal.getByLabelText('Buscar medicamento'), 'amoxi')

    expect(await modal.findByRole('button', { name: /Amoxicilina/ })).toBeDefined()
  })

  it('permite escribir un medicamento que no está en el catálogo', async () => {
    // El catálogo nunca está completo: bloquear lo que no aparece obligaría a
    // recetar algo distinto de lo que el médico quiere.
    simularApi({ ...RUTAS_BASE, '/api/recetas/medicamentos': { cuerpo: { medicamentos: [] } } })
    const { usuario, modal } = await abrirModal()

    await usuario.click(modal.getByRole('button', { name: 'Añadir medicamento' }))
    await usuario.type(modal.getByLabelText('Buscar medicamento'), 'Fórmula magistral')

    expect(await modal.findByRole('button', { name: /Usar «Fórmula magistral»/ })).toBeDefined()
  })

  it('no deja emitir sin medicamentos', async () => {
    simularApi(RUTAS_BASE)
    const { modal } = await abrirModal()

    expect(modal.getByRole('button', { name: 'Emitir e imprimir' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('emite la receta con el medicamento elegido', async () => {
    simularApi({
      ...RUTAS_BASE,
      '/api/recetas': { estado: 201, cuerpo: { receta: { id: 'r1', medicamentos: [] } } },
    })
    const { usuario, modal } = await abrirModal()

    await usuario.click(modal.getByRole('button', { name: 'Añadir medicamento' }))
    await usuario.type(modal.getByLabelText('Buscar medicamento'), 'amoxi')
    await usuario.click(await modal.findByRole('button', { name: /Amoxicilina/ }))
    await usuario.click(modal.getByRole('button', { name: 'Emitir e imprimir' }))

    await waitFor(() => {
      const enviado = cuerposEnviados.find(
        (c) => typeof c === 'object' && c !== null && 'medicamentos' in c,
      ) as { medicamentos: { nombre: string; concentracion: string }[] } | undefined

      expect(enviado?.medicamentos[0]?.nombre).toBe('Amoxicilina')
      // La concentración viene del catálogo, no se teclea.
      expect(enviado?.medicamentos[0]?.concentracion).toBe('500 mg')
    })
  })

  it('aplica una plantilla de un solo clic', async () => {
    // Un médico repite las mismas diez o veinte combinaciones.
    simularApi({
      ...RUTAS_BASE,
      '/api/recetas/plantillas': {
        cuerpo: {
          plantillas: [
            {
              id: 'pl1',
              nombre: 'Faringitis bacteriana',
              indicacionesGenerales: 'Abundante líquido',
              medicamentos: [
                { nombre: 'Amoxicilina', concentracion: '500 mg', via: 'Oral', frecuencia: 'Cada 8 horas' },
                { nombre: 'Paracetamol', concentracion: '500 mg', via: 'Oral' },
              ],
            },
          ],
        },
      },
    })

    const { usuario, modal } = await abrirModal()
    await usuario.click(await modal.findByRole('button', { name: /Faringitis bacteriana/ }))

    expect(modal.getByText(/Amoxicilina 500 mg/)).toBeDefined()
    expect(modal.getByRole('button', { name: 'Emitir e imprimir' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('sin permiso de receta no ofrece emitirlas', async () => {
    simularApi(RUTAS_BASE, {
      ...MEDICO,
      permisos: ['encounter:read', 'encounter:update', 'patient:read'],
    })
    render(<App />)

    await screen.findByRole('heading', { name: 'Carmen Vega' })
    expect(screen.queryByRole('button', { name: 'Nueva receta' })).toBeNull()
  })
})

describe('registro de firma', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/perfil/firma')
  })

  it('explica que se dibuja una sola vez', async () => {
    simularApi({ '/api/perfil/firma': { cuerpo: { registrada: false } } })
    render(<App />)

    expect(await screen.findByText(/una sola vez y aparece en todas tus recetas/)).toBeDefined()
    expect(screen.getByLabelText('Área para dibujar la firma')).toBeDefined()
  })

  it('avisa de que reemplaza la firma anterior', async () => {
    simularApi({ '/api/perfil/firma': { cuerpo: { registrada: true } } })
    render(<App />)

    expect(await screen.findByText(/reemplazará a la anterior/)).toBeDefined()
  })

  it('advierte que un dibujo no equivale a una firma con certificado', async () => {
    // La normativa peruana empuja hacia el certificado digital: conviene que
    // quien la usa sepa exactamente qué está usando.
    simularApi({ '/api/perfil/firma': { cuerpo: { registrada: false } } })
    render(<App />)

    expect(await screen.findByText(/no equivale a una firma electrónica con certificado/)).toBeDefined()
  })

  it('no deja guardar sin haber dibujado', async () => {
    simularApi({ '/api/perfil/firma': { cuerpo: { registrada: false } } })
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Guardar firma' })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
