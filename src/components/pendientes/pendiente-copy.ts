// ============================================================
// Bloque 6 · F4 · pendiente-copy.ts  (100% PURO)
// Helpers de lectura de `payload` (jsonb libre por `tipo`, ver
// `types/api.ts` PendienteDato) y copy es-MX de título por tipo,
// compartidos entre `pendiente-fila.tsx` y `pendiente-acciones.tsx`.
// Shapes reales de `payload` por tipo (confirmados en la migración
// 0009, sección SEED + encolado de `ingest_snapshot`):
//   kam_desconocido  → { kam_raw, ocurrencias, skus[] }
//   marca_west      → { sku, marca_actual }
//   colision_familia → { campo, canonico, variantes[], skus[] }
//   cuarentena_etl   → sin productor todavía (B6 F2) — se degrada a
//                      copy genérico si el payload no trae `motivo`.
// (INV-TAXO F2 / INV-B7B) 2 tipos nuevos. `familia_atomo_dudoso` lo
// encola solo 0011_taxo. `marca_ambigua` tiene DOS PRODUCTORES con
// reglas distintas para el MISMO `tipo` (payload más rico en el
// segundo) — la UI NUNCA debe asumir que `marca_actual`/`marca_fuente`
// se contradicen: solo pintar la contradicción cuando de verdad existe.
//   marca_ambigua → { sku, campo:'marca', marca_actual, marca_fuente,
//                      candidatas[], evidencia, pregunta }, más:
//                    · 0011_taxo.sql (pocos SKUs): `marca_actual` (capa v2,
//                      crudo) y `marca_fuente` (capa fuente vigente)
//                      SIEMPRE se contradicen — es la regla que los
//                      encola. `candidatas` = [marca_actual,
//                      marca_fuente] (siempre 2).
//                    · 0012_b7b_hardening.sql (varios SKUs, regla
//                      "tecnología-categoría"): la marca EFECTIVA de
//                      estos SKUs ES el nombre de una tecnología (p.ej.
//                      "EAS", que en el catálogo real fabrican varias marcas
//                      distintas) y no identifica a ningún fabricante —
//                      en la mayoría de los casos `marca_actual` y
//                      `marca_fuente` COINCIDEN (ambas dicen "EAS"): NO
//                      hay contradicción entre capas, la pregunta real
//                      es "¿quién lo fabrica?", no "¿cuál capa está
//                      mal?". Trae además `tecnologia`, `marca_v2`
//                      (crudo, nullable), `candidatas` (hasta 9, marcas
//                      reales de esa tecnología por # de SKUs desc),
//                      `candidatas_detalle`, `n_marcas_de_la_tecnologia`,
//                      `n_marcas_con_2_o_mas_skus`,
//                      `n_skus_de_la_tecnologia` — todos AUSENTES en
//                      0011: úsalos si vienen y ten un respaldo
//                      razonable si no.
//   familia_atomo_dudoso → { campo:'familia', canonico, atomos[],
//                            atomos_fantasma[] (subconjunto de atomos),
//                            skus[], n_skus, pregunta, opcion_confirmar,
//                            opcion_descartar, evidencia }. Confirmar
//                          RATIFICA el statu quo (no escribe nada);
//                          descartar solo registra el veredicto (la
//                          fusión/separación real queda fuera de 0011).
// (B, [MVP-2]) `familia_nueva` — encolado por
// `sincronizar_pendientes_familia` (0019, una fila por familia, no por
// SKU): { familia, prefijo (null si es de una sola palabra), hermanas[]
// (familias activas con ese prefijo, token-exacto), skus[] }.
// ============================================================
import type { PendienteDato } from '@/types/api';

/** Lectura defensiva de un campo string de `payload` — nunca lanza si falta o tiene otro tipo. */
export function textoPayload(payload: Record<string, unknown>, campo: string): string {
  const v = payload[campo];
  return typeof v === 'string' ? v : '';
}

/** Lectura defensiva de un campo numérico de `payload` — nunca lanza si falta o tiene otro tipo. */
export function numeroPayload(payload: Record<string, unknown>, campo: string): number {
  const v = payload[campo];
  return typeof v === 'number' ? v : 0;
}

/** Lectura defensiva de un campo arreglo-de-strings de `payload` — nunca lanza si falta o tiene otro tipo/elementos. */
export function arregloPayload(payload: Record<string, unknown>, campo: string): string[] {
  const v = payload[campo];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Capitaliza cada palabra ("ANA" → "Ana", "JUAN PEREZ" → "Juan
 * Perez") — precarga editable del input "Nombre canónico" en el diálogo
 * "Confirmar como KAM" (el crudo del Excel suele venir en mayúsculas).
 */
export function capitalizarNombre(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Reemplaza cada corrida de 2+ espacios por el mismo número de '␣'
 * (U+2423, visible) — evidencia el bug real detrás de una colisión de
 * familia (p.ej. 'CLIP 3.0 /  CLIP MODULAR' vs 'CLIP 3.0 / CLIP MODULAR',
 * ver seed de la migración 0009). Espacios simples quedan intactos.
 */
export function marcarEspaciosDobles(s: string): string {
  return s.replace(/ {2,}/g, (m) => '␣'.repeat(m.length));
}

/** Título es-MX por `tipo` (spec F4) — usa SIEMPRE el crudo de `payload`, sin capitalizar (a diferencia del input editable del diálogo de KAM). */
export function tituloPendiente(p: PendienteDato): string {
  switch (p.tipo) {
    case 'kam_desconocido':
      return `KAM desconocido: ${textoPayload(p.payload, 'kam_raw')}`;
    case 'marca_west':
      return `Marca WEST sin resolver: ${textoPayload(p.payload, 'sku')}`;
    case 'colision_familia':
      return `Colisión de familia: ${textoPayload(p.payload, 'canonico')}`;
    case 'marca_ambigua':
      return `Marca ambigua: ${textoPayload(p.payload, 'sku')}`;
    case 'familia_atomo_dudoso':
      return `Familia con átomo dudoso: ${textoPayload(p.payload, 'canonico')}`;
    // (MVP-CIERRE F2) El título dice qué FALTA, no qué es el SKU: el payload
    // trae `campo` = 'tecnologia' o 'tecnologia+familia' según le falte una
    // o las dos, así que la fila se lee sin abrir el diálogo.
    case 'sku_sin_tecnologia':
      return textoPayload(p.payload, 'campo') === 'tecnologia+familia'
        ? `Sin tecnología ni familia: ${textoPayload(p.payload, 'sku')}`
        : `Sin tecnología: ${textoPayload(p.payload, 'sku')}`;
    case 'familia_nueva':
      return `Familia nueva en la fuente: ${textoPayload(p.payload, 'familia')}`;
    case 'cuarentena_etl':
    default:
      return 'Registro en cuarentena de ETL';
  }
}
