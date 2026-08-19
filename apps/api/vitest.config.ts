import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /**
     * Los archivos de prueba se ejecutan DE UNO EN UNO.
     *
     * Todas comparten la misma base de datos, y varias manipulan filas
     * globales: la instalación borra y recrea `ClinicSettings`, que es una
     * tabla de fila única. En paralelo, un archivo puede borrar esa fila
     * mientras otro cuenta con ella.
     *
     * Ese tipo de fallo aparece de forma intermitente y solo bajo carga, que
     * es la peor manera de descubrirlo. Con una base compartida, la ejecución
     * en serie no es una limitación sino la única forma correcta; la suite
     * tarda un par de segundos más y a cambio es determinista.
     *
     * La alternativa —una base por archivo— solo compensaría si la suite
     * llegara a tardar minutos.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,

    env: {
      /**
       * Las pruebas corren contra UN consultorio, el de `DATABASE_URL`.
       *
       * Si heredaran el mapa de dominios del `.env` de desarrollo, supertest
       * —que pide a `127.0.0.1`— llegaría con un dominio que no está en el
       * mapa y toda la suite respondería 404. Las pruebas del propio
       * enrutador definen la variable ellas mismas y reimportan el módulo.
       */
      CONSULTORIOS: '',
    },
  },
})
