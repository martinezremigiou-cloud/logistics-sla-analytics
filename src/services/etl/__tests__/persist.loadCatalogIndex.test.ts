// ============================================================
// Bloque 2 · ETL · persist.loadCatalogIndex.test.ts
// Fix (precarga traga errores, ratificado 2026-07-19): loadCatalogIndex
// hacía 6 SELECTs vía Promise.all y NUNCA revisaba `.error` — con un
// fallo transitorio (p.ej. "JWT issued at future" tras arranque frío)
// `x.data ?? []` construía el índice VACÍO en silencio. Riesgo real:
// estatus_alias vacío en un POST de aduana cuarentenaría TODOS los
// embarques en silencio y produciría un snapshot envenenado
// válido-en-apariencia. Ahora se revisa `.error` de los 6 resultados
// ANTES de armar el índice; si cualquiera falló, se lanza explícito
// (el route ya convierte throws en 500 limpio).
// ============================================================
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadCatalogIndex } from '../persist';

type Resp = { data: unknown[] | null; error: { message: string } | null };

const OK: Resp = { data: [], error: null };

/** Fake mínimo: `db.from(tabla).select(cols)` awaited directamente (sin .eq/.order). */
function makeFakeDb(responses: Partial<Record<string, Resp>>): SupabaseClient {
  const db = {
    from(table: string) {
      return {
        select() {
          return Promise.resolve(responses[table] ?? { data: [], error: null });
        },
      };
    },
  };
  return db as unknown as SupabaseClient;
}

describe('loadCatalogIndex — falla explícita si algún catálogo no cargó', () => {
  it('marcas responde error → rechaza con mensaje que incluye la tabla', async () => {
    const db = makeFakeDb({
      marcas: { data: null, error: { message: 'JWT issued at future' } },
      marca_alias: OK,
      familias: OK,
      almacenes: OK,
      kams: OK,
      estatus_alias: OK,
    });
    await expect(loadCatalogIndex(db)).rejects.toThrow(/catalogos_no_disponibles: marcas: JWT issued at future/);
  });

  it('kams responde error → rechaza mencionando "kams" (no se traga en silencio como índice vacío)', async () => {
    const db = makeFakeDb({
      marcas: OK,
      marca_alias: OK,
      familias: OK,
      almacenes: OK,
      kams: { data: null, error: { message: 'timeout' } },
      estatus_alias: OK,
    });
    await expect(loadCatalogIndex(db)).rejects.toThrow(/catalogos_no_disponibles: kams: timeout/);
  });

  it('estatus_alias responde error → rechaza (caso real: cuarentenaría TODOS los embarques en silencio)', async () => {
    const db = makeFakeDb({
      marcas: OK,
      marca_alias: OK,
      familias: OK,
      almacenes: OK,
      kams: OK,
      estatus_alias: { data: null, error: { message: 'conexión perdida' } },
    });
    await expect(loadCatalogIndex(db)).rejects.toThrow(/catalogos_no_disponibles: estatus_alias: conexión perdida/);
  });

  it('caso feliz: los 6 catálogos responden ok → arma el índice sin lanzar (sin regresión)', async () => {
    const db = makeFakeDb({
      marcas: { data: [{ id: 'm-1', nombre: 'BRAND1' }], error: null },
      marca_alias: { data: [{ alias: 'brand1', marca_id: 'm-1' }], error: null },
      familias: { data: [{ id: 'f-1', nombre: 'SERIES11' }], error: null },
      almacenes: { data: [{ id: 'a-1', clave: 'NORTH' }], error: null },
      kams: { data: [{ id: 'k-1', nombre: 'Laura' }], error: null },
      estatus_alias: { data: [{ alias: 'en aduana', orden: 7 }], error: null },
    });
    const idx = await loadCatalogIndex(db);
    expect(idx.marcaByNombre.get('BRAND1')).toBe('m-1');
    expect(idx.marcaAlias.get('brand1')).toBe('m-1');
    expect(idx.familiaByNombre.get('SERIES11')).toBe('f-1');
    expect(idx.almacenByClave.get('NORTH')).toBe('a-1');
    expect(idx.kamByNombre.get('laura')).toBe('k-1');
    expect(idx.estatusAlias.get('en aduana')).toBe(7);
  });
});
