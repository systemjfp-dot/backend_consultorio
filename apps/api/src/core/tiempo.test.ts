/**
 * Pruebas del módulo de tiempo.
 *
 * Se escriben ANTES de la implementación. Aquí es donde nacen los errores más
 * caros de una agenda médica —una cita que aparece en el día equivocado, un
 * hueco ofrecido a una hora que el médico no atiende— y son errores que no se
 * ven en pantalla hasta que un paciente llega y no hay nadie.
 */

import { describe, expect, it } from 'vitest'
import {
  aFechaLocal,
  aInstante,
  aMinutosLocales,
  diaDeLaSemana,
  formatearMinutos,
  hoyLocal,
  parsearHora,
  sumarDiasLocal,
} from './tiempo.js'

const LIMA = 'America/Lima'
/** Zona con horario de verano, para comprobar que no se asume un desfase fijo. */
const MADRID = 'Europe/Madrid'

describe('hora local → instante', () => {
  it('las 08:00 en Lima son las 13:00 UTC', () => {
    // Perú está en UTC-5 todo el año.
    expect(aInstante('2026-08-17', 480, LIMA).toISOString()).toBe('2026-08-17T13:00:00.000Z')
  })

  it('medianoche local es las 05:00 UTC', () => {
    expect(aInstante('2026-08-17', 0, LIMA).toISOString()).toBe('2026-08-17T05:00:00.000Z')
  })

  it('las 23:30 locales caen ya en el día siguiente en UTC', () => {
    // El caso que hace que una cita nocturna aparezca en el día equivocado si
    // se mezcla la fecha local con la UTC.
    expect(aInstante('2026-08-17', 1410, LIMA).toISOString()).toBe('2026-08-18T04:30:00.000Z')
  })

  it('no asume un desfase fijo: respeta el horario de verano', () => {
    // Madrid es UTC+1 en invierno y UTC+2 en verano. Un desfase constante
    // desplazaría media agenda una hora durante seis meses del año.
    expect(aInstante('2026-01-15', 600, MADRID).toISOString()).toBe('2026-01-15T09:00:00.000Z')
    expect(aInstante('2026-07-15', 600, MADRID).toISOString()).toBe('2026-07-15T08:00:00.000Z')
  })

  it('rechaza minutos fuera del día', () => {
    expect(() => aInstante('2026-08-17', -1, LIMA)).toThrow()
    expect(() => aInstante('2026-08-17', 1441, LIMA)).toThrow()
  })

  it('rechaza una fecha mal formada', () => {
    expect(() => aInstante('17/08/2026', 480, LIMA)).toThrow()
    expect(() => aInstante('2026-13-01', 480, LIMA)).toThrow()
  })
})

describe('instante → hora local', () => {
  it('devuelve la fecha del calendario de la clínica, no la UTC', () => {
    // A las 02:00 UTC en Lima todavía es el día anterior. Agrupar por la fecha
    // UTC mandaría las citas de la noche al día siguiente en los reportes.
    expect(aFechaLocal(new Date('2026-08-18T02:00:00Z'), LIMA)).toBe('2026-08-17')
    expect(aFechaLocal(new Date('2026-08-17T13:00:00Z'), LIMA)).toBe('2026-08-17')
  })

  it('devuelve los minutos desde medianoche local', () => {
    expect(aMinutosLocales(new Date('2026-08-17T13:00:00Z'), LIMA)).toBe(480)
    expect(aMinutosLocales(new Date('2026-08-17T05:00:00Z'), LIMA)).toBe(0)
    expect(aMinutosLocales(new Date('2026-08-18T04:30:00Z'), LIMA)).toBe(1410)
  })

  it('la conversión es reversible', () => {
    for (const minutos of [0, 1, 480, 719, 720, 1080, 1439]) {
      const instante = aInstante('2026-08-17', minutos, LIMA)
      expect(aMinutosLocales(instante, LIMA)).toBe(minutos)
      expect(aFechaLocal(instante, LIMA)).toBe('2026-08-17')
    }
  })

  it('la reversibilidad se mantiene con horario de verano', () => {
    for (const fecha of ['2026-01-15', '2026-07-15']) {
      const instante = aInstante(fecha, 600, MADRID)
      expect(aFechaLocal(instante, MADRID)).toBe(fecha)
      expect(aMinutosLocales(instante, MADRID)).toBe(600)
    }
  })
})

describe('días', () => {
  it('devuelve el día de la semana con domingo = 0', () => {
    // Coincide con la convención de Schedule.dayOfWeek.
    expect(diaDeLaSemana('2026-08-16')).toBe(0) // domingo
    expect(diaDeLaSemana('2026-08-17')).toBe(1) // lunes
    expect(diaDeLaSemana('2026-08-22')).toBe(6) // sábado
  })

  it('suma días sin desplazarse por husos', () => {
    expect(sumarDiasLocal('2026-08-17', 1)).toBe('2026-08-18')
    expect(sumarDiasLocal('2026-08-31', 1)).toBe('2026-09-01')
    expect(sumarDiasLocal('2026-12-31', 1)).toBe('2027-01-01')
    expect(sumarDiasLocal('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('hoy es el día del calendario de la clínica', () => {
    // A las 22:00 de Lima ya es el día siguiente en UTC: usar la fecha UTC
    // dejaría la agenda del día en blanco cada noche.
    expect(hoyLocal(LIMA, new Date('2026-08-18T03:00:00Z'))).toBe('2026-08-17')
    expect(hoyLocal(LIMA, new Date('2026-08-17T13:00:00Z'))).toBe('2026-08-17')
  })
})

describe('formato de horas', () => {
  it('convierte minutos a HH:MM', () => {
    expect(formatearMinutos(0)).toBe('00:00')
    expect(formatearMinutos(480)).toBe('08:00')
    expect(formatearMinutos(510)).toBe('08:30')
    expect(formatearMinutos(1439)).toBe('23:59')
  })

  it('convierte HH:MM a minutos', () => {
    expect(parsearHora('08:00')).toBe(480)
    expect(parsearHora('8:30')).toBe(510)
    expect(parsearHora('23:59')).toBe(1439)
  })

  it('rechaza horas imposibles', () => {
    expect(() => parsearHora('25:00')).toThrow()
    expect(() => parsearHora('08:75')).toThrow()
    expect(() => parsearHora('ocho')).toThrow()
  })

  it('formatear y parsear son inversas', () => {
    for (const minutos of [0, 7, 480, 725, 1439]) {
      expect(parsearHora(formatearMinutos(minutos))).toBe(minutos)
    }
  })
})
