/**
 * Datos de ejemplo para desarrollo — `pnpm db:seed`
 *
 * Genera una clínica creíble: dos sedes, tres médicos con horarios distintos,
 * personal de recepción y enfermería, pacientes, y citas repartidas entre
 * pasado, presente y futuro con estados variados.
 *
 * NO SE EJECUTA EN PRODUCCIÓN. Un seed que crea usuarios con contraseñas
 * conocidas es, en un servidor real, una puerta trasera con nombre y apellido.
 */

import { PrismaClient, type Prisma } from '@prisma/client'
import { cifrarContrasena } from '../src/modules/auth/contrasenas.js'

const prisma = new PrismaClient()

if (process.env['NODE_ENV'] === 'production') {
  console.error(
    '\n  El seed no puede ejecutarse en producción: crea cuentas con contraseñas\n' +
      '  conocidas. Usa `pnpm setup` para instalar el sistema.\n',
  )
  process.exit(1)
}

/** Contraseña única para todas las cuentas de ejemplo. */
const CONTRASENA = 'Demo2026!'

/** Zona horaria de la clínica. Perú no aplica horario de verano: UTC-5 fijo. */
const DESFASE_HORAS = 5

/**
 * Convierte una hora local de la clínica a un instante UTC.
 *
 * Los horarios plantilla se guardan como minutos locales y las citas como
 * instantes absolutos; esta es la conversión entre ambos. En H2 la reemplaza
 * la utilidad definitiva del motor de agenda, que sí consultará el timezone
 * configurado en lugar de asumir un desfase.
 */
function horaLocalAUtc(dia: Date, minutosDesdeMedianoche: number): Date {
  const fecha = new Date(
    Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 0, 0, 0, 0),
  )
  fecha.setUTCMinutes(minutosDesdeMedianoche + DESFASE_HORAS * 60)
  return fecha
}

function sumarDias(base: Date, dias: number): Date {
  const fecha = new Date(base)
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha
}

/**
 * Hoy, según el calendario DE LA CLÍNICA.
 *
 * Un `new Date()` con las horas UTC a cero da el día en UTC, que en Lima
 * (UTC-5) es el día siguiente desde las 19:00. La primera versión de este seed
 * hacía justo eso y generaba la agenda "de hoy" para mañana: al consultar las
 * citas del día no aparecía ninguna.
 *
 * Es exactamente la clase de error que motiva la convención del proyecto —
 * fechas absolutas en UTC, horarios en minutos locales, una sola función que
 * convierte— y conviene que quede escrita aquí, porque es el fallo que más
 * veces se repite en una agenda médica.
 */
const hoy = (() => {
  const enHoraLocal = new Date(Date.now() - DESFASE_HORAS * 60 * 60_000)
  return new Date(
    Date.UTC(enHoraLocal.getUTCFullYear(), enHoraLocal.getUTCMonth(), enHoraLocal.getUTCDate()),
  )
})()

// =============================================================================
//  Catálogos
// =============================================================================

/** Muestra del CIE-10 en español, con los diagnósticos más frecuentes. */
const CIE10: Prisma.Icd10CodeCreateManyInput[] = [
  { code: 'A09', description: 'Diarrea y gastroenteritis de presunto origen infeccioso', category: 'Infecciosas' },
  { code: 'E11', description: 'Diabetes mellitus tipo 2', category: 'Endocrinas' },
  { code: 'E66', description: 'Obesidad', category: 'Endocrinas' },
  { code: 'E78', description: 'Trastornos del metabolismo de las lipoproteínas', category: 'Endocrinas' },
  { code: 'F32', description: 'Episodio depresivo', category: 'Salud mental' },
  { code: 'F41', description: 'Otros trastornos de ansiedad', category: 'Salud mental' },
  { code: 'G43', description: 'Migraña', category: 'Neurológicas' },
  { code: 'H10', description: 'Conjuntivitis', category: 'Oftalmológicas' },
  { code: 'I10', description: 'Hipertensión esencial (primaria)', category: 'Circulatorias' },
  { code: 'I20', description: 'Angina de pecho', category: 'Circulatorias' },
  { code: 'I25', description: 'Enfermedad isquémica crónica del corazón', category: 'Circulatorias' },
  { code: 'I48', description: 'Fibrilación y aleteo auricular', category: 'Circulatorias' },
  { code: 'J00', description: 'Rinofaringitis aguda (resfriado común)', category: 'Respiratorias' },
  { code: 'J02', description: 'Faringitis aguda', category: 'Respiratorias' },
  { code: 'J03', description: 'Amigdalitis aguda', category: 'Respiratorias' },
  { code: 'J18', description: 'Neumonía, organismo no especificado', category: 'Respiratorias' },
  { code: 'J20', description: 'Bronquitis aguda', category: 'Respiratorias' },
  { code: 'J45', description: 'Asma', category: 'Respiratorias' },
  { code: 'K21', description: 'Enfermedad por reflujo gastroesofágico', category: 'Digestivas' },
  { code: 'K29', description: 'Gastritis y duodenitis', category: 'Digestivas' },
  { code: 'K59', description: 'Otros trastornos funcionales del intestino', category: 'Digestivas' },
  { code: 'L20', description: 'Dermatitis atópica', category: 'Dermatológicas' },
  { code: 'M54', description: 'Dorsalgia', category: 'Osteomusculares' },
  { code: 'M79', description: 'Otros trastornos de los tejidos blandos', category: 'Osteomusculares' },
  { code: 'N39', description: 'Otros trastornos del sistema urinario', category: 'Genitourinarias' },
  { code: 'R05', description: 'Tos', category: 'Síntomas y signos' },
  { code: 'R10', description: 'Dolor abdominal y pélvico', category: 'Síntomas y signos' },
  { code: 'R50', description: 'Fiebre de origen desconocido', category: 'Síntomas y signos' },
  { code: 'R51', description: 'Cefalea', category: 'Síntomas y signos' },
  { code: 'Z00', description: 'Examen médico general', category: 'Factores de salud' },
]

const MEDICAMENTOS = [
  { name: 'Paracetamol', genericName: 'Paracetamol', concentration: '500 mg', form: 'Tableta' },
  { name: 'Paracetamol', genericName: 'Paracetamol', concentration: '120 mg/5 mL', form: 'Jarabe' },
  { name: 'Ibuprofeno', genericName: 'Ibuprofeno', concentration: '400 mg', form: 'Tableta' },
  { name: 'Naproxeno', genericName: 'Naproxeno', concentration: '550 mg', form: 'Tableta' },
  { name: 'Amoxicilina', genericName: 'Amoxicilina', concentration: '500 mg', form: 'Cápsula' },
  { name: 'Amoxicilina + Ácido clavulánico', genericName: 'Amoxicilina/clavulanato', concentration: '875/125 mg', form: 'Tableta' },
  { name: 'Azitromicina', genericName: 'Azitromicina', concentration: '500 mg', form: 'Tableta' },
  { name: 'Ciprofloxacino', genericName: 'Ciprofloxacino', concentration: '500 mg', form: 'Tableta' },
  { name: 'Omeprazol', genericName: 'Omeprazol', concentration: '20 mg', form: 'Cápsula' },
  { name: 'Ranitidina', genericName: 'Ranitidina', concentration: '150 mg', form: 'Tableta' },
  { name: 'Enalapril', genericName: 'Enalapril', concentration: '10 mg', form: 'Tableta' },
  { name: 'Losartán', genericName: 'Losartán potásico', concentration: '50 mg', form: 'Tableta' },
  { name: 'Amlodipino', genericName: 'Amlodipino', concentration: '5 mg', form: 'Tableta' },
  { name: 'Atorvastatina', genericName: 'Atorvastatina', concentration: '20 mg', form: 'Tableta' },
  { name: 'Metformina', genericName: 'Metformina', concentration: '850 mg', form: 'Tableta' },
  { name: 'Glibenclamida', genericName: 'Glibenclamida', concentration: '5 mg', form: 'Tableta' },
  { name: 'Salbutamol', genericName: 'Salbutamol', concentration: '100 mcg/dosis', form: 'Inhalador' },
  { name: 'Loratadina', genericName: 'Loratadina', concentration: '10 mg', form: 'Tableta' },
  { name: 'Cetirizina', genericName: 'Cetirizina', concentration: '10 mg', form: 'Tableta' },
  { name: 'Prednisona', genericName: 'Prednisona', concentration: '20 mg', form: 'Tableta' },
  { name: 'Dexametasona', genericName: 'Dexametasona', concentration: '4 mg/mL', form: 'Ampolla' },
  { name: 'Metamizol', genericName: 'Metamizol sódico', concentration: '500 mg', form: 'Tableta' },
  { name: 'Sales de rehidratación oral', genericName: 'SRO', concentration: 'Sobre', form: 'Polvo' },
  { name: 'Sulfato ferroso', genericName: 'Sulfato ferroso', concentration: '300 mg', form: 'Tableta' },
  { name: 'Ácido fólico', genericName: 'Ácido fólico', concentration: '5 mg', form: 'Tableta' },
]

const EXAMENES: { type: 'LABORATORY' | 'IMAGING' | 'SPECIAL' | 'OTHER'; name: string; instructions?: string }[] = [
  { type: 'LABORATORY', name: 'Hemograma completo' },
  { type: 'LABORATORY', name: 'Glucosa en ayunas', instructions: 'Ayuno de 8 horas' },
  { type: 'LABORATORY', name: 'Perfil lipídico', instructions: 'Ayuno de 12 horas' },
  { type: 'LABORATORY', name: 'Hemoglobina glicosilada (HbA1c)' },
  { type: 'LABORATORY', name: 'Perfil hepático' },
  { type: 'LABORATORY', name: 'Urea y creatinina' },
  { type: 'LABORATORY', name: 'Examen completo de orina' },
  { type: 'LABORATORY', name: 'Perfil tiroideo (TSH, T4 libre)' },
  { type: 'IMAGING', name: 'Radiografía de tórax' },
  { type: 'IMAGING', name: 'Ecografía abdominal', instructions: 'Ayuno de 6 horas' },
  { type: 'IMAGING', name: 'Ecografía pélvica', instructions: 'Vejiga llena' },
  { type: 'IMAGING', name: 'Tomografía computarizada' },
  { type: 'SPECIAL', name: 'Electrocardiograma' },
  { type: 'SPECIAL', name: 'Ecocardiograma' },
  { type: 'SPECIAL', name: 'Espirometría' },
  { type: 'SPECIAL', name: 'Prueba de esfuerzo', instructions: 'Ropa cómoda; no desayunar copiosamente' },
]

// =============================================================================
//  Personas
// =============================================================================

const MEDICOS = [
  {
    email: 'ana.ruiz@clinica.demo',
    nombres: 'Ana',
    apellidos: 'Ruiz Delgado',
    colegiatura: 'CMP-45821',
    especialidad: 'Cardiología',
    color: '#2563EB',
    minutos: 20,
    // Mañanas de lunes a viernes.
    horarios: [
      { dia: 1, inicio: 480, fin: 780 },
      { dia: 2, inicio: 480, fin: 780 },
      { dia: 3, inicio: 480, fin: 780 },
      { dia: 4, inicio: 480, fin: 780 },
      { dia: 5, inicio: 480, fin: 780 },
    ],
  },
  {
    email: 'carlos.mendoza@clinica.demo',
    nombres: 'Carlos',
    apellidos: 'Mendoza Vargas',
    colegiatura: 'CMP-38104',
    especialidad: 'Pediatría',
    color: '#10B981',
    minutos: 15,
    // Tardes, con los lunes y miércoles en la otra sede.
    horarios: [
      { dia: 1, inicio: 840, fin: 1200 },
      { dia: 2, inicio: 840, fin: 1200 },
      { dia: 3, inicio: 840, fin: 1200 },
      { dia: 4, inicio: 840, fin: 1200 },
      { dia: 6, inicio: 540, fin: 780 },
    ],
  },
  {
    email: 'lucia.paredes@clinica.demo',
    nombres: 'Lucía',
    apellidos: 'Paredes Soto',
    colegiatura: 'CMP-51937',
    especialidad: 'Medicina General',
    color: '#8B5CF6',
    minutos: 20,
    // Turno partido: mañana y noche el mismo día, sin superponerse.
    horarios: [
      { dia: 1, inicio: 540, fin: 780 },
      { dia: 1, inicio: 1080, fin: 1260 },
      { dia: 3, inicio: 540, fin: 780 },
      { dia: 3, inicio: 1080, fin: 1260 },
      { dia: 5, inicio: 540, fin: 780 },
    ],
  },
]

const PACIENTES = [
  { doc: '43215678', nom: 'María', ape: 'Quispe Huamán', nac: '1978-03-14', gen: 'F', tel: '987654321', alergias: 'Penicilina' },
  { doc: '10293847', nom: 'José', ape: 'Ramírez Castro', nac: '1965-11-02', gen: 'M', tel: '998877665', alergias: null },
  { doc: '75849302', nom: 'Rosa', ape: 'Flores Aguirre', nac: '1990-07-21', gen: 'F', tel: '912345678', alergias: 'Sulfas, AINEs' },
  { doc: '20394857', nom: 'Miguel', ape: 'Torres Salazar', nac: '1982-01-30', gen: 'M', tel: '945612378', alergias: null },
  { doc: '68402913', nom: 'Carmen', ape: 'Vega Ríos', nac: '1955-09-08', gen: 'F', tel: '923456789', alergias: 'Yodo' },
  { doc: '39485720', nom: 'Luis', ape: 'Chávez Medina', nac: '1995-05-17', gen: 'M', tel: '956781234', alergias: null },
  { doc: '84920156', nom: 'Patricia', ape: 'Núñez Cárdenas', nac: '1973-12-25', gen: 'F', tel: '934567812', alergias: null },
  { doc: '57301948', nom: 'Jorge', ape: 'Rojas Peña', nac: '1988-04-09', gen: 'M', tel: '967812345', alergias: 'Aspirina' },
  { doc: '91027384', nom: 'Sofía', ape: 'Espinoza Lira', nac: '2018-06-12', gen: 'F', tel: '978123456', alergias: null },
  { doc: '29175840', nom: 'Diego', ape: 'Bustamante León', nac: '2015-02-28', gen: 'M', tel: '989234567', alergias: 'Huevo' },
  { doc: '46018273', nom: 'Elena', ape: 'Cabrera Ortiz', nac: '1960-08-19', gen: 'F', tel: '901234567', alergias: null },
  { doc: '73519026', nom: 'Ricardo', ape: 'Fuentes Zapata', nac: '2000-10-05', gen: 'M', tel: '913579246', alergias: null },
]

const MOTIVOS = [
  'Control de presión arterial',
  'Dolor de cabeza persistente',
  'Chequeo anual',
  'Control de diabetes',
  'Dolor abdominal',
  'Tos y fiebre',
  'Control de crecimiento',
  'Dolor lumbar',
  'Revisión de resultados de laboratorio',
  'Malestar general',
]

// =============================================================================
//  Ejecución
// =============================================================================

async function limpiar() {
  // Orden inverso al de las dependencias. La auditoría no se toca: es
  // inmutable por diseño, y sus filas de desarrollo no estorban.
  await prisma.medicineItem.deleteMany()
  await prisma.prescription.deleteMany()
  await prisma.medicalExam.deleteMany()
  await prisma.attendanceDiagnosis.deleteMany()
  await prisma.attendanceAddendum.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.waitlist.deleteMany()
  await prisma.appointment.deleteMany()
  await prisma.patientConsent.deleteMany()
  await prisma.patient.deleteMany()
  await prisma.scheduleException.deleteMany()
  await prisma.schedule.deleteMany()
  await prisma.prescriptionTemplate.deleteMany()
  await prisma.doctor.deleteMany()
  await prisma.session.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.user.deleteMany()
  await prisma.location.deleteMany()
  await prisma.icd10Code.deleteMany()
  await prisma.medicineCatalog.deleteMany()
  await prisma.examCatalog.deleteMany()
}

async function principal() {
  console.log('\n  Generando datos de ejemplo...\n')

  await limpiar()

  // --- Configuración de la clínica ------------------------------------------
  await prisma.clinicSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Centro Médico San Rafael',
      ruc: '20512345678',
      address: 'Av. Larco 1234, Miraflores, Lima',
      phone: '(01) 445-6789',
      email: 'contacto@sanrafael.demo',
      timezone: 'America/Lima',
      defaultSlotMinutes: 20,
    },
  })

  // --- Catálogos -------------------------------------------------------------
  await prisma.icd10Code.createMany({ data: CIE10 })
  await prisma.medicineCatalog.createMany({ data: MEDICAMENTOS })
  await prisma.examCatalog.createMany({ data: EXAMENES })
  console.log(
    `  Catálogos: ${CIE10.length} códigos CIE-10, ${MEDICAMENTOS.length} medicamentos, ${EXAMENES.length} exámenes`,
  )

  // --- Sedes ----------------------------------------------------------------
  const sedeMiraflores = await prisma.location.create({
    data: { name: 'Sede Miraflores', address: 'Av. Larco 1234, Miraflores', phone: '(01) 445-6789' },
  })
  const sedeSanIsidro = await prisma.location.create({
    data: { name: 'Sede San Isidro', address: 'Av. Javier Prado 456, San Isidro', phone: '(01) 221-3344' },
  })

  const contrasena = await cifrarContrasena(CONTRASENA)

  // --- Personal --------------------------------------------------------------
  await prisma.user.create({
    data: {
      email: 'admin@clinica.demo',
      password: contrasena,
      firstName: 'Elena',
      lastName: 'Vásquez Ramos',
      phone: '999111222',
      roles: ['ADMIN'],
    },
  })

  await prisma.user.create({
    data: {
      email: 'recepcion@clinica.demo',
      password: contrasena,
      firstName: 'Rosa',
      lastName: 'Díaz Molina',
      phone: '999333444',
      roles: ['RECEPTIONIST'],
    },
  })

  await prisma.user.create({
    data: {
      email: 'enfermeria@clinica.demo',
      password: contrasena,
      firstName: 'Julia',
      lastName: 'Ccahuana Pari',
      phone: '999555666',
      roles: ['NURSE'],
    },
  })

  // El dueño del consultorio: administra y además atiende. Es el caso que el
  // rol único del diseño original no permitía representar.
  const directorMedico = await prisma.user.create({
    data: {
      email: 'director@clinica.demo',
      password: contrasena,
      firstName: 'Fernando',
      lastName: 'Alarcón Ríos',
      phone: '999777888',
      roles: ['ADMIN', 'DOCTOR'],
      doctor: {
        create: {
          licenseNumber: 'CMP-29014',
          specialty: 'Medicina Interna',
          colorCode: '#EA580C',
          defaultSlotMinutes: 30,
        },
      },
    },
    include: { doctor: true },
  })

  // El director atiende sábados y domingos por la mañana (guardia). Además de
  // ser realista, hace que el seed produzca una agenda visible cualquier día
  // de la semana: sin turnos de fin de semana, quien ejecute esto un domingo
  // encuentra el calendario vacío y cree que algo falló.
  await prisma.schedule.createMany({
    data: [
      { doctorId: directorMedico.doctor!.id, dayOfWeek: 2, startMinute: 600, endMinute: 780, slotMinutes: 30, locationId: sedeMiraflores.id },
      { doctorId: directorMedico.doctor!.id, dayOfWeek: 4, startMinute: 600, endMinute: 780, slotMinutes: 30, locationId: sedeMiraflores.id },
      { doctorId: directorMedico.doctor!.id, dayOfWeek: 6, startMinute: 540, endMinute: 720, slotMinutes: 30, locationId: sedeMiraflores.id },
      { doctorId: directorMedico.doctor!.id, dayOfWeek: 0, startMinute: 540, endMinute: 720, slotMinutes: 30, locationId: sedeMiraflores.id },
    ],
  })

  const medicos: { id: string; minutos: number; nombre: string }[] = []

  for (const datos of MEDICOS) {
    const usuario = await prisma.user.create({
      data: {
        email: datos.email,
        password: contrasena,
        firstName: datos.nombres,
        lastName: datos.apellidos,
        roles: ['DOCTOR'],
        doctor: {
          create: {
            licenseNumber: datos.colegiatura,
            specialty: datos.especialidad,
            colorCode: datos.color,
            defaultSlotMinutes: datos.minutos,
          },
        },
      },
      include: { doctor: true },
    })

    const doctorId = usuario.doctor!.id
    medicos.push({ id: doctorId, minutos: datos.minutos, nombre: `${datos.nombres} ${datos.apellidos}` })

    // Los horarios no se superponen: el constraint de exclusión rechazaría
    // dos franjas del mismo médico el mismo día que se pisen.
    for (const [indice, horario] of datos.horarios.entries()) {
      await prisma.schedule.create({
        data: {
          doctorId,
          dayOfWeek: horario.dia,
          startMinute: horario.inicio,
          endMinute: horario.fin,
          slotMinutes: datos.minutos,
          locationId: indice % 3 === 0 ? sedeSanIsidro.id : sedeMiraflores.id,
        },
      })
    }
  }

  // Vacaciones del cardiólogo la próxima semana: sin excepciones de horario,
  // la agenda ofrecería horas que el médico no va a atender.
  await prisma.scheduleException.createMany({
    data: [7, 8, 9].map((dias) => ({
      doctorId: medicos[0]!.id,
      date: sumarDias(hoy, dias),
      type: 'UNAVAILABLE' as const,
      reason: 'Congreso de cardiología',
    })),
  })

  console.log(`  Personal: 1 admin, 1 recepción, 1 enfermería, ${MEDICOS.length + 1} médicos`)

  // --- Pacientes -------------------------------------------------------------
  const pacientes = []
  for (const datos of PACIENTES) {
    pacientes.push(
      await prisma.patient.create({
        data: {
          document: datos.doc,
          firstName: datos.nom,
          lastName: datos.ape,
          birthDate: new Date(datos.nac),
          gender: datos.gen as 'M' | 'F',
          phone: datos.tel,
          allergies: datos.alergias,
          consents: {
            create: {
              type: 'DATA_PROCESSING',
              version: '2026-01',
            },
          },
        },
        select: { id: true },
      }),
    )
  }
  console.log(`  Pacientes: ${pacientes.length}`)

  // --- Citas -----------------------------------------------------------------
  // Se generan recorriendo los slots de cada médico en orden, de modo que
  // nunca se solapan. El constraint de exclusión de la base rechazaría
  // cualquier cruce, así que un error aquí se notaría de inmediato.
  const estadosPasados = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const
  const estadosHoy = ['ARRIVED', 'CONFIRMED', 'SCHEDULED', 'COMPLETED'] as const

  let totalCitas = 0
  let indicePaciente = 0

  const todosLosMedicos = [
    ...medicos,
    { id: directorMedico.doctor!.id, minutos: 30, nombre: 'Fernando Alarcón' },
  ]

  for (let desplazamiento = -14; desplazamiento <= 21; desplazamiento++) {
    const dia = sumarDias(hoy, desplazamiento)
    const diaSemana = dia.getUTCDay()

    for (const medico of todosLosMedicos) {
      const franjas = await prisma.schedule.findMany({
        where: { doctorId: medico.id, dayOfWeek: diaSemana, isActive: true },
        orderBy: { startMinute: 'asc' },
      })

      for (const franja of franjas) {
        const duracion = franja.slotMinutes ?? medico.minutos
        // Entre 2 y 4 citas por franja: una agenda llena al 100% no se parece
        // a ninguna clínica real y hace ilegible el calendario de prueba.
        const cantidad = 2 + ((desplazamiento + franja.startMinute) % 3)

        for (let n = 0; n < cantidad; n++) {
          const inicioMinuto = franja.startMinute + n * duracion
          if (inicioMinuto + duracion > franja.endMinute) break

          const paciente = pacientes[indicePaciente % pacientes.length]!
          indicePaciente++

          const estado =
            desplazamiento < 0
              ? estadosPasados[(indicePaciente + n) % estadosPasados.length]!
              : desplazamiento === 0
                ? estadosHoy[(indicePaciente + n) % estadosHoy.length]!
                : ('SCHEDULED' as const)

          await prisma.appointment.create({
            data: {
              patientId: paciente.id,
              doctorId: medico.id,
              locationId: franja.locationId,
              startsAt: horaLocalAUtc(dia, inicioMinuto),
              endsAt: horaLocalAUtc(dia, inicioMinuto + duracion),
              status: estado,
              reason: MOTIVOS[(indicePaciente + n) % MOTIVOS.length]!,
              ...(estado === 'CANCELLED'
                ? { cancelledAt: new Date(), cancelReason: 'El paciente no puede asistir', cancelledBy: 'PATIENT' }
                : {}),
              ...(estado === 'ARRIVED' ? { arrivedAt: new Date() } : {}),
            },
          })
          totalCitas++
        }
      }
    }
  }

  console.log(`  Citas: ${totalCitas} entre hace 2 semanas y dentro de 3`)

  // --- Lista de espera --------------------------------------------------------
  await prisma.waitlist.createMany({
    data: [
      {
        patientId: pacientes[2]!.id,
        doctorId: medicos[0]!.id,
        preferredDate: sumarDias(hoy, 3),
        preferredTime: 'MORNING',
      },
      {
        patientId: pacientes[5]!.id,
        preferredDate: sumarDias(hoy, 2),
        preferredTime: 'ANY',
      },
    ],
  })

  console.log('\n  Listo. Cuentas de prueba (contraseña: ' + CONTRASENA + '):\n')
  console.log('    admin@clinica.demo        ADMIN')
  console.log('    director@clinica.demo     ADMIN + DOCTOR  (el dueño que también atiende)')
  console.log('    ana.ruiz@clinica.demo     DOCTOR — Cardiología, mañanas')
  console.log('    carlos.mendoza@clinica.demo  DOCTOR — Pediatría, tardes')
  console.log('    lucia.paredes@clinica.demo   DOCTOR — Medicina General, turno partido')
  console.log('    recepcion@clinica.demo    RECEPTIONIST')
  console.log('    enfermeria@clinica.demo   NURSE\n')
}

try {
  await principal()
} catch (error) {
  console.error('\n  Error generando los datos:', error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
