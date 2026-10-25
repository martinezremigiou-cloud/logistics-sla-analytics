// ============================================================
// [2.0.1-A · D2] drift-familias.service.ts — LECTURA. Cero escritura.
//
// El GO vino con una condición que manda sobre el diseño entero: **la
// ingesta no se toca**. Así que esto no escribe una fila, no pide migración y
// no roza `ingest_snapshot`. Todo sale de lo que ya está en la base:
//
//   `cambios`            el libro del drift — cada reasignación de familia con
//                        su `valor_anterior → valor_nuevo` y su `snapshot_id`
//   `familias`+`productos`  qué familias conservan SKU en el snapshot vigente
//   `corpus_familia_ficha`  el puente al corpus documental
//
// QUÉ QUEDA FUERA, Y POR QUÉ. Que un vaciado sea RESOLUBLE (confirmar /
// descartar como un pendiente de verdad) exige una fila en `pendientes_datos`,
// y eso arrastra CHECK de tipo nuevo + productor + reproducir el cuerpo entero
// de `ingest_snapshot` para llamarlo. **Eso ES tocar la ingesta**, así que es
// deuda con disparador, no alcance. Lo mismo las propuestas «la ficha sigue a
// sus SKU»: escribirlas pediría grant y policy sobre `corpus_familia_ficha`,
// que hoy es solo-lectura para `authenticated`. Se PROPONEN en pantalla; las
// firma un humano por otro camino.
//
// DEGRADACIÓN, y la trampa que evita: si el puente no es legible (entorno por
// debajo de la 0032, donde `authenticated` no tiene SELECT), la lectura LANZA
// —no devuelve cero—. El testigo degrada a `null`, **nunca a 0**: un cero diría
// «ningún puente roto» justo cuando no se puede ver ninguno.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { embedName } from '@/lib/supabase/embed';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { conVigenteStock } from './vigente.service';
import { analizarCorrida, puentesSinCamino, type CambioFamilia, type ReporteCorrida, type TestigoPuentes } from '@/lib/drift-familias';

/** Ventana de historia que se analiza. 40 días cubre las olas de reclasificación conocidas con margen. */
export const DIAS_DRIFT = 40;

export interface CorridaDrift extends ReporteCorrida {
  /** Sello de la corrida (ISO) — el `detectado_en` de sus cambios, que es idéntico dentro de un snapshot. */
  detectadoEn: string;
  snapshotId: string;
  reasignaciones: number;
}

export interface DriftFamiliasVista {
  /** De la más reciente hacia atrás. Vacío = hubo lecturas y no hubo reasignaciones (un HECHO, no un hueco). */
  corridas: CorridaDrift[];
  /** Cuántas corridas de la ventana se analizaron (para distinguir «ninguna movió familias» de «no hubo corridas»). */
  ventanaDias: number;
  totalReasignaciones: number;
}

export interface LecturaDrift {
  drift: DriftFamiliasVista | null;
  puentes: TestigoPuentes | null;
}

interface FilaCambio {
  sku: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  detectado_en: string;
  snapshot_id: string;
}

/**
 * Deriva el drift de familias y el testigo de puentes. Nunca lanza hacia
 * arriba por indisponibilidad de una tabla: devuelve `null` en la parte que no
 * pudo leer, para que la pantalla pueda decir «no se pudo derivar» en vez de
 * enseñar un cero que no midió nada.
 */
export async function leerDrift(db: SupabaseClient): Promise<LecturaDrift> {
  const desde = new Date(Date.now() - DIAS_DRIFT * 24 * 3600 * 1000).toISOString();

  // ---------- el libro ----------
  //
  // EL ORDEN LLEVA DESEMPATE, y no es adorno: `fetchAllRows` pagina con
  // `range(from, to)`, que en Postgres es `LIMIT/OFFSET`. Sobre un orden NO
  // ÚNICO, dos páginas consecutivas pueden repetir una fila y saltarse otra sin
  // error ninguno — y aquí el orden era `detectado_en`, que **es idéntico para
  // todas las filas de un mismo snapshot** por construcción (lo dice el
  // comentario de `CorridaDrift`): el peor caso posible, miles de filas
  // empatadas. Con cientos de reasignaciones en una sola corrida, la ventana de 40 días
  // cruza el tope de 1 000 y la paginación se estrena justo ahí. `id` es la PK
  // (uuid, `0001_schema.sql:325`) y hace el orden total.
  let cambios: FilaCambio[];
  try {
    cambios = await fetchAllRows<FilaCambio>((from, to) =>
      db
        .from('cambios')
        .select('sku,valor_anterior,valor_nuevo,detectado_en,snapshot_id')
        .eq('entidad', 'producto')
        .eq('campo', 'familia')
        .gte('detectado_en', desde)
        .order('detectado_en', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    console.error('[drift-familias] no se pudo leer `cambios`:', e);
    return { drift: null, puentes: null };
  }

  // ---------- el universo vigente, pinneado ----------
  // Sin pinnear, `productos` acumula una copia por snapshot y el conteo se
  // infla por el número de snapshots (regla de este dominio, ver docs/architecture.md).
  const vigente = await conVigenteStock(db, async (S) => {
    // Mismo desempate, y aquí ya no es hipotético: el vigente trae más de mil SKU,
    // o sea DOS páginas. Sin `order`, PostgREST manda un `OFFSET 1000` sin
    // `ORDER BY` y el conteo por familia puede perder o duplicar filas — el
    // denominador del testigo de puentes, torcido en silencio. `sku` es la PK.
    const filas = await fetchAllRows<{ familias: unknown }>((from, to) =>
      db.from('productos').select('familias(nombre)').eq('snapshot_id', S.id).order('sku', { ascending: true }).range(from, to),
    );
    const conteo = new Map<string, number>();
    for (const f of filas) {
      const nombre = embedName(f.familias);
      if (nombre) conteo.set(nombre, (conteo.get(nombre) ?? 0) + 1);
    }
    return conteo;
  });
  const conteoVigente = vigente ?? new Map<string, number>();

  // ---------- el puente ----------
  let puentes: Map<string, string> | null = new Map();
  const resPuente = await db.from('corpus_familia_ficha').select('ficha_ruta, familias(nombre)');
  if (resPuente.error) {
    // Un SELECT sin privilegio LANZA; no devuelve cero. `null` ≠ 0.
    if (!esNoDisponiblePorMigracion(resPuente.error)) {
      console.error('[drift-familias] no se pudo leer el puente:', resPuente.error);
    }
    puentes = null;
  } else {
    for (const fila of resPuente.data ?? []) {
      const nombre = embedName((fila as { familias: unknown }).familias);
      const ruta = (fila as { ficha_ruta: string | null }).ficha_ruta;
      if (nombre && ruta) puentes.set(nombre, ruta);
    }
  }

  // ---------- altas por corrida ----------
  // Se derivan de `pendientes_datos` (`familia_nueva` trae `snapshot_id`), NO
  // de `familias.creado_en`: esa columna la selló la 0020 con fecha falsa para
  // las filas históricas y su propio comentario la declara falsificable.
  const altasPorSnapshot = new Map<string, Set<string>>();
  const resAltas = await db
    .from('pendientes_datos')
    .select('snapshot_id,payload')
    .eq('tipo', 'familia_nueva')
    .gte('detectado_en', desde);
  if (!resAltas.error) {
    for (const p of resAltas.data ?? []) {
      const snap = (p as { snapshot_id: string | null }).snapshot_id;
      const payload = (p as { payload: Record<string, unknown> | null }).payload;
      const familia = payload && typeof payload.familia === 'string' ? payload.familia.toLocaleUpperCase('es-MX') : null;
      if (!snap || !familia) continue;
      if (!altasPorSnapshot.has(snap)) altasPorSnapshot.set(snap, new Set());
      altasPorSnapshot.get(snap)!.add(familia);
    }
  }

  // ---------- una corrida = un snapshot ----------
  const porSnapshot = new Map<string, FilaCambio[]>();
  for (const c of cambios) {
    if (!porSnapshot.has(c.snapshot_id)) porSnapshot.set(c.snapshot_id, []);
    porSnapshot.get(c.snapshot_id)!.push(c);
  }

  const corridas: CorridaDrift[] = Array.from(porSnapshot.entries()).map(([snapshotId, filas]) => {
    const cambiosFamilia: CambioFamilia[] = filas.map((f) => ({
      sku: f.sku,
      valor_anterior: f.valor_anterior,
      valor_nuevo: f.valor_nuevo,
    }));
    const reporte = analizarCorrida({
      cambiosFamilia,
      familiasNuevas: altasPorSnapshot.get(snapshotId) ?? new Set(),
      conteoVigente,
      puentes: puentes ?? new Map(),
    });
    return {
      ...reporte,
      snapshotId,
      detectadoEn: filas[0]?.detectado_en ?? '',
      reasignaciones: filas.length,
    };
  });
  corridas.sort((a, b) => (a.detectadoEn < b.detectadoEn ? 1 : -1));

  const testigo =
    puentes === null
      ? null
      : puentesSinCamino({
          puentes,
          familiasConSkuVigente: new Set(
            Array.from(conteoVigente.entries())
              .filter(([, n]) => n > 0)
              .map(([nombre]) => nombre),
          ),
        });

  return {
    drift: { corridas, ventanaDias: DIAS_DRIFT, totalReasignaciones: cambios.length },
    puentes: testigo,
  };
}
