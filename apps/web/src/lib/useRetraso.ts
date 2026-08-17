import { useEffect, useState } from 'react'

/**
 * Retrasa un valor hasta que deja de cambiar durante `ms`.
 *
 * Es lo que separa un buscador usable de uno que dispara una consulta por
 * tecla: escribir "quispe" son seis peticiones, y las cinco primeras llegan
 * tarde y desordenadas. Con 250 ms, la recepcionista no percibe demora y el
 * servidor recibe una sola.
 */
export function useRetraso<T>(valor: T, ms = 250): T {
  const [retrasado, setRetrasado] = useState(valor)

  useEffect(() => {
    const temporizador = setTimeout(() => setRetrasado(valor), ms)
    return () => clearTimeout(temporizador)
  }, [valor, ms])

  return retrasado
}
