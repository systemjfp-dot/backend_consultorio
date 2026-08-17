/**
 * Acceso a datos de pacientes.
 *
 * LA REGLA QUE NADIE PUEDE OLVIDAR: toda consulta excluye los pacientes
 * borrados. No es una condición que cada método decida añadir, sino el punto de
 * partida de todos ellos (`filtroBase`). La misma disciplina que evita la fuga
 * de alcance en los repositorios clínicos: si un método nuevo se olvidara del
 * filtro, resucitaría registros que la clínica dio de baja.
 *
 * El borrado es lógico porque una historia clínica no se elimina: hay citas,
 * atenciones y recetas que la referencian, y borrarla de verdad dejaría el
 * historial médico apuntando al vacío.
 */

import { Prisma } from '@prisma/client'
import type { ContextoAuth } from '../../core/contexto.js'
import { prisma } from '../../core/prisma.js'

/** Campos que devuelve el listado. Deliberadamente sin datos clínicos. */
const CAMPOS_RESUMEN = {
  id: true,
  documentType: true,
  document: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  gender: true,
  phone: true,
  allergies: true,
} satisfies Prisma.PatientSelect

const CAMPOS_DETALLE = {
  ...CAMPOS_RESUMEN,
  email: true,
  address: true,
  medicalHistory: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientSelect

export type FilaResumen = Prisma.PatientGetPayload<{ select: typeof CAMPOS_RESUMEN }>
export type FilaDetalle = Prisma.PatientGetPayload<{ select: typeof CAMPOS_DETALLE }>

/** Fila cruda de la búsqueda por trigramas. */
interface FilaBusqueda {
  id: string
  documentType: string
  document: string
  firstName: string
  lastName: string
  birthDate: Date
  gender: string
  phone: string
  allergies: string | null
}

export class RepositorioPacientes {
  constructor(private readonly ctx: ContextoAuth) {}

  /**
   * Punto de partida de TODA consulta.
   *
   * Los pacientes no tienen alcance por médico —quien puede leer, lee el padrón
   * completo, porque para atender a alguien primero hay que encontrarlo—, pero
   * los dados de baja no existen para nadie.
   */
  private get filtroBase(): Prisma.PatientWhereInput {
    return { deletedAt: null }
  }

  async porId(id: string): Promise<FilaDetalle | null> {
    return prisma.patient.findFirst({
      where: { ...this.filtroBase, id },
      select: CAMPOS_DETALLE,
    })
  }

  /** Busca por documento exacto. Se usa para detectar duplicados al registrar. */
  async porDocumento(
    tipo: Prisma.PatientWhereInput['documentType'],
    documento: string,
  ): Promise<FilaDetalle | null> {
    return prisma.patient.findFirst({
      where: { ...this.filtroBase, documentType: tipo, document: documento },
      select: CAMPOS_DETALLE,
    })
  }

  /**
   * Comprueba si el documento ya existe INCLUYENDO los dados de baja.
   *
   * Es la única consulta que se salta el filtro base, y a propósito: el índice
   * único de la base no distingue borrados, así que sin mirar también los
   * inactivos el registro fallaría con un error de restricción incomprensible
   * en lugar de ofrecer reactivar la ficha.
   */
  async documentoOcupadoIncluyendoBajas(
    tipo: Prisma.PatientCreateInput['documentType'],
    documento: string,
  ): Promise<{ id: string; deletedAt: Date | null } | null> {
    return prisma.patient.findUnique({
      where: { documentType_document: { documentType: tipo!, document: documento } },
      select: { id: true, deletedAt: true },
    })
  }

  async listar(pagina: number, porPagina: number): Promise<{ filas: FilaResumen[]; total: number }> {
    const [filas, total] = await Promise.all([
      prisma.patient.findMany({
        where: this.filtroBase,
        select: CAMPOS_RESUMEN,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
      prisma.patient.count({ where: this.filtroBase }),
    ])

    return { filas, total }
  }

  /**
   * Búsqueda para el mostrador.
   *
   * Va en SQL directo porque Prisma no expone ni `unaccent` ni los operadores
   * de pg_trgm, que son justo lo que hace que esto funcione de verdad:
   *
   *  · Cada palabra del término debe aparecer en el nombre, EN CUALQUIER ORDEN.
   *    Así "quispe maria" y "maria quispe" encuentran a la misma persona, y
   *    funciona con apellidos compuestos ("Quispe Huamán"), donde el truco de
   *    concatenar el nombre al revés falla.
   *
   *  · `<%` (word_similarity) tolera erratas comparando el término contra CADA
   *    PALABRA del nombre, no contra el nombre entero. Buscar "nuñes" da 0.67
   *    de parecido frente a "Núñez" pero solo 0.24 contra "Núñez Cárdenas"
   *    completo: sin esta distinción, la tolerancia a erratas no encontraría a
   *    nadie con apellido compuesto.
   *
   *  · Todo se normaliza (minúsculas, sin acentos) porque en el mostrador se
   *    teclea rápido y sin tildes.
   *
   * Se busca también por documento y por teléfono: son las tres formas en que
   * un paciente se identifica cuando llega.
   */
  async buscar(
    termino: string,
    pagina: number,
    porPagina: number,
  ): Promise<{ filas: FilaResumen[]; total: number }> {
    const palabras = termino.split(/\s+/).filter(Boolean).slice(0, 6)
    if (palabras.length === 0) return this.listar(pagina, porPagina)

    // Cada palabra genera su propia condición, todas obligatorias.
    const condiciones = Prisma.join(
      palabras.map(
        (palabra) => Prisma.sql`(
          normalizar_busqueda("firstName" || ' ' || "lastName") LIKE '%' || normalizar_busqueda(${palabra}) || '%'
          OR normalizar_busqueda(${palabra}) <% normalizar_busqueda("firstName" || ' ' || "lastName")
          OR normalizar_busqueda("document") LIKE '%' || normalizar_busqueda(${palabra}) || '%'
          OR "phone" LIKE '%' || ${palabra} || '%'
        )`,
      ),
      ' AND ',
    )

    const donde = Prisma.sql`"deletedAt" IS NULL AND ${condiciones}`

    const [filas, conteo] = await Promise.all([
      prisma.$queryRaw<FilaBusqueda[]>`
        SELECT "id", "documentType", "document", "firstName", "lastName",
               "birthDate", "gender", "phone", "allergies"
        FROM "Patient"
        WHERE ${donde}
        ORDER BY
          -- Quien coincide por documento exacto va primero: si la
          -- recepcionista tecleó el DNI completo, es a quien busca.
          ("document" = ${termino.trim()}) DESC,
          similarity(normalizar_busqueda("firstName" || ' ' || "lastName"),
                     normalizar_busqueda(${termino})) DESC,
          "lastName" ASC, "firstName" ASC
        LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}
      `,
      prisma.$queryRaw<[{ total: bigint }]>`
        SELECT count(*)::bigint AS total FROM "Patient" WHERE ${donde}
      `,
    ])

    return {
      filas: filas as unknown as FilaResumen[],
      total: Number(conteo[0]?.total ?? 0),
    }
  }

  async crear(datos: Prisma.PatientCreateInput): Promise<FilaDetalle> {
    return prisma.patient.create({ data: datos, select: CAMPOS_DETALLE })
  }

  async actualizar(id: string, datos: Prisma.PatientUpdateInput): Promise<FilaDetalle> {
    // updateMany + lectura, y no update directo: `update` busca por clave
    // primaria e ignoraría el filtro base, permitiendo modificar un paciente
    // dado de baja.
    const { count } = await prisma.patient.updateMany({
      where: { ...this.filtroBase, id },
      data: datos,
    })
    if (count === 0) throw new PacienteNoEncontrado()

    return (await this.porId(id))!
  }

  /** Borrado lógico. */
  async darDeBaja(id: string): Promise<void> {
    const { count } = await prisma.patient.updateMany({
      where: { ...this.filtroBase, id },
      data: { deletedAt: new Date() },
    })
    if (count === 0) throw new PacienteNoEncontrado()
  }

  async reactivar(id: string): Promise<FilaDetalle> {
    await prisma.patient.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null },
    })

    const paciente = await this.porId(id)
    if (!paciente) throw new PacienteNoEncontrado()
    return paciente
  }

  /** Contexto de quien consulta. Lo usan los services para auditar. */
  get contexto(): ContextoAuth {
    return this.ctx
  }
}

export class PacienteNoEncontrado extends Error {
  constructor() {
    super('No se encontró el paciente')
    this.name = 'PacienteNoEncontrado'
  }
}
