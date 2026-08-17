/**
 * Lógica del módulo de pacientes.
 */

import {
  calcularEdad,
  type DatosActualizarPaciente,
  type DatosCrearPaciente,
  type Genero,
  type PacienteDetalle,
  type PacienteResumen,
  type TipoDocumento,
} from '@consultorio/shared'
import type { DocumentType, Gender, Prisma } from '@prisma/client'
import { registrarAuditoria } from '../../core/auditoria.js'
import type { ContextoAuth } from '../../core/contexto.js'
import { ErrorConflicto, ErrorNoEncontrado } from '../../core/errores.js'
import { exigirPermiso } from '../../core/permisos.js'
import { proveedorDocumentos } from './documentos.js'
import {
  PacienteNoEncontrado,
  RepositorioPacientes,
  type FilaDetalle,
  type FilaResumen,
} from './pacientes.repository.js'

export interface DatosCliente {
  ip?: string
  userAgent?: string
}

// --- Conversión a la forma que consume la web -------------------------------

/** Un campo de texto vacío es "no hay dato", no cadena vacía. */
function oNulo(valor: string | undefined): string | null {
  const limpio = valor?.trim()
  return limpio ? limpio : null
}

function aResumen(fila: FilaResumen): PacienteResumen {
  return {
    id: fila.id,
    tipoDocumento: fila.documentType as TipoDocumento,
    documento: fila.document,
    nombres: fila.firstName,
    apellidos: fila.lastName,
    nombreCompleto: `${fila.firstName} ${fila.lastName}`,
    fechaNacimiento: fila.birthDate.toISOString().slice(0, 10),
    edad: calcularEdad(fila.birthDate),
    genero: fila.gender as Genero,
    telefono: fila.phone,
    alergias: fila.allergies,
  }
}

function aDetalle(fila: FilaDetalle): PacienteDetalle {
  return {
    ...aResumen(fila),
    email: fila.email,
    direccion: fila.address,
    antecedentes: fila.medicalHistory,
    creadoEn: fila.createdAt.toISOString(),
    actualizadoEn: fila.updatedAt.toISOString(),
  }
}

// --- Consultas ---------------------------------------------------------------

export async function buscar(
  ctx: ContextoAuth,
  termino: string | undefined,
  pagina: number,
  porPagina: number,
) {
  exigirPermiso(ctx, 'patient:read')

  const repositorio = new RepositorioPacientes(ctx)

  // Con menos de dos caracteres cualquier término devuelve medio padrón: no es
  // una búsqueda, es el listado con ruido. Se responde con el listado ordenado,
  // que es lo que la recepcionista espera ver antes de empezar a escribir.
  const limpio = termino?.trim() ?? ''
  const { filas, total } =
    limpio.length >= 2
      ? await repositorio.buscar(limpio, pagina, porPagina)
      : await repositorio.listar(pagina, porPagina)

  return { pacientes: filas.map(aResumen), total, pagina, porPagina }
}

/**
 * Ficha completa.
 *
 * SÍ se audita, a diferencia del listado: abrir la ficha de una persona es un
 * acceso a datos de salud identificados (alergias, antecedentes). Auditar
 * también las búsquedas llenaría el registro de ruido y escondería justo esto.
 */
export async function verFicha(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<PacienteDetalle> {
  exigirPermiso(ctx, 'patient:read')

  const fila = await new RepositorioPacientes(ctx).porId(id)
  if (!fila) throw new ErrorNoEncontrado('No se encontró el paciente')

  await registrarAuditoria({
    accion: 'VIEW',
    entidad: 'Patient',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'patient:read',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aDetalle(fila)
}

// --- Registro ----------------------------------------------------------------

export type ResultadoRegistro =
  | { estado: 'creado'; paciente: PacienteDetalle }
  | { estado: 'ya_existe'; paciente: PacienteDetalle }
  | { estado: 'dado_de_baja'; pacienteId: string }

/**
 * Registra un paciente.
 *
 * El requisito 3.1 pide "verificar si ya existe → si existe, mostrar datos y
 * ofrecer crear una cita". Por eso un documento repetido NO es un error: es un
 * resultado distinto que la interfaz aprovecha para llevar a la ficha existente
 * en lugar de obligar a repetir la búsqueda.
 */
export async function registrar(
  ctx: ContextoAuth,
  datos: DatosCrearPaciente,
  cliente: DatosCliente,
): Promise<ResultadoRegistro> {
  exigirPermiso(ctx, 'patient:create')

  const repositorio = new RepositorioPacientes(ctx)
  const tipo = datos.tipoDocumento as DocumentType

  // Se mira también entre los dados de baja: el índice único no los distingue,
  // así que sin esto el registro fallaría con un error de restricción
  // incomprensible en lugar de ofrecer reactivar la ficha.
  const ocupado = await repositorio.documentoOcupadoIncluyendoBajas(tipo, datos.documento)

  if (ocupado?.deletedAt) {
    return { estado: 'dado_de_baja', pacienteId: ocupado.id }
  }

  if (ocupado) {
    const existente = await repositorio.porId(ocupado.id)
    return { estado: 'ya_existe', paciente: aDetalle(existente!) }
  }

  const creado = await repositorio.crear({
    documentType: tipo,
    document: datos.documento,
    firstName: datos.nombres,
    lastName: datos.apellidos,
    birthDate: datos.fechaNacimiento,
    gender: datos.genero as Gender,
    phone: datos.telefono,
    email: oNulo(datos.email),
    address: oNulo(datos.direccion),
    allergies: oNulo(datos.alergias),
    medicalHistory: oNulo(datos.antecedentes),
    // Consentimiento de tratamiento de datos, exigido por la Ley 29733 para
    // datos sensibles. Se registra en el mismo acto: sin él no debería haber
    // ficha, y separarlo garantizaría que a alguien se le olvide.
    consents: {
      create: { type: 'DATA_PROCESSING', version: '2026-01' },
    },
  })

  await registrarAuditoria({
    accion: 'CREATE',
    entidad: 'Patient',
    entidadId: creado.id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'patient:create',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return { estado: 'creado', paciente: aDetalle(creado) }
}

export async function actualizar(
  ctx: ContextoAuth,
  id: string,
  datos: DatosActualizarPaciente,
  cliente: DatosCliente,
): Promise<PacienteDetalle> {
  exigirPermiso(ctx, 'patient:update')

  const repositorio = new RepositorioPacientes(ctx)
  const anterior = await repositorio.porId(id)
  if (!anterior) throw new ErrorNoEncontrado('No se encontró el paciente')

  const cambios: Prisma.PatientUpdateInput = {}
  if (datos.nombres !== undefined) cambios.firstName = datos.nombres
  if (datos.apellidos !== undefined) cambios.lastName = datos.apellidos
  if (datos.fechaNacimiento !== undefined) cambios.birthDate = datos.fechaNacimiento
  if (datos.genero !== undefined) cambios.gender = datos.genero as Gender
  if (datos.telefono !== undefined) cambios.phone = datos.telefono
  if (datos.email !== undefined) cambios.email = oNulo(datos.email)
  if (datos.direccion !== undefined) cambios.address = oNulo(datos.direccion)
  if (datos.alergias !== undefined) cambios.allergies = oNulo(datos.alergias)
  if (datos.antecedentes !== undefined) cambios.medicalHistory = oNulo(datos.antecedentes)

  const actualizado = await repositorio.actualizar(id, cambios)

  await registrarAuditoria({
    accion: 'UPDATE',
    entidad: 'Patient',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'patient:update',
    // Se guarda QUÉ campos cambiaron, no sus valores: el registro de auditoría
    // no debe convertirse en una segunda copia de la historia clínica, fuera
    // del control de acceso que protege la original.
    cambios: { campos: Object.keys(cambios) },
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  return aDetalle(actualizado)
}

export async function darDeBaja(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<void> {
  exigirPermiso(ctx, 'patient:delete')

  try {
    await new RepositorioPacientes(ctx).darDeBaja(id)
  } catch (error) {
    if (error instanceof PacienteNoEncontrado) throw new ErrorNoEncontrado(error.message)
    throw error
  }

  await registrarAuditoria({
    accion: 'DELETE',
    entidad: 'Patient',
    entidadId: id,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'patient:delete',
    motivo: 'baja lógica: la historia clínica se conserva',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })
}

export async function reactivar(
  ctx: ContextoAuth,
  id: string,
  cliente: DatosCliente,
): Promise<PacienteDetalle> {
  exigirPermiso(ctx, 'patient:delete')

  try {
    const paciente = await new RepositorioPacientes(ctx).reactivar(id)

    await registrarAuditoria({
      accion: 'UPDATE',
      entidad: 'Patient',
      entidadId: id,
      usuarioId: ctx.usuarioId,
      usuarioEmail: ctx.email,
      roles: ctx.roles,
      motivo: 'reactivación de una ficha dada de baja',
      ip: cliente.ip,
      userAgent: cliente.userAgent,
    })

    return aDetalle(paciente)
  } catch (error) {
    if (error instanceof PacienteNoEncontrado) throw new ErrorNoEncontrado(error.message)
    throw error
  }
}

// --- Consulta de documento ---------------------------------------------------

export interface ResultadoConsultaDocumento {
  disponible: boolean
  encontrado: boolean
  datos?: { nombres: string; apellidos: string; fechaNacimiento?: string }
  /** Si ya hay una ficha con ese documento, se devuelve en lugar de consultar fuera. */
  pacienteExistente?: PacienteDetalle
}

/**
 * Autocompleta el registro a partir del documento.
 *
 * Primero mira en casa: si el paciente ya existe, no tiene sentido pagar una
 * consulta externa ni dejar que se cree un duplicado. Solo si no está se
 * pregunta al proveedor.
 */
export async function consultarDocumento(
  ctx: ContextoAuth,
  tipo: TipoDocumento,
  documento: string,
  cliente: DatosCliente,
): Promise<ResultadoConsultaDocumento> {
  exigirPermiso(ctx, 'patient:create')

  const repositorio = new RepositorioPacientes(ctx)
  const existente = await repositorio.porDocumento(tipo as DocumentType, documento)

  if (existente) {
    return { disponible: true, encontrado: true, pacienteExistente: aDetalle(existente) }
  }

  const proveedor = proveedorDocumentos()
  if (!proveedor.disponible) return { disponible: false, encontrado: false }

  const datos = await proveedor.consultar(documento)

  // Cada consulta cuesta dinero y expone datos de una persona ajena a la
  // clínica: queda auditada aunque no se llegue a crear la ficha.
  await registrarAuditoria({
    accion: 'VIEW',
    entidad: 'ConsultaDocumento',
    entidadId: documento,
    usuarioId: ctx.usuarioId,
    usuarioEmail: ctx.email,
    roles: ctx.roles,
    permiso: 'patient:create',
    motivo: datos ? 'documento encontrado' : 'documento sin resultados',
    ip: cliente.ip,
    userAgent: cliente.userAgent,
  })

  if (!datos) return { disponible: true, encontrado: false }

  return { disponible: true, encontrado: true, datos }
}

export { ErrorConflicto }
