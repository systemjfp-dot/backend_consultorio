/**
 * Ficha de atención.
 *
 * Pensada para una tablet en el consultorio, no para un escritorio: campos de
 * 16 px (menos hace que Safari en iOS haga zoom al enfocar), áreas de texto
 * amplias y botones grandes. El médico la usa de pie, con el paciente delante.
 *
 * GUARDADO AUTOMÁTICO. Una consulta dura veinte minutos y perder lo escrito
 * por cerrar una pestaña sería inaceptable, así que se guarda solo unos
 * segundos después de dejar de teclear. La alternativa —confiar en que alguien
 * pulse "guardar"— falla justo el día que hay prisa.
 */

import {
  ETIQUETAS_IMC,
  RANGOS_VITALES,
  calcularImc,
  fueraDeRangoHabitual,
  type Atencion,
  type CampoVital,
  type CodigoCie10,
} from '@consultorio/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Alerta, Boton, Cargando, Tarjeta } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { useAuth } from '../../lib/auth.js'
import { useRetraso } from '../../lib/useRetraso.js'
import { NuevaReceta } from '../recetas/NuevaReceta.js'
import { RecetasDeLaAtencion } from '../recetas/RecetasDeLaAtencion.js'
import { BuscadorCie10 } from './BuscadorCie10.js'
import { completarAtencion, guardarAtencion, obtenerAtencion } from './api.js'

type CamposTexto = Pick<
  Atencion,
  | 'motivo'
  | 'enfermedadActual'
  | 'antecedentesPersonales'
  | 'antecedentesFamiliares'
  | 'antecedentesQuirurgicos'
  | 'medicacionActual'
  | 'examenFisico'
  | 'diagnostico'
  | 'planTratamiento'
  | 'notas'
>

type Vitales = Record<CampoVital, string>

const VITALES_VACIOS: Vitales = {
  presionSistolica: '',
  presionDiastolica: '',
  frecuenciaCardiaca: '',
  frecuenciaRespiratoria: '',
  temperatura: '',
  saturacionOxigeno: '',
  pesoKg: '',
  tallaCm: '',
}

const ETIQUETAS_VITALES: Record<CampoVital, string> = {
  presionSistolica: 'Sistólica',
  presionDiastolica: 'Diastólica',
  frecuenciaCardiaca: 'Frec. cardíaca',
  frecuenciaRespiratoria: 'Frec. respiratoria',
  temperatura: 'Temperatura',
  saturacionOxigeno: 'Saturación O₂',
  pesoKg: 'Peso',
  tallaCm: 'Talla',
}

export function FichaAtencion() {
  const { id = '' } = useParams()
  const navegar = useNavigate()
  const { can } = useAuth()

  const consulta = useQuery({
    queryKey: ['atencion', id],
    queryFn: () => obtenerAtencion(id),
    // El borrador se mantiene en el formulario: recargar desde el servidor
    // mientras se escribe sobrescribiría lo que el médico está tecleando.
    refetchOnWindowFocus: false,
  })

  const atencion = consulta.data?.atencion

  const [textos, setTextos] = useState<CamposTexto | null>(null)
  const [vitales, setVitales] = useState<Vitales>(VITALES_VACIOS)
  const [diagnosticos, setDiagnosticos] = useState<CodigoCie10[]>([])
  const [error, setError] = useState<string | null>(null)
  const [guardadoEn, setGuardadoEn] = useState<Date | null>(null)
  const [recetando, setRecetando] = useState(false)

  // Carga inicial del formulario. Solo una vez: después manda el borrador
  // local, o el guardado automático pisaría lo que se está escribiendo.
  const cargado = useRef(false)
  useEffect(() => {
    if (!atencion || cargado.current) return
    cargado.current = true

    setTextos({
      motivo: atencion.motivo,
      enfermedadActual: atencion.enfermedadActual,
      antecedentesPersonales: atencion.antecedentesPersonales,
      antecedentesFamiliares: atencion.antecedentesFamiliares,
      antecedentesQuirurgicos: atencion.antecedentesQuirurgicos,
      medicacionActual: atencion.medicacionActual,
      examenFisico: atencion.examenFisico,
      diagnostico: atencion.diagnostico,
      planTratamiento: atencion.planTratamiento,
      notas: atencion.notas,
    })

    setVitales(
      Object.fromEntries(
        Object.keys(VITALES_VACIOS).map((campo) => [
          campo,
          String(atencion.signosVitales[campo as CampoVital] ?? ''),
        ]),
      ) as Vitales,
    )

    setDiagnosticos(
      atencion.diagnosticos.map((d) => ({
        codigo: d.codigo,
        descripcion: d.descripcion,
        categoria: null,
      })),
    )
  }, [atencion])

  const congelada = Boolean(atencion?.congeladaEn)
  const editable = Boolean(atencion) && !congelada && can('encounter:update')

  const guardar = useMutation({
    mutationFn: () =>
      guardarAtencion(id, {
        ...(textos ?? {}),
        signosVitales: Object.fromEntries(
          Object.entries(vitales).map(([k, v]) => [k, v === '' ? undefined : Number(v)]),
        ),
        diagnosticos: diagnosticos.map((d) => d.codigo),
      } as never),
    onSuccess: () => {
      setGuardadoEn(new Date())
      setError(null)
    },
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar')
    },
  })

  // Guardado automático: se dispara unos segundos después de dejar de teclear.
  const instantanea = useMemo(
    () => JSON.stringify({ textos, vitales, diagnosticos }),
    [textos, vitales, diagnosticos],
  )
  const instantaneaRetrasada = useRetraso(instantanea, 1500)
  const ultimaGuardada = useRef<string | null>(null)

  useEffect(() => {
    if (!editable || !cargado.current) return
    if (ultimaGuardada.current === null) {
      ultimaGuardada.current = instantaneaRetrasada
      return
    }
    if (ultimaGuardada.current === instantaneaRetrasada) return

    ultimaGuardada.current = instantaneaRetrasada
    guardar.mutate()
    // `guardar` cambia de identidad en cada render y reactivaría el efecto en
    // bucle; lo que debe dispararlo es únicamente el contenido del borrador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instantaneaRetrasada, editable])

  const completar = useMutation({
    mutationFn: async () => {
      await guardar.mutateAsync()
      return completarAtencion(id)
    },
    onSuccess: () => navegar('/atencion', { replace: true }),
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo completar la atención')
    },
  })

  if (consulta.isLoading) return <Cargando mensaje="Abriendo la atención…" />

  if (consulta.isError || !atencion || !textos) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alerta>No se pudo abrir la atención.</Alerta>
        <Link to="/atencion" className="mt-4 inline-block text-sm text-primario hover:underline">
          ← Volver
        </Link>
      </div>
    )
  }

  const imc = calcularImc(
    vitales.pesoKg ? Number(vitales.pesoKg) : null,
    vitales.tallaCm ? Number(vitales.tallaCm) : null,
    atencion.pacienteEdad,
  )

  const puedeCompletar =
    editable && (textos.diagnostico?.trim() || diagnosticos.length > 0)

  return (
    <div className="mx-auto max-w-3xl pb-24">
      {/* --- Cabecera fija: quién es el paciente, siempre visible --- */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-gray-200 bg-white px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{atencion.pacienteNombre}</h1>
            <p className="text-sm text-gray-500">
              {atencion.pacienteEdadLegible} · {atencion.pacienteDocumento}
            </p>
          </div>

          <Link
            to={`/pacientes/${atencion.pacienteId}`}
            className="text-sm text-primario hover:underline"
          >
            Ver ficha completa →
          </Link>
        </div>

        {atencion.pacienteAlergias && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            <span className="font-medium">Alergias:</span> {atencion.pacienteAlergias}
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alerta>{error}</Alerta>
        </div>
      )}

      {congelada && (
        <div className="mb-4">
          <Alerta tono="info">
            Esta atención está completada. Para corregir o ampliar, añade un addendum: el texto
            original no se modifica.
          </Alerta>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* --- Signos vitales --- */}
        <Tarjeta>
          <h2 className="mb-3 font-medium text-gray-900">Signos vitales</h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(VITALES_VACIOS) as CampoVital[]).map((campo) => (
              <CampoVitalNumerico
                key={campo}
                campo={campo}
                valor={vitales[campo]}
                editable={editable}
                onCambio={(valor) => setVitales((v) => ({ ...v, [campo]: valor }))}
              />
            ))}
          </div>

          {imc && (
            <p className="mt-3 text-sm text-gray-600">
              <span className="font-medium">IMC:</span> {imc.valor} ·{' '}
              {ETIQUETAS_IMC[imc.clasificacion]}
              {imc.clasificacion === 'requiere_percentiles' && (
                <span className="block text-xs text-gray-400">
                  En menores de 18 años el IMC se interpreta con tablas de percentiles por edad y
                  sexo, no con los rangos de adulto.
                </span>
              )}
            </p>
          )}
        </Tarjeta>

        {/* --- Anamnesis --- */}
        <Tarjeta>
          <h2 className="mb-3 font-medium text-gray-900">Anamnesis</h2>
          <div className="flex flex-col gap-4">
            <AreaTexto
              etiqueta="Motivo de consulta"
              valor={textos.motivo}
              filas={2}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, motivo: v })}
            />
            <AreaTexto
              etiqueta="Enfermedad actual"
              valor={textos.enfermedadActual}
              filas={4}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, enfermedadActual: v })}
            />
          </div>
        </Tarjeta>

        {/* --- Antecedentes (NTS 139) --- */}
        <details className="rounded-xl border border-gray-200 bg-white" open={false}>
          <summary className="cursor-pointer p-5 font-medium text-gray-900">
            Antecedentes
            <span className="ml-2 text-sm font-normal text-gray-400">
              personales, familiares, quirúrgicos y medicación
            </span>
          </summary>
          <div className="flex flex-col gap-4 px-5 pb-5">
            <AreaTexto
              etiqueta="Personales"
              valor={textos.antecedentesPersonales}
              filas={3}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, antecedentesPersonales: v })}
            />
            <AreaTexto
              etiqueta="Familiares"
              valor={textos.antecedentesFamiliares}
              filas={2}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, antecedentesFamiliares: v })}
            />
            <AreaTexto
              etiqueta="Quirúrgicos"
              valor={textos.antecedentesQuirurgicos}
              filas={2}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, antecedentesQuirurgicos: v })}
            />
            <AreaTexto
              etiqueta="Medicación actual"
              valor={textos.medicacionActual}
              filas={2}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, medicacionActual: v })}
            />
          </div>
        </details>

        {/* --- Examen físico --- */}
        <Tarjeta>
          <h2 className="mb-3 font-medium text-gray-900">Examen físico</h2>
          <AreaTexto
            etiqueta="Hallazgos"
            valor={textos.examenFisico}
            filas={4}
            editable={editable}
            onCambio={(v) => setTextos({ ...textos, examenFisico: v })}
          />
        </Tarjeta>

        {/* --- Diagnóstico --- */}
        <Tarjeta>
          <h2 className="mb-3 font-medium text-gray-900">Diagnóstico</h2>

          <div className="flex flex-col gap-4">
            <AreaTexto
              etiqueta="Descripción"
              valor={textos.diagnostico}
              filas={3}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, diagnostico: v })}
            />

            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">
                Códigos CIE-10
                <span className="ml-2 font-normal text-gray-400">
                  el primero es el diagnóstico principal
                </span>
              </p>

              {diagnosticos.length > 0 && (
                <ul className="mb-2 flex flex-col gap-1">
                  {diagnosticos.map((d, indice) => (
                    <li
                      key={d.codigo}
                      className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      <span className="font-mono font-medium text-gray-900">{d.codigo}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-600">{d.descripcion}</span>
                      {indice === 0 && (
                        <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                          principal
                        </span>
                      )}
                      {editable && (
                        <button
                          onClick={() =>
                            setDiagnosticos((lista) => lista.filter((x) => x.codigo !== d.codigo))
                          }
                          aria-label={`Quitar ${d.codigo}`}
                          className="shrink-0 text-gray-400 hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {editable && (
                <BuscadorCie10
                  onElegir={(codigo) =>
                    setDiagnosticos((lista) =>
                      lista.some((d) => d.codigo === codigo.codigo) ? lista : [...lista, codigo],
                    )
                  }
                />
              )}
            </div>
          </div>
        </Tarjeta>

        {/* --- Plan --- */}
        <Tarjeta>
          <h2 className="mb-3 font-medium text-gray-900">Plan de tratamiento</h2>
          <div className="flex flex-col gap-4">
            <AreaTexto
              etiqueta="Indicaciones"
              valor={textos.planTratamiento}
              filas={4}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, planTratamiento: v })}
            />
            <AreaTexto
              etiqueta="Notas internas"
              valor={textos.notas}
              filas={2}
              editable={editable}
              onCambio={(v) => setTextos({ ...textos, notas: v })}
            />
          </div>
        </Tarjeta>

        {/* --- Recetas --- */}
        {can('prescription:create') && (
          <Tarjeta>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-medium text-gray-900">Recetas</h2>
              <Boton variante="secundario" onClick={() => setRecetando(true)}>
                Nueva receta
              </Boton>
            </div>
            <RecetasDeLaAtencion atencionId={atencion.id} />
          </Tarjeta>
        )}

        {/* --- Addenda --- */}
        {atencion.addenda.length > 0 && (
          <Tarjeta>
            <h2 className="mb-3 font-medium text-gray-900">Addenda</h2>
            <ul className="flex flex-col gap-3">
              {atencion.addenda.map((a) => (
                <li key={a.id} className="border-l-2 border-gray-200 pl-3">
                  <p className="text-sm whitespace-pre-wrap text-gray-800">{a.contenido}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {a.autorNombre} · {new Date(a.creadoEn).toLocaleString('es-PE')}
                    {a.motivo ? ` · ${a.motivo}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </div>

      {recetando && (
        <NuevaReceta
          atencionId={atencion.id}
          onCerrar={() => setRecetando(false)}
          onEmitida={() => setRecetando(false)}
        />
      )}

      {/* --- Barra de acciones fija --- */}
      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pl-64">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-xs text-gray-400" role="status" aria-live="polite">
              {guardar.isPending
                ? 'Guardando…'
                : guardadoEn
                  ? `Guardado ${guardadoEn.toLocaleTimeString('es-PE')}`
                  : 'Se guarda solo'}
            </p>

            <Boton
              onClick={() => completar.mutate()}
              disabled={!puedeCompletar}
              cargando={completar.isPending}
            >
              Completar atención
            </Boton>
          </div>

          {!puedeCompletar && (
            <p className="mx-auto mt-1 max-w-3xl text-xs text-gray-400">
              Registra un diagnóstico para poder completar.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CampoVitalNumerico({
  campo,
  valor,
  editable,
  onCambio,
}: {
  campo: CampoVital
  valor: string
  editable: boolean
  onCambio: (valor: string) => void
}) {
  const rango = RANGOS_VITALES[campo]
  const numero = valor === '' ? null : Number(valor)
  const destacar = fueraDeRangoHabitual(campo, numero)

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`vital-${campo}`} className="text-xs font-medium text-gray-600">
        {ETIQUETAS_VITALES[campo]}
        <span className="ml-1 font-normal text-gray-400">{rango.unidad}</span>
      </label>
      <input
        id={`vital-${campo}`}
        type="number"
        inputMode="decimal"
        step="any"
        value={valor}
        disabled={!editable}
        onChange={(e) => onCambio(e.target.value)}
        // El resalte NO es un criterio clínico: solo evita que un 190/110 pase
        // desapercibido entre quince campos. La decisión es del médico.
        className={`min-h-[48px] rounded-lg border px-3 text-base outline-none transition-colors disabled:bg-gray-50 disabled:text-gray-500 ${
          destacar
            ? 'border-amber-400 bg-amber-50 focus:ring-2 focus:ring-amber-100'
            : 'border-gray-300 focus:border-primario focus:ring-2 focus:ring-blue-100'
        }`}
        {...(destacar ? { 'aria-describedby': `vital-${campo}-aviso` } : {})}
      />
      {destacar && (
        <span id={`vital-${campo}-aviso`} className="text-[11px] text-amber-700">
          Fuera del rango habitual
        </span>
      )}
    </div>
  )
}

function AreaTexto({
  etiqueta,
  valor,
  filas,
  editable,
  onCambio,
}: {
  etiqueta: string
  valor: string | null
  filas: number
  editable: boolean
  onCambio: (valor: string) => void
}) {
  const id = `campo-${etiqueta.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {etiqueta}
      </label>
      <textarea
        id={id}
        rows={filas}
        value={valor ?? ''}
        disabled={!editable}
        onChange={(e) => onCambio(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-base outline-none transition-colors focus:border-primario focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50 disabled:text-gray-600"
      />
    </div>
  )
}
