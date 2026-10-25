// ============================================================
// [INV-B8] types/proyectos.ts — DTOs del Módulo Proyectos.
//
// ARCHIVO APARTE, Y NO ES ORGANIZACIÓN: es la mitigación del riesgo R-7 de
// la investigación 2.0. `src/types/api.ts` tiene 909 líneas y **fan-in 53**
// —el archivo más importado del repo— y `src/types/index.ts` lo re-exporta
// con `export *`. Cuatro módulos nuevos de 2.0 metiendo sus DTOs ahí
// colisionarían **en silencio en tiempo de tipos**, con el error apareciendo
// en el call-site y no en la definición.
//
// Por eso este archivo NO se agrega al barrel: se importa por ruta explícita
// (`@/types/proyectos`). El costo es escribir la ruta; la ganancia es que
// una colisión de nombres es imposible por construcción.
// ============================================================
import type { BadgeCatalogo } from './api';
import type { EjeAgrupacion, ResumenAgrupacion, MotivoDegradacion, CapaImagen } from '@/services/documento/resoluciones';

/** Fila de la lista de proyectos. Sin partidas: la lista no deriva cifras de disponibilidad. */
export interface ProyectoResumen {
  id: string;
  /** Identidad legible (`PRJ-001`). Se enseña; `id` es la que viaja en URLs y FKs. */
  folio: string;
  titulo: string;
  descripcion: string | null;
  notas: string | null;
  /** Fecha de NEGOCIO del proyecto (`YYYY-MM-DD`), no la de creación. */
  fecha: string;
  tipo: string | null;
  intencion: string | null;
  creado_en: string;
  /**
   * Correo del DUEÑO del proyecto — el "Responsable" de la línea de metadatos
   * de la maqueta. Sale del embed `perfiles(email)`, no de la sesión: para un
   * admin mirando el proyecto de un KAM, la sesión sería otra persona.
   * `null` solo si el proyecto quedó huérfano (la cuenta se borró y
   * `ON DELETE SET NULL` conservó el trabajo).
   */
  responsable: string | null;
  /** Conteos de la línea de metadatos de la maqueta ("3 SKUs · 400 pz"). */
  skus: number;
  piezas: number;
}

/**
 * Una partida con sus cifras YA DERIVADAS. Las tres cifras salen de
 * `derivarSku` y de ningún otro sitio — ver §2.3 del brief y el riesgo R-3
 * (`piezas_en_camino` tiene 4 implementaciones sueltas precisamente por no
 * haber hecho esto).
 */
export interface PartidaItem {
  /**
   * Id de la FILA de partida. Es lo que viaja en las rutas de edicion y
   * borrado, y NO el SKU: los SKU reales traen `/` y espacios
   * (`WN947-X-N/BPU51-H14`, `YBY016 W`), que en un segmento de ruta se
   * interpretan como separador de carpeta. Es el mismo motivo por el que
   * `rutaImagen` (src/lib/imagenes.ts) hashea el SKU en vez de usarlo como
   * nombre de archivo.
   */
  partida_id: string;
  sku: string;
  /** Descripción EFECTIVA (override > v2 > fuente), vía `resolverClasificacion`. */
  descripcion: string | null;
  /** Marca EFECTIVA (v2 > fuente). */
  marca: string | null;
  tecnologia: string | null;
  /** Color curado para el borde izquierdo de la fila (`productos_metadata.color`). */
  color: string | null;
  imagen_url: string | null;

  /** Lo que el proyecto comprometió. */
  cantidad: number;

  total: number;
  reservado: number;
  disponible: number;
  badges: BadgeCatalogo[];

  /** `disponible < cantidad`. Ver `enRiesgo` y la prueba de subsunción. */
  en_riesgo: boolean;

  /**
   * El SKU ya no viene en el archivo vigente. Cuando es `true`, sus cifras
   * son de `dato_de` y NO del snapshot del documento — y el estatus
   * calculado ("Sin stock") no significa lo que parece.
   */
  fuera_del_vigente: boolean;
  /** Instante ISO del snapshot del que vienen las cifras de ESTA fila. `null` si es el mismo del documento. */
  dato_de: string | null;

  /** Banda de agrupación y el eje que la produjo (cadena D5). */
  banda: string | null;
  eje_banda: EjeAgrupacion;
}

/** De qué snapshot son los números, para que el documento y la pantalla puedan DECIRLO. */
export interface VigenciaDelDato {
  snapshot_id: string | null;
  /** `snapshots.created_at` del snapshot pinneado (ISO). `null` si no hay ninguno todavía. */
  tomado_en: string | null;
}

export interface ProyectoDetalle extends ProyectoResumen {
  partidas: PartidaItem[];
  vigencia: VigenciaDelDato;
  agrupacion: ResumenAgrupacion;
  /** Valores REALES presentes en las partidas, para poblar los dos selectores de la vista. Nunca una lista fija. */
  facetas: { marcas: string[]; tecnologias: string[] };
}

/** Imagen ya resuelta por la cadena D2, con el motivo de cada degradación. Solo la usa el generador de documentos. */
export interface ImagenDePartida {
  fuente: string;
  capa: CapaImagen;
  motivos: MotivoDegradacion[];
}

/**
 * Lo que devuelve `GET /api/proyectos`. **Es un envoltorio, no un arreglo**:
 * `{ items }` es la convención de la casa para endpoints de lista, la misma de
 * `/api/usuarios`.
 *
 * [INV-B8.2] Vive aquí desde que costó un bug. Estaba declarada como
 * `interface` LOCAL dentro de `proyectos-view.tsx`, así que el segundo
 * consumidor —el diálogo de volcado— no tenía nada que importar y **se inventó
 * la forma**: `useApi<ProyectoResumen[]>`, un arreglo pelón. `tsc` salió limpio
 * (un genérico de `useApi` es una AFIRMACIÓN, no una comprobación: TypeScript
 * no puede verificar lo que devuelve un `fetch`) y la suite salió verde porque
 * el mock del test inventaba la misma forma equivocada. Reventó en el navegador
 * con `t.find is not a function`, y se encontró haciendo clic.
 *
 * Con la forma en un solo lugar, un tercer consumidor no puede volver a
 * inventarla: la importa o no compila.
 */
export interface ProyectosResponse {
  items: ProyectoResumen[];
  /**
   * [2.0.1-B · S-1] El snapshot de stock con el que se leería el inventario de
   * CUALQUIERA de estos proyectos — el que pinnearía `conVigenteStock`.
   *
   * **Va en el sobre y no en cada renglón, y eso es una decisión.** Es un solo
   * dato global: repetirlo en los N ítems sería N copias de la misma fecha, y
   * este repo ya sabe adónde lleva eso: las tablas que
   * acumulan una copia por snapshot inflan cualquier conteo. El sobre es
   * el sitio donde un dato de toda la lista se dice UNA vez.
   *
   * Opcional a propósito: un consumidor viejo que solo lea `items` sigue
   * compilando, y la tarjeta no pinta la línea cuando no llega — la fecha del
   * inventario no se inventa.
   */
  vigencia?: VigenciaDelDato;
}

// ============================================================
// [INV-B8.2] EL RESULTADO DE UN VOLCADO.
//
// Vive aquí y no en el servicio porque lo lee el CLIENTE: el diálogo de volcado
// enseña el desglose. Un `import type` desde el servicio habría funcionado —los
// tipos se borran al compilar— pero habría dejado escrito en un archivo de
// navegador el nombre de un módulo que solo corre en el servidor, y ese es el
// tipo de dependencia que un día alguien convierte en import de valor.
//
// NO es un booleano a propósito. Un volcado puede aplicar unos renglones,
// detectar otros como reintento y chocar con un tercero; aplastar eso en
// «sí/no» perdería justo lo que el usuario necesita leer.
// ============================================================

/** Por qué un renglón no se aplicó. Se traduce a mensaje en el cliente, no en el servicio. */
export type MotivoConflicto = 'cambio_concurrente' | 'tope_cantidad';

export interface ResultadoVolcado {
  /** Renglones escritos, con el antes y el después — es el «and say» del sum-and-say. */
  aplicadas: { sku: string; antes: number; despues: number }[];
  /** Ya estaban con el resultado exacto de este volcado: es un reintento y NO se volvió a sumar. */
  sinCambio: { sku: string; cantidad: number }[];
  conflictos: { sku: string; cantidadVista: number; cantidadActual: number; motivo: MotivoConflicto }[];
  /** SKUs que no existen en `productos`. Se reportan uno por uno en vez de tumbar la operación con un 23503. */
  desconocidos: string[];
}
