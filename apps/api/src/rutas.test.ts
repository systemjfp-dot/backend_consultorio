/**
 * Cobertura de control de acceso.
 *
 * ESTA ES LA PRUEBA MÁS IMPORTANTE DEL PROYECTO.
 *
 * La vulnerabilidad más común en un sistema como este no es un permiso mal
 * asignado —eso se revisa— sino el endpoint nuevo que alguien añadió con prisa
 * y olvidó proteger. No lo detecta ninguna revisión de código porque no hay
 * nada que mirar: la línea que falta no está.
 *
 * Aquí se recorren TODAS las rutas registradas y se exige que cada una declare
 * explícitamente su nivel de acceso. Añadir un endpoint sin decidirlo pone la
 * suite en rojo.
 */

import { describe, expect, it } from 'vitest'
import { PERMISOS, esPermiso } from '@consultorio/shared'
import { estaMarcado, type MarcadorAcceso } from './middleware/permisos.js'
import { MODULOS_DE_RUTAS } from './rutas.js'

interface RutaRegistrada {
  metodo: string
  ruta: string
  marcadores: MarcadorAcceso[]
}

/** Recorre los routers y saca la lista real de rutas con sus marcadores. */
function recolectarRutas(): RutaRegistrada[] {
  const rutas: RutaRegistrada[] = []

  for (const { prefijo, router } of MODULOS_DE_RUTAS) {
    const capas = (router as unknown as { stack: unknown[] }).stack

    for (const capa of capas) {
      const ruta = (capa as { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } })
        .route
      if (!ruta) continue

      const marcadores = ruta.stack
        .map((entrada) => entrada.handle)
        .filter(estaMarcado)
        .map((manejador) => manejador as MarcadorAcceso)

      for (const metodo of Object.keys(ruta.methods)) {
        rutas.push({
          metodo: metodo.toUpperCase(),
          ruta: `${prefijo}${ruta.path === '/' ? '' : ruta.path}`,
          marcadores,
        })
      }
    }
  }

  return rutas
}

const RUTAS = recolectarRutas()

describe('cobertura de control de acceso', () => {
  it('encuentra rutas registradas (la prueba no es vacía)', () => {
    // Sin esto, un fallo en el recorrido daría una lista vacía y todas las
    // comprobaciones siguientes pasarían sin haber mirado nada.
    expect(RUTAS.length).toBeGreaterThan(5)
  })

  it('TODA ruta declara su nivel de acceso', () => {
    const sinDeclarar = RUTAS.filter((r) => r.marcadores.length === 0).map(
      (r) => `${r.metodo} ${r.ruta}`,
    )

    expect(
      sinDeclarar,
      'Estas rutas no declaran nivel de acceso. Añade requierePermiso(), ' +
        'rutaPropia() o rutaPublica() según corresponda:\n' +
        sinDeclarar.map((r) => `  · ${r}`).join('\n'),
    ).toEqual([])
  })

  it('ninguna ruta declara dos niveles a la vez', () => {
    // Una ruta a la vez pública y con permiso es una contradicción: revela que
    // alguien copió un bloque sin ajustarlo.
    const contradictorias = RUTAS.filter((r) => r.marcadores.length > 1).map(
      (r) => `${r.metodo} ${r.ruta}`,
    )

    expect(contradictorias).toEqual([])
  })

  it('toda ruta pública o propia justifica por qué lo es', () => {
    const sinMotivo = RUTAS.filter((r) => {
      const marcador = r.marcadores[0]
      if (!marcador) return false
      if (!marcador.esPublica && !marcador.esPropia) return false
      return !marcador.motivo || marcador.motivo.trim().length < 20
    }).map((r) => `${r.metodo} ${r.ruta}`)

    expect(
      sinMotivo,
      'Si no se puede explicar en una frase por qué una ruta no exige permiso, ' +
        'probablemente sí debería exigirlo:\n' + sinMotivo.join('\n'),
    ).toEqual([])
  })

  it('los permisos exigidos existen en el catálogo', () => {
    // Un permiso mal escrito en una ruta no lo tendría NADIE, y el endpoint
    // quedaría inaccesible para todos sin que nada lo explique.
    const desconocidos = RUTAS.flatMap((r) =>
      r.marcadores
        .map((m) => m.permisoRequerido)
        .filter((p): p is string => Boolean(p) && !esPermiso(p as string))
        .map((p) => `${r.metodo} ${r.ruta} → ${p}`),
    )

    expect(desconocidos).toEqual([])
  })

  it('las rutas públicas son pocas y conocidas', () => {
    // Una lista blanca explícita: si mañana aparece una ruta pública nueva,
    // esta prueba obliga a añadirla aquí conscientemente en vez de dejarla
    // pasar entre decenas de endpoints.
    const publicas = RUTAS.filter((r) => r.marcadores[0]?.esPublica)
      .map((r) => `${r.metodo} ${r.ruta}`)
      .sort()

    expect(publicas).toEqual([
      'GET /api/health',
      'GET /api/health/ready',
      'POST /api/auth/2fa/verificar',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'POST /api/auth/password/olvide',
      'POST /api/auth/password/restablecer',
      'POST /api/auth/refresh',
    ])
  })
})

describe('inventario de rutas', () => {
  it('no hay rutas duplicadas', () => {
    // Dos definiciones del mismo método y ruta: Express usa la primera y la
    // segunda queda muerta, con su control de acceso incluido.
    const claves = RUTAS.map((r) => `${r.metodo} ${r.ruta}`)
    const duplicadas = claves.filter((c, i) => claves.indexOf(c) !== i)

    expect(duplicadas).toEqual([])
  })

  it('el catálogo de permisos no tiene entradas fantasma en las rutas', () => {
    const usados = new Set(
      RUTAS.flatMap((r) => r.marcadores.map((m) => m.permisoRequerido)).filter(Boolean),
    )
    for (const permiso of usados) {
      expect(PERMISOS).toContain(permiso)
    }
  })
})
