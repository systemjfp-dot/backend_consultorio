/**
 * Generación de PDF.
 *
 * EL NAVEGADOR SE REUTILIZA. Arrancarlo cuesta unos 2,2 segundos; una vez
 * vivo, cada documento tarda ~130 ms. Lanzar uno por receta convertiría una
 * operación instantánea en una espera de dos segundos con el paciente delante,
 * y en las horas punta habría varios Chromium compitiendo por la memoria.
 *
 * Se arranca de forma perezosa: si la clínica nunca emite un PDF, el proceso
 * no gasta esos recursos.
 */

import puppeteer, { type Browser } from 'puppeteer'
import { logger } from './logger.js'

let navegador: Browser | null = null
let arrancando: Promise<Browser> | null = null

async function obtenerNavegador(): Promise<Browser> {
  if (navegador?.connected) return navegador

  // Una sola promesa compartida: si llegan tres peticiones a la vez cuando el
  // navegador aún no existe, no se lanzan tres Chromium.
  arrancando ??= puppeteer
    .launch({
      headless: true,
      // Necesarios en contenedores: sin ellos Chromium no arranca en Railway.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
    .then((instancia) => {
      navegador = instancia

      // Si el navegador muere (se quedó sin memoria, lo mató el sistema), se
      // limpia la referencia para que el siguiente documento lo relance en vez
      // de fallar para siempre.
      instancia.on('disconnected', () => {
        navegador = null
        arrancando = null
        logger.warn('El navegador de PDF se desconectó; se relanzará al próximo documento')
      })

      return instancia
    })
    .finally(() => {
      arrancando = null
    })

  return arrancando
}

/** Convierte HTML en un PDF A4 con márgenes de documento clínico. */
export async function htmlAPdf(html: string): Promise<Buffer> {
  const instancia = await obtenerNavegador()
  const pagina = await instancia.newPage()

  try {
    // `load` basta: el HTML es autocontenido y las imágenes van como data URL,
    // así que no hay red que esperar. Pedir inactividad de red añadiría medio
    // segundo por documento sin ganar nada.
    await pagina.setContent(html, { waitUntil: 'load' })

    return Buffer.from(
      await pagina.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
      }),
    )
  } finally {
    // La página se cierra pase lo que pase: acumular pestañas abiertas es la
    // forma más rápida de agotar la memoria del servidor.
    await pagina.close().catch(() => undefined)
  }
}

export async function cerrarNavegadorPdf(): Promise<void> {
  const instancia = navegador
  navegador = null
  arrancando = null
  await instancia?.close().catch(() => undefined)
}

/** Escapa texto que va dentro del HTML de una plantilla. */
export function escaparHtml(texto: string | null | undefined): string {
  if (!texto) return ''
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
