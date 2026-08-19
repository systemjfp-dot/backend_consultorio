/**
 * Plantilla HTML de la orden de examen auxiliar.
 *
 * A diferencia de la receta, aquí una sola orden puede llevar varios exámenes
 * —es habitual pedir hemograma, glucosa y perfil lipídico juntos— y el
 * laboratorio necesita ver de un vistazo cuáles son y qué preparación exige
 * cada uno.
 *
 * El QR codifica la dirección de la orden en el sistema: quien la reciba puede
 * escanearla para abrirla en lugar de teclear un número a mano.
 */

import { escaparHtml } from '../../core/pdf.js'

export interface DatosPlantillaExamen {
  clinica: { nombre: string; ruc: string; direccion: string; telefono: string; logoUrl: string | null }
  paciente: { nombre: string; documento: string; edad: string }
  medico: { nombre: string; colegiatura: string; especialidad: string }
  orden: {
    numero: string
    emitidaEn: string
    fechaLimite: string | null
    diagnosticoPresuntivo: string | null
  }
  examenes: {
    tipo: string
    nombre: string
    indicaciones: string | null
    urgente: boolean
  }[]
  qrDataUrl: string | null
  firmaDataUrl: string | null
}

export function plantillaExamen(datos: DatosPlantillaExamen): string {
  const e = escaparHtml

  // Se agrupan por tipo: el laboratorio y el servicio de imágenes suelen ser
  // ventanillas distintas, y una lista mezclada obliga a leerla entera dos
  // veces.
  const porTipo = new Map<string, typeof datos.examenes>()
  for (const examen of datos.examenes) {
    const grupo = porTipo.get(examen.tipo) ?? []
    grupo.push(examen)
    porTipo.set(examen.tipo, grupo)
  }

  const grupos = [...porTipo.entries()]
    .map(
      ([tipo, examenes]) => `
        <section class="grupo">
          <h2>${e(tipo)}</h2>
          <ul>
            ${examenes
              .map(
                (examen) => `
              <li>
                <div class="nombre">
                  ${e(examen.nombre)}
                  ${examen.urgente ? '<span class="urgente">URGENTE</span>' : ''}
                </div>
                ${examen.indicaciones ? `<div class="indicaciones">${e(examen.indicaciones)}</div>` : ''}
              </li>`,
              )
              .join('')}
          </ul>
        </section>`,
    )
    .join('')

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }

  /* Fondo y esquema fijos: sin esto, un navegador con preferencia de modo
     oscuro deja el texto ilegible en un documento que se imprime. */
  html, body { background: #ffffff; color-scheme: light; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #111827;
    font-size: 11pt;
    line-height: 1.45;
    margin: 0;
  }

  .membrete {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 10px;
  }
  .membrete .identidad { display: flex; align-items: flex-start; gap: 14px; }
  .membrete img.logo { width: 52px; height: 52px; object-fit: contain; }
  .clinica-nombre { font-size: 15pt; font-weight: 700; color: #1e3a8a; }
  .clinica-datos { font-size: 9pt; color: #4b5563; }
  .qr { text-align: center; }
  .qr img { width: 74px; height: 74px; }
  .qr .numero { font-size: 8pt; font-family: ui-monospace, monospace; color: #4b5563; }

  h1 {
    font-size: 13pt;
    letter-spacing: 0.1em;
    text-align: center;
    margin: 16px 0 12px;
    text-transform: uppercase;
  }

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

  .grupo { margin-top: 12px; break-inside: avoid; }
  .grupo h2 {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #1e3a8a;
    border-bottom: 1px solid #d1d5db;
    padding-bottom: 3px;
    margin: 0 0 6px;
  }
  .grupo ul { list-style: none; margin: 0; padding: 0; }
  .grupo li { padding: 6px 0; border-bottom: 1px solid #f3f4f6; break-inside: avoid; }
  .grupo .nombre { font-weight: 600; }
  .grupo .indicaciones { font-size: 9.5pt; color: #6b7280; font-style: italic; }
  .urgente {
    margin-left: 6px;
    background: #fee2e2;
    color: #991b1b;
    font-size: 7.5pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 1px 5px;
    border-radius: 3px;
    vertical-align: 1px;
  }

  .plazo {
    margin-top: 12px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 10pt;
  }

  .firma { margin-top: 32px; text-align: center; break-inside: avoid; }
  .firma img { height: 56px; object-fit: contain; }
  .firma .linea { border-top: 1px solid #111827; width: 230px; margin: 2px auto 4px; }
  .firma .nombre { font-weight: 600; }
  .firma .datos { font-size: 9pt; color: #4b5563; }

  .pie {
    margin-top: 20px;
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
    <div class="identidad">
      ${datos.clinica.logoUrl ? `<img class="logo" src="${e(datos.clinica.logoUrl)}" alt="">` : ''}
      <div>
        <div class="clinica-nombre">${e(datos.clinica.nombre)}</div>
        <div class="clinica-datos">
          ${e(datos.clinica.direccion)}<br>
          RUC ${e(datos.clinica.ruc)} · Tel. ${e(datos.clinica.telefono)}
        </div>
      </div>
    </div>

    ${
      datos.qrDataUrl
        ? `<div class="qr">
             <img src="${datos.qrDataUrl}" alt="Código para localizar la orden">
             <div class="numero">${e(datos.orden.numero)}</div>
           </div>`
        : ''
    }
  </div>

  <h1>Orden de examen auxiliar</h1>

  <div class="bloque">
    <h2>Paciente</h2>
    <div class="campos">
      <div class="campo"><div class="etiqueta">Nombre</div><div class="valor">${e(datos.paciente.nombre)}</div></div>
      <div class="campo"><div class="etiqueta">Documento</div><div class="valor">${e(datos.paciente.documento)}</div></div>
      <div class="campo"><div class="etiqueta">Edad</div><div class="valor">${e(datos.paciente.edad)}</div></div>
      <div class="campo"><div class="etiqueta">Emitida</div><div class="valor">${e(datos.orden.emitidaEn)}</div></div>
    </div>
  </div>

  ${
    datos.orden.diagnosticoPresuntivo
      ? `<div class="bloque">
           <h2>Diagnóstico presuntivo</h2>
           <div>${e(datos.orden.diagnosticoPresuntivo)}</div>
         </div>`
      : ''
  }

  ${grupos}

  ${
    datos.orden.fechaLimite
      ? `<div class="plazo"><strong>Realizar antes del ${e(datos.orden.fechaLimite)}.</strong></div>`
      : ''
  }

  <div class="firma">
    ${datos.firmaDataUrl ? `<img src="${datos.firmaDataUrl}" alt="">` : '<div style="height:56px"></div>'}
    <div class="linea"></div>
    <div class="nombre">${e(datos.medico.nombre)}</div>
    <div class="datos">${e(datos.medico.especialidad)}<br>CMP ${e(datos.medico.colegiatura)}</div>
  </div>

  <div class="pie">
    Documento emitido electrónicamente por ${e(datos.clinica.nombre)}.
    Presente esta orden en el establecimiento donde se realice el examen.
  </div>

</body>
</html>`
}
