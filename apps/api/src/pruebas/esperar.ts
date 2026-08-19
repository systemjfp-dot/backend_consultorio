/**
 * Ayudas de espera para las pruebas.
 *
 * La auditoría se escribe DESPUÉS de responder (`res.on('finish')`), a
 * propósito: registrar no debe encarecer la respuesta que ve el usuario. El
 * efecto colateral es que una prueba que consulta el registro justo después de
 * la petición puede llegar antes que la escritura. Dormir un tiempo fijo
 * disimula el problema en una máquina rápida y falla en la lenta —o cuando la
 * suite corre entera y compite por CPU—, así que aquí se reintenta hasta que
 * el dato aparece.
 */

/**
 * Reintenta `consulta` hasta que su resultado cumpla la condición —por defecto,
 * que exista—. Devuelve lo último que obtuvo aunque nunca la cumpla, para que
 * sea la aserción de la prueba la que explique el fallo.
 */
export async function esperarA<T>(
  consulta: () => Promise<T>,
  cumple: (valor: T) => boolean = (valor) => valor !== null && valor !== undefined,
  { intentos = 40, esperaMs = 25 } = {},
): Promise<T> {
  let ultimo = await consulta()

  for (let i = 1; i < intentos && !cumple(ultimo); i++) {
    await new Promise((seguir) => setTimeout(seguir, esperaMs))
    ultimo = await consulta()
  }

  return ultimo
}

/**
 * Margen para comprobar que algo NO se registró.
 *
 * Aquí no se puede reintentar: la ausencia solo se puede afirmar tras dar
 * tiempo suficiente a que apareciera.
 */
export function margenParaEscrituraDiferida(): Promise<void> {
  return new Promise((seguir) => setTimeout(seguir, 250))
}
