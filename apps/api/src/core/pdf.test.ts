/**
 * Pruebas de los ayudantes de las plantillas PDF.
 *
 * Salió de mirar un PDF renderizado: el papel decía "CMP CMP-45821" porque la
 * plantilla anteponía el prefijo a un número que ya lo traía.
 */

import { describe, expect, it } from 'vitest'
import { escaparHtml, formatearColegiatura } from './pdf.js'

describe('formatearColegiatura', () => {
  it('añade el prefijo cuando solo hay número', () => {
    expect(formatearColegiatura('45821')).toBe('CMP 45821')
  })

  it('no lo duplica si el médico ya lo escribió', () => {
    // Es lo que hay en la base: el perfil guarda "CMP-45821".
    expect(formatearColegiatura('CMP-45821')).toBe('CMP 45821')
    expect(formatearColegiatura('CMP 45821')).toBe('CMP 45821')
    expect(formatearColegiatura('cmp45821')).toBe('CMP 45821')
    expect(formatearColegiatura('C.M.P. 45821')).toBe('CMP 45821')
  })

  it('sin colegiatura no imprime un prefijo suelto', () => {
    // "CMP" a secas bajo la firma parece un dato, y no lo es.
    expect(formatearColegiatura('')).toBe('')
    expect(formatearColegiatura(null)).toBe('')
    expect(formatearColegiatura('  ')).toBe('')
  })

  it('no se come dígitos que empiecen por las mismas letras', () => {
    expect(formatearColegiatura('CMP-CM12')).toBe('CMP CM12')
  })
})

describe('escaparHtml', () => {
  it('neutraliza el marcado que venga en un dato del paciente', () => {
    expect(escaparHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('deja vacío lo que no hay', () => {
    expect(escaparHtml(null)).toBe('')
    expect(escaparHtml(undefined)).toBe('')
  })
})
