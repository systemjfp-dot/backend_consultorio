/**
 * Acceso a datos de citas.
 *
 * AQUÍ SE APLICA EL ALCANCE. Es el primer módulo del sistema donde importa: un
 * médico tiene `appointment:read` con alcance `own` y recepción con alcance
 * `all`, así que la misma consulta debe devolver cosas distintas según quién
 * pregunte (requisito 4.5 del documento maestro).
 *
 * El filtro NO se calcula en el controlador ni se pasa como parámetro
 * opcional: se construye en el constructor y se mezcla en todas las consultas.
 * Un método nuevo no puede olvidarlo porque no existe una versión "sin
 * filtrar" a la que recurrir.
 */

import type { Prisma } from '@prisma/client'
import type { ContextoAuth } from '../../core/contexto.js'
import { filtroDeAlcance } from '../../core/permisos.js'
import { prisma } from '../../core/prisma.js'

const INCLUIR = {
  patient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      document: true,
      phone: true,
      allergies: true,
    },
  },
  doctor: {
    select: {
      id: true,
      colorCode: true,
      defaultSlotMinutes: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  location: { select: { id: true, name: true } },
} satisfies Prisma.AppointmentInclude

export type FilaCita = Prisma.AppointmentGetPayload<{ include: typeof INCLUIR }>

export class RepositorioCitas {
  /** Restricción de filas del usuario actual. Se calcula una vez. */
  private readonly alcance: Record<string, string>

  constructor(private readonly ctx: ContextoAuth) {
    // Si el contexto no puede leer citas, esto lanza 403 ya en el constructor.
    // Es deliberado: mejor fallar al construir el repositorio que devolver
    // silenciosamente una lista vacía, que se confundiría con "no hay citas".
    this.alcance = filtroDeAlcance(ctx, 'appointment:read')
  }

  /** Punto de partida de toda consulta: alcance del usuario. */
  private get filtroBase(): Prisma.AppointmentWhereInput {
    return this.alcance
  }

  async porId(id: string): Promise<FilaCita | null> {
    return prisma.appointment.findFirst({
      where: { ...this.filtroBase, id },
      include: INCLUIR,
    })
  }

  /**
   * Citas de un rango.
   *
   * El rango se recibe como instantes ya convertidos: la traducción de fechas
   * locales a instantes la hace el service con la utilidad de tiempo, no aquí.
   */
  async enRango(opciones: {
    desde: Date
    hasta: Date
    medicoId?: string
    sedeId?: string
    pacienteId?: string
    incluirCanceladas: boolean
  }): Promise<FilaCita[]> {
    return prisma.appointment.findMany({
      where: {
        ...this.filtroBase,
        startsAt: { gte: opciones.desde, lt: opciones.hasta },
        ...(opciones.medicoId ? { doctorId: opciones.medicoId } : {}),
        ...(opciones.sedeId ? { locationId: opciones.sedeId } : {}),
        ...(opciones.pacienteId ? { patientId: opciones.pacienteId } : {}),
        ...(opciones.incluirCanceladas ? {} : { status: { notIn: ['CANCELLED', 'NO_SHOW'] } }),
      },
      include: INCLUIR,
      orderBy: [{ startsAt: 'asc' }],
    })
  }

  /** Próximas citas de un paciente. Se usa en su ficha. */
  async proximasDePaciente(pacienteId: string, limite = 10): Promise<FilaCita[]> {
    return prisma.appointment.findMany({
      where: {
        ...this.filtroBase,
        patientId: pacienteId,
        startsAt: { gte: new Date() },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      include: INCLUIR,
      orderBy: { startsAt: 'asc' },
      take: limite,
    })
  }

  async crear(datos: Prisma.AppointmentCreateInput): Promise<FilaCita> {
    return prisma.appointment.create({ data: datos, include: INCLUIR })
  }

  /**
   * Actualiza dentro del alcance.
   *
   * `updateMany` y no `update`: este último busca por clave primaria e
   * ignoraría el filtro, permitiendo que un médico modificara la cita de otro
   * conociendo su identificador.
   */
  async actualizar(id: string, datos: Prisma.AppointmentUpdateInput): Promise<FilaCita | null> {
    const { count } = await prisma.appointment.updateMany({
      where: { ...this.filtroBase, id },
      data: datos as Prisma.AppointmentUpdateManyMutationInput,
    })
    if (count === 0) return null

    return this.porId(id)
  }

  /** Citas del médico ese día. Alimenta el motor de disponibilidad. */
  async ocupacionDelMedico(
    medicoId: string,
    desde: Date,
    hasta: Date,
    excluirId?: string,
  ): Promise<{ startsAt: Date; endsAt: Date }[]> {
    return prisma.appointment.findMany({
      // Sin filtro de alcance A PROPÓSITO: para saber si un hueco está libre
      // hay que ver TODAS las citas del médico, incluidas las que quien
      // pregunta no puede leer. Solo se devuelven horas, ningún dato del
      // paciente, así que no se filtra nada que deba protegerse.
      where: {
        doctorId: medicoId,
        startsAt: { gte: desde, lt: hasta },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    })
  }

  get contexto(): ContextoAuth {
    return this.ctx
  }
}
