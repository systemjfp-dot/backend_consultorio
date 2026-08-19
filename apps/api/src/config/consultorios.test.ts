/**
 * Resolución de consultorio por dominio.
 *
 * Es el único punto del sistema donde un error cruzaría datos entre dos
 * clínicas, así que se prueba aparte de todo lo demás.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { consultorioDeDominio, normalizarDominio } from './consultorios.js'
import { CLAVE_UNICA } from './consultorios.js'

const DOS_CONSULTORIOS = JSON.stringify({
  'sanrafael.ejemplo': { clave: 'sanrafael', baseDeDatos: 'postgresql://x/rafael' },
  'sansantiago.ejemplo': { clave: 'sansantiago', baseDeDatos: 'postgresql://x/santiago' },
})

/**
 * El mapa se lee al importar el módulo, así que para probarlo configurado hay
 * que poner la variable y volver a importarlo desde cero.
 */
async function conMapa(valor: string) {
  vi.resetModules()
  process.env['CONSULTORIOS'] = valor
  return import('./consultorios.js')
}

describe('normalizarDominio', () => {
  it('ignora el puerto', () => {
    // En desarrollo el dominio llega como "sanrafael.localhost:5173"; en
    // producción, sin puerto. Deben ser el mismo consultorio.
    expect(normalizarDominio('sanrafael.localhost:5173')).toBe('sanrafael.localhost')
  })

  it('ignora mayúsculas y espacios', () => {
    expect(normalizarDominio('  SanRafael.Localhost  ')).toBe('sanrafael.localhost')
  })

  it('no confunde un dominio con otro que lo contenga', () => {
    // "sansantiago.com" NO es "santiago.com": el mapa se consulta por
    // igualdad, nunca por parecido.
    expect(normalizarDominio('sansantiago.com')).not.toBe(normalizarDominio('santiago.com'))
  })
})

describe('consultorioDeDominio', () => {
  it('sin mapa configurado, cualquier dominio es el consultorio único', () => {
    // Es el caso de una clínica sola y el de las pruebas: nadie tiene que
    // configurar dominios para que el sistema funcione.
    const consultorio = consultorioDeDominio('lo-que-sea.ejemplo')

    expect(consultorio).not.toBeNull()
    expect(consultorio!.clave).toBe(CLAVE_UNICA)
  })
})

describe('con dos consultorios configurados', () => {
  afterEach(() => {
    delete process.env['CONSULTORIOS']
    vi.resetModules()
  })

  it('cada dominio lleva a su propia base de datos', async () => {
    const { consultorioDeDominio: resolver } = await conMapa(DOS_CONSULTORIOS)

    expect(resolver('sanrafael.ejemplo')!.baseDeDatos).toBe('postgresql://x/rafael')
    expect(resolver('sansantiago.ejemplo')!.baseDeDatos).toBe('postgresql://x/santiago')
  })

  it('un dominio desconocido NO cae en ninguno', async () => {
    // Lo importante de esta prueba: si algún día alguien añade un
    // "?? consultorios[0]" por comodidad, un error de DNS o un proxy mal
    // configurado le serviría a cualquiera los pacientes del primer
    // consultorio de la lista.
    const { consultorioDeDominio: resolver } = await conMapa(DOS_CONSULTORIOS)

    expect(resolver('otro.ejemplo')).toBeNull()
    expect(resolver('')).toBeNull()
  })

  it('el puerto del entorno de desarrollo no despista', async () => {
    const { consultorioDeDominio: resolver } = await conMapa(DOS_CONSULTORIOS)

    expect(resolver('sansantiago.ejemplo:5173')!.clave).toBe('sansantiago')
  })

  it('un dominio que solo se parece a otro no entra', async () => {
    const { consultorioDeDominio: resolver } = await conMapa(DOS_CONSULTORIOS)

    expect(resolver('santiago.ejemplo')).toBeNull()
    expect(resolver('sansantiago.ejemplo.attacker.com')).toBeNull()
  })
})
