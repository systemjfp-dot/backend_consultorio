/**
 * Pruebas de la ficha de atención en la web.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    'encounter:addendum',
    'appointment:read',
    'patient:read',
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
  pacienteAlergias: 'Penicilina',
  medicoId: 'd1',
  medicoNombre: 'Ana Ruiz',
  iniciadaEn: '2026-08-17T14:00:00.000Z',
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

beforeEach(() => {
  window.history.pushState({}, '', '/atencion/a1')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ficha de atención', () => {
  it('muestra al paciente y sus alergias en una cabecera fija', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Carmen Vega' })).toBeDefined()
    expect(screen.getByText(/Penicilina/)).toBeDefined()
    expect(screen.getByText(/45 años/)).toBeDefined()
  })

  it('calcula el IMC en pantalla al escribir peso y talla', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/Peso/), '68')
    await usuario.type(screen.getByLabelText(/Talla/), '165')

    expect(await screen.findByText(/IMC:/)).toBeDefined()
    expect(screen.getByText(/Sobrepeso/)).toBeDefined()
  })

  it('en menores avisa de que la clasificación adulta no aplica', async () => {
    // Los cortes de adulto etiquetarían de "obesidad" a niños con desarrollo
    // normal: en pediatría se usan percentiles por edad y sexo.
    simularApi({
      '/api/atenciones/a1': {
        cuerpo: {
          atencion: { ...ATENCION, pacienteEdad: 8, pacienteEdadLegible: '8 años' },
        },
      },
    })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/Peso/), '30')
    await usuario.type(screen.getByLabelText(/Talla/), '128')

    // El texto aparece en la etiqueta de la clasificación y en la nota que la
    // explica: se comprueban ambas apariciones en vez de exigir una sola.
    expect((await screen.findAllByText(/percentiles/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/tablas de percentiles por edad y sexo/)).toBeDefined()
  })

  it('destaca un signo vital fuera del rango habitual', async () => {
    // No es criterio clínico: solo evita que un 190/110 pase desapercibido
    // entre quince campos.
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/Sistólica/), '190')

    expect(await screen.findByText('Fuera del rango habitual')).toBeDefined()
  })

  it('no destaca un valor normal', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    const usuario = userEvent.setup()
    await usuario.type(await screen.findByLabelText(/Sistólica/), '120')

    expect(screen.queryByText('Fuera del rango habitual')).toBeNull()
  })

  it('no deja completar sin diagnóstico', async () => {
    // Es justo el campo que se pierde al cerrar con prisa entre pacientes.
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    const completar = await screen.findByRole('button', { name: 'Completar atención' })
    expect(completar).toHaveProperty('disabled', true)
    expect(screen.getByText(/Registra un diagnóstico/)).toBeDefined()
  })

  it('habilita completar al escribir un diagnóstico', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    const completar = await screen.findByRole('button', { name: 'Completar atención' })
    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Hipertensión esencial' },
    })

    await waitFor(() => expect(completar).toHaveProperty('disabled', false))
  })

  it('guarda solo, sin pulsar nada', async () => {
    // Una consulta dura veinte minutos: confiar en que alguien pulse "guardar"
    // falla justo el día que hay prisa.
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: ATENCION } } })
    render(<App />)

    await screen.findByRole('heading', { name: 'Carmen Vega' })
    fireEvent.change(screen.getByLabelText('Motivo de consulta'), {
      target: { value: 'Dolor de cabeza' },
    })

    await waitFor(
      () => {
        const guardado = cuerposEnviados.find(
          (c) => typeof c === 'object' && c !== null && 'motivo' in c,
        ) as { motivo: string } | undefined
        expect(guardado?.motivo).toBe('Dolor de cabeza')
      },
      { timeout: 4000 },
    )
  })
})

describe('atención congelada', () => {
  const CONGELADA = {
    ...ATENCION,
    congeladaEn: '2026-08-17T14:30:00.000Z',
    finalizadaEn: '2026-08-17T14:30:00.000Z',
    diagnostico: 'Faringitis aguda',
    addenda: [
      {
        id: 'ad1',
        contenido: 'Se añade resultado de cultivo',
        motivo: 'Resultado tardío',
        autorNombre: 'Ana Ruiz',
        creadoEn: '2026-08-18T10:00:00.000Z',
      },
    ],
  }

  it('avisa de que ya no se puede modificar', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: CONGELADA } } })
    render(<App />)

    expect(await screen.findByText(/está completada/)).toBeDefined()
    expect(screen.getByText(/addendum/)).toBeDefined()
  })

  it('los campos quedan deshabilitados', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: CONGELADA } } })
    render(<App />)

    const diagnostico = await screen.findByLabelText('Descripción')
    expect(diagnostico).toHaveProperty('disabled', true)
  })

  it('no ofrece completar de nuevo', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: CONGELADA } } })
    render(<App />)

    await screen.findByLabelText('Descripción')
    expect(screen.queryByRole('button', { name: 'Completar atención' })).toBeNull()
  })

  it('muestra los addenda con su autor y fecha', async () => {
    simularApi({ '/api/atenciones/a1': { cuerpo: { atencion: CONGELADA } } })
    render(<App />)

    expect(await screen.findByText('Se añade resultado de cultivo')).toBeDefined()
    // La firma incluye autor, fecha y motivo en una sola línea.
    expect(screen.getByText(/Ana Ruiz · .* · Resultado tardío/)).toBeDefined()
  })
})

describe('sala de espera', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/atencion')
  })

  it('lista a quienes ya llegaron', async () => {
    simularApi({
      '/api/citas/sala-de-espera': {
        cuerpo: {
          citas: [
            {
              id: 'c1',
              hora: '09:00',
              pacienteNombre: 'Carmen Vega',
              medicoNombre: 'Ana Ruiz',
              motivo: 'Control',
              pacienteAlergias: 'Penicilina',
            },
          ],
        },
      },
    })
    render(<App />)

    expect(await screen.findByText('Carmen Vega')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Iniciar atención' })).toBeDefined()
    expect(screen.getByText(/Alergias: Penicilina/)).toBeDefined()
  })

  it('sin nadie esperando lo explica', async () => {
    simularApi({ '/api/citas/sala-de-espera': { cuerpo: { citas: [] } } })
    render(<App />)

    expect(await screen.findByText(/No hay pacientes esperando/)).toBeDefined()
  })
})
