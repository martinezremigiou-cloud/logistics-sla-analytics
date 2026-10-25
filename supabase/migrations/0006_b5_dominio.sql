-- ============================================================
-- Bloque 5 · 0006_b5_dominio.sql
-- (1) color en productos_metadata (paleta curada 8 slugs)
-- (2) RPC aplicar_override — override atómico multi-admin (cierra B3-1 y B1-7).
--     p_valor IS NULL = reversión REAL (D3): desactiva el override activo del
--     campo (UPDATE activo=false) SIN insertar uno nuevo — la efectiva vuelve
--     a leer el valor PRÍSTINO de la fuente (productos.descr_origen /
--     familias vía productos.familia_id) y sigue las ingestas futuras, en vez
--     de quedar fijada al valor "original" como si fuera un override más.
-- (3) UNIQUE lower(nombre) en familias (cierra B3-5; PRE-CHECK previo: cero duplicados en las familias existentes)
-- (4) hardening funciones SECURITY DEFINER (adelanto 3/6 WARN B1 + F3)
-- La aplica el operador por MCP ANTES que 0007. IDEMPOTENTE. PG 15.
-- ============================================================
BEGIN;

ALTER TABLE public.productos_metadata
  ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.productos_metadata
  DROP CONSTRAINT IF EXISTS productos_metadata_color_check;
ALTER TABLE public.productos_metadata
  ADD CONSTRAINT productos_metadata_color_check
  CHECK (color IS NULL OR color IN
    ('azul','verde','naranja','morado','rojo','turquesa','rosa','grafito'));

CREATE OR REPLACE FUNCTION public.aplicar_override(
  p_sku text, p_campo text, p_valor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_campo NOT IN ('familia','descripcion') THEN
    RAISE EXCEPTION 'campo invalido' USING errcode = '22023';
  END IF;

  UPDATE public.productos_override
     SET activo = false
   WHERE sku = p_sku AND campo = p_campo AND activo = true;

  -- p_valor NULL = "quitar override": solo desactiva (arriba); no inserta
  -- ningún registro nuevo, así el set activo que se regresa abajo queda SIN
  -- este campo y `efectivas()` cae de vuelta al valor de la fuente.
  IF p_valor IS NOT NULL THEN
    INSERT INTO public.productos_override
      (sku, campo, valor_editado, editado_por, activo)
    VALUES (p_sku, p_campo, p_valor, v_actor, true);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id', o.id, 'sku', o.sku, 'campo', o.campo,
           'valor_editado', o.valor_editado,
           'editado_en', o.editado_en, 'activo', o.activo))
    INTO v_result
    FROM public.productos_override o
   WHERE o.sku = p_sku AND o.activo = true;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL   ON FUNCTION public.aplicar_override(text,text,text) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.aplicar_override(text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.aplicar_override(text,text,text) TO authenticated;

-- PRE-CHECK ya corrido (PostgREST read-only): sin duplicados case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS familias_nombre_lower_uidx
  ON public.familias (lower(nombre));

-- is_admin(): authenticated DEBE retener EXECUTE (las policies RLS lo evalúan como el usuario).
REVOKE ALL   ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- Triggers: no requieren EXECUTE de ningún rol (se disparan por mecanismo de trigger).
REVOKE ALL ON FUNCTION public.handle_new_user()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_sku_immutable() FROM PUBLIC;

-- F3 (auditor): REVOKE FROM PUBLIC no basta si Supabase otorgó EXECUTE
-- directo a `authenticated`/`anon` vía sus default privileges del schema
-- `public` — se revoca explícito de ambos roles (defensa en profundidad;
-- ninguno de los dos triggers debe ser invocable como RPC).
REVOKE ALL ON FUNCTION public.handle_new_user()       FROM authenticated, anon;
REVOKE ALL ON FUNCTION public.protect_sku_immutable() FROM authenticated, anon;

COMMIT;
