/**
 * Plantilla HTML de la receta médica.
 *
 * Es HTML y CSS y no dibujo a mano con PDFKit porque el membrete, la tabla de
 * medicamentos y el pie legal cambian: ajustar un margen aquí es editar una
 * línea de CSS, no recalcular coordenadas.
 *
 * DATOS OBLIGATORIOS DEL RECETARIO EN PERÚ: nombre y colegiatura del médico,
 * datos del establecimiento, identificación del paciente, fecha de emisión y
 * la prescripción en denominación común. Están todos en la plantilla porque
 * una receta a la que le falte uno no la acepta una farmacia.
 */

import { escaparHtml } from '../../core/pdf.js'

export interface DatosPlantillaReceta {
  clinica: { nombre: string; ruc: string; direccion: string; telefono: string; logoUrl: string | null }
  paciente: { nombre: string; documento: string; edad: string }
  medico: { nombre: string; colegiatura: string; especialidad: string; registroEspecialista: string | null }
  receta: {
    numero: string
    emitidaEn: string
    validaHasta: string
    indicacionesGenerales: string | null
  }
  medicamentos: {
    nombre: string
    concentracion: string | null
    forma: string | null
    via: string | null
    frecuencia: string | null
    duracion: string | null
    cantidad: number | null
    indicaciones: string | null
  }[]
  firmaDataUrl: string | null
}

export function plantillaReceta(datos: DatosPlantillaReceta): string {
  const e = escaparHtml

  const filas = datos.medicamentos
    .map((m, indice) => {
      const posologia = [
        m.via,
        m.frecuencia,
        m.duracion ? `durante ${m.duracion}` : null,
      ]
        .filter(Boolean)
        .join(' · ')

      return `
        <tr>
          <td class="numero">${indice + 1}</td>
          <td>
            <div class="medicamento">${e(m.nombre)}${m.concentracion ? ` <span class="concentracion">${e(m.concentracion)}</span>` : ''}</div>
            ${m.forma ? `<div class="forma">${e(m.forma)}</div>` : ''}
            ${posologia ? `<div class="posologia">${e(posologia)}</div>` : ''}
            ${m.indicaciones ? `<div class="indicaciones">${e(m.indicaciones)}</div>` : ''}
          </td>
          <td class="cantidad">${m.cantidad ?? ''}</td>
        </tr>`
    })
    .join('')

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }

  /*
   * Fondo blanco y esquema de color fijo, EXPLÍCITAMENTE.
   *
   * Sin esto, un navegador con preferencia de modo oscuro pinta el fondo
   * oscuro y el texto —definido en grises oscuros— queda ilegible. En pantalla
   * se nota enseguida; en un documento que se imprime, el fallo llega hasta el
   * paciente. El servidor donde corre Chromium no tiene por qué compartir las
   * preferencias de nadie, así que el documento las fija por su cuenta.
   */
  html, body {
    background: #ffffff;
    color-scheme: light;
  }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    font-size: 11pt;
    line-height: 1.45;
    margin: 0;
  }

  /* --- Membrete --- */
  .membrete {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 10px;
  }
  .membrete img { width: 52px; height: 52px; object-fit: contain; }
  .clinica-nombre { font-size: 15pt; font-weight: 700; color: #1e3a8a; }
  .clinica-datos { font-size: 9pt; color: #4b5563; }

  h1 {
    font-size: 13pt;
    letter-spacing: 0.12em;
    text-align: center;
    margin: 16px 0 12px;
    text-transform: uppercase;
  }

  /* --- Bloques de datos --- */
  .bloque {
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .bloque h2 {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
    margin: 0 0 4px;
  }
  .campos { display: flex; flex-wrap: wrap; gap: 4px 22px; }
  .campo .etiqueta { font-size: 8pt; color: #6b7280; }
  .campo .valor { font-weight: 600; }

  /* --- Medicamentos --- */
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6b7280;
    text-align: left;
    border-bottom: 1px solid #d1d5db;
    padding: 4px 6px;
  }
  td { padding: 7px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  /* Un medicamento no debe partirse entre dos páginas: media posología en la
     página siguiente es exactamente como se administra una dosis equivocada. */
  tr { break-inside: avoid; }
  .numero { width: 22px; color: #9ca3af; font-size: 9pt; }
  .cantidad { width: 52px; text-align: right; font-variant-numeric: tabular-nums; }
  .medicamento { font-weight: 600; }
  .concentracion { font-weight: 400; color: #374151; }
  .forma, .posologia { font-size: 9.5pt; color: #374151; }
  .indicaciones { font-size: 9.5pt; color: #6b7280; font-style: italic; }

  .generales { margin-top: 10px; font-size: 10pt; }
  .generales .etiqueta { font-size: 8pt; text-transform: uppercase; color: #6b7280; }

  /* --- Firma --- */
  .firma {
    margin-top: 34px;
    text-align: center;
    break-inside: avoid;
  }
  .firma img { height: 58px; object-fit: contain; }
  .firma .linea { border-top: 1px solid #111827; width: 230px; margin: 2px auto 4px; }
  .firma .nombre { font-weight: 600; }
  .firma .datos { font-size: 9pt; color: #4b5563; }

  .pie {
    margin-top: 22px;
    border-top: 1px solid #e5e7eb;
    padding-top: 6px;
    font-size: 8pt;
    color: #6b7280;
    text-align: center;
  }
</style>
</head>
<body>

  <div class="membrete">
    ${datos.clinica.logoUrl ? `<img src="${e(datos.clinica.logoUrl)}" alt="">` : ''}
    <div>
      <div class="clinica-nombre">${e(datos.clinica.nombre)}</div>
      <div class="clinica-datos">
        ${e(datos.clinica.direccion)}<br>
        RUC ${e(datos.clinica.ruc)} · Tel. ${e(datos.clinica.telefono)}
      </div>
    </div>
  </div>

  <h1>Receta médica</h1>

  <div class="bloque">
    <h2>Paciente</h2>
    <div class="campos">
      <div class="campo"><div class="etiqueta">Nombre</div><div class="valor">${e(datos.paciente.nombre)}</div></div>
      <div class="campo"><div class="etiqueta">Documento</div><div class="valor">${e(datos.paciente.documento)}</div></div>
      <div class="campo"><div class="etiqueta">Edad</div><div class="valor">${e(datos.paciente.edad)}</div></div>
    </div>
  </div>

  <div class="bloque">
    <h2>Receta</h2>
    <div class="campos">
      <div class="campo"><div class="etiqueta">N.º</div><div class="valor">${e(datos.receta.numero)}</div></div>
      <div class="campo"><div class="etiqueta">Emitida</div><div class="valor">${e(datos.receta.emitidaEn)}</div></div>
      <div class="campo"><div class="etiqueta">Válida hasta</div><div class="valor">${e(datos.receta.validaHasta)}</div></div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th></th><th>Medicamento e indicaciones</th><th style="text-align:right">Cant.</th></tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>

  ${
    datos.receta.indicacionesGenerales
      ? `<div class="generales">
           <div class="etiqueta">Indicaciones generales</div>
           <div>${e(datos.receta.indicacionesGenerales).replace(/\n/g, '<br>')}</div>
         </div>`
      : ''
  }

  <div class="firma">
    ${datos.firmaDataUrl ? `<img src="${datos.firmaDataUrl}" alt="">` : '<div style="height:58px"></div>'}
    <div class="linea"></div>
    <div class="nombre">${e(datos.medico.nombre)}</div>
    <div class="datos">
      ${e(datos.medico.especialidad)}<br>
      CMP ${e(datos.medico.colegiatura)}${datos.medico.registroEspecialista ? ` · RNE ${e(datos.medico.registroEspecialista)}` : ''}
    </div>
  </div>

  <div class="pie">
    Documento emitido electrónicamente por ${e(datos.clinica.nombre)}.
    Su autenticidad puede verificarse ante la clínica citando el N.º de receta.
  </div>

</body>
</html>`
}
