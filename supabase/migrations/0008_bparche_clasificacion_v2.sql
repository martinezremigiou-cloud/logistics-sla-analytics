-- ============================================================
-- B-PARCHE · F1 · 0008_bparche_clasificacion_v2.sql
-- Cimientos de la capa de clasificación v2: capa INTERPRETATIVA,
-- puramente data-driven, que se apila SOBRE la fuente cruda de
-- `productos` (marca/familia/class/descr_origen) sin sustituirla.
-- El ETL de B2 (`ingest_snapshot`) NO conoce estas tablas: la
-- ingesta de existencia/stock/reservas/embarques sigue exactamente
-- igual. Esta capa SOLO afecta interpretación de catálogo (marca,
-- familia, clase, descripción, tecnología), jamás disponibilidad
-- ni cantidades.
-- (1) tecnologias — catálogo nuevo (dinámico, análogo a marcas/familias).
-- (2) clasificacion_v2 — 1 fila por sku con los 5 campos v2 (nullable).
-- (3) RLS en ambas: SELECT autenticados · INSERT/UPDATE solo admin.
--     Sin DELETE: la capa no borra (EMPTY-NEVER-CLEARS).
-- (4) RPC aplicar_clasificacion_v2(payload) — upsert atómico + siembra
--     idempotente de catálogos nuevos descubiertos en la fuente v2.
-- Re-ejecutable · IDEMPOTENTE · PG 15.
-- La aplica el operador por MCP; este archivo solo la declara.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) tecnologias
-- Catálogo controlado de tecnologías (extensible por admin o por
-- la siembra automática del RPC de abajo). Mismo patrón que
-- `marcas`/`familias`: UNIQUE(nombre) + índice case-insensitive.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tecnologias (
    id      uuid    NOT NULL DEFAULT gen_random_uuid(),
    nombre  text    NOT NULL,
    activo  boolean NOT NULL DEFAULT true,

    CONSTRAINT tecnologias_pkey PRIMARY KEY (id),
    CONSTRAINT tecnologias_nombre_unique UNIQUE (nombre)
);

CREATE UNIQUE INDEX IF NOT EXISTS tecnologias_nombre_lower_uidx
    ON public.tecnologias (lower(nombre));

-- ------------------------------------------------------------
-- (2) clasificacion_v2
-- 1 fila por sku (PK = sku, FK → productos). Los 5 campos son
-- nullable: una fila puede traer solo algunos campos poblados.
-- fuente_version identifica la corrida de origen (trazabilidad);
-- updated_by/updated_at = último RPC que tocó la fila.
-- Sin valor_original ni historial: el valor prístino de fuente
-- sigue viviendo en `productos` (descr_origen/marca_id/familia_id/class).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clasificacion_v2 (
    sku             text        NOT NULL,
    tecnologia      text,
    marca_v2        text,
    familia_v2      text,
    clase_v2        text,
    descr_v2        text,
    fuente_version  text        NOT NULL,
    updated_by      text,
    updated_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT clasificacion_v2_pkey PRIMARY KEY (sku),
    CONSTRAINT clasificacion_v2_sku_fkey
        FOREIGN KEY (sku) REFERENCES public.productos(sku)
);

CREATE INDEX IF NOT EXISTS idx_clasificacion_v2_tecnologia
    ON public.clasificacion_v2 (tecnologia);
CREATE INDEX IF NOT EXISTS idx_clasificacion_v2_familia_v2
    ON public.clasificacion_v2 (familia_v2);
CREATE INDEX IF NOT EXISTS idx_clasificacion_v2_marca_v2
    ON public.clasificacion_v2 (marca_v2);

-- ------------------------------------------------------------
-- (3) RLS — patrón exacto de 0002/0006: SELECT autenticados;
-- INSERT/UPDATE solo admin. SIN DELETE (la capa no borra).
-- ------------------------------------------------------------
ALTER TABLE public.tecnologias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clasificacion_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tecnologias_select_auth ON public.tecnologias;
CREATE POLICY tecnologias_select_auth
    ON public.tecnologias
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS tecnologias_admin_insert ON public.tecnologias;
CREATE POLICY tecnologias_admin_insert
    ON public.tecnologias
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS tecnologias_admin_update ON public.tecnologias;
CREATE POLICY tecnologias_admin_update
    ON public.tecnologias
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS clasificacion_v2_select_auth ON public.clasificacion_v2;
CREATE POLICY clasificacion_v2_select_auth
    ON public.clasificacion_v2
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS clasificacion_v2_admin_insert ON public.clasificacion_v2;
CREATE POLICY clasificacion_v2_admin_insert
    ON public.clasificacion_v2
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS clasificacion_v2_admin_update ON public.clasificacion_v2;
CREATE POLICY clasificacion_v2_admin_update
    ON public.clasificacion_v2
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- (4) RPC aplicar_clasificacion_v2(payload jsonb)
-- Atómica: siembra idempotente de catálogos nuevos descubiertos
-- en la fuente v2 (tecnologías/familias/marcas/alias de marca) +
-- upsert de las filas de clasificación por sku.
-- EMPTY-NEVER-CLEARS: el builder (JS) nunca emite campos vacíos;
-- y aunque llegara NULL en `filas`, el ON CONFLICT usa
-- coalesce(EXCLUDED.campo, c.campo) → un NULL entrante JAMÁS borra
-- un valor ya guardado, solo lo deja intacto.
-- SECURITY DEFINER (bypassa RLS) → solo admin puede invocarla
-- (guard explícito is_admin(), además de EXECUTE restringido).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_clasificacion_v2(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor          text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_fuente_version text := payload ->> 'fuente_version';
  v_escritas       integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF v_fuente_version IS NULL OR btrim(v_fuente_version) = '' THEN
    RAISE EXCEPTION 'fuente_version requerida' USING errcode = '22023';
  END IF;

  -- (a) siembra idempotente de catálogos nuevos ------------------
  INSERT INTO public.tecnologias (nombre)
  SELECT t
  FROM jsonb_array_elements_text(coalesce(payload -> 'tecnologiasNuevas', '[]'::jsonb)) AS t
  ON CONFLICT (nombre) DO NOTHING;

  INSERT INTO public.familias (nombre)
  SELECT f
  FROM jsonb_array_elements_text(coalesce(payload -> 'familiasNuevas', '[]'::jsonb)) AS f
  ON CONFLICT (nombre) DO NOTHING;

  INSERT INTO public.marcas (nombre)
  SELECT m
  FROM jsonb_array_elements_text(coalesce(payload -> 'marcasNuevas', '[]'::jsonb)) AS m
  ON CONFLICT (nombre) DO NOTHING;

  -- `marca_id` es NOT NULL + FK (0001): un elemento cuya `marca` no
  -- exista (aún) en el catálogo produciría un NULL que violaría esa
  -- constraint y abortaría TODA la RPC (incluida la siembra de
  -- tecnologias/familias/marcas y el upsert de `filas[]` ya resueltos
  -- arriba en la misma transacción). Se filtra en el WHERE: ese alias
  -- puntual se degrada a skip silencioso en vez de tumbar la corrida
  -- completa.
  INSERT INTO public.marca_alias (alias, marca_id)
  SELECT
    a ->> 'alias',
    (SELECT id FROM public.marcas WHERE nombre = a ->> 'marca')
  FROM jsonb_array_elements(coalesce(payload -> 'marcaAliasNuevos', '[]'::jsonb)) AS a
  WHERE (SELECT id FROM public.marcas WHERE nombre = a ->> 'marca') IS NOT NULL
  ON CONFLICT (alias) DO NOTHING;

  -- (b) upsert de filas por sku (EMPTY-NEVER-CLEARS) -------------
  INSERT INTO public.clasificacion_v2 AS c (
    sku, tecnologia, marca_v2, familia_v2, clase_v2, descr_v2,
    fuente_version, updated_by, updated_at
  )
  SELECT
    f.sku, f.tecnologia, f.marca_v2, f.familia_v2, f.clase_v2, f.descr_v2,
    v_fuente_version, v_actor, now()
  FROM jsonb_to_recordset(coalesce(payload -> 'filas', '[]'::jsonb)) AS f(
    sku text, tecnologia text, marca_v2 text, familia_v2 text, clase_v2 text, descr_v2 text
  )
  ON CONFLICT (sku) DO UPDATE SET
    tecnologia     = coalesce(EXCLUDED.tecnologia, c.tecnologia),
    marca_v2       = coalesce(EXCLUDED.marca_v2, c.marca_v2),
    familia_v2     = coalesce(EXCLUDED.familia_v2, c.familia_v2),
    clase_v2       = coalesce(EXCLUDED.clase_v2, c.clase_v2),
    descr_v2       = coalesce(EXCLUDED.descr_v2, c.descr_v2),
    fuente_version = v_fuente_version,
    updated_by     = v_actor,
    updated_at     = now();

  GET DIAGNOSTICS v_escritas = ROW_COUNT;

  RETURN jsonb_build_object(
    'escritas', v_escritas,
    'version', v_fuente_version,
    'actor', v_actor
  );
END;
$$;

REVOKE ALL   ON FUNCTION public.aplicar_clasificacion_v2(jsonb) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.aplicar_clasificacion_v2(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.aplicar_clasificacion_v2(jsonb) TO authenticated;

COMMIT;
