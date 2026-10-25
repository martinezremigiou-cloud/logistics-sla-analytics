// ============================================================
// [FIX-B1] tecnologias.service.ts (READ)
// GET /api/tecnologias: el vocabulario SELECCIONABLE para el override
// manual de `tecnologia` — sólo lo escribe un ADMIN (`PUT /api/override`
// exige `requireAdminSession`; la Ficha sólo ofrece el selector dentro de
// `FichaAtributosEditable`, montada exclusivamente para ese rol; ver
// `TecnologiaEditable`, `ficha-atributos.tsx`). CUALQUIER rol autenticado
// puede LEER esta lista (`GET` va tras `requireSession`, no
// `requireAdminSession` — la RPC concede EXECUTE a `authenticated`), pero
// sólo el admin la usa para capturar.
//
// Fuente ÚNICA: la RPC de sólo lectura `tecnologias_seleccionables()`
// (migración 0044) — NUNCA una lista fija en el código. NO es un
// vocabulario aparte de `tecnologias.nombre` (la tabla que también lee
// `pendientes.service.ts` para la bandeja): es la MISMA tabla, filtrada
// por la propia RPC a «ACTIVA Y usada por al menos un producto VISIBLE
// del snapshot de stock vigente (marca no excluida del catálogo)» — ver
// el cuerpo SQL de `tecnologias_seleccionables()` en 0044. El día que el
// negocio agregue/retire una tecnología seleccionable, este endpoint la
// sigue sin tocar TypeScript.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lista de tecnologías seleccionables, orden tal cual la regresa la RPC.
 *
 * [FIX-B1 · revisión] YA NO degrada a `[]` ante NINGÚN error — ni si la
 * migración aún no se aplicó (`PGRST202`, RPC ausente) ni si una fila
 * llega con una forma desconocida: las dos situaciones antes producían un
 * selector VACÍO Y SIN ERROR (P12, lector tolerante), indistinguible en
 * pantalla de «hoy no hay tecnologías seleccionables» (un universo real,
 * legítimo — ver el cuerpo SQL de la RPC). Ahora ambas LANZAN: la ruta
 * (`app/api/tecnologias/route.ts`) las atrapa con `internalError` y
 * responde 500 con mensaje, en vez de mentir con una lista vacía.
 *
 * Tolerante SÓLO a las DOS formas razonables en que PostgREST puede
 * envolver el resultado de una función SQL que regresa una lista de
 * texto: `RETURNS SETOF text` (jsonb: `["EAS","BRAND2","BRAND1"]`, cada
 * fila ya es el string) o `RETURNS TABLE(tecnologia text)` (cada fila es
 * un objeto `{ tecnologia: "EAS" }`) — este service no se acopla a cuál
 * de las dos eligió la migración 0044 (hoy: `SETOF text`).
 */
export async function listTecnologiasSeleccionables(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.rpc('tecnologias_seleccionables');
  if (error) {
    throw new Error('tecnologias_seleccionables: ' + error.message);
  }
  const filas = (data ?? []) as unknown[];
  return filas
    .map((fila, indice) => {
      if (typeof fila === 'string') return fila.trim();
      if (fila && typeof fila === 'object' && 'tecnologia' in fila) {
        return String((fila as { tecnologia?: unknown }).tecnologia ?? '').trim();
      }
      throw new Error(`tecnologias_seleccionables: fila con forma desconocida en la posición ${indice}: ${JSON.stringify(fila)}`);
    })
    .filter((n) => n !== '');
}
