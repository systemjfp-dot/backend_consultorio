/**
 * Pruebas del módulo de pacientes en la web.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App.js'

const RECEPCION = {
  id: 'u1',
  email: 'recepcion@clinica.demo',
  firstName: 'Rosa',
  lastName: 'Díaz',
  roles: ['RECEPTIONIST'],
  permisos: ['patient:read', 'patient:create', 'patient:update', 'appointment:read'],
  twoFactorEnabled: false,
}

const SOLO_LECTURA = { ...RECEPCION, permisos: ['patient:read'] }

const MARIA = {
  id: 'p1',
  tipoDocumento: 'DNI',
  documento: '43215678',
  nombres: 'María',
  apellidos: 'Quispe Huamán',
  nombreCompleto: 'María Quispe Huamán',
  fechaNacimiento: '1978-03-14',
  edad: 48,
  genero: 'F',
  telefono: '987654321',
  alergias: 'Penicilina',
}

const MARIA_DETALLE = {
  ...MARIA,
  email: null,
  direccion: null,
  antecedentes: null,
  creadoEn: '2026-01-10T10:00:00.000Z',
  actualizadoEn: '2026-01-10T10:00:00.000Z',
}

/** Registra qué URLs se pidieron, para poder afirmar sobre ellas. */
let urlesPedidas: string[] = []

function simularApi(rutas: Record<string, { estado?: number; cuerpo: unknown }>, usuario = RECEPCION) {
  urlesPedidas = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: string | URL | Request) => {
      const url = typeof entrada === 'string' ? entrada : entrada.toString()
      urlesPedidas.push(url)

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
  window.history.pushState({}, '', '/pacientes')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listado', () => {
  it('muestra los pacientes con su edad y documento', async () => {
    simularApi({
      '/api/pacientes': { cuerpo: { pacientes: [MARIA], total: 1, pagina: 1, porPagina: 20 } },
    })

    render(<App />)

    expect(await screen.findByText('María Quispe Huamán')).toBeDefined()
    expect(screen.getByText(/43215678/)).toBeDefined()
    expect(screen.getByText('1 paciente')).toBeDefined()
  })

  it('destaca las alergias sin necesidad de abrir la ficha', async () => {
    // Es el dato que puede cambiar una prescripción: esconderlo un clic más
    // adentro es justo donde se pierde.
    simularApi({
      '/api/pacientes': { cuerpo: { pacientes: [MARIA], total: 1, pagina: 1, porPagina: 20 } },
    })

    render(<App />)

    expect(await screen.findByTitle('Alergias: Penicilina')).toBeDefined()
  })

  it('agrupa las pulsaciones en una sola consulta', async () => {
    // Sin retraso, escribir "quispe" dispara seis peticiones y las cinco
    // primeras llegan tarde y desordenadas.
    simularApi({
      '/api/pacientes': { cuerpo: { pacientes: [], total: 0, pagina: 1, porPagina: 20 } },
    })

    render(<App />)
    const usuario = userEvent.setup()

    const buscador = await screen.findByLabelText('Buscar pacientes')
    await usuario.type(buscador, 'quispe')

    await waitFor(() => {
      expect(urlesPedidas.filter((u) => u.includes('q=quispe')).length).toBeGreaterThan(0)
    })

    // Seis letras, pero no seis búsquedas.
    const busquedas = urlesPedidas.filter((u) => u.includes('/api/pacientes?') && u.includes('q='))
    expect(busquedas.length).toBeLessThan(4)
  })

  it('ofrece registrar cuando la búsqueda no encuentra a nadie', async () => {
    simularApi({
      '/api/pacientes': { cuerpo: { pacientes: [], total: 0, pagina: 1, porPagina: 20 } },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Buscar pacientes'), '12345678')

    expect(await screen.findByText(/No se encontró a nadie/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Registrar a esta persona' })).toBeDefined()
  })

  it('sin permiso de alta no ofrece registrar', async () => {
    simularApi(
      { '/api/pacientes': { cuerpo: { pacientes: [MARIA], total: 1, pagina: 1, porPagina: 20 } } },
      SOLO_LECTURA,
    )

    render(<App />)
    await screen.findByText('María Quispe Huamán')

    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).toBeNull()
  })
})

describe('ficha', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/pacientes/p1')
  })

  it('muestra las alergias antes que cualquier otro dato', async () => {
    simularApi({ '/api/pacientes/p1': { cuerpo: { paciente: MARIA_DETALLE } } })

    render(<App />)

    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).toContain('Penicilina')
  })

  it('explica que el paciente pudo ser dado de baja cuando no se encuentra', async () => {
    simularApi({
      '/api/pacientes/p1': {
        estado: 404,
        cuerpo: { error: { codigo: 'NO_ENCONTRADO', mensaje: 'No se encontró el paciente' } },
      },
    })

    render(<App />)

    expect(await screen.findByText(/dado de baja/)).toBeDefined()
  })

  it('sin permiso de edición no ofrece editar', async () => {
    simularApi({ '/api/pacientes/p1': { cuerpo: { paciente: MARIA_DETALLE } } }, SOLO_LECTURA)

    render(<App />)
    await screen.findByRole('heading', { name: 'María Quispe Huamán' })

    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull()
  })

  it('el documento no se puede modificar desde la edición', async () => {
    simularApi({ '/api/pacientes/p1': { cuerpo: { paciente: MARIA_DETALLE } } })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))

    expect(screen.queryByLabelText('Documento')).toBeNull()
    expect(screen.getByText(/no se puede modificar/)).toBeDefined()
  })
})

describe('registro', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/pacientes/nuevo')
  })

  it('anticipa el formato esperado del DNI mientras se teclea', async () => {
    // La regla de 8 dígitos es una validación cruzada (depende del tipo de
    // documento) y esas solo se ejecutan cuando el resto del formulario es
    // válido. La guía en vivo evita que el error aparezca al final.
    simularApi({})

    render(<App />)
    expect(await screen.findByText('8 dígitos')).toBeDefined()
  })

  it('valida el DNI antes de enviar nada al servidor', async () => {
    simularApi({})

    render(<App />)
    const usuario = userEvent.setup()

    // Siete dígitos: pasa el mínimo del campo pero incumple la regla del DNI,
    // que es el error real de tecleo (un dígito de menos), no una cadena corta.
    await usuario.type(await screen.findByLabelText('Documento'), '1234567')
    await usuario.type(screen.getByLabelText('Nombres'), 'Carmen')
    await usuario.type(screen.getByLabelText('Apellidos'), 'Vega')
    await usuario.type(screen.getByLabelText('Teléfono'), '999888777')
    // Un <input type="date"> no se rellena tecleando en jsdom: se cambia su
    // valor directamente, que es lo que hace el navegador con el selector.
    fireEvent.change(screen.getByLabelText('Fecha de nacimiento'), {
      target: { value: '1990-03-20' },
    })
    await usuario.click(screen.getByRole('button', { name: 'Registrar paciente' }))

    expect(await screen.findByText('El DNI debe tener exactamente 8 dígitos')).toBeDefined()
    // Nada salió hacia el servidor: la validación es idéntica en ambos lados,
    // así que no hace falta el viaje para saber que está mal.
    expect(urlesPedidas.some((u) => u.endsWith('/api/pacientes'))).toBe(false)
  })

  it('si el documento ya existe, lleva a la ficha en vez de dar un error', async () => {
    // Requisito 3.1: no se obliga a la recepcionista a repetir la búsqueda.
    simularApi({
      '/api/pacientes/consulta-documento': {
        cuerpo: { disponible: true, encontrado: true, pacienteExistente: MARIA_DETALLE },
      },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Documento'), '43215678')
    await usuario.click(screen.getByRole('button', { name: 'Buscar datos por documento' }))

    expect(await screen.findByText(/ya está registrado/)).toBeDefined()
    expect(screen.getByRole('link', { name: 'Abrir su ficha' })).toBeDefined()
  })

  it('sin proveedor configurado avisa pero deja registrar a mano', async () => {
    // Autocompletar es una comodidad: su ausencia no puede bloquear el alta.
    simularApi({
      '/api/pacientes/consulta-documento': {
        cuerpo: { disponible: false, encontrado: false },
      },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Documento'), '11223344')
    await usuario.click(screen.getByRole('button', { name: 'Buscar datos por documento' }))

    expect(await screen.findByText(/no está configurada/)).toBeDefined()
    expect(screen.getByLabelText('Nombres')).toBeDefined()
  })

  it('autocompleta los nombres cuando el proveedor responde', async () => {
    simularApi({
      '/api/pacientes/consulta-documento': {
        cuerpo: {
          disponible: true,
          encontrado: true,
          datos: { nombres: 'Ana Lucía', apellidos: 'Torres Vega' },
        },
      },
    })

    render(<App />)
    const usuario = userEvent.setup()

    await usuario.type(await screen.findByLabelText('Documento'), '11223344')
    await usuario.click(screen.getByRole('button', { name: 'Buscar datos por documento' }))

    await waitFor(() => {
      expect((screen.getByLabelText('Nombres') as HTMLInputElement).value).toBe('Ana Lucía')
    })
    expect((screen.getByLabelText('Apellidos') as HTMLInputElement).value).toBe('Torres Vega')
  })
})
