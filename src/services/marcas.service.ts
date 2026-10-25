// ============================================================
// [VERT-B2] marcas.service.ts — LA LECTURA DEL GOBIERNO DE LA REGLA.
//
// Sólo LEE. La regla se enciende y se apaga con un UPDATE sobre
// `marcas.excluida_del_catalogo`, y eso NO pasa por aquí — es una decisión
// abierta, con su razón escrita en el reporte del bloque: el molde de la casa
// para una escritura con autoría es una RPC `SECURITY DEFINER` que saca el
// actor del JWT (`aplicar_override`, `aplicar_metadata`), nunca un UPDATE
// directo cuyo `excluida_por` lo escriba el cliente. El CHECK
// `marcas_exclusion_con_autoria` garantiza que los tres campos ESTÉN; no
// garantiza que digan la verdad.
//
// SIN pinnear snapshot, y es correcto: `marcas` es vocabulario, no una tabla
// que acumule una copia por snapshot. (La trampa de inflado por snapshot, ver docs/architecture.md, es de
// `embarques`/`reservas`/`stock`, que sí acumulan.) Por eso aquí no hay
// `conVigenteStock` y no falta: son pocas filas, el universo entero.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarcaGobierno } from '@/lib/marcas/gobierno';

/** Fila cruda de `marcas` para el gobierno. */
interface MarcaRow {
  nombre: string;
  excluida_del_catalogo: boolean | null;
  excluida_motivo: string | null;
  excluida_por: string | null;
  excluida_en: string | null;
  creada_en: string | null;
}

/**
 * Las marcas con su estado de gobierno, ordenadas por nombre.
 *
 * `.order('nombre')` no es cosmético: es el orden TOTAL que vuelve estable lo
 * que se pinta y lo que se captura. Son pocas filas —una sola página— así que
 * esto no es el caso de `fetchAllRows`; el orden está igual porque un listado
 * sin orden es un listado que cambia solo.
 */
export async function listarMarcasGobierno(db: SupabaseClient): Promise<MarcaGobierno[]> {
  const { data, error } = await db
    .from('marcas')
    .select('nombre,excluida_del_catalogo,excluida_motivo,excluida_por,excluida_en,creada_en')
    .order('nombre', { ascending: true });

  if (error) throw new Error('marcas: ' + error.message);

  return ((data ?? []) as MarcaRow[]).map((m) => ({
    nombre: String(m.nombre),
    // `=== true` y no un truthy, mismo criterio estricto que `embedExcluida`:
    // qué marca desaparece del catálogo no lo decide una coerción.
    excluida: m.excluida_del_catalogo === true,
    motivo: m.excluida_motivo ?? null,
    por: m.excluida_por ?? null,
    en: m.excluida_en ?? null,
    creadaEn: m.creada_en ?? null,
  }));
}
