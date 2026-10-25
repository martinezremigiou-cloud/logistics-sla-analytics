// ============================================================
// [INV-B11] O6-adenda · A QUIÉN ESCRIBIRLE, Y QUIÉN LO DECIDE.
//
// EL INVARIANTE, que es lo que hace buena esta pieza:
//
//     > El usuario no navega un menú de contactos:
//     > el contacto correcto aparece EN la respuesta que lo hizo falta.
//
// Y sale de una máquina de estados que YA existe —la de O4 y la de las siete
// intenciones—, así que aquí no se inventa lógica: **solo hay un mapa**.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ES DATO Y NO UNA CADENA DE `if`.
//
// Se pidió con el molde de `INTENCIONES`, y la razón es la misma que allá:
// con `Record<EstadoEscalable, …>` **agregar un estado sin destino no compila**.
// Un `if/else` con un `return null` al final se traga el estado nuevo en
// silencio y deja al usuario mirando un «no sé» sin salida — que es el hueco de
// P7/P24: la mitad que nadie echa de menos porque nunca se pinta.
//
// El `switch` de `mensajeDe()` en `corpus-consulta.service.ts` ya usa este
// mismo molde para el TEXTO de cada estado. Esto es su gemelo para el DESTINO,
// y va aparte a propósito: el texto es del chat, el destino también lo usa
// Ajustes.
//
// ────────────────────────────────────────────────────────────
// DE DÓNDE SALEN LOS DATOS DE CONTACTO.
//
// Se confirmaron el 2026-08-21. **Son correos y teléfonos internos de
// Demo** — el directorio de escalada del equipo, no dato de un cliente. No
// hay nada que ocultar aquí y por eso viven en el repo y no en el entorno: si
// vivieran en variables, la lista dejaría de estar bajo revisión de código y
// nadie notaría que un contacto se fue de la empresa.
// ============================================================
import type { Intencion } from '@/lib/chat/intenciones';
import type { ResultadoFicha } from '@/services/corpus-consulta.service';

/** Las cuatro áreas de escalada. Una por persona, hoy. */
export type AreaEscalada = 'producto' | 'software' | 'inventario' | 'embarques';

export interface Contacto {
  area: AreaEscalada;
  nombre: string;
  puesto: string;
  correo: string;
  telefono: string;
  /**
   * Cuándo escribirle, **en palabras de quien tiene el problema**. Es el texto
   * de la tabla de Ajustes y no puede ser jerga del sistema: quien lo lee
   * acaba de toparse con algo que no entendió.
   */
  cuando: string;
}

export const CONTACTOS: Record<AreaEscalada, Contacto> = Object.freeze({
  producto: {
    area: 'producto',
    nombre: 'Hugo Lara',
    puesto: 'Commercial Support',
    correo: 'hlara@example.com',
    telefono: '+52 55 0000 0001',
    cuando: 'Qué hace un producto, especificaciones, compatibilidades',
  },
  software: {
    area: 'software',
    nombre: 'Tomas Ruiz',
    puesto: 'Analista de Datos',
    correo: 'truiz@example.com',
    telefono: '55 0000 0002',
    cuando: 'El portal: algo falla, algo se ve mal, no encuentras dónde',
  },
  inventario: {
    area: 'inventario',
    nombre: 'Paula Soto',
    puesto: 'Commercial Coordinator',
    correo: 'psoto@example.com',
    telefono: '+52 55 0000 0003',
    cuando: 'Existencias o reservas que no cuadran',
  },
  embarques: {
    area: 'embarques',
    nombre: 'Raquel Vega',
    puesto: 'Responsable del archivo de embarques',
    correo: 'rvega@example.com',
    telefono: '+52 55 0000 0004',
    cuando: 'Embarques, fechas de llegada, aduana',
  },
});

/**
 * Todo estado desde el que se puede escalar.
 *
 * Son TRES espacios de claves que existían por separado y aquí se juntan en
 * uno solo, porque el usuario no distingue entre ellos — solo sabe que se
 * quedó sin respuesta:
 *
 *   `ResultadoFicha['tipo']`  los 8 estados de O4 (la rama documental)
 *   `Intencion`               las 7 intenciones del enrutador (la rama de dato)
 *   los dos de transporte     el chat sin llave, y la llamada caída
 *
 * **Ninguna clave colisiona**, y eso está comprobado en la prueba: si algún día
 * una intención se llamara igual que un estado, el mapa perdería una fila sin
 * que nadie lo viera.
 */
export type EstadoEscalable =
  | ResultadoFicha['tipo']
  | Intencion
  | 'config_error'
  | 'fallo_transporte';

/**
 * El mapa. **Un renglón por estado**, y `null` donde escalar sería ruido.
 *
 * `null` NO es «no sé a quién»: es **«aquí no hay a quién escribirle porque
 * nada falló»**. La distinción importa por la regla del bloque —cero y
 * no-medido son valores distintos—: un `null` mal puesto se ve igual que un
 * hueco, así que cada uno lleva su razón al lado.
 */
export const DESTINO: Record<EstadoEscalable, AreaEscalada | null> = Object.freeze({
  // ── Los 8 estados de la ficha (O4) ──────────────────────────
  /** Nada indexado. No falta la ficha: falta que el portal la cargue. */
  corpus_vacio: 'software',
  /** No pudimos preguntar. Es transporte, no conocimiento. */
  fallo_consulta: 'software',
  /**
   * El puente apunta a una ficha que ya no está. Va a PRODUCTO y no a software
   * porque el propio mensaje de O4 dice qué hay que hacer —*«avisa para
   * reasignarla»*— y reasignar una familia a otra ficha es una decisión de
   * documentación de producto, no un arreglo de código.
   */
  puente_colgante: 'producto',
  /** El SKU no está en el catálogo: no viene en el Excel de inventario. */
  sku_desconocido: 'inventario',
  /** Sin familia. Lo dice O4 con todas sus letras: «es calidad del Excel». */
  sin_familia: 'inventario',
  /** Nadie ha mapeado esa familia. Hueco NUESTRO, y del lado de producto. */
  sin_puente: 'producto',
  /** Un humano confirmó que esa familia no tiene ficha. Si hace falta, es de producto. */
  sin_ficha_confirmado: 'producto',
  /** Hubo ficha. **Nada que escalar**, y por eso `null`. */
  ficha: null,

  // ── Las 7 intenciones ───────────────────────────────────────
  llegada: 'embarques',
  pipeline: 'embarques',
  disponibilidad: 'inventario',
  sobre_reservados: 'inventario',
  buscar_por_nombre: 'inventario',
  /** Familia, marca, tecnología: la clasificación entra por el Excel de inventario. */
  clasificacion: 'inventario',
  documental: 'producto',

  // ── Las cuatro conceptuales de O6 ───────────────────────────
  /**
   * **`null`, y es el segundo de todo el mapa.** «¿Qué puedes hacer?» no es un
   * hueco de nadie: es una pregunta que el sistema contesta entera. Ofrecer un
   * contacto ahí diría que algo salió mal.
   */
  capacidades: null,
  /** Lo que se movió sale de stock y reservas: si no cuadra, es el Excel de inventario. */
  destacado_hoy: 'inventario',
  /**
   * Los proyectos se originan EN el portal: no vienen de ningún Excel. Si uno
   * falta, aparece de más o no cuadra, no hay archivo que revisar — hay portal.
   */
  mis_proyectos: 'software',
  /**
   * Va a software y no al dueño del archivo, **y la razón es B10-3**: cuando
   * falta una carga, el sistema NO puede distinguir «no corrió» de «corrió y el
   * archivo no había cambiado». Mandar a alguien a preguntarle a Paula por un
   * hueco que quizá fue una corrida sin novedad es mandarlo a la persona
   * equivocada la mitad de las veces. Quien puede mirar si el ETL corrió es
   * quien tiene el registro.
   */
  snapshots_recientes: 'software',

  // ── Transporte ──────────────────────────────────────────────
  /** El servidor sin `OPENAI_API_KEY`. Es despliegue, y tiene dueño. */
  config_error: 'software',
  /** La llamada se cayó. También del portal. */
  fallo_transporte: 'software',
});

/**
 * El contacto de un estado, o `null` si no hay nada que escalar.
 *
 * **PRECEDENCIA, para quien llame con dos cosas en la mano:** si hay un estado
 * de ficha, ése gana sobre la intención. Una pregunta `documental` que terminó
 * en `sin_familia` es un problema del Excel, no de la documentación — y mandar
 * al usuario con producto por algo que solo Paula puede arreglar es peor que no
 * mandarlo con nadie.
 */
export function contactoDe(estado: EstadoEscalable): Contacto | null {
  const area = DESTINO[estado];
  return area ? CONTACTOS[area] : null;
}

/** La tabla de Ajustes, en el orden en que se definió. */
export const ORDEN_AYUDA: readonly AreaEscalada[] = Object.freeze([
  'producto',
  'software',
  'inventario',
  'embarques',
]);
