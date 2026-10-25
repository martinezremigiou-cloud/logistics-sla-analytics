// ============================================================
// [INV-B8.2] lib/seleccion.ts — la Selección, 100% PURA.
//
// SE LLAMA «SELECCIÓN» Y NO «CARRITO» NI «BANDEJA». Es como la nombra la propia
// maqueta 2.2 (*"Selección flotante persistente"*), y **«bandeja» ya está
// tomado** en el repo por la Bandeja de pendientes
// (`components/pendientes/bandeja-view.tsx`): reusar el nombre confundiría dos
// cosas que no tienen nada que ver.
//
// QUÉ ES Y QUÉ NO ES. La Selección es un apunte de trabajo del navegador: SKUs
// que un KAM va marcando mientras recorre el catálogo, para volcarlos después a
// un proyecto. **No es dato originado**: no se persiste en la base, no aparece
// en ningún documento, y perderla no pierde nada del negocio. Por eso vive en
// `localStorage` y no en una tabla — una tabla la volvería dato de usuario, con
// su RLS, su respaldo y su deuda (ver B8-10).
//
// EL INVARIANTE QUE ESTE ARCHIVO SOSTIENE, y es el que se rompe callado:
// **la Selección NO sobrevive a un cambio de sesión.** Si un KAM cierra sesión
// y entra otro en el mismo navegador, el segundo no puede heredar los SKUs del
// primero.
//
// Se resuelve POR CONSTRUCCIÓN y no por evento: la clave de almacenamiento
// lleva dentro el `auth.uid()` de la sesión (`mx-seleccion:<id>`), así que otro
// usuario simplemente lee otra clave. La alternativa —escuchar el cierre de
// sesión y limpiar— depende de que ese evento dispare siempre: no dispara si la
// pestaña se cerró, si la sesión expiró sola, o si alguien entró desde otro
// perfil del navegador. Una garantía que depende de un evento no es una
// garantía.
// ============================================================

export interface ItemSeleccion {
  sku: string;
  cantidad: number;
}

export interface Seleccion {
  items: ItemSeleccion[];
}

export const SELECCION_VACIA: Seleccion = { items: [] };

/** Tope de SKUs distintos en la Selección. Espejo de `MAX_PARTIDAS` (200): volcar no puede crear un proyecto que la base rechace. */
export const MAX_SELECCION = 200;

/**
 * Clave de `localStorage`, con la cuenta dentro. **Es el mecanismo del
 * invariante 2**: dos sesiones distintas leen y escriben claves distintas, así
 * que ninguna puede ver la de la otra ni por accidente ni por un evento que no
 * disparó.
 */
export function claveDeSeleccion(sesionId: string): string {
  return `mx-seleccion:${sesionId}`;
}

/** Normaliza el SKU igual que el ETL y que `agregarPartidaSchema`: `trim + UPPER`. Sin esto, `suj500-f` y `SUJ500-F` serían dos renglones. */
export function normalizarSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** `true` si el SKU ya está en la Selección. Lo consumen los botones del catálogo y de la ficha para pintar su estado. */
export function tiene(seleccion: Seleccion, sku: string): boolean {
  const normal = normalizarSku(sku);
  return seleccion.items.some((i) => i.sku === normal);
}

export function cantidadDe(seleccion: Seleccion, sku: string): number {
  const normal = normalizarSku(sku);
  return seleccion.items.find((i) => i.sku === normal)?.cantidad ?? 0;
}

export function totalPiezas(seleccion: Seleccion): number {
  return seleccion.items.reduce((suma, i) => suma + i.cantidad, 0);
}

/**
 * Agrega un SKU. **Es IDEMPOTENTE a propósito**: si ya está, la Selección no
 * cambia — ni suma ni reemplaza.
 *
 * El botón del catálogo es un interruptor con dos estados (`+ Proyecto` /
 * `En Selección`), no un contador: quien ya marcó un SKU y vuelve a pasar por
 * su fila no está pidiendo más piezas. La cantidad se edita en el panel, que es
 * donde el usuario la está mirando. Sumar aquí haría que recorrer el catálogo
 * dos veces duplicara cifras sin que nadie lo pidiera.
 */
export function agregar(seleccion: Seleccion, sku: string, cantidad = 1): Seleccion {
  const normal = normalizarSku(sku);
  if (!normal || tiene(seleccion, normal)) return seleccion;
  if (seleccion.items.length >= MAX_SELECCION) return seleccion;
  return { items: [...seleccion.items, { sku: normal, cantidad: saneaCantidad(cantidad) }] };
}

export function quitar(seleccion: Seleccion, sku: string): Seleccion {
  const normal = normalizarSku(sku);
  if (!tiene(seleccion, normal)) return seleccion;
  return { items: seleccion.items.filter((i) => i.sku !== normal) };
}

/** Alterna: agrega si no está, quita si está. Es lo que hace el botón de una fila del catálogo. */
export function alternar(seleccion: Seleccion, sku: string, cantidad = 1): Seleccion {
  return tiene(seleccion, sku) ? quitar(seleccion, sku) : agregar(seleccion, sku, cantidad);
}

/** Fija la cantidad de un SKU ya seleccionado. Una cantidad de 0 o menos QUITA el renglón: es lo que el usuario quiso decir. */
export function fijarCantidad(seleccion: Seleccion, sku: string, cantidad: number): Seleccion {
  const normal = normalizarSku(sku);
  if (!tiene(seleccion, normal)) return seleccion;
  if (!Number.isFinite(cantidad) || cantidad < 1) return quitar(seleccion, normal);
  return {
    items: seleccion.items.map((i) => (i.sku === normal ? { ...i, cantidad: saneaCantidad(cantidad) } : i)),
  };
}

export function vaciar(): Seleccion {
  return SELECCION_VACIA;
}

/** Entero ≥ 1 y por debajo del tope del schema de partidas. Un `NaN` o un negativo caen a 1 en vez de envenenar el estado. */
function saneaCantidad(cantidad: number): number {
  if (!Number.isFinite(cantidad)) return 1;
  return Math.min(1_000_000, Math.max(1, Math.floor(cantidad)));
}

/**
 * Lo mínimo que este módulo necesita de `localStorage`. Tiparlo así lo vuelve
 * probable sin navegador y sin mocks globales: el test le pasa un objeto.
 */
export interface AlmacenLocal {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

/**
 * Lee la Selección de esa sesión. **Nunca lanza y nunca contamina**: un JSON
 * corrupto, un tipo inesperado o una cantidad basura devuelven una Selección
 * vacía o se descartan renglón por renglón.
 *
 * Es deliberado y no defensivo de más: `localStorage` es editable por quien
 * tenga el navegador, y este dato alimenta un volcado que crea partidas. Un
 * lector tolerante que convierta basura en un dato válido es el patrón P12 del
 * repo; aquí la basura se tira, no se interpreta.
 */
export function leerSeleccion(almacen: AlmacenLocal, sesionId: string): Seleccion {
  let crudo: string | null;
  try {
    crudo = almacen.getItem(claveDeSeleccion(sesionId));
  } catch {
    // Safari en modo privado y algunas políticas corporativas lanzan al leer.
    return SELECCION_VACIA;
  }
  if (!crudo) return SELECCION_VACIA;

  try {
    const datos = JSON.parse(crudo) as unknown;
    if (!datos || typeof datos !== 'object' || !Array.isArray((datos as Seleccion).items)) return SELECCION_VACIA;

    const items: ItemSeleccion[] = [];
    for (const item of (datos as Seleccion).items) {
      if (!item || typeof item !== 'object') continue;
      const sku = typeof item.sku === 'string' ? normalizarSku(item.sku) : '';
      if (!sku) continue;
      if (items.some((i) => i.sku === sku)) continue; // sin duplicados, aunque el almacén los traiga
      if (typeof item.cantidad !== 'number' || !Number.isFinite(item.cantidad) || item.cantidad < 1) continue;
      items.push({ sku, cantidad: saneaCantidad(item.cantidad) });
      if (items.length >= MAX_SELECCION) break;
    }
    return { items };
  } catch {
    return SELECCION_VACIA;
  }
}

/** Escribe la Selección de esa sesión. Una Selección vacía BORRA la clave en vez de dejar `{"items":[]}` de basura. */
export function escribirSeleccion(almacen: AlmacenLocal, sesionId: string, seleccion: Seleccion): void {
  const clave = claveDeSeleccion(sesionId);
  try {
    if (seleccion.items.length === 0) almacen.removeItem(clave);
    else almacen.setItem(clave, JSON.stringify(seleccion));
  } catch {
    // Cuota llena o almacenamiento bloqueado: la Selección sigue viva en
    // memoria durante la sesión. Perderla no pierde nada del negocio.
  }
}
