/**
 * Motor de disponibilidad.
 *
 * Responde a la única pregunta que importa en un mostrador: ¿a qué horas puede
 * atender este médico este día?
 *
 * ES UNA FUNCIÓN PURA. No consulta la base, no mira el reloj —se le pasa— y no
 * conoce Prisma. Quien la llama reúne los datos; ella solo cruza horarios,
 * excepciones y citas existentes. Esa separación es lo que permite probar sus
 * casos límite sin preparar una base de datos, y son muchos: duraciones que no
 * dividen la franja, solapes parciales, turnos partidos, guardias en días sin
 * horario, ausencias que anulan franjas extraordinarias.
 */

import { aInstante, aMinutosLocales, diaDeLaSemana, hoyLocal } from '../../core/tiempo.js'

/** Franja de atención recurrente. Minutos desde medianoche, hora local. */
export interface Franja {
  diaSemana: number
  inicioMinuto: number
  finMinuto: number
  /** Duración de cita propia de esta franja. Si falta, se usa la general. */
  slotMinutos?: number
  sedeId?: string
}

export type TipoExcepcion = 'AUSENTE' | 'EXTRA'

/** Alteración puntual del horario para una fecha concreta. */
export interface Excepcion {
  tipo: TipoExcepcion
  /** Sin inicio ni fin, la excepción cubre el día completo. */
  inicioMinuto?: number
  finMinuto?: number
}

/** Tiempo ya comprometido: una cita existente. */
export interface Ocupacion {
  inicio: Date
  fin: Date
}

export interface Hueco {
  inicio: Date
  fin: Date
  inicioMinuto: number
  finMinuto: number
  sedeId?: string
}

export interface ParametrosDisponibilidad {
  /** Fecha del calendario de la clínica (AAAA-MM-DD). */
  fecha: string
  zonaHoraria: string
  franjas: Franja[]
  excepciones: Excepcion[]
  ocupadas: Ocupacion[]
  duracionMinutos: number
  /** Instante actual. Se recibe para poder probar el filtrado del pasado. */
  ahora?: Date
  /** Margen mínimo para agendar. Evita ofrecer una hora inalcanzable. */
  anticipacionMinutos?: number
}

/** Intervalo de minutos locales, con la sede de la que procede. */
interface Intervalo {
  inicio: number
  fin: number
  slotMinutos?: number
  sedeId?: string
}

const seSolapan = (aInicio: number, aFin: number, bInicio: number, bFin: number): boolean =>
  aInicio < bFin && bInicio < aFin

export function calcularHuecos(parametros: ParametrosDisponibilidad): Hueco[] {
  const {
    fecha,
    zonaHoraria,
    franjas,
    excepciones,
    ocupadas,
    duracionMinutos,
    ahora = new Date(),
    anticipacionMinutos = 0,
  } = parametros

  if (duracionMinutos <= 0) return []

  // 1. Una ausencia de día completo cierra el día, sin importar lo demás.
  //    Va primero porque hace innecesario todo el resto del cálculo.
  const ausenciaTotal = excepciones.some(
    (e) => e.tipo === 'AUSENTE' && e.inicioMinuto === undefined && e.finMinuto === undefined,
  )
  if (ausenciaTotal) return []

  // 2. Un día ya pasado no ofrece nada. Se compara por fecha del calendario de
  //    la clínica, no por instantes: a las 22:00 de Lima ya es el día siguiente
  //    en UTC, y comparar en UTC vaciaría la agenda cada noche.
  const hoy = hoyLocal(zonaHoraria, ahora)
  if (fecha < hoy) return []

  // 3. Franjas del día: las del horario semanal más las extraordinarias.
  const diaObjetivo = diaDeLaSemana(fecha)

  const intervalos: Intervalo[] = [
    ...franjas
      .filter((f) => f.diaSemana === diaObjetivo)
      .map((f) => ({
        inicio: f.inicioMinuto,
        fin: f.finMinuto,
        ...(f.slotMinutos !== undefined ? { slotMinutos: f.slotMinutos } : {}),
        ...(f.sedeId !== undefined ? { sedeId: f.sedeId } : {}),
      })),
    ...excepciones
      .filter((e) => e.tipo === 'EXTRA' && e.inicioMinuto !== undefined && e.finMinuto !== undefined)
      .map((e) => ({ inicio: e.inicioMinuto!, fin: e.finMinuto! })),
  ]

  if (intervalos.length === 0) return []

  // 4. Ausencias parciales, ya como intervalos de minutos.
  const ausencias = excepciones
    .filter((e) => e.tipo === 'AUSENTE' && e.inicioMinuto !== undefined && e.finMinuto !== undefined)
    .map((e) => ({ inicio: e.inicioMinuto!, fin: e.finMinuto! }))

  // 5. Citas existentes, traídas a minutos locales del día.
  //    Se descartan las de otros días: comparar en minutos sin comprobar la
  //    fecha haría que la cita de mañana a las 09:00 bloqueara la de hoy.
  const comprometidos = ocupadas
    .map((o) => ({
      inicio: aMinutosLocales(o.inicio, zonaHoraria),
      fin: aMinutosLocales(o.fin, zonaHoraria),
      mismoDia:
        aInstante(fecha, 0, zonaHoraria) <= o.inicio &&
        o.inicio < aInstante(fecha, 1440, zonaHoraria),
    }))
    .filter((o) => o.mismoDia)

  // 6. Momento a partir del cual se puede agendar.
  const limiteInferior = new Date(ahora.getTime() + anticipacionMinutos * 60_000)

  // 7. Recorrer cada intervalo generando huecos.
  const huecos: Hueco[] = []
  const yaGenerados = new Set<number>()

  for (const intervalo of intervalos) {
    const paso = intervalo.slotMinutos ?? duracionMinutos

    for (let inicio = intervalo.inicio; inicio + paso <= intervalo.fin; inicio += paso) {
      const fin = inicio + paso

      // Un hueco duplicado solo puede venir de franjas solapadas, que la base
      // impide. Aun así no se ofrece dos veces la misma hora.
      if (yaGenerados.has(inicio)) continue

      if (ausencias.some((a) => seSolapan(inicio, fin, a.inicio, a.fin))) continue
      if (comprometidos.some((o) => seSolapan(inicio, fin, o.inicio, o.fin))) continue

      const instanteInicio = aInstante(fecha, inicio, zonaHoraria)
      if (instanteInicio < limiteInferior) continue

      yaGenerados.add(inicio)
      huecos.push({
        inicio: instanteInicio,
        fin: aInstante(fecha, fin, zonaHoraria),
        inicioMinuto: inicio,
        finMinuto: fin,
        ...(intervalo.sedeId !== undefined ? { sedeId: intervalo.sedeId } : {}),
      })
    }
  }

  return huecos.sort((a, b) => a.inicioMinuto - b.inicioMinuto)
}

/**
 * ¿Está libre este momento concreto?
 *
 * Se usa al agendar: comprueba que la hora elegida sea realmente uno de los
 * huecos ofrecidos y no una que llegó por una pantalla desactualizada.
 *
 * La garantía definitiva contra el doble agendamiento la da el constraint de
 * exclusión de la base, que resiste a dos recepcionistas simultáneas. Esto es
 * lo que permite dar un mensaje comprensible antes de llegar ahí.
 */
export function estaDisponible(
  parametros: ParametrosDisponibilidad,
  inicio: Date,
): boolean {
  return calcularHuecos(parametros).some((hueco) => hueco.inicio.getTime() === inicio.getTime())
}
