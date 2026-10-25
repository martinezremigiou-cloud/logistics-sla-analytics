// ============================================================
// [INV-B11] O4 · La recuperación, y su NEGATIVA EXPLÍCITA.
//
// LO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR. Tres situaciones que hoy darían la
// misma respuesta y **no son la misma cosa**:
//
//     «no hay ficha para este producto»   ← el caso honesto
//     «el índice está vacío»              ← no se ha corrido la sincronización
//     «la búsqueda falló»                 ← error de infraestructura
//
// Las tres se leerían como *«ese producto no está documentado»*, y en dos de
// ellas **el problema es nuestro**. Es el mismo error que B10 arregló con el
// fallo de transporte del chat, un frente más adelante — y la lección que se
// pagó allí es la que justifica el trabajo de aquí:
//
//     Un fallo con la cara correcta se arregla en un minuto.
//     Con la cara equivocada, en horas.
//
// ────────────────────────────────────────────────────────────
// EL ORDEN ES LA REGLA, y es lo que la vuelve barata:
//
//   1. ¿el índice tiene con qué contestar?   NO → «corpus no cargado». PARA.
//   2. ¿la consulta respondió?               NO → «no pude consultar». PARA.
//   3. ¿la familia tiene ficha?              NO → «no tengo ficha de este producto»
//
// Los tres son comprobables **por construcción**, no por prompt: el conteo se
// sabe, el fallo devuelve `error`, y la ausencia en el puente es un `null`.
// **En ningún caso se dice «no tengo ficha» sin haber pasado antes por 1 y 2.**
//
// ────────────────────────────────────────────────────────────
// `N` FICHAS ES IRREPRESENTABLE, y por eso no se maneja.
//
// El brief pedía el caso `0 / 1 / N`. Con el puente teniendo `familia_id` de
// clave primaria, **una familia tiene como mucho una ficha**: el `N` no se
// resuelve, no puede ocurrir. Manejar un caso imposible habría dejado una rama
// que ninguna prueba puede alcanzar — y una rama inalcanzable es P24 esperando.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatosFrescura } from '@/lib/corpus/frescura';

/**
 * El resultado, y **cada variante es una verdad distinta**. Colapsarlas en un
 * `string | null` es exactamente lo que este archivo evita.
 */
export type ResultadoFicha =
  // ── Problemas NUESTROS. Nunca se disfrazan de dato. ──
  /** No hay nada indexado. Decir «no tengo ficha» aquí sería culpar al corpus. */
  | { tipo: 'corpus_vacio' }
  /** La consulta falló. No es que no supiéramos: no pudimos preguntar. */
  | { tipo: 'fallo_consulta'; detalle: string }
  /**
   * El puente apunta a una ficha que **ya no está en el corpus**.
   *
   * Existe porque `ficha_ruta` no lleva clave foránea, y eso es deliberado
   * (ver `0031`): con `ON DELETE SET NULL` esto se habría vuelto un «no tengo
   * ficha» impecable, y el problema real —que alguien borró el archivo— sería
   * invisible.
   */
  | { tipo: 'puente_colgante'; sku: string | null; familia: string; ruta: string }

  // ── Datos honestos. El sistema funciona y la respuesta es que no hay. ──
  /** El SKU no existe en el catálogo. */
  | { tipo: 'sku_desconocido'; sku: string }
  /** El SKU no tiene familia asignada. Es calidad del Excel. */
  | { tipo: 'sin_familia'; sku: string }
  /** Nadie ha mapeado esa familia todavía. **Es un hueco NUESTRO, y se dice.** */
  | { tipo: 'sin_puente'; sku: string | null; familia: string }
  /** Un humano revisó y confirmó que esa familia no tiene ficha. */
  | { tipo: 'sin_ficha_confirmado'; sku: string | null; familia: string; notas: string | null }

  // ── La ficha ──
  | {
      tipo: 'ficha';
      /**
       * `null` = **se llegó por el NOMBRE DE LA FAMILIA**, no por un SKU
       * (puerta 2). No es un hueco: es de dónde vino la pregunta, y la
       * respuesta es la misma ficha.
       */
      sku: string | null;
      familia: string;
      ruta: string;
      titulo: string | null;
      /**
       * `null` significa **«sin PDF de origen»**, y la respuesta tiene que
       * decirlo. Medido: alguna ficha no lo declara. Omitir la cita en
       * silencio se lee como «no hay nada que citar».
       */
      fuentePdf: string | null;
      /** El commit del que se leyó. `local-sin-git` = procedencia no verificable. */
      commitSha: string;
      /** Revisado por un humano, o propuesta automática todavía sin revisar. */
      revisada: boolean;
      trozos: { orden: number; rutaSeccion: string; texto: string; tieneTabla: boolean }[];
    };

/**
 * Busca la ficha que corresponde a un SKU.
 *
 * `db` puede ser el cliente de SESIÓN: el corpus es documentación COMPARTIDA,
 * no dato de nadie. Pero `corpus_*` tiene RLS con cero policies, así que hoy
 * solo la llave de servicio llega — la función `SECURITY DEFINER` que abra el
 * acceso a `authenticated` es trabajo de la ruta, no de aquí.
 */
export async function recuperarFicha(db: SupabaseClient, skuCrudo: string): Promise<ResultadoFicha> {
  const sku = skuCrudo.trim().toUpperCase();

  // ---------- (1) ¿Hay con qué contestar? ----------
  // Se cuentan TROZOS y no documentos: hay documentos indexados con cero
  // trozos a propósito (los excluidos), así que «hay documentos» no implica
  // «hay algo que contestar». Contar lo que no se usa daría un falso lleno.
  const { count: trozos, error: errConteo } = await db
    .from('corpus_trozos')
    .select('id', { count: 'exact', head: true });
  if (errConteo) return { tipo: 'fallo_consulta', detalle: 'conteo del índice: ' + errConteo.message };
  if (!trozos || trozos === 0) return { tipo: 'corpus_vacio' };

  // ---------- (2) y (3) ----------
  const { data: prod, error: errProd } = await db
    .from('productos')
    .select('sku,familia_id')
    .eq('sku', sku)
    .maybeSingle();
  if (errProd) return { tipo: 'fallo_consulta', detalle: 'productos: ' + errProd.message };
  if (!prod) return { tipo: 'sku_desconocido', sku };
  if (!prod.familia_id) return { tipo: 'sin_familia', sku };

  const { data: fam, error: errFam } = await db
    .from('familias')
    .select('id,nombre')
    .eq('id', prod.familia_id)
    .maybeSingle();
  if (errFam) return { tipo: 'fallo_consulta', detalle: 'familias: ' + errFam.message };
  const familia = fam?.nombre ? String(fam.nombre) : '(sin nombre)';

  return desdeFamilia(db, prod.familia_id, familia, sku);
}

/**
 * [INV-B11] O6 · EL TRAMO `familia → puente → ficha`, con DOS entradas.
 *
 * Se extrajo tal cual de `recuperarFicha`: es exactamente el mismo camino, y
 * **eso es lo que hace barata la puerta 2**. La otra entrada —por el nombre de
 * la familia— no reimplementa nada, entra un escalón más abajo.
 *
 * `sku` es solo la ETIQUETA de por dónde se entró. `null` cuando se llegó por
 * el nombre. Ninguno de los cuatro estados que produce este tramo usa el SKU
 * para redactar su mensaje —todos hablan de la FAMILIA—, y por eso el campo
 * pudo volverse opcional sin tocar un solo texto.
 */
async function desdeFamilia(
  db: SupabaseClient,
  familiaId: unknown,
  familia: string,
  sku: string | null,
): Promise<ResultadoFicha> {
  const { data: puente, error: errPuente } = await db
    .from('corpus_familia_ficha')
    .select('ficha_ruta,revisado_en,notas')
    .eq('familia_id', familiaId as string)
    .maybeSingle();
  if (errPuente) return { tipo: 'fallo_consulta', detalle: 'puente: ' + errPuente.message };

  // Sin renglón: nadie lo ha mirado. **No es lo mismo que «no hay ficha»**, y
  // la diferencia es de quién es el hueco.
  if (!puente) return { tipo: 'sin_puente', sku, familia };

  if (!puente.ficha_ruta) {
    // Renglón sin ruta pero con revisión: un humano confirmó que no hay ficha.
    // El CHECK de la 0031 garantiza que no puede estar sin ruta Y sin revisar.
    return { tipo: 'sin_ficha_confirmado', sku, familia, notas: puente.notas ? String(puente.notas) : null };
  }

  const ruta = String(puente.ficha_ruta);
  const { data: doc, error: errDoc } = await db
    .from('corpus_documentos')
    .select('ruta,titulo,fuente_pdf,commit_sha')
    .eq('ruta', ruta)
    .maybeSingle();
  if (errDoc) return { tipo: 'fallo_consulta', detalle: 'documento: ' + errDoc.message };

  // El puente apunta a algo que ya no existe. Esto NO se degrada a «no tengo
  // ficha»: es un estado propio porque su causa es otra y su arreglo también.
  if (!doc) return { tipo: 'puente_colgante', sku, familia, ruta };

  const { data: filas, error: errTrozos } = await db
    .from('corpus_trozos')
    .select('orden,ruta_seccion,texto,tiene_tabla')
    .eq('ruta', ruta)
    .order('orden');
  if (errTrozos) return { tipo: 'fallo_consulta', detalle: 'trozos: ' + errTrozos.message };

  // Documento sin trozos: está en el índice pero fue EXCLUIDO por las tres
  // reglas. Que el puente apunte a un excluido es un error de mapeo, no una
  // ficha vacía — y se reporta como colgante, que es lo que es: apunta a algo
  // que no puede contestar.
  if (!filas || filas.length === 0) return { tipo: 'puente_colgante', sku, familia, ruta };

  return {
    tipo: 'ficha',
    sku,
    familia,
    ruta,
    titulo: doc.titulo ? String(doc.titulo) : null,
    fuentePdf: doc.fuente_pdf ? String(doc.fuente_pdf) : null,
    commitSha: String(doc.commit_sha),
    revisada: Boolean(puente.revisado_en),
    trozos: filas.map((f) => ({
      orden: Number(f.orden),
      rutaSeccion: String(f.ruta_seccion),
      texto: String(f.texto),
      tieneTabla: Boolean(f.tiene_tabla),
    })),
  };
}

/**
 * [INV-B11] O6 · PUERTA 2 — la ficha por el NOMBRE DE LA FAMILIA.
 *
 * EL HUECO QUE CIERRA, medido: de los documentos con trozos, **solo una
 * minoría era alcanzable**. El resto estaba indexado y mudo, porque
 * el único camino a una ficha pasaba por un SKU. Y la relación real es al
 * revés de como estaba construida: **la ficha es del PRODUCTO, no del SKU** —
 * así se planteó, *«todo Series2 48 hasta Series2 QR viene del mismo énfasis
 * de ficha»*—, así que obligar a saberse un código para preguntar por un
 * producto invierte la relación.
 *
 * Y NO HIZO FALTA TOCAR EL MODELO. Medido con la sonda
 * (una sonda contra el modelo): las preguntas por nombre de familia
 * ya salían `documental` con el nombre en `termino`. El modelo llevaba tiempo
 * haciendo su parte; lo que faltaba era que el servicio, antes de buscar SKU,
 * mirara si ese término **es** una familia.
 *
 * Devuelve `null` —y no un estado— cuando el término NO es una familia. Es la
 * señal de «esto no es lo mío, sigue por el camino del SKU», y tiene que ser
 * distinguible de «es una familia y no tiene ficha», que sí es un estado.
 */
export async function recuperarFichaPorFamilia(
  db: SupabaseClient,
  nombreCrudo: string,
): Promise<ResultadoFicha | null> {
  const nombre = nombreCrudo.trim();
  if (!nombre) return null;

  // Se limitan DOS y no uno: si dos familias comparten nombre, el nombre no
  // alcanza para decidir y hay que seguir por el SKU. Traer una sola con
  // `limit(1)` elegiría en silencio, que es adivinar.
  const { data: fams, error: errFam } = await db.from('familias').select('id,nombre').ilike('nombre', nombre).limit(2);
  if (errFam) return { tipo: 'fallo_consulta', detalle: 'familias por nombre: ' + errFam.message };
  if (!fams || fams.length !== 1) return null;

  // El conteo del índice va DESPUÉS de saber que sí es una familia: contarlo
  // antes cobraría una consulta a cada término que no lo es.
  const { count: trozos, error: errConteo } = await db
    .from('corpus_trozos')
    .select('id', { count: 'exact', head: true });
  if (errConteo) return { tipo: 'fallo_consulta', detalle: 'conteo del índice: ' + errConteo.message };
  if (!trozos || trozos === 0) return { tipo: 'corpus_vacio' };

  return desdeFamilia(db, fams[0].id, String(fams[0].nombre), null);
}

/**
 * [INV-B11] O6 · PUERTA 3 — un hallazgo del corpus, ya agrupado por documento.
 *
 * Se agrupa **por documento y no por trozo** porque un trozo suelto no se puede
 * citar: la cita es el PDF del documento, y tres trozos del mismo archivo son
 * una respuesta, no tres.
 */
export interface DocHallado {
  ruta: string;
  titulo: string | null;
  fuentePdf: string | null;
  /**
   * [CHAT-B1] Cuántos trozos tiene el documento ENTERO, no cuántos casaron.
   *
   * Hace falta porque `armarEntrega()` deriva `camino` comparando lo que viaja
   * con el total: sin este número, unos fragmentos sueltos se declararían
   * «completo», que es exactamente la mentira que `camino` existe para impedir.
   */
  trozosTotales: number;
  /** El mejor `ts_rank` de sus trozos. Es por lo que se ordenan los documentos. */
  rango: number;
  /** Los fragmentos que casaron, en el orden en que los rankeó Postgres. */
  fragmentos: { seccion: string; texto: string }[];
}

/**
 * El resultado de buscar. **Cuatro estados, y ninguno se colapsa** — el mismo
 * criterio que gobierna `ResultadoFicha` desde O4.
 *
 * `sin_hallazgos` NO es `corpus_vacio`: uno dice «busqué y no hay», el otro
 * dice «no tengo nada donde buscar». Es un pendiente nuestro contra un hecho
 * sobre la pregunta, y la regla del bloque —cero y no-medido son valores
 * distintos— exige que se digan aparte.
 */
export type ResultadoBusquedaCorpus =
  | { tipo: 'fallo_consulta'; detalle: string }
  | { tipo: 'corpus_vacio' }
  | { tipo: 'sin_hallazgos'; consulta: string }
  | { tipo: 'hallazgos'; consulta: string; docs: DocHallado[] };

/** Cuántos trozos pide al motor. Más arriba solo agrega ruido con peor rango. */
const TOPE_TROZOS = 12;
/** Cuántos documentos se enseñan. Cuatro caben en una tarjeta sin volverla una lista. */
const TOPE_DOCS = 4;
/** Cuántos fragmentos por documento. Uno solo suele cortar la frase que importaba. */
const TOPE_FRAGMENTOS = 2;

/**
 * [INV-B11] O6 · PUERTA 3 — buscar DENTRO del corpus, sin pasar por familia.
 *
 * EL HUECO QUE CIERRA, medido: de los documentos con trozos, **más de la mitad** no
 * son alcanzables ni por SKU ni por nombre de familia. Y no les falta un
 * renglón en el puente: **no son fichas de familia**. Son el glosario, el mapa
 * del vault, el índice de clientes, la ficha de la empresa. Ningún puente los
 * va a alcanzar nunca porque el puente va de familia a ficha.
 *
 * NO DERIVA EL RANKING AQUÍ. `buscar_corpus` ordena por `ts_rank` en Postgres
 * (migración 0033) y esta función solo agrupa. Rankear en TypeScript habría
 * sido escribir una segunda implementación de algo que la base ya tiene —
 * exactamente lo que `derivarSku` existe para no volver a hacer.
 *
 * Y es LÉXICA, no vectorial, por decisión de producto en el avance 5: así el corpus
 * **no sale del perímetro** para poder consultarse. El precio, dicho: no
 * encuentra sinónimos.
 */
export async function buscarEnCorpus(db: SupabaseClient, consultaCruda: string): Promise<ResultadoBusquedaCorpus> {
  const consulta = consultaCruda.trim();
  if (!consulta) return { tipo: 'sin_hallazgos', consulta };

  const { data: filas, error } = await db.rpc('buscar_corpus', { consulta, tope: TOPE_TROZOS });
  if (error) return { tipo: 'fallo_consulta', detalle: 'busqueda: ' + error.message };

  if (!filas || filas.length === 0) {
    // DISTINGUIR «no hay dónde buscar» de «busqué y no hay». Cuesta una
    // consulta y sin ella el usuario oiría «no encontré nada sobre eso»
    // cuando la verdad es que nadie ha cargado el corpus todavía.
    const { count, error: errConteo } = await db.from('corpus_trozos').select('id', { count: 'exact', head: true });
    if (errConteo) return { tipo: 'fallo_consulta', detalle: 'conteo del índice: ' + errConteo.message };
    if (!count || count === 0) return { tipo: 'corpus_vacio' };
    return { tipo: 'sin_hallazgos', consulta };
  }

  // ── Agrupar por documento, conservando el orden del motor ──
  const porRuta = new Map<string, DocHallado>();
  for (const f of filas as { ruta: string; seccion: string; texto: string; rango: number }[]) {
    const previo = porRuta.get(f.ruta);
    if (previo) {
      if (previo.fragmentos.length < TOPE_FRAGMENTOS) previo.fragmentos.push({ seccion: f.seccion, texto: f.texto });
      continue;
    }
    porRuta.set(f.ruta, {
      ruta: f.ruta,
      titulo: null,
      fuentePdf: null,
      rango: Number(f.rango),
      trozosTotales: 0, // se llena abajo, con una lectura propia
      fragmentos: [{ seccion: f.seccion, texto: f.texto }],
    });
  }

  const docs = Array.from(porRuta.values()).slice(0, TOPE_DOCS);

  // LA CITA. Se lee `corpus_documentos` para el título y el PDF: sin eso la
  // respuesta sería texto sin procedencia, que es lo que la regla #1 prohíbe.
  const { data: metadatos, error: errDoc } = await db
    .from('corpus_documentos')
    .select('ruta,titulo,fuente_pdf')
    .in('ruta', docs.map((d) => d.ruta));
  if (errDoc) return { tipo: 'fallo_consulta', detalle: 'documentos: ' + errDoc.message };

  const meta = new Map((metadatos ?? []).map((m) => [String(m.ruta), m]));
  for (const d of docs) {
    const m = meta.get(d.ruta);
    d.titulo = m?.titulo ? String(m.titulo) : null;
    d.fuentePdf = m?.fuente_pdf ? String(m.fuente_pdf) : null;
  }

  // [CHAT-B1] CUÁNTOS TROZOS TIENE CADA DOCUMENTO ENTERO.
  //
  // Se piden sólo los `id` de como mucho unos pocos documentos, así que son pocas filas
  // sin texto: la lectura es barata y evita cuatro conteos por separado.
  //
  // Si falla NO se tumba la búsqueda —los hallazgos siguen siendo verdad—, y el
  // respaldo es `fragmentos.length + 1` A PROPÓSITO: un documento del que no
  // sabemos el total se declara PARCIAL. La alternativa (usar `fragmentos.length`)
  // lo habría declarado completo, que es justo la mentira que `camino` existe
  // para impedir. Ante la duda, el camino se declara por encima.
  const { data: conteos } = await db
    .from('corpus_trozos')
    .select('id,ruta')
    .in('ruta', docs.map((d) => d.ruta));
  const totales = new Map<string, number>();
  for (const c of conteos ?? []) {
    const r = String((c as { ruta: string }).ruta);
    totales.set(r, (totales.get(r) ?? 0) + 1);
  }
  for (const d of docs) {
    d.trozosTotales = totales.get(d.ruta) ?? d.fragmentos.length + 1;
  }

  return { tipo: 'hallazgos', consulta, docs };
}

/**
 * [INV-B11] O7 · Lo que hace falta para el testigo de frescura.
 *
 * **Cuatro lecturas y ninguna derivación.** Qué significan los dos instantes
 * juntos lo decide `src/lib/corpus/frescura.ts`, que es puro y se prueba sin
 * base — ahí es donde se distinguen los dos silencios, y ese es el sitio que
 * tiene que poder probarse.
 *
 * `ultimoIntento` sale de `corpus_sync_intentos`, que la `0030` escribe **al
 * EMPEZAR**. Es lo único que permite decir «se revisó y no había nada nuevo»
 * en vez de dejar al lector adivinando — la deuda B10-3 resuelta en el sitio
 * donde sí se podía.
 */
export async function leerFrescura(db: SupabaseClient): Promise<DatosFrescura> {
  const [docs, trozos, ultimo, intento] = await Promise.all([
    db.from('corpus_documentos').select('ruta', { count: 'exact', head: true }),
    db.from('corpus_trozos').select('id', { count: 'exact', head: true }),
    db.from('corpus_documentos').select('indexado_en,commit_sha').order('indexado_en', { ascending: false }).limit(1),
    db
      .from('corpus_sync_intentos')
      .select('iniciado_en,resultado,motivo')
      .order('iniciado_en', { ascending: false })
      .limit(1),
  ]);

  // Un error de lectura NO se disfraza de corpus vacío. Que la consulta falle y
  // que no haya nada son cosas distintas, y colapsarlas aquí sería el mismo
  // defecto que O4 existe para no cometer.
  if (docs.error) throw new Error('corpus_documentos: ' + docs.error.message);
  if (trozos.error) throw new Error('corpus_trozos: ' + trozos.error.message);
  if (ultimo.error) throw new Error('ultimo documento: ' + ultimo.error.message);
  if (intento.error) throw new Error('corpus_sync_intentos: ' + intento.error.message);

  const u = ultimo.data?.[0];
  const i = intento.data?.[0];

  return {
    documentos: docs.count ?? 0,
    trozos: trozos.count ?? 0,
    version: u?.commit_sha ? String(u.commit_sha) : null,
    ultimoCambio: u?.indexado_en ? String(u.indexado_en) : null,
    ultimoIntento: i?.iniciado_en ? String(i.iniciado_en) : null,
    ultimoResultado: i?.resultado ? String(i.resultado) : null,
    motivo: i?.motivo ? String(i.motivo) : null,
  };
}

/**
 * ¿La causa es NUESTRA?
 *
 * Existe porque un test de «los mensajes no se repiten» resultó más débil de lo
 * que parecía: comparaba cadenas exactas, así que **un colapso semántico se le
 * escapaba** —cambiar el mensaje de `fallo_consulta` a «no tengo ficha de este
 * producto» lo pasaba sin ruido—.
 *
 * Así que la distinción deja de vivir solo en la redacción y pasa a ser un
 * dato. La interfaz puede tratarlos distinto sin releer el texto, y la prueba
 * comprueba una propiedad en vez de una cadena.
 *
 * **Los tres de arriba son fallas nuestras y no hechos del catálogo.** Un
 * usuario que reciba uno no debe concluir que su producto no está documentado.
 */
export function causaNuestra(r: ResultadoFicha): boolean {
  return r.tipo === 'corpus_vacio' || r.tipo === 'fallo_consulta' || r.tipo === 'puente_colgante' || r.tipo === 'sin_puente';
}

/**
 * El texto que se le puede enseñar al usuario, por estado.
 *
 * **Vive junto al tipo y no en el componente**, por el mismo motivo que las
 * sugerencias del chat viven dentro del catálogo de intenciones: un estado sin
 * mensaje sería irrepresentable, y añadir un estado obliga a escribir su
 * mensaje en el mismo commit.
 */
export function mensajeDe(r: ResultadoFicha): string {
  switch (r.tipo) {
    case 'corpus_vacio':
      return 'Todavía no tengo cargada la documentación de productos. Es un pendiente nuestro, no que falte la ficha.';
    case 'fallo_consulta':
      return 'No pude consultar la documentación en este momento. Vuelve a intentarlo.';
    case 'puente_colgante':
      return `La ficha que tenía asociada a «${r.familia}» ya no está en la documentación. Es un pendiente nuestro; avisa para reasignarla.`;
    case 'sku_desconocido':
      return `No encuentro ningún SKU que se llame «${r.sku}».`;
    case 'sin_familia':
      return `El SKU ${r.sku} no tiene familia asignada, así que no puedo saber qué ficha le toca.`;
    case 'sin_puente':
      return `Todavía no tengo asociada una ficha a la familia «${r.familia}». Es un pendiente nuestro.`;
    case 'sin_ficha_confirmado':
      return `La familia «${r.familia}» no tiene ficha de producto.`;
    case 'ficha':
      return r.fuentePdf
        ? `Según la ficha de ${r.titulo ?? r.familia} (${r.fuentePdf})`
        : `Según la ficha de ${r.titulo ?? r.familia} (sin PDF de origen)`;
  }
}
