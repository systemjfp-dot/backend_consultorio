/**
 * Conversión entre el calendario de la clínica y los instantes absolutos.
 *
 * ESTE ES EL ÚNICO SITIO DEL SISTEMA QUE HACE ARITMÉTICA DE HUSOS HORARIOS.
 *
 * La convención del proyecto (ver datos/PLAN-DESARROLLO.md) es:
 *
 *   · Todo `DateTime` de la base se guarda en UTC (`timestamptz`).
 *   · Los horarios plantilla son MINUTOS desde medianoche en hora local:
 *     480 = 08:00. Enteros, no texto, para que la aritmética de slots sea suma.
 *   · Una sola función convierte entre ambos mundos. Nadie más lo hace.
 *
 * Esa última regla es la que importa. Cuando la conversión está repartida por
 * el código, cada sitio la hace un poco distinto y la agenda empieza a mostrar
 * citas en el día equivocado sin que nadie sepa cuál de los veinte lugares
 * está mal.
 *
 * No se asume un desfase fijo aunque Perú no tenga horario de verano: escribir
 * `-5` a mano funciona hoy y falla el día que la clínica abra una sede fuera,
 * o que el país cambie de norma. Y sale igual de barato hacerlo bien.
 */

export const ZONA_POR_DEFECTO = 'America/Lima'

const MINUTOS_POR_DIA = 1440
const MS_POR_MINUTO = 60_000

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
const FORMATO_HORA = /^(\d{1,2}):(\d{2})$/

/** Formateadores por zona. Construir uno cuesta lo suyo y se usan mucho. */
const formateadores = new Map<string, Intl.DateTimeFormat>()

function formateador(zona: string): Intl.DateTimeFormat {
  let existente = formateadores.get(zona)
  if (!existente) {
    existente = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formateadores.set(zona, existente)
  }
  return existente
}

interface PartesLocales {
  anio: number
  mes: number
  dia: number
  hora: number
  minuto: number
  segundo: number
}

function partesLocales(instante: Date, zona: string): PartesLocales {
  const partes = formateador(zona).formatToParts(instante)
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? 0)

  return {
    anio: valor('year'),
    mes: valor('month'),
    dia: valor('day'),
    // A medianoche, algunas configuraciones devuelven 24 en lugar de 0.
    hora: valor('hour') % 24,
    minuto: valor('minute'),
    segundo: valor('second'),
  }
}

/** Desfase de la zona respecto a UTC, en milisegundos, para ese instante. */
function desfase(instante: Date, zona: string): number {
  const p = partesLocales(instante, zona)
  const comoSiFueraUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo)
  return comoSiFueraUtc - instante.getTime()
}

function validarFecha(fechaLocal: string): { anio: number; mes: number; dia: number } {
  const coincidencia = FORMATO_FECHA.exec(fechaLocal)
  if (!coincidencia) {
    throw new RangeError(`Fecha inválida: "${fechaLocal}". Se espera AAAA-MM-DD.`)
  }

  const [, anio, mes, dia] = coincidencia.map(Number) as [number, number, number, number]

  // Se comprueba que la fecha exista de verdad: Date.UTC acepta el mes 13 y lo
  // traslada al año siguiente en silencio, que es la clase de error que
  // termina en una cita agendada doce meses más tarde.
  const comprobacion = new Date(Date.UTC(anio, mes - 1, dia))
  if (
    comprobacion.getUTCFullYear() !== anio ||
    comprobacion.getUTCMonth() !== mes - 1 ||
    comprobacion.getUTCDate() !== dia
  ) {
    throw new RangeError(`Fecha inexistente: "${fechaLocal}".`)
  }

  return { anio, mes, dia }
}

/**
 * Hora del calendario de la clínica → instante absoluto.
 *
 * Se resuelve en dos pasadas: la primera estima el desfase usando el instante
 * aproximado, y la segunda lo recalcula sobre el resultado. Hace falta porque
 * el desfase depende del propio instante, y en un cambio de horario de verano
 * una sola pasada erraría por una hora.
 */
export function aInstante(fechaLocal: string, minutos: number, zona: string): Date {
  if (!Number.isInteger(minutos) || minutos < 0 || minutos > MINUTOS_POR_DIA) {
    throw new RangeError(`Minutos fuera del día: ${minutos}. Se espera 0–${MINUTOS_POR_DIA}.`)
  }

  const { anio, mes, dia } = validarFecha(fechaLocal)
  const comoSiFueraUtc = Date.UTC(anio, mes - 1, dia) + minutos * MS_POR_MINUTO

  const primeraEstimacion = comoSiFueraUtc - desfase(new Date(comoSiFueraUtc), zona)
  const ajustado = comoSiFueraUtc - desfase(new Date(primeraEstimacion), zona)

  return new Date(ajustado)
}

/** Instante absoluto → fecha del calendario de la clínica (AAAA-MM-DD). */
export function aFechaLocal(instante: Date, zona: string): string {
  const p = partesLocales(instante, zona)
  return `${String(p.anio).padStart(4, '0')}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`
}

/** Instante absoluto → minutos desde la medianoche local. */
export function aMinutosLocales(instante: Date, zona: string): number {
  const p = partesLocales(instante, zona)
  return p.hora * 60 + p.minuto
}

/** Hoy, según el calendario de la clínica. */
export function hoyLocal(zona: string, ahora = new Date()): string {
  return aFechaLocal(ahora, zona)
}

/**
 * Día de la semana de una fecha local. 0 = domingo, como `Schedule.dayOfWeek`.
 *
 * Se calcula sobre la fecha civil, sin husos: el 17 de agosto de 2026 es lunes
 * en cualquier parte del mundo.
 */
export function diaDeLaSemana(fechaLocal: string): number {
  const { anio, mes, dia } = validarFecha(fechaLocal)
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()
}

/** Suma (o resta) días a una fecha local, sin pasar por husos horarios. */
export function sumarDiasLocal(fechaLocal: string, dias: number): string {
  const { anio, mes, dia } = validarFecha(fechaLocal)
  const resultado = new Date(Date.UTC(anio, mes - 1, dia + dias))

  return [
    String(resultado.getUTCFullYear()).padStart(4, '0'),
    String(resultado.getUTCMonth() + 1).padStart(2, '0'),
    String(resultado.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

/** 510 → "08:30" */
export function formatearMinutos(minutos: number): string {
  const horas = Math.floor(minutos / 60)
  const resto = minutos % 60
  return `${String(horas).padStart(2, '0')}:${String(resto).padStart(2, '0')}`
}

/** "08:30" → 510 */
export function parsearHora(texto: string): number {
  const coincidencia = FORMATO_HORA.exec(texto.trim())
  if (!coincidencia) throw new RangeError(`Hora inválida: "${texto}". Se espera HH:MM.`)

  const horas = Number(coincidencia[1])
  const minutos = Number(coincidencia[2])

  if (horas > 23 || minutos > 59) throw new RangeError(`Hora inexistente: "${texto}".`)

  return horas * 60 + minutos
}
