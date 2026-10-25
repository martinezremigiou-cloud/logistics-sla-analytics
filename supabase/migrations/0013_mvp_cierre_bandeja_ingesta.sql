-- ============================================================
-- 0013 · [MVP-CIERRE] F2 — la ingesta pasa a ser PRODUCTORA de la bandeja
--
-- QUÉ CIERRA. La deuda B6-7: `pendientes_datos.detectado_por` solo contiene
-- `0011_taxo | 0012_b7b | clasificacion_v2 | po`. La ingesta nunca existió
-- como detector. Los SKU que entraron en la última ingesta lo hicieron MUDOS:
-- todos sin fila en `clasificacion_v2`, ninguno encolado.
--
-- CRITERIO DE ESTADO, NO DE EVENTO (decisión de producto). No se encolan "los
-- SKU nuevos" sino TODOS los que hoy no tienen tecnología efectiva, sin
-- importar cuándo llegaron. Medido contra la base viva (snapshot
-- del momento), son tres poblaciones y no una:
--
--   A · alta reciente, sin ficha v2 .......... n SKU  (algunos sin familia)
--   B · preexistente, sin ficha v2 ............ n SKU  (ninguno sin familia)
--   C · con ficha v2, tecnologia NULL/vacía ... n SKU  (algunos sin familia)
--   D · con tecnología ....................... n SKU
--
--   A+B+C = el nodo "Sin tecnología (N)" del Dashboard
--   A+B   = "sin ficha v2"
--   A+B+C+D = el catálogo. Cierra por los tres lados.
--
-- Las tres están en la MISMA condición operativa: un KAM no las encuentra
-- por el árbol. Encolar solo las recientes habría dejado la bandeja diciendo menos
-- mientras el Dashboard dice más — el mismo defecto de "contar una cosa y
-- mostrar otra" que F5 acaba de arreglar una tarjeta más allá.
--
-- POR QUÉ UN TIPO NUEVO Y NO `cuarentena_etl`. Verificado: `cuarentena_etl`
-- tiene CERO filas y ningún productor. Es la mitad de B6-7 todavía no
-- construida — el lugar reservado para lo que de verdad NO SE PUDO
-- procesar. Estos SKU se procesaron perfecto: entraron con stock, reservas
-- y embarques. Lo que falta es que un humano decida qué son. Llenar
-- `cuarentena_etl` con ellos gastaría el nombre y dejaría sin casa al
-- productor de cuarentena real.
--
-- POR QUÉ NO SE LLAMA `sku_nuevo_sin_clasificar`. Dos correcciones al
-- nombre, ambas medidas:
--   · NO están "sin clasificar": ninguno sin marca. Todos traen marca de la
--     fuente (VERTICAL, SERIES5, BRAND1) y algunos traen familia. Lo que falta
--     es la ficha v2, que es la capa que carga la TECNOLOGÍA.
--   · NO lleva "nuevo": un criterio de ESTADO no depende de cuándo llegó,
--     y "nuevo" envejece mal en una pantalla que alguien va a leer dentro
--     de seis meses.
-- El origen se distingue en `payload.evidencia`, no en el tipo.
--
-- TRANSACCIÓN EXPLÍCITA, como 0004–0012. La primera versión de este archivo
-- no la traía y se apoyaba en la transacción IMPLÍCITA que Postgres aplica a
-- un simple-query multi-sentencia. Funciona, pero hace que el todo-o-nada
-- dependa de CÓMO se aplique: `psql -f` sin `-1` manda sentencia por
-- sentencia y no habría atomicidad ninguna. Con `BEGIN; … COMMIT;` la
-- garantía es del archivo, no del corredor — y es la convención que las 9
-- migraciones anteriores ya seguían.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) El CHECK admite el tipo nuevo.
--     Se reconstruye entero —no se puede "agregar un valor" a un CHECK—
--     conservando los 6 vigentes de 0009+0011+0012.
-- ------------------------------------------------------------
-- El nombre EXACTO importa: es `pendientes_datos_tipo_check` (0009:29,
-- reemplazado por 0011:208 conservando el nombre). Escribirlo mal haría que
-- el `DROP ... IF EXISTS` no hiciera NADA en silencio y que el `ADD` dejara
-- un SEGUNDO check, con el viejo —sin el tipo nuevo— siguiendo vigente y
-- rechazando cada encolado. Verificado contra 0009 y 0011 antes de escribirlo.
ALTER TABLE public.pendientes_datos DROP CONSTRAINT IF EXISTS pendientes_datos_tipo_check;
ALTER TABLE public.pendientes_datos ADD CONSTRAINT pendientes_datos_tipo_check
  CHECK (tipo IN ('kam_desconocido','marca_west','colision_familia',
                  'cuarentena_etl','marca_ambigua','familia_atomo_dudoso',
                  'sku_sin_tecnologia'));

COMMENT ON COLUMN public.pendientes_datos.tipo IS
    'kam_desconocido | marca_west | colision_familia | cuarentena_etl | '
    'marca_ambigua | familia_atomo_dudoso | sku_sin_tecnologia. El último lo '
    'agrega [MVP-CIERRE] (0013): SKU vigente sin tecnología efectiva — sin '
    'ficha en clasificacion_v2, o con ficha y la tecnología vacía. Es un '
    'criterio de ESTADO, no de evento: no depende de cuándo entró el SKU, y '
    'se auto-cierra cuando deja de aplicar (payload: sku, campo, pregunta, '
    'poblacion, evidencia, sin_familia, marca_origen, familia_origen, '
    'descr_origen).';

-- GUARDA ANTI-SILENCIO (mismo patrón que 0011:230-255, que a su vez viene de
-- 0010:60-94). Un CHECK homónimo o huérfano de una aplicación anterior
-- vetaría el tipo nuevo EN SILENCIO: la migración "aplicaría" y la bandeja
-- simplemente nunca podría encolar — el backfill de abajo insertaría 0 filas
-- y nadie se enteraría. Se prueba el COMPORTAMIENTO real, no la definición.
DO $g0013$
DECLARE
    v_clave   text := '__probe_0013_mvp_cierre__';
    v_acepta  boolean := false;
    v_rechaza boolean := false;
BEGIN
    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    BEGIN
        INSERT INTO public.pendientes_datos (tipo, clave_natural, detectado_por)
        VALUES ('sku_sin_tecnologia', v_clave, '0013_mvp_cierre');
        v_acepta := true;
    EXCEPTION WHEN check_violation THEN
        v_acepta := false;
    END;

    IF NOT v_acepta THEN
        RAISE EXCEPTION '0013 (guarda): el CHECK vigente sobre pendientes_datos.tipo RECHAZA "sku_sin_tecnologia" justo después del ADD CONSTRAINT — hay otro CHECK vetándolo en silencio. Abortando.';
    END IF;

    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    -- Control POSITIVO del detector: si el CHECK aceptara CUALQUIER cosa, la
    -- prueba de arriba pasaría por inútil y no por sana.
    BEGIN
        INSERT INTO public.pendientes_datos (tipo, clave_natural, detectado_por)
        VALUES ('__tipo_que_no_existe__', v_clave, '0013_mvp_cierre');
        v_rechaza := false;
    EXCEPTION WHEN check_violation THEN
        v_rechaza := true;
    END;

    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    IF NOT v_rechaza THEN
        RAISE EXCEPTION '0013 (guarda): el CHECK sobre pendientes_datos.tipo ACEPTA un tipo inventado — no está filtrando nada. Abortando.';
    END IF;
END $g0013$;

-- ------------------------------------------------------------
-- (2) El productor + el auto-cierre, en UNA función.
--
--     Vive aparte y no inline en `ingest_snapshot` para que el BACKFILL y
--     la INGESTA usen exactamente el mismo código: dos copias del criterio
--     podrían divergir y producir una bandeja que no coincide con el
--     Dashboard, que es justo lo que este frente viene a arreglar.
--
--     La llama `ingest_snapshot` DENTRO de su transacción: el encolado es
--     atómico con el snapshot que lo motivó.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_pendientes_tecnologia(p_snapshot uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_snap      uuid;
  v_encolados integer := 0;
  v_cerrados  integer := 0;
  v_baja      integer := 0;
BEGIN
  -- En el backfill no viene snapshot: se resuelve el vigente de STOCK para
  -- poder distinguir la población A (alta reciente) de la B.
  v_snap := coalesce(
    p_snapshot,
    (SELECT s.id FROM public.snapshots s
      WHERE s.fuente = 'stock' ORDER BY s.created_at DESC, s.id DESC LIMIT 1)
  );

  -- ---------- ENCOLADO ----------
  -- Idempotente por el UNIQUE(tipo, clave_natural) que 0009 ya declaró: no
  -- se construye deduplicación propia, y un pendiente ya resuelto o
  -- descartado JAMÁS reaparece (misma garantía que `kam_desconocido`).
  WITH sin_tecnologia AS (
    SELECT
      p.sku,
      (p.familia_id IS NULL)                                   AS sin_familia,
      (v.sku IS NOT NULL)                                      AS tiene_ficha,
      EXISTS (
        SELECT 1 FROM public.cambios c
         WHERE c.snapshot_id = v_snap
           AND c.entidad = 'producto'
           -- OJO: `cambios.tipo` está en MAYÚSCULAS. Compararlo en
           -- minúsculas devuelve 0 filas y hace parecer que no hubo altas.
           AND c.tipo = 'ALTA'
           AND c.sku = p.sku
      )                                                        AS alta_reciente,
      m.nombre                                                 AS marca_origen,
      f.nombre                                                 AS familia_origen,
      p.descr_origen
    FROM public.productos p
    LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
    LEFT JOIN public.marcas   m ON m.id = p.marca_id
    LEFT JOIN public.familias f ON f.id = p.familia_id
    -- `productos` NO es el catálogo: es tabla de ESTADO ACTUAL con
    -- procedencia. `snapshot_id` dice de dónde vino la última escritura, y
    -- las filas de SKU que ya no aparecen en la fuente se quedan con su
    -- snapshot viejo — el upsert las actualiza, nunca las borra. Medido:
    -- hay más filas en la tabla que SKU en el snapshot vigente: las HUÉRFANAS (casi todas sin
    -- tecnología). Sin este filtro el encolado habría sido mayor,
    -- incluyendo basura como un "SKU" que es una nota de texto libre,
    -- tecleada en la columna de SKU.
    --
    -- El catálogo es `productos WHERE snapshot_id = <vigente de stock>`, que
    -- es lo que da el total del catálogo y lo que usa el Dashboard para su conteo.
    --
    -- Funciona en los DOS caminos sin ramas: en la ingesta `v_snap` es el
    -- snapshot recién insertado y los productos acaban de escribirse con él;
    -- en el backfill `v_snap` ya resolvió al vigente de stock.
    WHERE p.snapshot_id = v_snap
      AND (v.sku IS NULL
        OR v.tecnologia IS NULL
        OR btrim(v.tecnologia) = '')
  )
  INSERT INTO public.pendientes_datos
        (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
  SELECT
    'sku_sin_tecnologia', t.sku, 'abierto', 'etl', v_snap,
    jsonb_build_object(
      'sku',            t.sku,
      'campo',          CASE WHEN t.sin_familia THEN 'tecnologia+familia' ELSE 'tecnologia' END,
      'pregunta',       CASE WHEN t.sin_familia
                             THEN '¿Qué tecnología y qué familia le corresponden a este SKU?'
                             ELSE '¿Qué tecnología le corresponde a este SKU?' END,
      -- `evidencia` dice de qué población viene y si además falta familia:
      -- un admin que abre decenas de pendientes necesita saber cuál es cuál sin
      -- salir de la fila.
      'poblacion',      CASE WHEN NOT t.tiene_ficha AND t.alta_reciente THEN 'alta_reciente'
                             WHEN NOT t.tiene_ficha                      THEN 'preexistente_sin_ficha'
                             ELSE 'ficha_sin_tecnologia' END,
      'evidencia',      (CASE WHEN NOT t.tiene_ficha AND t.alta_reciente
                                THEN 'Entró como ALTA en el snapshot ' || coalesce(v_snap::text,'(sin snapshot)') || ' y no tiene ficha en clasificacion_v2'
                              WHEN NOT t.tiene_ficha
                                THEN 'Ya estaba en el catálogo y nunca tuvo ficha en clasificacion_v2'
                              ELSE 'Tiene ficha en clasificacion_v2 pero con la tecnología vacía' END)
                        || CASE WHEN t.sin_familia THEN '. Además NO tiene familia asignada.' ELSE '.' END,
      'sin_familia',    t.sin_familia,
      'marca_origen',   t.marca_origen,
      'familia_origen', t.familia_origen,
      'descr_origen',   t.descr_origen
    )
  FROM sin_tecnologia t
  ON CONFLICT (tipo, clave_natural) DO NOTHING;
  GET DIAGNOSTICS v_encolados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (1/2): ya tiene tecnología ----------
  -- Un criterio de ESTADO tiene que auto-curarse: si el SKU recibe
  -- tecnología por otra vía (edición manual, una v2 futura), su pendiente
  -- deja de aplicar. Se cierra, pero SE VE: `resuelto_por='auto:ingesta'`
  -- y `resolucion.accion='auto_cierre'`. Un pendiente que desaparece sin
  -- rastro sería este mismo bloque otra vez, con otro disfraz (P15).
  UPDATE public.pendientes_datos pd
     SET estado       = 'resuelto',
         resuelto_por = 'auto:ingesta',
         resuelto_en  = now(),
         resolucion   = jsonb_build_object(
           'accion',     'auto_cierre',
           'motivo',     'El SKU ya tiene tecnología asignada: el pendiente dejó de aplicar.',
           'tecnologia', v.tecnologia,
           'snapshot',   v_snap
         )
    FROM public.clasificacion_v2 v
   WHERE pd.tipo = 'sku_sin_tecnologia'
     AND pd.estado = 'abierto'
     AND v.sku = pd.clave_natural
     AND v.tecnologia IS NOT NULL
     AND btrim(v.tecnologia) <> '';
  GET DIAGNOSTICS v_cerrados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (2/2): salió del catálogo ----------
  -- La otra mitad del criterio de estado. Un SKU dado de BAJA ya no es
  -- pregunta pendiente para nadie; dejarlo abierto infla la bandeja con
  -- trabajo imposible de resolver.
  --
  -- El `AND p.snapshot_id = v_snap` NO es decorativo: sin él la condición
  -- era CÓDIGO MUERTO. La baja no borra la fila de `productos` —el upsert
  -- solo actualiza— así que un `NOT EXISTS (... WHERE sku = ...)` a secas no
  -- podía ser cierto JAMÁS, y este UPDATE nunca habría cerrado nada. Salir
  -- del catálogo significa "ya no está en el snapshot vigente", no "ya no
  -- está en la tabla".
  UPDATE public.pendientes_datos pd
     SET estado       = 'resuelto',
         resuelto_por = 'auto:ingesta',
         resuelto_en  = now(),
         resolucion   = jsonb_build_object(
           'accion',   'auto_cierre',
           'motivo',   'El SKU salió del catálogo: el pendiente dejó de aplicar.',
           'snapshot', v_snap
         )
   WHERE pd.tipo = 'sku_sin_tecnologia'
     AND pd.estado = 'abierto'
     AND NOT EXISTS (
       SELECT 1 FROM public.productos p
        WHERE p.sku = pd.clave_natural
          AND p.snapshot_id = v_snap
     );
  GET DIAGNOSTICS v_baja = ROW_COUNT;

  RETURN jsonb_build_object(
    'snapshot',           v_snap,
    'encolados',          v_encolados,
    'cerrados_con_tec',   v_cerrados,
    'cerrados_por_baja',  v_baja
  );
END;
$fn$;
REVOKE ALL    ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) TO service_role;


-- ------------------------------------------------------------
-- (3) `ingest_snapshot` llama al productor.
--     Cuerpo COMPLETO de 0009 (última definición vigente — verificado:
--     ni 0011 ni 0012 la tocan) + UNA línea al final. Se reproduce entero
--     porque `CREATE OR REPLACE` sustituye la función completa.
-- ------------------------------------------------------------
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

  -- [MVP-CIERRE] F2 · ÚNICA adición sobre el cuerpo de 0009. Solo aplica a
  -- STOCK: el catálogo (`productos`) no lo mueve una ingesta de aduana, así
  -- que evaluar el criterio ahí sería trabajo inútil por corrida.
  IF snap->>'fuente' = 'stock' THEN
    PERFORM public.sincronizar_pendientes_tecnologia(snap_id);
  END IF;

  RETURN snap_id;
END;
$$;
REVOKE ALL    ON FUNCTION public.ingest_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_snapshot(jsonb) TO service_role;


-- ------------------------------------------------------------
-- (4) `resolver_pendiente` aprende a resolver el tipo nuevo.
--     Cuerpo COMPLETO de 0011 + una rama. Se reproduce entero por la misma
--     razón que arriba.
--
--     EL ADMIN DECIDE LAS DOS EN UN SOLO VIAJE (decisión de producto). Como la
--     firma tiene un solo `p_valor text` y añadir un parámetro obligaría a
--     DROP+CREATE de una función que la app ya llama con 4 argumentos
--     nombrados, para ESTE tipo `p_valor` viaja como JSON:
--
--         {"tecnologia":"BRAND1","familia":"SERIES 2 26"}
--
--     `familia` es opcional (solo la piden los que no la traen de la
--     fuente). Los otros tipos siguen recibiendo texto plano: no se cambia
--     nada de lo que ya funciona.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_pendiente(
  p_id uuid, p_accion text, p_motivo text DEFAULT NULL, p_valor text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_actor    text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_p        public.pendientes_datos%ROWTYPE;
  v_nombre   text;
  v_kam_id   uuid;
  v_marca    text;
  v_marca_id uuid;
  v_canon    text;
  v_sku      text;
  v_ref      jsonb := '{}'::jsonb;
  v_json     jsonb;
  v_tec      text;
  v_familia  text;
  v_fam_id   uuid;
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

  ELSIF v_p.tipo = 'marca_ambigua' THEN
    -- FAIL-CLOSED (1/3): sin marca elegida no hay resolución posible.
    v_marca := nullif(btrim(p_valor), '');
    IF v_marca IS NULL THEN
      RAISE EXCEPTION 'marca requerida para resolver marca_ambigua' USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (2/3): el pendiente debe saber sobre qué SKU decide.
    v_sku := nullif(btrim(coalesce(v_p.payload ->> 'sku', v_p.clave_natural)), '');
    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'pendiente marca_ambigua sin sku en payload' USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (3/3): clasificacion_v2.sku tiene FK a productos; sin
    -- este chequeo el upsert moriría con un error de FK ilegible.
    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'sku % inexistente en productos', v_sku USING errcode = 'P0002'; END IF;

    -- Alta idempotente en `marcas`, case-insensitive (ver cabecera P2).
    SELECT id, nombre INTO v_marca_id, v_canon
      FROM public.marcas WHERE upper(btrim(nombre)) = upper(v_marca);
    IF v_marca_id IS NULL THEN
      INSERT INTO public.marcas (nombre) VALUES (upper(v_marca))
      RETURNING id, nombre INTO v_marca_id, v_canon;
    END IF;

    -- Upsert de la capa v2 con el nombre CANÓNICO del catálogo.
    INSERT INTO public.clasificacion_v2 AS c
           (sku, marca_v2, fuente_version, updated_by, updated_at)
    VALUES (v_sku, v_canon, 'pendiente:marca_ambigua', v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      marca_v2       = EXCLUDED.marca_v2,
      fuente_version = EXCLUDED.fuente_version,
      updated_by     = EXCLUDED.updated_by,
      updated_at     = EXCLUDED.updated_at;

    v_ref := jsonb_build_object('marca_id', v_marca_id, 'marca', v_canon, 'sku', v_sku);

  ELSIF v_p.tipo = 'sku_sin_tecnologia' THEN
    -- [MVP-CIERRE] F2. `p_valor` llega como JSON con las DOS decisiones.
    -- FAIL-CLOSED (1/4): tiene que ser JSON parseable.
    BEGIN
      v_json := nullif(btrim(coalesce(p_valor,'')),'')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'p_valor debe ser JSON: {"tecnologia":"...","familia":"..."}'
        USING errcode = '22023';
    END;
    IF v_json IS NULL THEN
      RAISE EXCEPTION 'p_valor requerido: {"tecnologia":"...","familia":"..."}'
        USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (2/4): la tecnología es la razón de existir del pendiente.
    v_tec := nullif(btrim(coalesce(v_json ->> 'tecnologia','')), '');
    IF v_tec IS NULL THEN
      RAISE EXCEPTION 'tecnologia requerida para resolver sku_sin_tecnologia'
        USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (3/4): el pendiente debe saber sobre qué SKU decide.
    v_sku := nullif(btrim(coalesce(v_p.payload ->> 'sku', v_p.clave_natural)), '');
    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'pendiente sku_sin_tecnologia sin sku' USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (4/4): FK a productos, igual que marca_ambigua.
    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'sku % inexistente en productos', v_sku USING errcode = 'P0002'; END IF;

    -- La familia es OPCIONAL: solo la mandan los SKU que no la traen de la
    -- fuente. Si viene, se da de alta en el catálogo de familias igual que
    -- las marcas — idempotente y case-insensitive.
    v_familia := nullif(btrim(coalesce(v_json ->> 'familia','')), '');
    IF v_familia IS NOT NULL THEN
      SELECT id INTO v_fam_id FROM public.familias WHERE upper(btrim(nombre)) = upper(v_familia);
      IF v_fam_id IS NULL THEN
        INSERT INTO public.familias (nombre) VALUES (upper(v_familia)) RETURNING id INTO v_fam_id;
      END IF;
      SELECT nombre INTO v_familia FROM public.familias WHERE id = v_fam_id;
    END IF;

    -- UN SOLO UPSERT cubre los dos caminos que pidió el puente: INSERT para
    -- las poblaciones A y B (sin ficha v2) y UPDATE para la C (ficha con la
    -- tecnología vacía). `COALESCE` en el DO UPDATE para no borrar una
    -- familia que ya estuviera puesta cuando el admin no manda una nueva.
    INSERT INTO public.clasificacion_v2 AS c
           (sku, tecnologia, familia_v2, fuente_version, updated_by, updated_at)
    VALUES (v_sku, v_tec, v_familia, 'pendiente:sku_sin_tecnologia', v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      tecnologia     = EXCLUDED.tecnologia,
      familia_v2     = coalesce(EXCLUDED.familia_v2, c.familia_v2),
      fuente_version = EXCLUDED.fuente_version,
      updated_by     = EXCLUDED.updated_by,
      updated_at     = EXCLUDED.updated_at;

    v_ref := jsonb_build_object('sku', v_sku, 'tecnologia', v_tec, 'familia', v_familia);

  -- 'familia_atomo_dudoso' NO tiene rama, A PROPÓSITO: confirmarlo
  -- significa RATIFICAR EL STATU QUO y con el modelo vigente (derivar al
  -- leer, sin materializar) eso no tiene efecto de escritura. Ver 0011.
  END IF;

  UPDATE public.pendientes_datos
     SET estado='resuelto', resuelto_por=v_actor, resuelto_en=now(),
         resolucion=jsonb_build_object('accion','confirmar','motivo',p_motivo) || v_ref
   WHERE id=p_id;
  RETURN jsonb_build_object('estado','resuelto','actor',v_actor,'ref',v_ref);
END;
$fn$;
REVOKE ALL   ON FUNCTION public.resolver_pendiente(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_pendiente(uuid,text,text,text) TO authenticated;


-- ------------------------------------------------------------
-- (5) BACKFILL de las que ya están en esa condición.
--     Idempotente por construcción: usa la MISMA función que la ingesta,
--     que a su vez se apoya en el UNIQUE(tipo, clave_natural). Correrlo dos
--     veces no duplica ni una fila.
-- ------------------------------------------------------------
SELECT public.sincronizar_pendientes_tecnologia();


-- ------------------------------------------------------------
-- (6) GUARDA DE CIERRE — no un reporte.
--
--     La primera versión de esta sección era un `SELECT` que imprimía
--     conteos y nada más. Si el bug de los huérfanos hubiera llegado a
--     aplicarse, habría impreso un conteo alto y la migración habría terminado en
--     ÉXITO: una verificación que no aborta es un comentario con sintaxis
--     de SQL. Es P14 en su forma más pura — la ausencia de validación
--     llegando con la forma correcta.
--
--     Se verifica el CRITERIO, no una cifra fija. Nada de "== N": ese
--     número cambia con cada ingesta y un literal aquí volvería la guarda
--     falsa a la semana. Se contrasta contra la MISMA definición que usa el
--     Dashboard para su nodo "Sin tecnología (N)":
--         productos WHERE snapshot_id = <vigente de stock>
--         Y (sin ficha v2  OR  tecnologia NULL/vacía)
--
--     Dos invariantes, en las dos direcciones:
--       (1) COBERTURA — ningún SKU vigente sin tecnología se queda sin
--           fila. Se cuenta en CUALQUIER estado, no solo `abierto`: un
--           pendiente ya resuelto o descartado no debe reabrirse (el
--           `ON CONFLICT DO NOTHING` lo garantiza), así que exigir
--           `abierto` volvería roja la guarda en la segunda corrida.
--       (2) NO SOBRA — ningún pendiente ABIERTO apunta a un SKU que ya
--           tiene tecnología o que ya no está en el snapshot vigente. Si
--           esto falla, alguno de los dos auto-cierres no hizo su trabajo.
-- ------------------------------------------------------------
DO $cierre0013$
DECLARE
    v_snap        uuid;
    v_esperados   integer;
    v_con_fila    integer;
    v_sin_fila    integer;
    v_sobran      integer;
    v_abiertos    integer;
    v_total_abier integer;
BEGIN
    SELECT s.id INTO v_snap FROM public.snapshots s
     WHERE s.fuente = 'stock' ORDER BY s.created_at DESC, s.id DESC LIMIT 1;

    -- El universo, según el criterio del Dashboard.
    SELECT count(*) INTO v_esperados
      FROM public.productos p
      LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
     WHERE p.snapshot_id = v_snap
       AND (v.sku IS NULL OR v.tecnologia IS NULL OR btrim(v.tecnologia) = '');

    -- (1) COBERTURA
    SELECT count(*) INTO v_con_fila
      FROM public.productos p
      LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
     WHERE p.snapshot_id = v_snap
       AND (v.sku IS NULL OR v.tecnologia IS NULL OR btrim(v.tecnologia) = '')
       AND EXISTS (SELECT 1 FROM public.pendientes_datos pd
                    WHERE pd.tipo = 'sku_sin_tecnologia' AND pd.clave_natural = p.sku);
    v_sin_fila := v_esperados - v_con_fila;

    -- (2) NO SOBRA
    SELECT count(*) INTO v_sobran
      FROM public.pendientes_datos pd
     WHERE pd.tipo = 'sku_sin_tecnologia'
       AND pd.estado = 'abierto'
       AND NOT EXISTS (
         SELECT 1 FROM public.productos p
           LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
          WHERE p.sku = pd.clave_natural
            AND p.snapshot_id = v_snap
            AND (v.sku IS NULL OR v.tecnologia IS NULL OR btrim(v.tecnologia) = '')
       );

    SELECT count(*) FILTER (WHERE tipo = 'sku_sin_tecnologia' AND estado = 'abierto'),
           count(*) FILTER (WHERE estado = 'abierto')
      INTO v_abiertos, v_total_abier
      FROM public.pendientes_datos;

    RAISE NOTICE '0013 · snapshot vigente ............ %', v_snap;
    RAISE NOTICE '0013 · SKU vigentes sin tecnologia . % (criterio del Dashboard)', v_esperados;
    RAISE NOTICE '0013 · sku_sin_tecnologia abiertos . %', v_abiertos;
    RAISE NOTICE '0013 · total de abiertos en bandeja  %', v_total_abier;
    RAISE NOTICE '0013 · por poblacion: alta_reciente % · preexistente % · ficha_sin_tec %',
        (SELECT count(*) FROM public.pendientes_datos WHERE tipo='sku_sin_tecnologia' AND payload->>'poblacion'='alta_reciente'),
        (SELECT count(*) FROM public.pendientes_datos WHERE tipo='sku_sin_tecnologia' AND payload->>'poblacion'='preexistente_sin_ficha'),
        (SELECT count(*) FROM public.pendientes_datos WHERE tipo='sku_sin_tecnologia' AND payload->>'poblacion'='ficha_sin_tecnologia');
    RAISE NOTICE '0013 · de esos, sin familia ....... %',
        (SELECT count(*) FROM public.pendientes_datos WHERE tipo='sku_sin_tecnologia' AND (payload->>'sin_familia')::boolean);

    IF v_sin_fila <> 0 THEN
        RAISE EXCEPTION
          '0013 (cobertura): % SKU vigente(s) sin tecnologia NO tienen fila en la bandeja. El encolado no cubrio el universo del Dashboard (% esperados). Abortando.',
          v_sin_fila, v_esperados;
    END IF;

    IF v_sobran <> 0 THEN
        RAISE EXCEPTION
          '0013 (sobrantes): % pendiente(s) ABIERTO(s) apuntan a un SKU que ya tiene tecnologia o que salio del snapshot vigente. Alguno de los dos auto-cierres no hizo su trabajo. Abortando.',
          v_sobran;
    END IF;

    RAISE NOTICE '0013 · GUARDA VERDE: cobertura completa (%/%) y cero sobrantes.', v_con_fila, v_esperados;
END $cierre0013$;

COMMIT;
