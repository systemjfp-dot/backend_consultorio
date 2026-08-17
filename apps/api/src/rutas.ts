/**
 * Mapa de rutas de la API.
 *
 * Declarar aquí los módulos, en vez de llamar a `app.use` disperso, tiene dos
 * ventajas: se ve de un vistazo toda la superficie de la API, y la prueba de
 * cobertura puede recorrerla para comprobar que ninguna ruta quedó sin declarar
 * su nivel de acceso. Express no expone el prefijo de montaje de un router, así
 * que sin este mapa la prueba no podría nombrar la ruta que falla.
 */

import type { Router } from 'express'
import { rutasAgenda } from './modules/agenda/agenda.routes.js'
import { rutasAuditoria } from './modules/auditoria/auditoria.routes.js'
import { rutasAuth } from './modules/auth/auth.routes.js'
import { rutasCitas } from './modules/citas/citas.routes.js'
import { rutasEmergencia } from './modules/emergencia/emergencia.routes.js'
import { rutasInstalacion } from './modules/instalacion/instalacion.routes.js'
import { rutasPacientes } from './modules/pacientes/pacientes.routes.js'
import { rutasSalud } from './modules/salud/salud.routes.js'

export interface ModuloDeRutas {
  prefijo: string
  router: Router
}

export const MODULOS_DE_RUTAS: ModuloDeRutas[] = [
  { prefijo: '/api', router: rutasSalud },
  { prefijo: '/api/auth', router: rutasAuth },
  { prefijo: '/api/emergencia', router: rutasEmergencia },
  { prefijo: '/api/auditoria', router: rutasAuditoria },
  { prefijo: '/api/instalacion', router: rutasInstalacion },
  { prefijo: '/api/pacientes', router: rutasPacientes },
  { prefijo: '/api/agenda', router: rutasAgenda },
  { prefijo: '/api/citas', router: rutasCitas },
]
