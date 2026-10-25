// ============================================================
// [INV-B11] services/corpus.service.ts — la sincronización del corpus.
//
// EL ORDEN DE ESTE ARCHIVO ES SU CONTENIDO. No es una lista de pasos que
// podrían ir en otro orden: **cada uno está donde está porque moverlo rompe una
// garantía**, y dos de esas garantías se fijaron por escrito.
//
//    1. el INTENTO se registra al EMPEZAR      ← si se registrara al final,
//                                                 una corrida que muere a medias
//                                                 no dejaría rastro y «murió»
//                                                 volvería a ser indistinguible
//                                                 de «no corrió» (B10-3)
//    2. manifiesto COMPLETO
//    3. diff
//    4. ¿borrado masivo? → se detiene ANTES de tocar nada
//    5. se LEE lo que va a indexarse
//    6. ★ LA PARADA ANTE SECRETO — sobre el LOTE ENTERO
//    7. ────────── de aquí para abajo SÍ sale texto del perímetro ──────────
//    8. trocear · embeber
//    9. escribir
//   10. cerrar el intento
//
// EL PASO 6 ES UNA CONDICIÓN DE PRODUCTO, y la forma importa tanto como el hecho:
// se revisa **el lote entero**, no archivo por archivo. Un bucle
// «revisar → mandar → revisar → mandar» manda los N−1 primeros antes de
// descubrir el secreto del N-ésimo. Por eso `revisarLote` recibe una lista:
// **la firma impide llamarlo tarde.**
//
// Es el mismo razonamiento de orden que en B10 —el techo se cobra ANTES de
// llamar al modelo, porque después ya se gastó— aplicado a algo que no se puede
// deshacer: un texto enviado no se des-envía.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ SE GUARDAN TODOS LOS DOCUMENTOS Y NO SOLO LOS QUE SE EMBEBEN.
//
// Un documento excluido que no se guardara volvería a aparecer como ALTA en
// cada corrida —se leería otra vez, para nada, para siempre—. Guardándolo, el
// diff lo ve sin cambio y no se vuelve a tocar.
//
// Y sale gratis una propiedad que un campo `excluido: boolean` no daría:
// **«0 trozos» ES la definición de excluido.** No hay bandera que pueda
// contradecir a la realidad, porque no hay bandera.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { diffManifiesto, esBorradoMasivo, resumirDiff, UMBRAL_BORRADO_MASIVO, type Diff } from '@/lib/corpus/manifiesto';
import { leerDocumento, trocear, seEmbebe } from '@/lib/corpus/trocear';
import { revisarLote, hayParada, motivoParada, type HallazgoSecreto } from '@/lib/corpus/secretos';
import { DIMENSIONES_EMBEDDING, type Embebedor, type FuenteCorpus } from '@/lib/corpus/fuente';

/**
 * Cuántos trozos van por llamada de embebido y por INSERT.
 *
 * No es el mismo número por casualidad: los dos límites que muerden son de
 * TAMAÑO. Un trozo llega a 6 KB, así que 40 son ~240 KB de texto por llamada y
 * ~2,5 MB de JSON por INSERT contando los 1536 flotantes de cada vector. Subirlo
 * empieza a chocar con límites de cuerpo que fallan lejos de aquí.
 */
const LOTE = 40;

export interface OpcionesSync {
  umbralBorrado?: number;
  /**
   * La declaración escrita de un humano para permitir un borrado masivo.
   *
   * **Mismo molde que `aplicar-migracion.mjs --irreversibilidad`**, y por la
   * misma razón: una operación irreversible exige que alguien declare por
   * escrito que la quiso, y esa declaración **se persiste** —aquí en
   * `corpus_sync_intentos.motivo`— en vez de quedarse en el historial del
   * shell.
   *
   * Se exige un mínimo de largo, que es lo único que este molde endurece: un
   * «sí» de dos letras es un clic, no una declaración.
   */
  irreversibilidad?: string;
  /** Corre todo menos embeber y escribir. No gasta y no toca nada. */
  simular?: boolean;
}

export interface ResultadoSync {
  intentoId: string | null;
  resultado: 'ok' | 'detenido' | 'error';
  motivo: string;
  version: string;
  diff: Diff;
  /** Archivos leídos en esta corrida (altas + cambios). */
  leidos: number;
  /** De los leídos, cuántos pasaron las tres reglas de exclusión. */
  embebidos: number;
  excluidos: number;
  trozos: number;
  tokens: number;
  hallazgos: HallazgoSecreto[];
}

const MIN_DECLARACION = 40;

/** `[1,2,3]` — el formato de entrada de pgvector, explícito y no inferido. */
const aVector = (v: readonly number[]) => '[' + v.join(',') + ']';

/** Parte una lista en lotes de `n`. */
function enLotes<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Sincroniza el índice con la fuente.
 *
 * `db` es el cliente de **SERVICIO**, y aquí sí corresponde: esto es un trabajo
 * del sistema, no una acción de un usuario, y `corpus_*` tiene RLS con cero
 * policies. Es lo contrario del chat, que usa el de sesión a propósito.
 */
export async function sincronizar(
  db: SupabaseClient,
  fuente: FuenteCorpus,
  /**
   * `null` = **se indexa SIN embeddings**, y no es un modo degradado.
   *
   * Medido sobre un corpus real: **casi todas las fichas de producto son UN
   * SOLO TROZO** (de unos cientos de tokens). Una búsqueda vectorial
   * sobre un trozo no significa nada — **la ficha ES el trozo**, y cabe entera
   * en un prompt.
   *
   * Y eso no contradice el invariante del bloque: lo cumple mejor. *«La ficha
   * se ELIGE por tabla; la semántica solo actúa DENTRO de la ficha ya
   * elegida»* — y dentro de una ficha de un trozo no hay dónde actuar.
   * Sin embebedor **desaparece el único sitio donde un puntaje de similitud
   * podría escoger mal**.
   *
   * Se deja el hueco abierto para los documentos que NO son ficha (varios
   * trozos cada uno) y para cuando el corpus crezca.
   */
  embebedor: Embebedor | null,
  opciones: OpcionesSync = {},
): Promise<ResultadoSync> {
  const vacio: Diff = { altas: [], cambios: [], bajas: [], sinCambio: 0 };
  const base: ResultadoSync = {
    intentoId: null,
    resultado: 'error',
    motivo: '',
    version: '',
    diff: vacio,
    leidos: 0,
    embebidos: 0,
    excluidos: 0,
    trozos: 0,
    tokens: 0,
    hallazgos: [],
  };

  // ---------- (0) La dimensión, ANTES de gastar ----------
  // Descubrir el desajuste en el primer INSERT significaría haber pagado ya por
  // todos los vectores. Cuesta una comparación comprobarlo aquí.
  //
  // **Y hay que decir lo que esta comprobación NO cubre**, porque suena a más
  // de lo que es: `embebedorOpenAI` declara `dimensiones: DIMENSIONES_EMBEDDING`,
  // así que para el embebedor REAL esta condición **no puede ser cierta nunca**
  // — es P19, y solo muerde para un embebedor alternativo.
  //
  // La protección de verdad está donde sí hay un dato ajeno que comprobar: en
  // `embebedor-openai.ts`, contra el LARGO DEL VECTOR QUE DEVOLVIÓ la API.
  if (embebedor && embebedor.dimensiones !== DIMENSIONES_EMBEDDING) {
    return {
      ...base,
      resultado: 'error',
      motivo:
        'El embebedor «' +
        embebedor.nombre +
        '» produce ' +
        embebedor.dimensiones +
        ' dimensiones y la columna declara ' +
        DIMENSIONES_EMBEDDING +
        '. Se detiene antes de embeber: el desajuste solo se vería en el primer INSERT, con todo ya pagado.',
    };
  }

  // ---------- (1) El intento, al EMPEZAR ----------
  const { data: filaIntento, error: errIntento } = await db
    .from('corpus_sync_intentos')
    .insert({ resultado: 'corriendo' })
    .select('id')
    .single();
  if (errIntento || !filaIntento) {
    return { ...base, motivo: 'No se pudo registrar el intento: ' + (errIntento?.message ?? 'sin fila') };
  }
  const intentoId = String((filaIntento as { id: string }).id);

  const cerrar = async (r: ResultadoSync): Promise<ResultadoSync> => {
    await db
      .from('corpus_sync_intentos')
      .update({
        terminado_en: new Date().toISOString(),
        commit_sha: r.version || null,
        resultado: r.resultado,
        altas: r.diff.altas.length,
        cambios: r.diff.cambios.length,
        bajas: r.diff.bajas.length,
        sin_cambio: r.diff.sinCambio,
        motivo: r.motivo || null,
      })
      .eq('id', intentoId);
    return r;
  };

  try {
    // ---------- (2) El manifiesto COMPLETO ----------
    const version = await fuente.version();
    const manifiesto = await fuente.listar();

    const { data: filasIndice, error: errIndice } = await db.from('corpus_documentos').select('ruta,hash');
    if (errIndice) {
      return cerrar({ ...base, intentoId, version, motivo: 'No se pudo leer el índice: ' + errIndice.message });
    }
    const indice = (filasIndice ?? []).map((f) => ({ ruta: String(f.ruta), hash: String(f.hash) }));

    // ---------- (3) El diff ----------
    const diff = diffManifiesto(manifiesto, indice);
    const parcial: ResultadoSync = { ...base, intentoId, version, diff };

    // ---------- (4) ¿Borrado masivo? ----------
    const veredicto = esBorradoMasivo(
      diff,
      indice.length,
      manifiesto.length === 0,
      opciones.umbralBorrado ?? UMBRAL_BORRADO_MASIVO,
    );
    if (veredicto.masivo) {
      const decl = (opciones.irreversibilidad ?? '').trim();
      if (decl.length < MIN_DECLARACION) {
        return cerrar({
          ...parcial,
          resultado: 'detenido',
          motivo:
            veredicto.motivo +
            ' Para proceder hace falta una declaración escrita de al menos ' +
            MIN_DECLARACION +
            ' caracteres (opción `irreversibilidad`), que queda guardada en este mismo renglón.',
        });
      }
      // Declarado: se procede, y la declaración queda EN LA BASE, no en el
      // historial del shell.
      parcial.motivo = 'BORRADO MASIVO AUTORIZADO POR ESCRITO: ' + decl + ' — ' + veredicto.motivo;
    }

    // ---------- (5) Leer lo que va a indexarse ----------
    const aLeer = [...diff.altas, ...diff.cambios.map((c) => ({ ruta: c.ruta, hash: c.hashNuevo }))];
    const leidos: { ruta: string; hash: string; texto: string }[] = [];
    for (const a of aLeer) {
      leidos.push({ ruta: a.ruta, hash: a.hash, texto: await fuente.leer(a.ruta) });
    }
    parcial.leidos = leidos.length;

    // ---------- (6) ★ LA PARADA ANTE SECRETO ----------
    // Sobre el LOTE ENTERO y antes de una sola llamada de red. Un archivo
    // saltado en silencio es invisible; una parada es una decisión.
    const hallazgos = revisarLote(leidos);
    parcial.hallazgos = hallazgos;
    if (hayParada(hallazgos)) {
      return cerrar({ ...parcial, resultado: 'detenido', motivo: motivoParada(hallazgos) });
    }

    // ---------- (7) Trocear, aplicando las tres reglas ----------
    const documentos = leidos.map((l) => {
      const doc = leerDocumento(l.texto);
      const embebible = seEmbebe(l.ruta, doc);
      return {
        ...l,
        doc,
        embebible,
        trozos: embebible ? trocear(doc) : [],
      };
    });
    parcial.embebidos = documentos.filter((d) => d.embebible).length;
    parcial.excluidos = documentos.length - parcial.embebidos;

    const trozosPlanos = documentos.flatMap((d) =>
      d.trozos.map((t) => ({ ruta: d.ruta, trozo: t })),
    );
    parcial.trozos = trozosPlanos.length;

    if (opciones.simular) {
      return cerrar({
        ...parcial,
        resultado: 'ok',
        motivo: (parcial.motivo ? parcial.motivo + ' · ' : '') + 'SIMULACIÓN: no se embebió ni se escribió nada.',
      });
    }

    // ══════════════ de aquí para abajo SÍ sale texto del perímetro ══════════════

    // ---------- (8) Embeber, si hay con qué ----------
    const vectores: number[][] = [];
    let tokens = 0;
    for (const lote of embebedor ? enLotes(trozosPlanos, LOTE) : []) {
      const r = await embebedor!.embeber(lote.map((x) => x.trozo.texto));
      if (r.vectores.length !== lote.length) {
        // Un embebedor que devuelve otra cantidad pegaría cada vector al trozo
        // equivocado, y el índice se vería perfectamente sano.
        return cerrar({
          ...parcial,
          resultado: 'error',
          motivo:
            'El embebedor devolvió ' + r.vectores.length + ' vectores para ' + lote.length + ' trozos. Se detiene: emparejarlos mal produce un índice que se ve sano y contesta mal.',
        });
      }
      vectores.push(...r.vectores);
      tokens += r.tokens;
    }
    parcial.tokens = tokens;

    // ---------- (9) Escribir ----------
    // (9a) Los documentos — TODOS los leídos, embebibles o no.
    for (const lote of enLotes(documentos, LOTE)) {
      const { error } = await db.from('corpus_documentos').upsert(
        lote.map((d) => ({
          ruta: d.ruta,
          hash: d.hash,
          commit_sha: version,
          titulo: d.doc.meta.name ?? null,
          descripcion: d.doc.meta.description ?? null,
          fuente_pdf: d.doc.meta.fuente_pdf ?? null,
          bytes: Buffer.byteLength(d.texto, 'utf8'),
          indexado_en: new Date().toISOString(),
        })),
        { onConflict: 'ruta' },
      );
      if (error) return cerrar({ ...parcial, resultado: 'error', motivo: 'upsert documentos: ' + error.message });
    }

    // (9b) Los trozos viejos de lo que se re-indexa. La cascada solo dispara al
    //      borrar el documento; un `cambio` conserva el documento, así que sus
    //      trozos hay que quitarlos a mano o quedarían los dos juegos.
    const rutasTocadas = documentos.map((d) => d.ruta);
    for (const lote of enLotes(rutasTocadas, LOTE)) {
      const { error } = await db.from('corpus_trozos').delete().in('ruta', lote);
      if (error) return cerrar({ ...parcial, resultado: 'error', motivo: 'delete trozos: ' + error.message });
    }

    // (9c) Los trozos nuevos, con su vector.
    const conVector = trozosPlanos.map((x, i) => ({
      ruta: x.ruta,
      orden: x.trozo.orden,
      ruta_seccion: x.trozo.rutaSeccion,
      texto: x.trozo.texto,
      bytes: x.trozo.bytes,
      tiene_tabla: x.trozo.tieneTabla,
      excede: x.trozo.excede,
      commit_sha: version,
      // `null` cuando no hay embebedor. La columna queda vacía A PROPÓSITO, no
      // a medias: ver el porqué en el parámetro `embebedor`.
      embedding: vectores[i] ? aVector(vectores[i]!) : null,
    }));
    for (const lote of enLotes(conVector, LOTE)) {
      const { error } = await db.from('corpus_trozos').insert(lote);
      if (error) return cerrar({ ...parcial, resultado: 'error', motivo: 'insert trozos: ' + error.message });
    }

    // (9d) Las bajas. Aquí SÍ trabaja la cascada: borrar el documento se lleva
    //      sus trozos en la misma transacción.
    for (const lote of enLotes(diff.bajas.map((b) => b.ruta), LOTE)) {
      const { error } = await db.from('corpus_documentos').delete().in('ruta', lote);
      if (error) return cerrar({ ...parcial, resultado: 'error', motivo: 'delete bajas: ' + error.message });
    }

    // ---------- (10) Cerrar ----------
    return cerrar({
      ...parcial,
      resultado: 'ok',
      motivo: (parcial.motivo ? parcial.motivo + ' · ' : '') + resumirDiff(diff),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return cerrar({ ...base, intentoId, resultado: 'error', motivo: 'Excepción: ' + msg });
  }
}
