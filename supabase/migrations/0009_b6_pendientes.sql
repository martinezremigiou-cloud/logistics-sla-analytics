-- ============================================================
-- Bloque 6 · 0009_b6_pendientes.sql
-- (1) reservas.kam_raw (se puebla desde esta migración en adelante:
--     buildIngestPayload ya emite 'kam' — encendido ratificado B6)
-- (2) pendientes_datos + índices + RLS (SELECT admin-only)
-- (3) RPC resolver_pendiente + contar_pendientes (patrón 0006/0008)
-- (4) CREATE OR REPLACE ingest_snapshot: + kam_raw + encolado kam_desconocido
-- (5) SEED: pendientes iniciales: uno descartado, uno resuelto, marca_west y colisiones (abiertos)
-- Idempotente (IF NOT EXISTS / ON CONFLICT). La aplica el operador por MCP. PG 15.
-- ============================================================
BEGIN;

ALTER TABLE public.reservas ADD COLUMN IF NOT EXISTS kam_raw text;

CREATE TABLE IF NOT EXISTS public.pendientes_datos (
    id             uuid        NOT NULL DEFAULT gen_random_uuid(),
    tipo           text        NOT NULL,
    clave_natural  text        NOT NULL,
    estado         text        NOT NULL DEFAULT 'abierto',
    payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    detectado_por  text        NOT NULL DEFAULT 'etl',
    detectado_en   timestamptz NOT NULL DEFAULT now(),
    snapshot_id    uuid,
    resolucion     jsonb,
    resuelto_por   text,
    resuelto_en    timestamptz,
    CONSTRAINT pendientes_datos_pkey PRIMARY KEY (id),
    CONSTRAINT pendientes_datos_uniq UNIQUE (tipo, clave_natural),
    CONSTRAINT pendientes_datos_tipo_check
        CHECK (tipo IN ('kam_desconocido','marca_west','colision_familia','cuarentena_etl')),
    CONSTRAINT pendientes_datos_estado_check
        CHECK (estado IN ('abierto','resuelto','descartado')),
    CONSTRAINT pendientes_datos_resuelto_check
        CHECK (estado = 'abierto' OR (resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL)),
    CONSTRAINT pendientes_datos_snapshot_fkey
        FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_pendientes_estado      ON public.pendientes_datos (estado);
CREATE INDEX IF NOT EXISTS idx_pendientes_tipo_estado ON public.pendientes_datos (tipo, estado);
CREATE INDEX IF NOT EXISTS idx_pendientes_abiertos    ON public.pendientes_datos (tipo) WHERE estado = 'abierto';
CREATE INDEX IF NOT EXISTS idx_pendientes_snapshot    ON public.pendientes_datos (snapshot_id);

ALTER TABLE public.pendientes_datos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pendientes_datos_admin_select ON public.pendientes_datos;
CREATE POLICY pendientes_datos_admin_select
    ON public.pendientes_datos FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.resolver_pendiente(
  p_id uuid, p_accion text, p_motivo text DEFAULT NULL, p_valor text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_p      public.pendientes_datos%ROWTYPE;
  v_nombre text;
  v_kam_id uuid;
  v_ref    jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF p_accion NOT IN ('confirmar','descartar') THEN
    RAISE EXCEPTION 'accion invalida' USING errcode = '22023'; END IF;

  SELECT * INTO v_p FROM public.pendientes_datos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pendiente inexistente' USING errcode = 'P0002'; END IF;
  IF v_p.estado <> 'abierto' THEN
    RAISE EXCEPTION 'pendiente ya resuelto/descartado' USING errcode = '22023'; END IF;

  IF p_accion = 'descartar' THEN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
      RAISE EXCEPTION 'motivo requerido para descartar' USING errcode = '22023'; END IF;
    UPDATE public.pendientes_datos
       SET estado='descartado', resuelto_por=v_actor, resuelto_en=now(),
           resolucion=jsonb_build_object('accion','descartar','motivo',p_motivo)
     WHERE id=p_id;
    RETURN jsonb_build_object('estado','descartado','actor',v_actor);
  END IF;

  IF v_p.tipo = 'kam_desconocido' THEN
    v_nombre := coalesce(nullif(btrim(p_valor),''), v_p.payload ->> 'kam_raw');
    IF v_nombre IS NULL OR btrim(v_nombre) = '' THEN
      RAISE EXCEPTION 'nombre de KAM requerido' USING errcode = '22023'; END IF;
    -- Matching normalizado ANTES de insertar (evita duplicados tipo 'Nadia' vs
    -- 'NADIA' que el ON CONFLICT DO NOTHING + re-SELECT exacto dejaba pasar).
    SELECT id INTO v_kam_id FROM public.kams WHERE lower(btrim(nombre)) = lower(btrim(v_nombre));
    IF v_kam_id IS NULL THEN
      INSERT INTO public.kams (nombre) VALUES (v_nombre) RETURNING id INTO v_kam_id;
    END IF;
    v_ref := jsonb_build_object('kam_id', v_kam_id);
  END IF;

  UPDATE public.pendientes_datos
     SET estado='resuelto', resuelto_por=v_actor, resuelto_en=now(),
         resolucion=jsonb_build_object('accion','confirmar','motivo',p_motivo) || v_ref
   WHERE id=p_id;
  RETURN jsonb_build_object('estado','resuelto','actor',v_actor,'ref',v_ref);
END;
$$;
REVOKE ALL   ON FUNCTION public.resolver_pendiente(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_pendiente(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.contar_pendientes()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'abiertos', (SELECT count(*) FROM public.pendientes_datos WHERE estado='abierto'),
    'por_tipo', coalesce((SELECT jsonb_object_agg(tipo, c) FROM (
        SELECT tipo, count(*) c FROM public.pendientes_datos
        WHERE estado='abierto' GROUP BY tipo) t), '{}'::jsonb));
$$;
REVOKE ALL   ON FUNCTION public.contar_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contar_pendientes() TO authenticated;

-- (4) ingest_snapshot con kam_raw + encolado (cuerpo completo = 0005 + 2 adiciones)
CREATE OR REPLACE FUNCTION public.ingest_snapshot(payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  snap    jsonb := payload -> 'snapshot';
  snap_id uuid;
BEGIN
  INSERT INTO public.snapshots (fuente, hash, periodo, archivo, filas, created_by)
  VALUES (snap->>'fuente', snap->>'hash', snap->>'periodo', snap->>'archivo',
          nullif(snap->>'filas','')::integer, snap->>'created_by')
  RETURNING id INTO snap_id;

  INSERT INTO public.marcas (nombre)
  SELECT m FROM jsonb_array_elements_text(coalesce(payload->'marcasNuevas','[]'::jsonb)) AS m
  ON CONFLICT (nombre) DO NOTHING;
  INSERT INTO public.familias (nombre)
  SELECT f FROM jsonb_array_elements_text(coalesce(payload->'familiasNuevas','[]'::jsonb)) AS f
  ON CONFLICT (nombre) DO NOTHING;

  INSERT INTO public.productos (sku, marca_id, familia_id, class, descr_origen, cliente, resv, snapshot_id)
  SELECT p->>'sku',
    (SELECT id FROM public.marcas WHERE nombre = p->>'marca'),
    (SELECT id FROM public.familias WHERE nombre = p->>'familia'),
    p->>'class', p->>'descr_origen', p->>'cliente',
    coalesce((p->>'resv')::integer,0), snap_id
  FROM jsonb_array_elements(coalesce(payload->'productos','[]'::jsonb)) AS p
  ON CONFLICT (sku) DO UPDATE SET
    marca_id=EXCLUDED.marca_id, familia_id=EXCLUDED.familia_id, class=EXCLUDED.class,
    descr_origen=EXCLUDED.descr_origen, cliente=EXCLUDED.cliente, resv=EXCLUDED.resv,
    snapshot_id=EXCLUDED.snapshot_id;

  INSERT INTO public.stock_por_almacen (sku, almacen_id, snapshot_id, cantidad)
  SELECT s->>'sku', (s->>'almacen_id')::uuid, snap_id, coalesce((s->>'cantidad')::integer,0)
  FROM jsonb_array_elements(coalesce(payload->'stock','[]'::jsonb)) AS s;

  -- reservas: + kam_raw (crudo del Excel; poblado desde que buildIngestPayload emite 'kam')
  INSERT INTO public.reservas (sku, kam_id, kam_raw, cliente, cantidad, motivo, fecha, snapshot_id)
  SELECT r->>'sku', nullif(r->>'kam_id','')::uuid, nullif(r->>'kam',''),
         r->>'cliente', (r->>'cantidad')::integer, r->>'motivo', (r->>'fecha')::date, snap_id
  FROM jsonb_array_elements(coalesce(payload->'reservas','[]'::jsonb)) AS r;

  INSERT INTO public.embarques (
    sku, oc_po, proveedor, referencia, factura, pais_origen, piezas, fw, tipo_importacion,
    fecha_recoleccion, etd, eta, fecha_llegada, fecha_disponibilidad,
    estatus_id, proyecto, observaciones, is_historial, snapshot_id)
  SELECT e->>'sku', e->>'oc_po', e->>'proveedor', e->>'referencia', e->>'factura', e->>'pais_origen',
    nullif(e->>'piezas','')::integer, e->>'fw', e->>'tipo_importacion',
    nullif(e->>'fecha_recoleccion','')::date, nullif(e->>'etd','')::date, nullif(e->>'eta','')::date,
    nullif(e->>'fecha_llegada','')::date, nullif(e->>'fecha_disponibilidad','')::date,
    (e->>'estatus_orden')::smallint, e->>'proyecto', e->>'observaciones',
    coalesce((e->>'is_historial')::boolean,false), snap_id
  FROM jsonb_array_elements(coalesce(payload->'embarques','[]'::jsonb)) AS e;

  INSERT INTO public.cambios (snapshot_id, entidad, clave, sku, campo, valor_anterior, valor_nuevo, tipo)
  SELECT snap_id, c->>'entidad', c->>'clave', c->>'sku', c->>'campo',
         c->>'valor_anterior', c->>'valor_nuevo', c->>'tipo'
  FROM jsonb_array_elements(coalesce(payload->'cambios','[]'::jsonb)) AS c;

  -- Encolado kam_desconocido del snapshot recién insertado.
  -- Dedupe por (tipo, clave_natural): un descartado/resuelto JAMÁS reaparece.
  INSERT INTO public.pendientes_datos (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
  SELECT 'kam_desconocido', k.clave, 'abierto', 'etl', snap_id,
         jsonb_build_object('kam_raw', k.kam_raw, 'ocurrencias', k.n, 'skus', k.skus)
  FROM (
    SELECT lower(regexp_replace(btrim(r.kam_raw),'\s+',' ','g')) AS clave,
           min(r.kam_raw) AS kam_raw, count(*) AS n,
           jsonb_agg(DISTINCT r.sku ORDER BY r.sku) AS skus
    FROM public.reservas r
    WHERE r.snapshot_id = snap_id AND r.kam_id IS NULL AND r.kam_raw IS NOT NULL
    GROUP BY 1
  ) k
  ON CONFLICT (tipo, clave_natural) DO NOTHING;

  RETURN snap_id;
END;
$$;
REVOKE ALL    ON FUNCTION public.ingest_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_snapshot(jsonb) TO service_role;

-- (5) SEED
INSERT INTO public.pendientes_datos (tipo, clave_natural, estado, detectado_por, payload)
SELECT 'marca_west', sku, 'abierto', 'clasificacion_v2',
  jsonb_build_object('sku', sku, 'marca_actual', 'NACIONAL',
    'evidencia', 'MARCA=WEST en Inventario sin contraparte en hoja INV_WEST; cross-ref v2 no resuelto (B-PARCHE)')
FROM unnest(ARRAY[
  'Producto Demo A','Producto Demo B','Producto Demo C','JT2639','RL2959','LU1988',
  'WF1986 II TENSOR','KB4789','HV3602','VT4159 CABLE RETAILER24','Producto Demo D','Producto Demo E',
  'EYA2515','AYG3257GR (LZ1832)','Producto Demo F','EC969-AG','PT390-YR','EP342-HM',
  'JE016-YD','Producto Demo G','Producto Demo H']) AS sku
ON CONFLICT (tipo, clave_natural) DO NOTHING;

INSERT INTO public.pendientes_datos (tipo, clave_natural, estado, detectado_por, payload) VALUES
 ('colision_familia', lower('SERIES 2 26 / SERIES 2 38'), 'abierto', 'clasificacion_v2',
  jsonb_build_object('campo','familia','canonico','SERIES 2 26 / SERIES 2 38',
    'variantes', jsonb_build_array('SERIES 2 26  / SERIES 2 38','SERIES 2 26 / SERIES 2 38'),
    'skus', jsonb_build_array('GLN8003','RRC3965','CUU960-V','UDM839-K','YBN820','HDL621',
      'VXA840-F','GXQ203-A','YET196-F','TYY790-Z','DZN923-J','MFU162-J','UZQ102-C','BFC196-D',
      'VYF012-T','WCA761','EN763'))),
 ('colision_familia', lower('CLIP 3.0 / CLIP MODULAR'), 'abierto', 'clasificacion_v2',
  jsonb_build_object('campo','familia','canonico','CLIP 3.0 / CLIP MODULAR',
    'variantes', jsonb_build_array('CLIP 3.0 /  CLIP MODULAR','CLIP 3.0 / CLIP MODULAR'),
    'skus', jsonb_build_array('WQ7230-K','CU6396-D'))),
 ('colision_familia', lower('CLIP 3.0 / CLIPS MODULAR ALTA SEGURIDAD'), 'abierto', 'clasificacion_v2',
  jsonb_build_object('campo','familia','canonico','CLIP 3.0 / CLIPS MODULAR ALTA SEGURIDAD',
    'variantes', jsonb_build_array('CLIP 3.0 /  CLIPS MODULAR ALTA SEGURIDAD','CLIP 3.0 / CLIPS MODULAR ALTA SEGURIDAD'),
    'skus', jsonb_build_array('BS4638-Q','LD9385-Y','MZ7513','MP9504')))
ON CONFLICT (tipo, clave_natural) DO NOTHING;

INSERT INTO public.pendientes_datos
  (tipo, clave_natural, estado, detectado_por, snapshot_id, payload, resolucion, resuelto_por, resuelto_en)
SELECT 'kam_desconocido','retailer24','descartado','po',
  (SELECT id FROM public.snapshots WHERE fuente='stock' ORDER BY created_at DESC LIMIT 1),
  jsonb_build_object('kam_raw','RETAILER24',
    'evidencia','Reservas con cliente=RETAILER24 y kam_id NULL (ING-6); el texto aparece en la celda KAM del pivote',
    'skus', coalesce((SELECT jsonb_agg(DISTINCT sku ORDER BY sku) FROM public.reservas
       WHERE snapshot_id=(SELECT id FROM public.snapshots WHERE fuente='stock' ORDER BY created_at DESC LIMIT 1)
         AND upper(cliente)='RETAILER24' AND kam_id IS NULL),'[]'::jsonb)),
  jsonb_build_object('accion','descartar','motivo','Artefacto del pivote — no es KAM (veredicto PO 2026-07-19)'),
  'po', now()
ON CONFLICT (tipo, clave_natural) DO NOTHING;

INSERT INTO public.pendientes_datos
  (tipo, clave_natural, estado, detectado_por, snapshot_id, payload, resolucion, resuelto_por, resuelto_en)
SELECT 'kam_desconocido','nadia','resuelto','po',
  (SELECT id FROM public.snapshots WHERE fuente='stock' ORDER BY created_at DESC LIMIT 1),
  jsonb_build_object('kam_raw','NADIA',
    'evidencia','Reservas de julio con kam_id NULL; el texto crudo se perdió al persistir (pre-B6: buildIngestPayload no emitía kam)'),
  jsonb_build_object('accion','confirmar','motivo','KAM real; insertada en kams por el bridge post-INGESTA2',
    'kam_id', (SELECT id FROM public.kams WHERE lower(btrim(nombre))='nadia')),
  'bridge', now()
ON CONFLICT (tipo, clave_natural) DO NOTHING;

COMMIT;
