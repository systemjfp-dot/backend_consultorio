/**
 * Estado de la instalación.
 *
 * Es público porque la pantalla de inicio de sesión lo consulta ANTES de que
 * exista ninguna sesión: necesita saber si el sistema está instalado y con qué
 * nombre y logo presentarse. Solo expone el nombre y el logo de la clínica,
 * datos que de todos modos figuran en su puerta.
 *
 * No hay endpoint para instalar: eso se hace con `pnpm setup` desde el
 * servidor. Un instalador accesible por HTTP sería una vía de entrada abierta
 * durante toda la vida del sistema a cambio de una comodidad de un solo uso.
 */

import { Router } from 'express'
import { rutaPublica } from '../../middleware/permisos.js'
import { datosPublicos } from './instalacion.service.js'

export const rutasInstalacion: Router = Router()

rutasInstalacion.get(
  '/estado',
  rutaPublica('La pantalla de inicio de sesión necesita el nombre de la clínica antes de autenticar'),
  async (_req, res) => {
    res.json(await datosPublicos())
  },
)
