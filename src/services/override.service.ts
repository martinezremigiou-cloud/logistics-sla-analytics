// ============================================================
// Bloque 5 · API · override.service.ts  (WRITE admin)
// PUT /api/override: edición trazable y reversible (D3) de
// `familia`/`descripcion`/`tecnologia` (FIX-B1) por SKU. La escritura
// (desactivar el anterior activo + insertar el nuevo, versionado) ocurre
// de forma ATÓMICA en el RPC `aplicar_override` (0006, ampliado por
// FIX-B1/T2a): una sola llamada, sin la carrera entre 2 statements que
// existía en B3. El RPC fija `editado_por` server-side desde el JWT
// (nunca viaja desde el cliente) y regresa el set ACTIVO fresco de ese
// sku, que se usa directo como fuente de overrides para
// `resolverClasificacion()` (sin re-fetch adicional).
// `campo='familia'`: el valor debe existir en `familias` con
// `activo=true` (case-insensitive); se persiste el nombre CANÓNICO
// del catálogo, no el casing crudo del cliente — esta validación
// previa sigue en JS (el RPC no la duplica).
// `campo='tecnologia'` (FIX-B1): SIN canonicalización en JS — el
// selector del cliente ya ofrece solo los valores de
// `tecnologias_seleccionables()` (`GET /api/tecnologias`), así que no hay
// casing libre que normalizar (a diferencia de familia, texto libre). El
// RPC valida: rechaza con SQLSTATE `MXEXL` ("el Excel manda") si
// `productos.tecnologia` ya trae un valor para ese SKU, y con `MXTEC`
// ("tecnología no seleccionable") si el valor no está en la lista — ver
// `esExcelManda`/`esTecnologiaNoSeleccionable` (`lib/supabase/pg-errors.ts`).
// `valor: null` (C2) = reversión REAL: "quitar el override" en vez de
// re-escribirlo con el valor original. No aplica NINGUNA validación (ni
// familia ni tecnología: no hay nada que canonicalizar/comprobar al
// quitar) y el RPC recibe `p_valor: null` — desactiva el override activo
// sin insertar uno nuevo, así `resolverClasificacion()` cae de vuelta al
// valor PRÍSTINO de la fuente y sigue las ingestas futuras.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolverClasificacion, type ProductoLectura, type OverrideLectura } from './derivaciones';
import { embedName } from '@/lib/supabase/embed';
import { escaparLike } from '@/lib/supabase/ilike';
import { esForbidden, esExcelManda, esTecnologiaNoSeleccionable } from '@/lib/supabase/pg-errors';
import type { OverrideResult } from '@/types/api';
import type { CampoOverride } from '@/types/enums';
import type { OverrideBody } from '@/schemas/override.schema';

export type SetOverrideResult =
  | { tipo: 'ok'; resultado: OverrideResult }
  | { tipo: 'sku_no_encontrado' }
  | { tipo: 'familia_invalida'; nombre: string }
  | { tipo: 'forbidden' }
  /** [FIX-B1] SQLSTATE `MXEXL`: el Excel ya trae tecnología para este SKU — el portal no puede sobrescribirla. */
  | { tipo: 'excel_manda' }
  /** [FIX-B1] SQLSTATE `MXTEC`: el valor no está en `tecnologias_seleccionables()`. */
  | { tipo: 'tecnologia_no_seleccionable'; valor: string };

/** Fila cruda de `productos` (select mínimo para override). */
interface OverrideProductoRow {
  sku: string;
  descr_origen: string | null;
  /** [FIX-B1] necesaria para resolver `tecnologia` (regla «el Excel gana», ver `derivaciones.ts`). */
  tecnologia: string | null;
  familias: unknown;
}

/** Fila cruda de `familias` (lookup de canonicalización). */
interface OverrideFamiliaRow {
  id: string;
  nombre: string;
}

/** Fila cruda del jsonb que regresa el RPC `aplicar_override` (set activo fresco del sku). */
interface OverrideRow {
  id: string;
  sku: string;
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  activo: boolean;
}

/**
 * Escribe un override de `familia`, `descripcion` o `tecnologia` (FIX-B1)
 * para un SKU y regresa las efectivas frescas. `sku_no_encontrado` si el
 * SKU no existe en `productos`; `familia_invalida` si `campo==='familia'`,
 * `valor !== null` y no matchea (case-insensitive) ninguna familia
 * `activo=true`; `excel_manda`/`tecnologia_no_seleccionable` si
 * `campo==='tecnologia'` y el RPC rechaza (ver comentario de cabecera).
 * `valor === null` revierte (quita el override activo, sin validar nada)
 * — ver comentario de cabecera.
 */
export async function setOverride(db: SupabaseClient, input: OverrideBody): Promise<SetOverrideResult> {
  const { sku, campo, valor } = input;

  const { data: productoRow, error: productoError } = await db
    .from('productos')
    .select('sku,descr_origen,tecnologia, familias(nombre)')
    .eq('sku', sku)
    .maybeSingle();
  if (productoError) throw new Error('productos: ' + productoError.message);
  if (!productoRow) return { tipo: 'sku_no_encontrado' };

  const producto = productoRow as OverrideProductoRow;
  const familiaOrigen = embedName(producto.familias);

  let valorCanonico: string | null = null;
  if (campo === 'familia' && valor !== null) {
    // `.order('nombre').limit(1)`: elección determinista por si hubiera más
    // de una familia activa matcheando por casing. Defensa en profundidad:
    // desde `0006_b5_dominio.sql:73` (`familias_nombre_lower_uidx`, UNIQUE
    // sobre TODA la tabla, activas e inactivas) el propio UNIQUE de BD ya
    // garantiza a lo sumo una — ver comentario de cabecera de
    // familias.service.ts (deuda B3-5, CERRADA).
    const { data: familiaRows, error: familiaError } = await db
      .from('familias')
      .select('id,nombre')
      .eq('activo', true)
      .ilike('nombre', escaparLike(valor))
      .order('nombre', { ascending: true })
      .limit(1);
    if (familiaError) throw new Error('familias: ' + familiaError.message);

    const familiaRow = ((familiaRows ?? []) as OverrideFamiliaRow[])[0];
    if (!familiaRow) return { tipo: 'familia_invalida', nombre: valor };
    valorCanonico = familiaRow.nombre;
  }

  const { data: overridesData, error: rpcError } = await db.rpc('aplicar_override', {
    p_sku: sku,
    p_campo: campo,
    p_valor: valorCanonico ?? valor,
  });
  if (rpcError) {
    // Defensa en profundidad (C5/F4, mismo patrón que el 23505 de
    // familias.service.ts): `requireAdminSession` (route) ya exige
    // rol='admin' antes de llegar aquí, pero el RPC vuelve a verificarlo
    // (`is_admin()`) dentro de la misma transacción — un TOCTOU (p.ej. el
    // admin fue degradado justo entre el gate y este RPC) devuelve
    // SQLSTATE 42501, que se traduce a 'forbidden' en vez de filtrarse
    // como 500 genérico. `esForbidden` vive en `@/lib/supabase/pg-errors`
    // (compartida con `esNoDisponiblePorMigracion` de los otros services).
    if (esForbidden(rpcError)) return { tipo: 'forbidden' };
    // [FIX-B1] `campo==='tecnologia'`: el RPC valida lo que este service ya
    // no valida en JS (ver comentario de cabecera) — se traduce el
    // SQLSTATE en vez de dejarlo caer al 500 genérico de más abajo.
    if (esExcelManda(rpcError)) return { tipo: 'excel_manda' };
    if (esTecnologiaNoSeleccionable(rpcError)) return { tipo: 'tecnologia_no_seleccionable', valor: valor ?? '' };
    throw new Error('aplicar_override: ' + rpcError.message);
  }

  const overridesLectura: OverrideLectura[] = ((overridesData ?? []) as OverrideRow[]).map((o) => ({
    sku: String(o.sku),
    campo: o.campo,
    valor_editado: String(o.valor_editado),
    editado_en: String(o.editado_en),
    id: String(o.id),
    activo: Boolean(o.activo),
  }));

  const productoLectura: ProductoLectura = {
    sku,
    marca: '', // irrelevante para resolverClasificacion(): no usa marca
    familia: familiaOrigen,
    descr_origen: producto.descr_origen ?? null,
    resv: 0, // irrelevante para resolverClasificacion(): no usa resv
    tecnologia: producto.tecnologia ?? null,
  };

  // `resolverClasificacion` en vez de `efectivas()` (que solo cubre
  // familia/descr): FIX-B1 necesita también `tecnologia_efectiva`, y las
  // TRES se calculan siempre, sin importar qué `campo` se tocó — mismo
  // criterio que familia_efectiva/descr_efectiva ya viajaban juntas antes
  // de este bloque (el cliente las usa para refrescar la ficha entera).
  const resuelto = resolverClasificacion(productoLectura, overridesLectura, null);
  const familia_efectiva = resuelto.familia.valor;
  const descr_efectiva = resuelto.descr.valor;
  const tecnologia_efectiva = resuelto.tecnologia.valor;

  // Switch EXHAUSTIVO (P25 — antes era un ternario binario que, con
  // `campo==='tecnologia'`, habría devuelto la DESCRIPCIÓN por error): el
  // `never` del `default` obliga a `tsc` a rechazar el build el día que
  // `CampoOverride` gane un cuarto valor y nadie actualice este switch.
  let valor_efectivo: string | null;
  switch (campo) {
    case 'familia':
      valor_efectivo = familia_efectiva;
      break;
    case 'descripcion':
      valor_efectivo = descr_efectiva;
      break;
    case 'tecnologia':
      valor_efectivo = tecnologia_efectiva;
      break;
    default: {
      const _exhaustivo: never = campo;
      throw new Error(`campo de override desconocido: ${String(_exhaustivo)}`);
    }
  }

  return {
    tipo: 'ok',
    resultado: { sku, campo, valor_efectivo, familia_efectiva, descr_efectiva, tecnologia_efectiva },
  };
}
