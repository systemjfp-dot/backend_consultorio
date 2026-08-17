/**
 * Pruebas del motor de disponibilidad.
 *
 * Escritas antes de la implementación. Es el módulo donde el plan prometía TDD
 * estricto, y con razón: calcular qué huecos quedan libres cruzando horarios,
 * excepciones, duraciones y citas existentes tiene muchos más casos límite de
 * los que caben en la cabeza, y cada uno se manifiesta como un paciente citado
 * a una hora en la que no hay médico.
 *
 * El motor es una FUNCIÓN PURA: recibe datos y devuelve huecos. No consulta la
 * base ni mira el reloj salvo que se le pase. Eso es lo que permite escribir
 * estas pruebas sin preparar nada.
 */

import { describe, expect, it } from 'vitest'
import { calcularHuecos, type Franja, type Ocupacion } from './disponibilidad.js'

const LIMA = 'America/Lima'
const LUNES = '2026-08-17'
const DOMINGO = '2026-08-16'

/** Mañana de 08:00 a 13:00. */
const MANANA: Franja = { diaSemana: 1, inicioMinuto: 480, finMinuto: 780 }

/** Atajo: los huecos como texto "HH:MM", que es como se leen. */
function horas(huecos: { inicioMinuto: number }[]): string[] {
  return huecos.map((h) => {
    const hh = String(Math.floor(h.inicioMinuto / 60)).padStart(2, '0')
    const mm = String(h.inicioMinuto % 60).padStart(2, '0')
    return `${hh}:${mm}`
  })
}

function calcular(opciones: Partial<Parameters<typeof calcularHuecos>[0]> = {}) {
  return calcularHuecos({
    fecha: LUNES,
    zonaHoraria: LIMA,
    franjas: [MANANA],
    excepciones: [],
    ocupadas: [],
    duracionMinutos: 60,
    // Un instante muy anterior: por defecto ninguna prueba mira el reloj.
    ahora: new Date('2020-01-01T00:00:00Z'),
    ...opciones,
  })
}

describe('generación básica', () => {
  it('divide la franja en huecos de la duración pedida', () => {
    expect(horas(calcular())).toEqual(['08:00', '09:00', '10:00', '11:00', '12:00'])
  })

  it('respeta duraciones que no dividen la franja en partes exactas', () => {
    // 08:00–13:00 son 300 minutos; con citas de 45 caben 6 y sobran 30, que no
    // alcanzan para una séptima. Ofrecerla citaría a alguien hasta las 13:15.
    const huecos = calcular({ duracionMinutos: 45 })

    expect(horas(huecos)).toEqual(['08:00', '08:45', '09:30', '10:15', '11:00', '11:45'])
    expect(huecos.at(-1)?.finMinuto).toBe(750)
  })

  it('no hay huecos si la duración no cabe en la franja', () => {
    expect(calcular({ duracionMinutos: 301 })).toEqual([])
  })

  it('un día sin franjas no ofrece nada', () => {
    // Domingo: ninguna franja tiene diaSemana 0.
    expect(calcular({ fecha: DOMINGO })).toEqual([])
  })

  it('solo usa las franjas del día que corresponde', () => {
    const martes: Franja = { diaSemana: 2, inicioMinuto: 900, finMinuto: 1200 }
    expect(horas(calcular({ franjas: [MANANA, martes] }))).toEqual([
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '12:00',
    ])
  })

  it('combina varias franjas del mismo día en orden', () => {
    // Turno partido: mañana y noche, sin inventar huecos en el intermedio.
    const noche: Franja = { diaSemana: 1, inicioMinuto: 1080, finMinuto: 1200 }
    expect(horas(calcular({ franjas: [noche, MANANA] }))).toEqual([
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '18:00',
      '19:00',
    ])
  })

  it('cada franja puede tener su propia duración de cita', () => {
    // Un médico atiende de 30 minutos por la mañana y de 60 por la tarde.
    const tarde: Franja = { diaSemana: 1, inicioMinuto: 840, finMinuto: 960, slotMinutos: 60 }
    const manana: Franja = { ...MANANA, finMinuto: 540, slotMinutos: 30 }

    expect(horas(calcular({ franjas: [manana, tarde], duracionMinutos: 20 }))).toEqual([
      '08:00',
      '08:30',
      '14:00',
      '15:00',
    ])
  })

  it('cada hueco lleva la sede de su franja', () => {
    const huecos = calcular({ franjas: [{ ...MANANA, sedeId: 'sede-norte' }] })
    expect(huecos.every((h) => h.sedeId === 'sede-norte')).toBe(true)
  })
})

describe('citas ya agendadas', () => {
  const ocupar = (inicio: number, fin: number): Ocupacion => ({
    inicio: new Date(Date.UTC(2026, 7, 17, 5 + Math.floor(inicio / 60), inicio % 60)),
    fin: new Date(Date.UTC(2026, 7, 17, 5 + Math.floor(fin / 60), fin % 60)),
  })

  it('retira el hueco exactamente ocupado', () => {
    expect(horas(calcular({ ocupadas: [ocupar(540, 600)] }))).toEqual([
      '08:00',
      '10:00',
      '11:00',
      '12:00',
    ])
  })

  it('retira el hueco aunque el solape sea parcial', () => {
    // Una cita de 09:30 a 09:50 no deja libre el hueco de 09:00: es la trampa
    // en la que caía el diseño original, que solo comparaba horas de inicio.
    expect(horas(calcular({ ocupadas: [ocupar(570, 590)] }))).toEqual([
      '08:00',
      '10:00',
      '11:00',
      '12:00',
    ])
  })

  it('una cita que cruza dos huecos retira los dos', () => {
    expect(horas(calcular({ ocupadas: [ocupar(570, 630)] }))).toEqual(['08:00', '11:00', '12:00'])
  })

  it('una cita pegada al borde NO retira el hueco contiguo', () => {
    // De 09:00 a 10:00 y de 10:00 a 11:00 no se solapan: el fin es exclusivo.
    // Tratarlos como conflicto perdería la mitad de la agenda del día.
    expect(horas(calcular({ ocupadas: [ocupar(540, 600)] }))).toContain('10:00')
  })

  it('una cita fuera de la franja no afecta a nada', () => {
    expect(horas(calcular({ ocupadas: [ocupar(1200, 1260)] }))).toHaveLength(5)
  })
})

describe('excepciones de horario', () => {
  it('una ausencia de día completo deja el día sin huecos', () => {
    // Vacaciones, congreso, feriado.
    expect(calcular({ excepciones: [{ tipo: 'AUSENTE' }] })).toEqual([])
  })

  it('una ausencia parcial retira solo esas horas', () => {
    // El médico sale a las 10:00 y vuelve a las 12:00.
    expect(horas(calcular({ excepciones: [{ tipo: 'AUSENTE', inicioMinuto: 600, finMinuto: 720 }] }))).toEqual(
      ['08:00', '09:00', '12:00'],
    )
  })

  it('una ausencia parcial retira también los huecos que la rozan', () => {
    expect(
      horas(calcular({ excepciones: [{ tipo: 'AUSENTE', inicioMinuto: 630, finMinuto: 650 }] })),
    ).toEqual(['08:00', '09:00', '11:00', '12:00'])
  })

  it('una franja extraordinaria añade horas fuera del horario habitual', () => {
    // Un médico que abre un sábado o alarga una tarde puntualmente.
    const huecos = calcular({
      excepciones: [{ tipo: 'EXTRA', inicioMinuto: 900, finMinuto: 1020 }],
    })
    expect(horas(huecos)).toEqual(['08:00', '09:00', '10:00', '11:00', '12:00', '15:00', '16:00'])
  })

  it('una franja extraordinaria funciona en un día sin horario habitual', () => {
    // Guardia de domingo: sin esto, no habría forma de abrir un día suelto.
    expect(
      horas(calcular({ fecha: DOMINGO, excepciones: [{ tipo: 'EXTRA', inicioMinuto: 540, finMinuto: 660 }] })),
    ).toEqual(['09:00', '10:00'])
  })

  it('una ausencia gana sobre una franja extraordinaria', () => {
    // Si algo se anuló, se anuló: la ausencia es la información más reciente.
    expect(
      calcular({
        fecha: DOMINGO,
        excepciones: [
          { tipo: 'EXTRA', inicioMinuto: 540, finMinuto: 660 },
          { tipo: 'AUSENTE' },
        ],
      }),
    ).toEqual([])
  })
})

describe('huecos en el pasado', () => {
  it('no se ofrecen horas que ya pasaron', () => {
    // Son las 10:30 de Lima (15:30 UTC).
    const huecos = calcular({ ahora: new Date('2026-08-17T15:30:00Z') })
    expect(horas(huecos)).toEqual(['11:00', '12:00'])
  })

  it('se respeta una anticipación mínima', () => {
    // A las 10:30 con 45 minutos de margen, el hueco de las 11:00 queda fuera:
    // no da tiempo a avisar al paciente ni a que llegue.
    const huecos = calcular({
      ahora: new Date('2026-08-17T15:30:00Z'),
      anticipacionMinutos: 45,
    })
    expect(horas(huecos)).toEqual(['12:00'])
  })

  it('un día futuro no se ve afectado por la hora actual', () => {
    const huecos = calcular({
      fecha: '2026-08-24',
      ahora: new Date('2026-08-17T15:30:00Z'),
    })
    expect(horas(huecos)).toHaveLength(5)
  })

  it('un día pasado no ofrece nada', () => {
    expect(calcular({ fecha: '2026-08-10', ahora: new Date('2026-08-17T15:30:00Z') })).toEqual([])
  })
})

describe('instantes devueltos', () => {
  it('cada hueco trae el instante absoluto que se guardará en la cita', () => {
    // Evita que quien llama tenga que repetir la conversión de husos, que es
    // exactamente lo que la convención del proyecto quiere impedir.
    const primero = calcular()[0]!

    expect(primero.inicio.toISOString()).toBe('2026-08-17T13:00:00.000Z')
    expect(primero.fin.toISOString()).toBe('2026-08-17T14:00:00.000Z')
  })

  it('los huecos salen ordenados por hora', () => {
    const tarde: Franja = { diaSemana: 1, inicioMinuto: 840, finMinuto: 960 }
    const huecos = calcular({ franjas: [tarde, MANANA] })

    const minutos = huecos.map((h) => h.inicioMinuto)
    expect(minutos).toEqual([...minutos].sort((a, b) => a - b))
  })
})

describe('franjas solapadas', () => {
  it('no duplica huecos cuando dos franjas se pisan', () => {
    // La base lo impide con un constraint de exclusión, pero el motor no debe
    // ofrecer la misma hora dos veces si los datos llegaran mal.
    const a: Franja = { diaSemana: 1, inicioMinuto: 480, finMinuto: 600 }
    const b: Franja = { diaSemana: 1, inicioMinuto: 540, finMinuto: 660 }

    const huecos = calcular({ franjas: [a, b] })
    const inicios = huecos.map((h) => h.inicioMinuto)

    expect(new Set(inicios).size).toBe(inicios.length)
  })
})
