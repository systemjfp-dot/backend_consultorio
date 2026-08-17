/**
 * Registro de paciente.
 *
 * El orden de los campos sigue el de la conversación en el mostrador: primero
 * el documento —que además puede autocompletar el resto— y luego los datos que
 * el paciente va diciendo.
 */

import {
  ETIQUETAS_GENERO,
  ETIQUETAS_TIPO_DOCUMENTO,
  GENEROS,
  TIPOS_DOCUMENTO,
  esquemaCrearPaciente,
  type DatosCrearPaciente,
  type EntradaCrearPaciente,
} from '@consultorio/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Alerta, Boton, Campo, Tarjeta } from '../../components/ui/index.js'
import { ErrorApi } from '../../lib/api.js'
import { consultarDocumento, registrarPaciente } from './api.js'

export function NuevoPaciente() {
  const navegar = useNavigate()
  const [parametros] = useSearchParams()

  const [avisoDuplicado, setAvisoDuplicado] = useState<{
    mensaje: string
    pacienteId: string
  } | null>(null)
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)
  const [avisoDocumento, setAvisoDocumento] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
    // Tres parámetros: lo que maneja el formulario, el contexto, y lo que
    // entrega `handleSubmit` ya validado y convertido.
  } = useForm<EntradaCrearPaciente, unknown, DatosCrearPaciente>({
    resolver: zodResolver(esquemaCrearPaciente),
    defaultValues: {
      tipoDocumento: 'DNI',
      // Si se llega desde una búsqueda sin resultados, el término se aprovecha
      // como documento: es lo que la recepcionista acaba de teclear.
      documento: /^\d+$/.test(parametros.get('documento') ?? '')
        ? (parametros.get('documento') ?? '')
        : '',
      genero: 'F',
    },
  })

  const tipoElegido = watch('tipoDocumento')

  /** Autocompletado por documento. */
  const consulta = useMutation({
    mutationFn: (documento: string) => consultarDocumento(documento, getValues('tipoDocumento') ?? 'DNI'),
    onSuccess: (resultado) => {
      setAvisoDocumento(null)

      if (resultado.pacienteExistente) {
        setAvisoDuplicado({
          mensaje: `${resultado.pacienteExistente.nombreCompleto} ya está registrado.`,
          pacienteId: resultado.pacienteExistente.id,
        })
        return
      }

      if (resultado.datos) {
        setValue('nombres', resultado.datos.nombres, { shouldValidate: true })
        setValue('apellidos', resultado.datos.apellidos, { shouldValidate: true })
        if (resultado.datos.fechaNacimiento) {
          // El campo es un <input type="date">: espera "AAAA-MM-DD", no un Date.
          setValue('fechaNacimiento', resultado.datos.fechaNacimiento.slice(0, 10))
        }
        return
      }

      // Ni error ni datos: el servicio no está configurado o no encontró nada.
      // Se avisa sin bloquear — el registro manual funciona igual.
      setAvisoDocumento(
        resultado.disponible
          ? 'No se encontraron datos para ese documento. Complétalos a mano.'
          : 'La consulta automática no está configurada. Completa los datos a mano.',
      )
    },
    onError: () => {
      setAvisoDocumento('No se pudo consultar el documento. Completa los datos a mano.')
    },
  })

  const registro = useMutation({
    mutationFn: registrarPaciente,
    onSuccess: (resultado) => {
      if (resultado.estado === 'creado' || resultado.estado === 'ya_existe') {
        navegar(`/pacientes/${resultado.paciente.id}`, { replace: true })
        return
      }

      // Documento de una ficha dada de baja: el requisito es ofrecer la ficha,
      // no un error de restricción única incomprensible.
      setAvisoDuplicado({
        mensaje:
          'Ese documento pertenece a una ficha dada de baja. Un administrador puede reactivarla.',
        pacienteId: resultado.pacienteId,
      })
    },
    onError: (error) => {
      setErrorGeneral(
        error instanceof ErrorApi ? error.message : 'No se pudo registrar al paciente',
      )
    },
  })

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <Link to="/pacientes" className="text-sm text-gray-500 hover:text-gray-700">
          ← Pacientes
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900 sm:text-2xl">Nuevo paciente</h1>
      </div>

      {errorGeneral && (
        <div className="mb-4">
          <Alerta>{errorGeneral}</Alerta>
        </div>
      )}

      {avisoDuplicado && (
        <div className="mb-4">
          <Alerta tono="aviso">
            <p className="mb-2">{avisoDuplicado.mensaje}</p>
            <Link
              to={`/pacientes/${avisoDuplicado.pacienteId}`}
              className="font-medium underline underline-offset-2"
            >
              Abrir su ficha
            </Link>
          </Alerta>
        </div>
      )}

      <form
        onSubmit={handleSubmit((datos) => {
          setErrorGeneral(null)
          setAvisoDuplicado(null)
          registro.mutate(datos)
        })}
        className="flex flex-col gap-4"
      >
        <Tarjeta>
          <h2 className="mb-4 font-medium text-gray-900">Identificación</h2>

          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tipoDocumento" className="text-sm font-medium text-gray-700">
                Tipo
              </label>
              <select
                id="tipoDocumento"
                {...register('tipoDocumento')}
                className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
              >
                {TIPOS_DOCUMENTO.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETAS_TIPO_DOCUMENTO[tipo]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Campo
                etiqueta="Documento"
                inputMode={tipoElegido === 'DNI' ? 'numeric' : 'text'}
                autoFocus
                error={errors.documento?.message}
                // La regla de "8 dígitos" depende del tipo de documento, así
                // que vive en el esquema como validación cruzada — y esas solo
                // se ejecutan cuando el resto de campos ya es válido. Sin esta
                // guía en vivo, quien teclea mal el DNI tendría que completar y
                // corregir todo lo demás antes de enterarse.
                ayuda={tipoElegido === 'DNI' ? '8 dígitos' : undefined}
                {...register('documento')}
              />
              <Boton
                type="button"
                variante="secundario"
                cargando={consulta.isPending}
                onClick={() => {
                  const documento = getValues('documento')
                  if (documento) consulta.mutate(documento)
                }}
              >
                Buscar datos por documento
              </Boton>
            </div>
          </div>

          {avisoDocumento && (
            <p className="mt-3 text-sm text-gray-500">{avisoDocumento}</p>
          )}
        </Tarjeta>

        <Tarjeta>
          <h2 className="mb-4 font-medium text-gray-900">Datos personales</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Nombres" error={errors.nombres?.message} {...register('nombres')} />
            <Campo
              etiqueta="Apellidos"
              error={errors.apellidos?.message}
              {...register('apellidos')}
            />

            <Campo
              etiqueta="Fecha de nacimiento"
              type="date"
              error={errors.fechaNacimiento?.message}
              {...register('fechaNacimiento')}
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="genero" className="text-sm font-medium text-gray-700">
                Género
              </label>
              <select
                id="genero"
                {...register('genero')}
                className="min-h-[44px] rounded-lg border border-gray-300 px-3 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
              >
                {GENEROS.map((genero) => (
                  <option key={genero} value={genero}>
                    {ETIQUETAS_GENERO[genero]}
                  </option>
                ))}
              </select>
            </div>

            <Campo
              etiqueta="Teléfono"
              type="tel"
              inputMode="tel"
              error={errors.telefono?.message}
              {...register('telefono')}
            />
            <Campo
              etiqueta="Correo (opcional)"
              type="email"
              error={errors.email?.message}
              {...register('email')}
            />
          </div>

          <div className="mt-4">
            <Campo
              etiqueta="Dirección (opcional)"
              error={errors.direccion?.message}
              {...register('direccion')}
            />
          </div>
        </Tarjeta>

        <Tarjeta>
          <h2 className="mb-1 font-medium text-gray-900">Datos clínicos de ingreso</h2>
          <p className="mb-4 text-sm text-gray-500">
            Las alergias se muestran destacadas en toda la ficha y antes de emitir una receta.
          </p>

          <div className="flex flex-col gap-4">
            <Campo
              etiqueta="Alergias conocidas"
              placeholder="Penicilina, sulfas…"
              error={errors.alergias?.message}
              {...register('alergias')}
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="antecedentes" className="text-sm font-medium text-gray-700">
                Antecedentes
              </label>
              <textarea
                id="antecedentes"
                rows={3}
                {...register('antecedentes')}
                className="rounded-lg border border-gray-300 px-3 py-2 text-base outline-none focus:border-primario focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
        </Tarjeta>

        <div className="flex gap-3">
          <Boton type="submit" cargando={isSubmitting || registro.isPending}>
            Registrar paciente
          </Boton>
          <Link to="/pacientes">
            <Boton type="button" variante="secundario">
              Cancelar
            </Boton>
          </Link>
        </div>

        <p className="text-xs text-gray-500">
          Al registrar se guarda el consentimiento de tratamiento de datos personales exigido por
          la Ley 29733.
        </p>
      </form>
    </div>
  )
}
