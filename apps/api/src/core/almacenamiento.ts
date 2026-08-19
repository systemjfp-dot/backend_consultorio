/**
 * Almacenamiento de archivos: firmas y PDFs.
 *
 * Se guardan en disco y no en la base de datos. Un PNG en base64 dentro de una
 * fila infla cada consulta que toque esa tabla —aunque no pida la imagen— y
 * convierte los respaldos en algo mucho más pesado de lo necesario.
 *
 * NINGÚN NOMBRE DE ARCHIVO VIENE DEL USUARIO. Se derivan de identificadores
 * generados por la base, y aun así se validan: un identificador que llegara
 * manipulado con "../" permitiría escribir o leer fuera del directorio.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ErrorPeticion } from './errores.js'
import { claveActiva } from './prisma.js'

const RAIZ = resolve(process.env['STORAGE_DIR'] ?? 'storage')

/**
 * Carpeta del consultorio que se está atendiendo.
 *
 * Con varios consultorios en un mismo despliegue, sus firmas y PDF no pueden
 * compartir carpeta: los nombres de archivo son identificadores de la base, y
 * dos bases distintas pueden generar el mismo. Uno sobrescribiría la receta
 * del otro.
 */
function raizDelConsultorio(): string {
  return join(RAIZ, claveActiva())
}

/** Solo caracteres de un cuid o un uuid. Nada de separadores de ruta. */
const IDENTIFICADOR_VALIDO = /^[A-Za-z0-9_-]{1,64}$/

function rutaSegura(carpeta: string, identificador: string, extension: string): string {
  if (!IDENTIFICADOR_VALIDO.test(identificador)) {
    throw new ErrorPeticion('Identificador de archivo inválido')
  }

  const raiz = raizDelConsultorio()
  const ruta = join(raiz, carpeta, `${identificador}.${extension}`)

  // Cinturón y tirantes: aunque la expresión regular ya lo impide, se
  // comprueba que el resultado siga dentro de la raíz del consultorio.
  if (!resolve(ruta).startsWith(raiz)) {
    throw new ErrorPeticion('Ruta de archivo inválida')
  }

  return ruta
}

async function asegurarDirectorio(ruta: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
}

// --- Firmas ------------------------------------------------------------------

export async function guardarFirma(medicoId: string, dataUrl: string): Promise<void> {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  const ruta = rutaSegura('firmas', medicoId, 'png')

  await asegurarDirectorio(ruta)
  await writeFile(ruta, Buffer.from(base64, 'base64'))
}

export async function leerFirma(medicoId: string): Promise<Buffer | null> {
  const ruta = rutaSegura('firmas', medicoId, 'png')
  if (!existsSync(ruta)) return null
  return readFile(ruta)
}

export async function borrarFirma(medicoId: string): Promise<void> {
  const ruta = rutaSegura('firmas', medicoId, 'png')
  if (existsSync(ruta)) await unlink(ruta)
}

export function hayFirma(medicoId: string): boolean {
  return existsSync(rutaSegura('firmas', medicoId, 'png'))
}

/** Firma como data URL, para incrustarla en el HTML del PDF. */
export async function firmaComoDataUrl(medicoId: string): Promise<string | null> {
  const contenido = await leerFirma(medicoId)
  if (!contenido) return null
  return `data:image/png;base64,${contenido.toString('base64')}`
}

// --- PDFs --------------------------------------------------------------------

/**
 * Dónde queda un PDF en disco.
 *
 * Se expone porque el layout dejó de ser evidente desde fuera: con varios
 * consultorios hay una carpeta por cada uno, y quien quiera comprobar el
 * archivo —las pruebas, un respaldo— no debería tener que adivinarlo.
 */
export function rutaDePdf(carpeta: string, id: string): string {
  return rutaSegura(carpeta, id, 'pdf')
}

export async function guardarPdf(carpeta: string, id: string, contenido: Buffer): Promise<string> {
  const ruta = rutaSegura(carpeta, id, 'pdf')

  await asegurarDirectorio(ruta)
  await writeFile(ruta, contenido)

  // Se devuelve el hash para guardarlo junto al registro: es lo que permite
  // demostrar después que el documento entregado no fue alterado.
  return createHash('sha256').update(contenido).digest('hex')
}

export async function leerPdf(carpeta: string, id: string): Promise<Buffer | null> {
  const ruta = rutaSegura(carpeta, id, 'pdf')
  if (!existsSync(ruta)) return null
  return readFile(ruta)
}

export function hayPdf(carpeta: string, id: string): boolean {
  return existsSync(rutaSegura(carpeta, id, 'pdf'))
}
