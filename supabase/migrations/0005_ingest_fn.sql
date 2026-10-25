-- ============================================================
-- Bloque 2 · Demo Inventory · 0005_ingest_fn.sql
-- RPC transaccional de ingesta: public.ingest_snapshot(payload jsonb).
-- Una sola llamada = atómica (cualquier fallo → ROLLBACK total).
-- Resolución de FK — una sola estrategia por tipo de catálogo:
--  · DINÁMICOS (marcas, familias): viajan por NOMBRE; la función inserta
--    los nuevos y resuelve el id por nombre dentro de la transacción.
--  · FIJOS (almacenes, kams, estatus): el id/orden se resuelve en JS con
--    normalizeAliasKey y viaja en el payload (almacen_id, kam_id,
--    estatus_orden) → sin re-resolución por nombre, sin regresión de acentos.
-- SECURITY DEFINER (bypassa RLS) → EXECUTE restringido a service_role.
-- La aplica el operador por MCP; este archivo solo la declara. PG 15.
-- CREATE OR REPLACE = re-aplicable.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.ingest_snapshot(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  snap    jsonb := payload -> 'snapshot';
  snap_id uuid;
BEGIN
  -- (1) snapshot (inmutable) ---------------------------------
  INSERT INTO public.snapshots (fuente, hash, periodo, archivo, filas, created_by)
  VALUES (
    snap ->> 'fuente',
    snap ->> 'hash',
    snap ->> 'periodo',
    snap ->> 'archivo',
    nullif(snap ->> 'filas', '')::integer,
    snap ->> 'created_by'
  )
  RETURNING id INTO snap_id;

  -- (2) alta de catálogos nuevos (idempotente) ---------------
  INSERT INTO public.marcas (nombre)
  SELECT m
  FROM jsonb_array_elements_text(coalesce(payload -> 'marcasNuevas', '[]'::jsonb)) AS m
  ON CONFLICT (nombre) DO NOTHING;

  INSERT INTO public.familias (nombre)
  SELECT f
  FROM jsonb_array_elements_text(coalesce(payload -> 'familiasNuevas', '[]'::jsonb)) AS f
  ON CONFLICT (nombre) DO NOTHING;

  -- (3) productos (upsert por sku; sku inmutable → trigger OK)
  INSERT INTO public.productos (sku, marca_id, familia_id, class, descr_origen, cliente, resv, snapshot_id)
  SELECT
    p ->> 'sku',
    (SELECT id FROM public.marcas   WHERE nombre = p ->> 'marca'),
    (SELECT id FROM public.familias WHERE nombre = p ->> 'familia'),
    p ->> 'class',
    p ->> 'descr_origen',
    p ->> 'cliente',
    coalesce((p ->> 'resv')::integer, 0),
    snap_id
  FROM jsonb_array_elements(coalesce(payload -> 'productos', '[]'::jsonb)) AS p
  ON CONFLICT (sku) DO UPDATE SET
    marca_id     = EXCLUDED.marca_id,
    familia_id   = EXCLUDED.familia_id,
    class        = EXCLUDED.class,
    descr_origen = EXCLUDED.descr_origen,
    cliente      = EXCLUDED.cliente,
    resv         = EXCLUDED.resv,
    snapshot_id  = EXCLUDED.snapshot_id;

  -- (4) stock por almacén (almacen_id resuelto en JS por clave) ----
  --     Catálogo FIJO: el id viaja en el payload; sin re-resolución aquí.
  INSERT INTO public.stock_por_almacen (sku, almacen_id, snapshot_id, cantidad)
  SELECT
    s ->> 'sku',
    (s ->> 'almacen_id')::uuid,
    snap_id,
    coalesce((s ->> 'cantidad')::integer, 0)
  FROM jsonb_array_elements(coalesce(payload -> 'stock', '[]'::jsonb)) AS s;

  -- (5) reservas (kam_id resuelto en JS vía normalizeAliasKey; nullable)
  --     Catálogo FIJO: el id viaja en el payload; sin re-resolución por
  --     upper(nombre) → sin regresión de acentos.
  INSERT INTO public.reservas (sku, kam_id, cliente, cantidad, motivo, fecha, snapshot_id)
  SELECT
    r ->> 'sku',
    nullif(r ->> 'kam_id', '')::uuid,
    r ->> 'cliente',
    (r ->> 'cantidad')::integer,
    r ->> 'motivo',
    (r ->> 'fecha')::date,
    snap_id
  FROM jsonb_array_elements(coalesce(payload -> 'reservas', '[]'::jsonb)) AS r;

  -- (6) embarques (estatus_id = estatus_orden 1..11) ---------
  INSERT INTO public.embarques (
    sku, oc_po, proveedor, referencia, factura, pais_origen, piezas, fw, tipo_importacion,
    fecha_recoleccion, etd, eta, fecha_llegada, fecha_disponibilidad,
    estatus_id, proyecto, observaciones, is_historial, snapshot_id
  )
  SELECT
    e ->> 'sku',
    e ->> 'oc_po',
    e ->> 'proveedor',
    e ->> 'referencia',
    e ->> 'factura',
    e ->> 'pais_origen',
    nullif(e ->> 'piezas', '')::integer,
    e ->> 'fw',
    e ->> 'tipo_importacion',
    nullif(e ->> 'fecha_recoleccion', '')::date,
    nullif(e ->> 'etd', '')::date,
    nullif(e ->> 'eta', '')::date,
    nullif(e ->> 'fecha_llegada', '')::date,
    nullif(e ->> 'fecha_disponibilidad', '')::date,
    (e ->> 'estatus_orden')::smallint,
    e ->> 'proyecto',
    e ->> 'observaciones',
    coalesce((e ->> 'is_historial')::boolean, false),
    snap_id
  FROM jsonb_array_elements(coalesce(payload -> 'embarques', '[]'::jsonb)) AS e;

  -- (7) cambios (append-only) --------------------------------
  INSERT INTO public.cambios (snapshot_id, entidad, clave, sku, campo, valor_anterior, valor_nuevo, tipo)
  SELECT
    snap_id,
    c ->> 'entidad',
    c ->> 'clave',
    c ->> 'sku',
    c ->> 'campo',
    c ->> 'valor_anterior',
    c ->> 'valor_nuevo',
    c ->> 'tipo'
  FROM jsonb_array_elements(coalesce(payload -> 'cambios', '[]'::jsonb)) AS c;

  RETURN snap_id;
END;
$$;

-- ------------------------------------------------------------
-- Seguridad: la función bypassa RLS (SECURITY DEFINER). Solo el
-- service_role (ETL server-side) puede ejecutarla.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ingest_snapshot(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_snapshot(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ingest_snapshot(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_snapshot(jsonb) TO service_role;

COMMIT;
