// ============================================================
// [INV-B9] avisos.service.ts — las lecturas que alimentan a `lib/avisos.ts`.
//
// Este archivo LEE y DELEGA. Toda la decisión de qué avisar está en
// `src/lib/avisos.ts`, que es puro y no sabe qué es Supabase; aquí solo se
// arman las filas que esa función necesita. La razón es la de O5: el bloque de
// correo va a llamar a la MISMA función pura, y si la decisión viviera aquí
// —o peor, en un componente— habría que reimplementarla.
//
// CERO ARITMÉTICA NUEVA (invariante O1). Las cifras de hoy salen de
// `derivarSku` y de ningún otro lado. Se le pasan `[]` en reservas y overrides
// **a propósito y sin perder nada**: de los tres números que este bloque
// consume, `derivaciones.ts:237-239` dice que `total` sale de las filas de
// stock, `reservado` de `producto.resv` y `disponible` de la resta. Ni uno
// depende de reservas ni de overrides — ésos alimentan `reserva_descuadre` y
// las clasificaciones efectivas, que aquí no se leen. `inventory.service.ts:149`
// ya usa esa misma llamada acotada.
//
// LA VENTANA DEL PANEL SON 14 DÍAS, y el número se eligió con criterio: el
// hueco entre cargas de `stock` queda por debajo de la ventana y
// por eso, con 14 días el panel nunca sale vacío por el simple hecho de que
// las cargas vengan en racimos. La MARCA DE AGUA es otra cosa y no se mezcla:
// el panel enseña la ventana, el badge cuenta lo que hay más allá de la marca.
// Dos preguntas, dos respuestas — así abrir la campana no la deja en blanco.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows, comoRespuesta } from '@/lib/supabase/fetch-all';
import { conVigenteStock, resolveVigente } from './vigente.service';
import { derivarSku, type ProductoLectura, type StockLectura } from './derivaciones';
import type { PreferenciasAvisos, CampanaResponse } from '@/types/avisos';
import type { CanalCallado } from '@/lib/correo';
import {
  derivarAvisos,
  derivarPulso,
  fuentesCalladas,
  type Aviso,
  type CambioCrudo,
  type CifrasAhora,
  type EmbarqueActivo,
  type FuenteCallada,
  type Pulso,
  type SeguimientoLectura,
} from '@/lib/avisos';

/** Días de historia que muestra el panel. Ver la cabecera: sale del máximo histórico entre cargas. */
export const DIAS_VENTANA = 14;

/**
 * Tope de SKUs seguidos por persona. Espejo del criterio de `MAX_PARTIDAS`: la
 * lista viaja en un `.in()` de PostgREST, que va en la URL. NO tiene espejo en
 * la base — un CHECK no puede contar filas de otra tabla sin un trigger.
 */
export const MAX_SEGUIMIENTOS = 200;

/** Cuántos SKUs caben en un `.in()` antes de trocear. Evita una URL de 10 KB en la peor carga. */
const LOTE_IN = 200;

// ------------------------------------------------------------
// [FIX-B2] TODA LECTURA DE FILAS QUE PUEDA PASAR DE 1 000 VA POR `fetchAllRows`,
// CON UN ORDEN TOTAL. PostgREST devuelve como máximo 1 000 filas por respuesta
// SIN error, pida el `.range` lo que pida — `.range(0, 4999)` no da margen:
// da 1 000. Así estaban tres lecturas de este archivo, y
// una ya mordía: la ventana de 14 días de `cambios` podía pasar de las 1 000 filas, y como
// el orden es ascendente se quedaban las 1 000 MÁS VIEJAS — todo lo posterior
// desaparecía del pulso de la campana y del correo. Una cuarta
// (`leerResumenCatalogo`) sí paginaba, pero con un orden que no era total.
//
// Las lecturas que NO pasan por aquí tienen un tope que no depende del volumen
// del dato: `seguimientos`, `MAX_SEGUIMIENTOS` (200, comprobado en `seguirSku`
// y sin espejo en la base); `productos` de `leerCifras`, el lote de `LOTE_IN`
// (200 SKU, una fila por SKU porque `sku` es su PK); y `estatus_catalogo`, que
// son 11 etapas.
//
// Cada lectura dice abajo por qué su orden es total (su llave primaria en
// `0001_schema.sql`, comprobada también en la base). Y el error se sigue
// leyendo donde se leía y con el mismo prefijo `<tabla>: `: `comoRespuesta`
// devuelve la lectura paginada con la forma `{ data, error }` de siempre.
// ------------------------------------------------------------

// ------------------------------------------------------------
// LAS PREFERENCIAS Y EL DTO DE LA CAMPANA SE IMPORTAN DE `@/types/avisos`, y
// NO se declaran aquí. La razón costó un bug en INV-B8.2: cuando la ruta y su
// consumidor declaran la misma forma por separado, nada obliga a que
// coincidan — `tsc` valida cada lado contra su propia declaración y la
// divergencia solo aparece en el navegador. Con UN solo tipo, el route handler
// no puede devolver algo que el cliente no espere.
// ------------------------------------------------------------

/** Los valores por omisión, espejo de los DEFAULT de la 0026. Se usan cuando el perfil aún no tiene fila. */
export const PREFERENCIAS_POR_OMISION: PreferenciasAvisos = {
  av_estatus: false,
  av_disponible: false,
  av_reservado: false,
  av_llegada: true,
  preguntar_por_sku: false,
  visto_hasta: null,
  boletin_correo: true,
};

/** Lo que devuelve `GET /api/campana`. Es EL MISMO tipo que consume el cliente. */
export type CampanaDTO = CampanaResponse;

interface SeguimientoRow {
  perfil_id: string;
  sku: string;
  av_estatus: boolean;
  av_disponible: boolean;
  av_reservado: boolean;
  av_llegada: boolean;
  av_correo: boolean;
}

/** Trocea un `.in()` largo. Sin esto, seguir 200 SKUs armaría una URL que algún proxy va a cortar. */
async function enLotes<T>(skus: string[], fn: (lote: string[]) => Promise<T[]>): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < skus.length; i += LOTE_IN) {
    salida.push(...(await fn(skus.slice(i, i + LOTE_IN))));
  }
  return salida;
}

/** Las preferencias del perfil, o los valores por omisión si la fila aún no existe (nace perezosa). */
export async function leerPreferencias(db: SupabaseClient): Promise<PreferenciasAvisos> {
  const { data, error } = await db
    .from('preferencias_notificacion')
    .select('av_estatus,av_disponible,av_reservado,av_llegada,preguntar_por_sku,visto_hasta,boletin_correo')
    .maybeSingle();

  if (error) throw new Error('preferencias_notificacion: ' + error.message);
  if (!data) return PREFERENCIAS_POR_OMISION;
  return data as PreferenciasAvisos;
}

/** Los seguimientos de la sesión. La RLS filtra: no hace falta —ni se debe— filtrar por perfil aquí. */
export async function leerSeguimientos(db: SupabaseClient): Promise<SeguimientoLectura[]> {
  const { data, error } = await db
    .from('seguimientos')
    .select('perfil_id,sku,av_estatus,av_disponible,av_reservado,av_llegada,av_correo')
    .order('sku');

  if (error) throw new Error('seguimientos: ' + error.message);
  return (data ?? []) as SeguimientoRow[];
}

/**
 * `disponible` y `reservado` de HOY para un conjunto de SKUs, por `derivarSku`.
 *
 * Las cifras van pinneadas al snapshot vigente de stock — sin pinnear, las
 * tablas acumulan una copia por snapshot y los totales salen inflados por el número de snapshots.
 */
export async function leerCifras(db: SupabaseClient, skus: string[]): Promise<Map<string, CifrasAhora>> {
  if (skus.length === 0) return new Map();

  const cifras = await conVigenteStock(db, async (S) => {
    const productos = await enLotes(skus, async (lote) => {
      const { data, error } = await db.from('productos').select('sku,resv').in('sku', lote);
      if (error) throw new Error('productos: ' + error.message);
      return (data ?? []) as { sku: string; resv: number }[];
    });

    // Un lote de 200 SKU trae hasta 200 × 6 almacenes = 1 200 filas: cruza el
    // tope. `stock_por_almacen` NO tiene `id`: su PK es (sku, almacen_id,
    // snapshot_id), y con `snapshot_id` fijo por el filtro, (sku, almacen_id)
    // es único — por eso las DOS columnas. `sku` sola empata entre los
    // almacenes de un SKU, y un empate en el corte de página repite una fila y
    // se salta otra: el `total` de ese SKU saldría mal sin ningún error.
    const stock = await enLotes(skus, async (lote) => {
      const { data, error } = await comoRespuesta(
        fetchAllRows<{ sku: string; cantidad: number }>((from, to) =>
          db
            .from('stock_por_almacen')
            .select('sku,cantidad')
            .eq('snapshot_id', S.id)
            .in('sku', lote)
            .order('sku', { ascending: true })
            .order('almacen_id', { ascending: true })
            .range(from, to),
        ),
      );
      if (error) throw new Error('stock_por_almacen: ' + error.message);
      return data ?? [];
    });

    const porSku = new Map<string, { sku: string; cantidad: number }[]>();
    for (const s of stock) {
      const lista = porSku.get(s.sku);
      if (lista) lista.push(s);
      else porSku.set(s.sku, [s]);
    }

    const salida = new Map<string, CifrasAhora>();
    for (const p of productos) {
      const filas = (porSku.get(p.sku) ?? []) as unknown as StockLectura[];
      const d = derivarSku({ ...p } as unknown as ProductoLectura, filas, [], []);
      salida.set(p.sku, { disponible: d.disponible, reservado: d.reservado });
    }
    return salida;
  });

  // Sin snapshot vigente no hay cifras que dar. No es un error: es un portal
  // recién montado, y la campana degrada a «solo estatus» en vez de romperse.
  return cifras ?? new Map();
}

/**
 * Las filas de `cambios` de la ventana, ya acotadas a lo que le importa a ventas.
 *
 * [INV-B9.1] `hasta` es OPCIONAL y por omisión no acota: la campana mira «desde
 * hace 14 días hasta ahora» y no necesita techo. El correo SÍ: su ventana la
 * decide el llamador (n8n), y sin techo un reintento tardío arrastraría cambios
 * posteriores a la ventana que dijo cubrir — y el registro afirmaría una
 * ventana que no es la que se envió.
 */
export async function leerCambios(
  db: SupabaseClient,
  desde: string,
  skus: string[] | null,
  hasta?: string,
): Promise<CambioCrudo[]> {
  const COLS = 'entidad,campo,tipo,sku,valor_anterior,valor_nuevo,detectado_en,snapshot_id';

  // [FIX-B2] Paginada, y con los filtros DENTRO del closure: cada página es la
  // misma consulta con otro `OFFSET`. Medido (sólo lectura): la
  // ventana de 14 días podía pasar de las 1 000 filas, con muchas filas
  // compartiendo el MISMO `detectado_en` — la ingesta sella con un
  // solo instante todo lo que detecta en una carga. Por eso `detectado_en` a
  // secas no es un orden total, y el corte de página cae dentro de un empate.
  // `id` es la PK de `cambios` (uuid) y cierra el orden.
  const leer = async (lote: string[] | null): Promise<CambioCrudo[]> => {
    const { data, error } = await comoRespuesta(
      fetchAllRows<CambioCrudo>((from, to) => {
        let q = db
          .from('cambios')
          .select(COLS)
          .gte('detectado_en', desde)
          // La taxonomía (`producto|familia`, `descr`, `class`, `marca`) NO es
          // aviso de ventas: son la mayoría de las modificaciones del histórico.
          .in('entidad', ['stock', 'producto', 'embarque']);
        if (hasta) q = q.lte('detectado_en', hasta);
        if (lote) q = q.in('sku', lote);
        return (
          q
            // `detectado_en` ascendente es REQUISITO de `agregarPorSku`: es lo
            // que hace que tres saltos de etapa se lean como uno solo, del
            // primero al último. `id` desempata y vuelve el orden total.
            // Ojo: `id` es un uuid — el desempate es ESTABLE pero no significa
            // nada. Si dos embarques del mismo SKU cambian de etapa en la misma
            // carga, `agregarPorSku` mezcla sus «de → a» (se observó con un SKU
            // real). Deuda `EL-PULSO-AGREGA-POR-SKU-Y-MEZCLA-EMBARQUES`.
            .order('detectado_en', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)
        );
      }),
    );
    if (error) throw new Error('cambios: ' + error.message);
    return data ?? [];
  };

  if (skus === null) return leer(null);

  if (skus.length === 0) return [];

  const filas = await enLotes(skus, leer);
  // El troceo rompe el orden global; se restaura porque `agregarPorSku` lo exige.
  // `sort` es estable (ES2019): cada SKU vive en UN solo lote —los dos
  // llamadores pasan SKU sin repetir: la campana, por la PK (perfil_id, sku) de
  // `seguimientos` bajo su RLS de «sólo los tuyos»; el correo, por su `Set`—,
  // así que sus filas conservan entre sí el orden (detectado_en, id) de su lote.
  return filas.sort((a, b) => a.detectado_en.localeCompare(b.detectado_en));
}

/** Los embarques VIVOS del snapshot vigente de aduana. `is_historial` fuera: ya no están en el pipeline. */
export async function leerEnCamino(db: SupabaseClient): Promise<EmbarqueActivo[]> {
  const vigente = await resolveVigente(db, 'aduana');
  if (!vigente) return [];

  const [{ data: cat, error: errCat }, { data: filas, error: errEmb }] = await Promise.all([
    db.from('estatus_catalogo').select('orden,nombre'),
    // [FIX-B2] Paginada con orden total: `id` es la PK de `embarques` (uuid).
    // Puede no cruzar el tope hoy, pero el `.range(0, 4999)` de antes prometía un margen que
    // PostgREST no da — el día 1 001 se habría cortado sin avisar.
    comoRespuesta(
      fetchAllRows<{ sku: string; piezas: number | null; estatus_id: number }>((from, to) =>
        db
          .from('embarques')
          .select('sku,piezas,estatus_id,is_historial')
          .eq('snapshot_id', vigente.id)
          .eq('is_historial', false)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
  ]);

  if (errCat) throw new Error('estatus_catalogo: ' + errCat.message);
  if (errEmb) throw new Error('embarques: ' + errEmb.message);

  const nombre = new Map<number, string>();
  for (const c of (cat ?? []) as { orden: number; nombre: string }[]) nombre.set(c.orden, c.nombre);

  return (filas ?? []).map((f) => ({
    sku: f.sku,
    piezas: f.piezas,
    etapa: nombre.get(f.estatus_id) ?? null,
  }));
}

// ============================================================
// [CORREO·C-5] EL ESTADO DEL CATÁLOGO **AHORA MISMO** — y por qué no vive en `Pulso`.
//
// `Pulso` es el DELTA de la ventana: qué se movió esta semana. Esto es el
// ESTADO: cuántos SKU tienen piezas hoy. Son dos universos, y meterlos bajo el
// mismo tipo sería exactamente el defecto que el correo acaba de arreglar en su
// cara visible — dos cifras contiguas que el lector cree comparables. La
// separación es estructural, no un rótulo.
//
// SE DERIVA POR `derivarSku`, la única fuente. **No se calcula como
// `total − conReserva`**: medido sobre el vigente, hay SKU con disponible > 0 Y
// reservado > 0 a la vez, así que esa resta los borraba. Tener reserva no
// implica no tener piezas.
//
// COSTO MEDIDO: derivar todo el catálogo es barato. Se paga una vez por corrida del
// boletín, no una por destinatario.
// ============================================================
export interface ResumenCatalogo {
  total: number;
  disponibles: number;
  conReserva: number;
}

export async function leerResumenCatalogo(db: SupabaseClient): Promise<ResumenCatalogo | null> {
  return conVigenteStock(db, async (S) => {
    // PostgREST corta en 1 000 filas SIN error (`.range(0, 4999)` sobre
    // una tabla más grande devuelve 1 000). Paginar no es prudencia: es lo único que hace que
    // el conteo sea el del catálogo y no el de la primera página.
    //
    // [FIX-B2] Antes paginaba un bucle hecho a mano que ordenaba las DOS tablas
    // por `sku` a secas. En `productos` eso es total (`sku` es su PK); en
    // `stock_por_almacen` NO lo es —su PK es (sku, almacen_id, snapshot_id)—, y
    // en cuanto el stock del vigente pasara de 1 000 filas,
    // un SKU partido por el corte de página se contaría con una fila repetida y
    // otra de menos. Ahora las dos van por `fetchAllRows`, cada una con su PK.
    const { data: filasProd, error: errProd } = await comoRespuesta(
      fetchAllRows<{ sku: string; resv: number }>((from, to) =>
        db
          .from('productos')
          .select('sku,resv')
          .eq('snapshot_id', S.id)
          .order('sku', { ascending: true })
          .range(from, to),
      ),
    );
    if (errProd) throw new Error('productos: ' + errProd.message);
    const productos = filasProd ?? [];

    const { data: filasStock, error: errStock } = await comoRespuesta(
      fetchAllRows<{ sku: string; cantidad: number }>((from, to) =>
        db
          .from('stock_por_almacen')
          .select('sku,cantidad')
          .eq('snapshot_id', S.id)
          .order('sku', { ascending: true })
          .order('almacen_id', { ascending: true })
          .range(from, to),
      ),
    );
    if (errStock) throw new Error('stock_por_almacen: ' + errStock.message);
    const stock = filasStock ?? [];

    const porSku = new Map<string, { sku: string; cantidad: number }[]>();
    for (const s of stock) {
      const lista = porSku.get(s.sku);
      if (lista) lista.push(s);
      else porSku.set(s.sku, [s]);
    }

    let disponibles = 0;
    let conReserva = 0;
    for (const p of productos) {
      const filas = (porSku.get(p.sku) ?? []) as unknown as StockLectura[];
      const d = derivarSku({ ...p } as unknown as ProductoLectura, filas, [], []);
      if (d.disponible > 0) disponibles++;
      if (d.reservado > 0) conReserva++;
    }
    return { total: productos.length, disponibles, conReserva };
  });
}

/**
 * [CORREO·C-5] `nombre de etapa → orden`.
 *
 * Es lo ÚNICO que permite decir si un SKU avanzó o volvió atrás: `Aviso.de`/`.a`
 * son NOMBRES, no números. `leerEnCamino` ya lee esta tabla pero se queda con el
 * mapa al revés y lo descarta; aquí se lee para el correo, que necesita el
 * sentido y no el nombre. Son 11 filas.
 */
export async function leerOrdenEtapas(db: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await db.from('estatus_catalogo').select('orden,nombre');
  if (error) throw new Error('estatus_catalogo: ' + error.message);
  const orden = new Map<string, number>();
  for (const c of (data ?? []) as { orden: number; nombre: string }[]) orden.set(c.nombre, c.orden);
  return orden;
}

/** Última carga de cada fuente. Es la línea que contesta «¿por qué no he visto nada?». */
export async function leerUltimasCargas(db: SupabaseClient): Promise<{ fuente: string; ultima: string | null }[]> {
  const [stock, aduana] = await Promise.all([resolveVigente(db, 'stock'), resolveVigente(db, 'aduana')]);
  return [
    { fuente: 'stock', ultima: stock?.created_at ?? null },
    { fuente: 'aduana', ultima: aduana?.created_at ?? null },
  ];
}

/**
 * Todo lo que la campana enseña, en una sola lectura.
 *
 * `esAdmin` solo decide si se puebla `calladas`. **No amplía nada más**: un
 * admin ve exactamente los mismos avisos que un KAM —los suyos—, porque lo que
 * una persona sigue es su configuración y la RLS ni siquiera se lo enseñaría.
 *
 * `ahora` se inyecta para que la línea de fuentes calladas sea probable sin
 * depender del día en que corra la suite.
 */
export async function construirCampana(
  db: SupabaseClient,
  opciones: { esAdmin: boolean; ahora: Date; correoCallado?: CanalCallado | null },
): Promise<CampanaDTO> {
  const desde = new Date(opciones.ahora.getTime() - DIAS_VENTANA * 86_400_000).toISOString();

  const [preferencias, seguimientos, enCamino, ultimas] = await Promise.all([
    leerPreferencias(db),
    leerSeguimientos(db),
    leerEnCamino(db),
    leerUltimasCargas(db),
  ]);

  const misSkus = seguimientos.map((s) => s.sku);

  // Dos lecturas de `cambios` y no una: la del pulso es GLOBAL (le llega a
  // todos, nadie la suscribe) y la de avisos está acotada a los SKU seguidos.
  // Traer todo y filtrar en memoria haría que el pulso pagara el precio de la
  // lista de cada persona.
  const [cambiosGlobales, cambiosMios] = await Promise.all([
    leerCambios(db, desde, null),
    leerCambios(db, desde, misSkus),
  ]);

  // Candidatos a «llegada» para el pulso: solo los SKU con movimiento de
  // stock en la ventana. Derivar el catálogo entero en cada apertura de la campana sería
  // pagarlo completo por contar unas pocas llegadas al mes.
  const candidatos = new Set<string>();
  for (const c of cambiosGlobales) if (c.entidad === 'stock' && c.sku) candidatos.add(c.sku);
  for (const s of misSkus) candidatos.add(s);

  const cifras = await leerCifras(db, Array.from(candidatos));

  const avisos = derivarAvisos(seguimientos, cambiosMios, cifras);
  const pulso = derivarPulso(cambiosGlobales, enCamino, cifras);

  const marca = preferencias.visto_hasta;
  const nuevos = marca === null ? avisos.length : avisos.filter((a) => a.detectado_en > marca).length;

  return {
    pulso,
    avisos,
    nuevos,
    seguidos: seguimientos.length,
    preferencias,
    ultimas,
    calladas: opciones.esAdmin ? fuentesCalladas(ultimas, opciones.ahora) : [],
    // [INV-B9.1] Llega YA CALCULADO desde la ruta, y no se lee aquí a
    // propósito: `envios_aviso` no tiene ninguna policy, así que leerla exige
    // la llave de servicio. Esa escalada vive en el route handler, pegada a
    // donde se decide el rol, en vez de escondida dentro de un servicio que
    // por lo demás corre con la sesión del usuario.
    correoCallado: opciones.esAdmin ? (opciones.correoCallado ?? null) : null,
  };
}

// ------------------------------------------------------------
// ESCRITURAS
// ------------------------------------------------------------

/** Error de dominio del seguimiento, traducido a HTTP por la ruta. Mismo molde que `ProyectoError`. */
export type CodigoAvisoError = 'sku_no_encontrado' | 'demasiados_seguimientos' | 'sin_avisos';

export class AvisoError extends Error {
  readonly codigo: CodigoAvisoError;

  // El campo se declara y se asigna a mano, sin propiedad de parámetro: el
  // type-stripping nativo de Node no soporta esa sintaxis y cualquier script
  // que importe este archivo moriría con ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
  // Medido en INV-B8 con `ProyectoError`.
  constructor(codigo: CodigoAvisoError) {
    super(codigo);
    this.name = 'AvisoError';
    this.codigo = codigo;
  }
}

/**
 * Sigue un SKU, o cambia qué se quiere saber de él si ya se seguía.
 *
 * **Es idempotente por construcción**, y no por código: la PK compuesta
 * `(perfil_id, sku)` de la 0026 hace que el `upsert` no pueda crear una
 * segunda fila. Es la misma lección del volcado de B8.2 resuelta un nivel más
 * abajo — donde no se puede olvidar de aplicarla.
 *
 * Si `avisos` no viene, se aplican las preferencias del perfil. Ése es el
 * camino normal: «usar esto para los siguientes» está marcado por omisión.
 */
export async function seguirSku(
  db: SupabaseClient,
  perfilId: string,
  input: {
    sku: string;
    avisos?: { av_estatus: boolean; av_disponible: boolean; av_reservado: boolean; av_llegada: boolean };
    av_correo?: boolean;
  },
  maxSeguimientos: number,
): Promise<void> {
  const avisos = input.avisos ?? (await leerPreferencias(db));

  if (!(avisos.av_estatus || avisos.av_disponible || avisos.av_reservado || avisos.av_llegada)) {
    throw new AvisoError('sin_avisos');
  }

  // El tope solo se comprueba si la fila es NUEVA: cambiar los avisos de un
  // SKU que ya se sigue no hace crecer nada. Mismo razonamiento que el tope de
  // renglones del volcado.
  const { data: yaEsta, error: errLee } = await db
    .from('seguimientos')
    .select('sku,av_correo')
    .eq('sku', input.sku)
    .maybeSingle();
  if (errLee) throw new Error('seguimientos: ' + errLee.message);

  if (!yaEsta) {
    const { count, error: errCount } = await db.from('seguimientos').select('sku', { count: 'exact', head: true });
    if (errCount) throw new Error('seguimientos: ' + errCount.message);
    if ((count ?? 0) >= maxSeguimientos) throw new AvisoError('demasiados_seguimientos');
  }

  const { error } = await db.from('seguimientos').upsert(
    {
      perfil_id: perfilId,
      sku: input.sku,
      av_estatus: avisos.av_estatus,
      av_disponible: avisos.av_disponible,
      av_reservado: avisos.av_reservado,
      av_llegada: avisos.av_llegada,
      // Ausente ⇒ se CONSERVA lo que hubiera. Un upsert que lo pusiera en
      // `false` por omisión apagaría el correo de un SKU cada vez que alguien
      // toca sus avisos desde otra superficie — un apagado silencioso.
      av_correo: input.av_correo ?? (yaEsta as { av_correo?: boolean } | null)?.av_correo ?? false,
    },
    { onConflict: 'perfil_id,sku' },
  );

  if (error) {
    // 23503 aquí solo puede ser la FK contra `productos`: el perfil viene de
    // la sesión. Un SKU inventado se dice por su nombre, no con un 500.
    if (error.code === '23503') throw new AvisoError('sku_no_encontrado');
    if (error.code === '23514') throw new AvisoError('sin_avisos');
    throw new Error('seguimientos: ' + error.message);
  }
}

/**
 * Deja de seguir un SKU.
 *
 * `.select('sku')` no es adorno: un DELETE que la RLS filtró se ve EXACTAMENTE
 * igual que uno que borró la fila —ambos «sin error»— y la interfaz
 * confirmaría un borrado que no ocurrió. Misma lección que `quitarPartida`.
 * Aquí, además, borrar algo que ya no estaba **no es un error**: dejar de
 * seguir dos veces tiene que dar el mismo resultado que hacerlo una.
 */
export async function dejarDeSeguir(db: SupabaseClient, sku: string): Promise<boolean> {
  const { data, error } = await db.from('seguimientos').delete().eq('sku', sku).select('sku').maybeSingle();
  if (error) throw new Error('seguimientos: ' + error.message);
  return data !== null;
}

/**
 * Guarda preferencias. `marcar_visto` mueve la MARCA DE AGUA, y **la hora la
 * pone el servidor**: si el cliente propusiera el instante, podría silenciarse
 * con una marca en el futuro.
 *
 * La fila nace perezosa, así que esto es un `upsert` que mezcla sobre lo que
 * haya —o sobre los valores por omisión si es la primera vez.
 */
export async function guardarPreferencias(
  db: SupabaseClient,
  perfilId: string,
  parche: Partial<Omit<PreferenciasAvisos, 'visto_hasta'>> & { marcar_visto?: true },
  ahora: Date,
): Promise<PreferenciasAvisos> {
  const actuales = await leerPreferencias(db);
  const { marcar_visto, ...avisos } = parche;

  const fila = {
    perfil_id: perfilId,
    av_estatus: avisos.av_estatus ?? actuales.av_estatus,
    av_disponible: avisos.av_disponible ?? actuales.av_disponible,
    av_reservado: avisos.av_reservado ?? actuales.av_reservado,
    av_llegada: avisos.av_llegada ?? actuales.av_llegada,
    preguntar_por_sku: avisos.preguntar_por_sku ?? actuales.preguntar_por_sku,
    // [INV-B9.1] Ausente ⇒ se conserva. Igual que `av_correo` en `seguirSku`:
    // ningún PATCH que hable de otra cosa puede apagarle el boletín a nadie.
    boletin_correo: avisos.boletin_correo ?? actuales.boletin_correo,
    visto_hasta: marcar_visto ? ahora.toISOString() : actuales.visto_hasta,
    actualizado_en: ahora.toISOString(),
  };

  const { data, error } = await db
    .from('preferencias_notificacion')
    .upsert(fila, { onConflict: 'perfil_id' })
    .select('av_estatus,av_disponible,av_reservado,av_llegada,preguntar_por_sku,visto_hasta,boletin_correo')
    .single();

  if (error) {
    if (error.code === '23514') throw new AvisoError('sin_avisos');
    throw new Error('preferencias_notificacion: ' + error.message);
  }
  return data as PreferenciasAvisos;
}

export type { Aviso, Pulso, FuenteCallada };
