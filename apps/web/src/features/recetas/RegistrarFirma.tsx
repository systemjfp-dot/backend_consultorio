/**
 * Registro de la firma del médico.
 *
 * Se dibuja UNA VEZ y se reutiliza en todas sus recetas. El documento maestro
 * proponía dibujarla en cada una; repetir el trazo veinte veces al día en una
 * tablet es fricción pura, y además obligaba a guardar una imagen por receta.
 *
 * ES OPCIONAL. Quien prefiera imprimir y firmar a mano no necesita registrar
 * nada: el documento sale con el espacio en blanco sobre la línea.
 *
 * ADVERTENCIA QUE CONVIENE NO PERDER DE VISTA: esto es un dibujo, no una firma
 * electrónica. El D.S. 098-2025-PCM y la Directiva MINSA 343-2023 empujan
 * hacia el certificado digital para documentos de salud. El modelo de datos ya
 * contempla ese camino.
 */

import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Alerta, Boton, Tarjeta } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { estadoFirma, registrarFirma } from './api.js'

export function RegistrarFirma() {
  const lienzo = useRef<HTMLCanvasElement>(null)
  const dibujando = useRef(false)
  const [hayTrazo, setHayTrazo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardada, setGuardada] = useState(false)

  const estado = useQuery({ queryKey: ['firma'], queryFn: estadoFirma })

  useEffect(() => {
    const elemento = lienzo.current
    if (!elemento) return

    // El lienzo se dibuja a la resolución real del dispositivo: en una tablet
    // con pantalla densa, un lienzo a 1× produce una firma pixelada al
    // imprimirla.
    const escala = window.devicePixelRatio || 1
    const ancho = elemento.clientWidth
    const alto = elemento.clientHeight

    elemento.width = ancho * escala
    elemento.height = alto * escala

    const ctx = elemento.getContext('2d')
    if (!ctx) return

    ctx.scale(escala, escala)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
  }, [])

  function posicion(evento: React.PointerEvent<HTMLCanvasElement>) {
    const rect = evento.currentTarget.getBoundingClientRect()
    return { x: evento.clientX - rect.left, y: evento.clientY - rect.top }
  }

  function empezar(evento: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = lienzo.current?.getContext('2d')
    if (!ctx) return

    // Se captura el puntero: si el dedo sale del lienzo a media firma, el
    // trazo no se corta de golpe.
    evento.currentTarget.setPointerCapture(evento.pointerId)
    dibujando.current = true

    const { x, y } = posicion(evento)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function mover(evento: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current) return
    const ctx = lienzo.current?.getContext('2d')
    if (!ctx) return

    const { x, y } = posicion(evento)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHayTrazo(true)
  }

  function terminar() {
    dibujando.current = false
  }

  function limpiar() {
    const elemento = lienzo.current
    const ctx = elemento?.getContext('2d')
    if (!elemento || !ctx) return

    ctx.clearRect(0, 0, elemento.width, elemento.height)
    setHayTrazo(false)
  }

  const guardar = useMutation({
    mutationFn: () => registrarFirma(lienzo.current!.toDataURL('image/png')),
    onSuccess: async () => {
      setGuardada(true)
      setError(null)
      await estado.refetch()
    },
    onError: (fallo) => {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo guardar la firma')
    },
  })

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Mi firma</h1>
      <p className="mb-4 text-sm text-gray-600">
        Se dibuja una sola vez y aparece en todas tus recetas y órdenes. Es opcional: sin ella los
        documentos salen con el espacio en blanco para firmarlos a mano.
      </p>

      {error && (
        <div className="mb-4">
          <Alerta>{error}</Alerta>
        </div>
      )}

      {guardada && (
        <div className="mb-4">
          <Alerta tono="exito">Firma guardada.</Alerta>
        </div>
      )}

      {estado.data?.registrada && !guardada && (
        <div className="mb-4">
          <Alerta tono="info">
            Ya tienes una firma registrada. Si dibujas una nueva, reemplazará a la anterior.
          </Alerta>
        </div>
      )}

      <Tarjeta>
        <canvas
          ref={lienzo}
          onPointerDown={empezar}
          onPointerMove={mover}
          onPointerUp={terminar}
          onPointerCancel={terminar}
          aria-label="Área para dibujar la firma"
          // touch-none impide que el gesto desplace la página en lugar de
          // dibujar, que es lo que pasa por defecto en una tablet.
          className="h-44 w-full touch-none rounded-lg border-2 border-dashed border-gray-300 bg-white"
        />

        <p className="mt-2 text-xs text-gray-400">
          Dibuja con el dedo, un lápiz digital o el ratón.
        </p>

        <div className="mt-4 flex gap-3">
          <Boton onClick={() => guardar.mutate()} disabled={!hayTrazo} cargando={guardar.isPending}>
            Guardar firma
          </Boton>
          <Boton variante="secundario" onClick={limpiar} disabled={!hayTrazo}>
            Borrar
          </Boton>
        </div>
      </Tarjeta>

      <p className="mt-4 text-xs text-gray-500">
        Una firma dibujada acredita la autoría ante la clínica, pero no equivale a una firma
        electrónica con certificado digital, que es hacia donde apunta la normativa de documentos
        de salud. El sistema ya está preparado para incorporarla.
      </p>
    </div>
  )
}
