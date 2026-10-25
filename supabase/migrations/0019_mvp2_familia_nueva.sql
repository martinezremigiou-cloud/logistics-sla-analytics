-- ============================================================
-- 0019 · [MVP-2] B · La familia nueva deja de entrar muda.
--
-- ESCRITA, **NO APLICADA**. Se aplica a mano. DEPENDE DE LA 0018
-- (`familia_alias` / `fusionar_familia`): aplicar ésta antes falla ruidoso
-- en la guarda de abajo, a propósito.
--
-- ------------------------------------------------------------
-- EL HALLAZGO
-- ------------------------------------------------------------
-- `ingest_snapshot` recibe `payload->'familiasNuevas'`, da de alta esas
-- filas y TIRA el dato. Medido: `cambios` no tiene `entidad='familia'`, no
-- existe tipo de pendiente para una familia recién llegada, y los dos tipos
-- de familia que sí existen (`colision_familia`, `familia_atomo_dudoso`)
-- preguntan por familias que YA estaban.
--
-- Y no es teórico. En una corrida típica (stock):
--
--     muchos cambios de familia · muchos destinos distintos
--     SERIES11   → SERIES11 ALFA      SERIES11  → SERIES11 BETA
--     SERIES10 → SERIES10 XR      SERIES10 → SERIES 31
--     ETIQUETAS → TAG           BRAND2 → BOTON DE ASISTENCIA
--
-- `SERIES11 → SERIES11 ALFA` **es** el caso que se preguntó («si mañana se
-- agrega SERIES 2 44, ¿cómo se sabe que corresponde a SERIES 2 14, 18,
-- 26…?»). Ya ocurrió, hace dos días, y nadie fue avisado.
--
-- Las otras corridas medidas tienen CERO cambios de familia: el estado
-- estable es cero, y los de arriba fueron la re-taxonomía de estrenar la fuente
-- unificada.
--
-- ------------------------------------------------------------
-- LO QUE HACE Y LO QUE NO
-- ------------------------------------------------------------
-- PREGUNTA Y ESPERA. Nunca asigna. La familia entra al catálogo igual que
-- hoy (el Excel manda) y el producto queda asignado igual que hoy; lo único
-- que cambia es que alguien se entera y puede decidir.
--
-- La EVIDENCIA que acompaña la pregunta se calcula, no se adivina:
-- las familias existentes que comparten el PREFIJO DE TOKENS. Para
-- `SERIES 2 44` el prefijo es `SERIES 2` y devuelve **sus hermanas**
-- (p. ej. 14, 18, 26, 32, 38, 52, XL…).
-- Es la misma disciplina token-exacta de `src/lib/familias.ts`: nunca
-- substring, porque con substring 'SERIES12' capturaría 'SERIES 12', que es
-- otra familia.
--
-- CORREGIDO POR LA AUDITORÍA: la primera versión de este comentario decía
-- un número menor, medido con una consulta que agrupaba por prefijo — NO la que el
-- código ejecuta. La consulta real (`LIKE prefijo || ' %'`) devolvía **más**,
-- y varias de ellas eran COMPUESTOS (`SERIES 2 / CLIP 3.0`, `SERIES 2 26 / SERIES 2
-- VISOR`…). Un compuesto no es hermana de nada: es otra celda que además
-- empieza igual, y ofrecerlo como sugerencia es ruido que induce al error.
-- Se filtran, y con eso la cifra declarada y la que produce el código son
-- la misma — que era el problema de fondo, no el número.
--
-- UNA FILA POR FAMILIA, no por SKU: los destinos de esa corrida serían tantas
-- filas como destinos, no como cambios.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (0) DEPENDENCIA DURA. `familia_nueva` sin `fusionar_familia` sería una
--     bandeja que pregunta y no tiene dónde escribir la respuesta.
-- ------------------------------------------------------------
DO $dep0019$
BEGIN
  IF to_regclass('public.familia_alias') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public' AND p.proname = 'fusionar_familia') THEN
    RAISE EXCEPTION '0019 depende de la 0018 (familia_alias + fusionar_familia), que no está aplicada. Aplica la 0018 primero. Abortando.';
  END IF;
END $dep0019$;

-- ------------------------------------------------------------
-- (1) El CHECK, de 7 valores a 8.
--     Se lee el nombre REAL del constraint, no se adivina: en 0013 costó
--     una migración descubrir que era `..._tipo_check` y no `..._tipo_chk`,
--     y un DROP con el nombre equivocado NO falla — no hace nada, y deja
--     la migración "verde" sin haber cambiado el CHECK (fail-open, P4).
-- ------------------------------------------------------------
DO $chk0019$
DECLARE
  v_nombre text;
  v_def    text;
  v_cuantos integer;
BEGIN
  -- ASERCIÓN DE UNICIDAD, restituida por la auditoría. `0011_taxo.sql:282-286`
  -- y `0012_b7b_hardening.sql:363-367` sí abortaban ante un segundo CHECK que
  -- mencionara `tipo`; esta migración la había perdido. Sin ella, un
  -- `SELECT ... INTO` sin `STRICT` toma UNA fila arbitraria en silencio y el
  -- DROP podría caer sobre el constraint equivocado.
  SELECT count(*) INTO v_cuantos
    FROM pg_constraint
   WHERE conrelid = 'public.pendientes_datos'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%tipo%';
  IF v_cuantos <> 1 THEN
    RAISE EXCEPTION '0019: se esperaba EXACTAMENTE 1 CHECK que mencione `tipo` en pendientes_datos, hay %. No se adivina cuál tocar. Abortando.', v_cuantos;
  END IF;

  SELECT conname, pg_get_constraintdef(oid) INTO v_nombre, v_def
    FROM pg_constraint
   WHERE conrelid = 'public.pendientes_datos'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%tipo%';

  IF v_nombre IS NULL THEN
    RAISE EXCEPTION '0019: no encontré el CHECK de `tipo` en pendientes_datos. Abortando.';
  END IF;
  IF v_def LIKE '%familia_nueva%' THEN
    RAISE NOTICE '0019 · el CHECK ya incluía familia_nueva — nada que hacer.';
  ELSE
    EXECUTE format('ALTER TABLE public.pendientes_datos DROP CONSTRAINT %I', v_nombre);
    ALTER TABLE public.pendientes_datos
      ADD CONSTRAINT pendientes_datos_tipo_check
      CHECK (tipo = ANY (ARRAY[
        'kam_desconocido','marca_west','colision_familia','cuarentena_etl',
        'marca_ambigua','familia_atomo_dudoso','sku_sin_tecnologia','familia_nueva'
      ]));
    RAISE NOTICE '0019 · CHECK de tipo: 7 → 8 valores (+familia_nueva). Constraint anterior: %', v_nombre;
  END IF;
END $chk0019$;

-- El COMMENT de la columna enumeraba los 7 valores viejos (`0013:73-81`) y
-- se quedaba desfasado. Hallazgo de la auditoría: la base se documentaba a sí
-- misma con un dato viejo, que es el mismo problema que el frente F vino a
-- arreglar en los comentarios del código.
COMMENT ON COLUMN public.pendientes_datos.tipo IS
  'Tipo de pendiente. 8 valores: kam_desconocido · marca_west · '
  'colision_familia · cuarentena_etl · marca_ambigua · familia_atomo_dudoso · '
  'sku_sin_tecnologia · familia_nueva ([MVP-2] 0019). El CHECK es la fuente '
  'de verdad; si editas uno, edita el otro.';

-- ------------------------------------------------------------
-- (2) EL PRODUCTOR.
--
--     Recibe los nombres que el motor ya calculó como nuevos
--     (`payload->'familiasNuevas'`) — no los re-deriva: `familias` no tiene
--     `created_at`, así que después de insertar ya no hay forma de
--     distinguir una fila nueva de una de abril.
--
--     TOPE: 25 por corrida. Justificación: el catálogo tiene centenas de familias y
--     el estado estable es que casi no entran nuevas por corrida; una corrida que
--     estrene más de 25 nombres es una anomalía de la FUENTE, y lo que hay
--     que revisar entonces es el Excel, no cientos de filas de bandeja.
--     Por encima del tope se encolan las 25 primeras (orden alfabético,
--     determinista) y **las excluidas se registran en el log UNA POR UNA,
--     por nombre** — nunca un conteo agregado, nunca un truncado silencioso.
--     Límite honesto: un evento masivo de la fuente lo habría rebasado. El tope no
--     está para acertar, está para que un evento así no inunde la bandeja;
--     el log por nombre es la salida.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_pendientes_familia(
  p_snapshot uuid, p_familias jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  TOPE        constant integer := 25;
  v_total     integer := 0;
  v_encolados integer := 0;
  v_excluida  text;
BEGIN
  -- Cuenta el MISMO conjunto que se filtra abajo (sin blancos, sin
  -- duplicados). La primera versión contaba los elementos crudos: con un
  -- blanco o un duplicado en `familiasNuevas`, `v_total > TOPE` disparaba el
  -- aviso "TOPE ALCANZADO" con MENOS de 25 candidatas reales, el bucle de
  -- excluidas no imprimía nada, y `excluidas_por_tope` reportaba un número
  -- que no correspondía a ninguna familia. Un aviso que manda a revisar el
  -- Excel por nada gasta la credibilidad que necesita cuando sí importa.
  SELECT count(*) INTO v_total FROM (
    SELECT DISTINCT lower(regexp_replace(btrim(f), '\s+', ' ', 'g'))
      FROM jsonb_array_elements_text(coalesce(p_familias, '[]'::jsonb)) AS f
     WHERE btrim(f) <> ''
  ) d;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('candidatas', 0, 'encolados', 0, 'excluidas_por_tope', 0);
  END IF;

  WITH candidatas AS (
    SELECT btrim(f) AS nombre
      FROM jsonb_array_elements_text(p_familias) AS f
     WHERE btrim(f) <> ''
     ORDER BY 1
     LIMIT TOPE
  ),
  -- Prefijo de tokens = todos los tokens menos el último. `SERIES 2 44` →
  -- `SERIES 2`. Con un solo token no hay prefijo y no hay hermanas: una
  -- familia de una palabra se pregunta igual, pero sin sugerencias.
  con_prefijo AS (
    SELECT c.nombre,
           string_to_array(btrim(regexp_replace(upper(c.nombre), '\s+', ' ', 'g')), ' ') AS toks
      FROM candidatas c
  ),
  evidencia AS (
    SELECT p.nombre,
           CASE WHEN array_length(p.toks,1) > 1
                THEN array_to_string(p.toks[1:array_length(p.toks,1)-1], ' ')
                ELSE NULL END AS prefijo,
           p.toks
      FROM con_prefijo p
  )
  INSERT INTO public.pendientes_datos (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
  SELECT 'familia_nueva',
         lower(regexp_replace(btrim(e.nombre), '\s+', ' ', 'g')),
         'abierto', 'etl', p_snapshot,
         jsonb_build_object(
           'familia',  e.nombre,
           'prefijo',  e.prefijo,
           'hermanas', coalesce((
              SELECT jsonb_agg(x.nombre ORDER BY x.nombre)
                FROM public.familias x
               WHERE e.prefijo IS NOT NULL
                 AND x.activo
                 AND lower(x.nombre) <> lower(e.nombre)
                 -- Los COMPUESTOS quedan fuera: `SERIES 2 / CLIP 3.0` empieza
                 -- por el prefijo pero no es hermana de `SERIES 2 44`, es
                 -- otra celda multi-valor. Ofrecerla como sugerencia induce
                 -- a fusionar mal. Medido: sin este filtro la consulta daba
                 -- de más para `SERIES 2`, varias de ellas compuestos; con él da menos.
                 AND position('/' in x.nombre) = 0
                 -- Token-exacta, NUNCA substring: el prefijo tiene que
                 -- terminar en frontera de palabra. `CLIP` no puede
                 -- capturar `CLIPS`.
                 --
                 -- `ESCAPE '\'` + escapado del prefijo: el nombre viene del
                 -- Excel, y un `_` o `%` ahí se volvería comodín y rompería
                 -- justo la promesa de token-exacta. Hoy ninguna de las familias
                 -- los traen — es latente, no vivo, y se cierra igual: el
                 -- repo ya hace esto mismo en JS (`escaparLike`,
                 -- `src/lib/supabase/ilike.ts`).
                 AND upper(x.nombre) LIKE
                     replace(replace(replace(e.prefijo,'\','\\'),'%','\%'),'_','\_') || ' %'
                     ESCAPE '\'
           ), '[]'::jsonb),
           'skus', coalesce((
              SELECT jsonb_agg(pr.sku ORDER BY pr.sku)
                FROM public.productos pr
                JOIN public.familias fx ON fx.id = pr.familia_id
               WHERE lower(fx.nombre) = lower(e.nombre)
           ), '[]'::jsonb)
         )
    FROM evidencia e
  ON CONFLICT (tipo, clave_natural) DO NOTHING;

  GET DIAGNOSTICS v_encolados = ROW_COUNT;

  -- El log por nombre de lo que quedó fuera del tope.
  IF v_total > TOPE THEN
    RAISE NOTICE '0019/productor · TOPE ALCANZADO: % candidatas, se encolaron las primeras % por orden alfabético. Las EXCLUIDAS van una por una abajo — revisa el Excel, no la bandeja.', v_total, TOPE;
    FOR v_excluida IN
      SELECT btrim(f) FROM jsonb_array_elements_text(p_familias) AS f
       WHERE btrim(f) <> ''
       ORDER BY 1 OFFSET TOPE
    LOOP
      RAISE NOTICE '0019/productor · EXCLUIDA POR TOPE: %', v_excluida;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'candidatas', v_total,
    'encolados', v_encolados,
    'excluidas_por_tope', greatest(v_total - TOPE, 0)
  );
END;
$fn$;
REVOKE ALL    ON FUNCTION public.sincronizar_pendientes_familia(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_pendientes_familia(uuid, jsonb) TO service_role;

-- ------------------------------------------------------------
-- (3) `ingest_snapshot` llama al productor.
--     Cuerpo COMPLETO de 0013 (última definición vigente) + UNA línea. Se
--     reproduce entero porque `CREATE OR REPLACE` sustituye la función
--     completa — misma disciplina y misma advertencia que dejó la 0013.
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

  -- [MVP-CIERRE] F2 · Solo aplica a STOCK: el catálogo (`productos`) no lo
  -- mueve una ingesta de aduana, así que evaluar el criterio ahí sería
  -- trabajo inútil por corrida.
  IF snap->>'fuente' = 'stock' THEN
    PERFORM public.sincronizar_pendientes_tecnologia(snap_id);
    -- [MVP-2] B · ÚNICA adición sobre el cuerpo de 0013. Va DESPUÉS del
    -- INSERT de `familias` (arriba) a propósito: la evidencia de hermanas
    -- consulta el catálogo y necesita ver el estado ya escrito. Mismo
    -- ámbito que el productor de tecnología, y por la misma razón.
    PERFORM public.sincronizar_pendientes_familia(
      snap_id, coalesce(payload->'familiasNuevas','[]'::jsonb));
  END IF;

  RETURN snap_id;
END;
$$;
REVOKE ALL    ON FUNCTION public.ingest_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_snapshot(jsonb) TO service_role;

-- ------------------------------------------------------------
-- (4) La RESOLUCIÓN, por composición — sin reproducir `resolver_pendiente`.
--
--     Dos caminos, y la diferencia importa:
--
--     · «es la misma que X»  → `resolver_familia_nueva(id, 'X')`: escribe
--       el ALIAS (regla global que sobrevive al espejo) y cierra. NO
--       escribe `clasificacion_v2.familia_v2`: eso sería una fila por SKU
--       para una sola regla, y no cubriría los SKU que lleguen el mes que
--       viene con el mismo nombre malo.
--
--     · «es una familia legítima» → `resolver_pendiente(id,'confirmar')`
--       tal cual, sin rama nueva. Confirmar RATIFICA EL STATU QUO y no
--       tiene efecto de escritura — exactamente el criterio que 0011 ya
--       eligió para `familia_atomo_dudoso`.
--
--     Se COMPONEN las dos RPC que ya existen en vez de reproducir las 200
--     líneas de `resolver_pendiente`: ambas son SECURITY DEFINER con su
--     propia guarda `is_admin()`, corren en la misma transacción y ven el
--     mismo `auth.jwt()`. Reproducir una función de 200 líneas para
--     añadirle una rama es cómo se pierden ramas al copiar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_familia_nueva(
  p_id uuid, p_destino text, p_motivo text DEFAULT NULL, p_skus_esperados integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_p      public.pendientes_datos%ROWTYPE;
  v_alias  text;
  v_fusion jsonb;
  v_cierre jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO v_p FROM public.pendientes_datos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pendiente inexistente' USING errcode = 'P0002';
  END IF;
  IF v_p.tipo <> 'familia_nueva' THEN
    RAISE EXCEPTION 'este pendiente no es familia_nueva (es %)', v_p.tipo USING errcode = '22023';
  END IF;
  IF v_p.estado <> 'abierto' THEN
    RAISE EXCEPTION 'pendiente ya resuelto/descartado' USING errcode = '22023';
  END IF;

  v_alias := nullif(btrim(coalesce(v_p.payload ->> 'familia', '')), '');
  IF v_alias IS NULL THEN
    RAISE EXCEPTION 'el pendiente no trae el nombre de la familia en su payload' USING errcode = '22023';
  END IF;

  v_fusion := public.fusionar_familia(v_alias, p_destino, p_skus_esperados);
  v_cierre := public.resolver_pendiente(p_id, 'confirmar', p_motivo, NULL);

  -- El destino de la fusión queda EN el pendiente, no solo en el log.
  -- `resolver_pendiente` graba `v_ref = {}` para este tipo (no tiene rama
  -- propia, a propósito), así que sin esto la bandeja registraría "resuelto"
  -- sin decir HACIA QUÉ se fusionó — hallazgo B4-quater de la auditoría, y
  -- era el que más pesaba: una regla global y permanente sin rastro.
  UPDATE public.pendientes_datos
     SET resolucion = coalesce(resolucion, '{}'::jsonb) || jsonb_build_object('fusion', v_fusion)
   WHERE id = p_id;

  -- Se DEVUELVE el resultado del cierre en vez de descartarlo con PERFORM:
  -- quien llama necesita la confirmación de que el pendiente quedó resuelto,
  -- no solo la de que el alias se escribió.
  RETURN jsonb_build_object('fusion', v_fusion, 'cierre', v_cierre);
END;
$fn$;
REVOKE ALL   ON FUNCTION public.resolver_familia_nueva(uuid,text,text,integer) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.resolver_familia_nueva(uuid,text,text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolver_familia_nueva(uuid,text,text,integer) TO authenticated;

-- ------------------------------------------------------------
-- (5) GUARDA DEL EFECTO REAL — y lo que NO puede ver.
--
--     NO se hace backfill de las familias existentes, a propósito y a
--     diferencia de lo que hizo 0013 con tecnología: aquéllas eran unas decenas de SKU
--     sin un dato que el negocio necesita; éstas son un catálogo entero que
--     ya está revisado por el uso. Encolarlas sería centenas de preguntas que nadie
--     pidió. `familia_nueva` empieza en 0 y crece solo con lo que llegue.
-- ------------------------------------------------------------
DO $guarda0019$
DECLARE
  v_def text;
  v_n   integer;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.pendientes_datos'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%tipo%';
  IF v_def IS NULL OR v_def NOT LIKE '%familia_nueva%' THEN
    RAISE EXCEPTION '0019: el CHECK de tipo NO admite familia_nueva. El productor no podría encolar nada. Abortando.';
  END IF;

  -- Los 7 viejos siguen ahí: un DROP+ADD mal escrito podría haberlos perdido.
  FOREACH v_def IN ARRAY ARRAY['kam_desconocido','marca_west','colision_familia','cuarentena_etl',
                               'marca_ambigua','familia_atomo_dudoso','sku_sin_tecnologia'] LOOP
    IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conrelid = 'public.pendientes_datos'::regclass AND contype='c'
           AND pg_get_constraintdef(oid) LIKE '%tipo%') NOT LIKE '%' || v_def || '%' THEN
      RAISE EXCEPTION '0019: el CHECK nuevo PERDIÓ el tipo `%`. Abortando.', v_def;
    END IF;
  END LOOP;

  FOREACH v_def IN ARRAY ARRAY['sincronizar_pendientes_familia','resolver_familia_nueva'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = v_def AND p.prosecdef) THEN
      RAISE EXCEPTION '0019: falta la función % o no es SECURITY DEFINER. Abortando.', v_def;
    END IF;
  END LOOP;

  -- `ingest_snapshot` tiene que llamar al productor: si se reprodujo el
  -- cuerpo y se olvidó la línea, todo lo demás quedaría inerte.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ingest_snapshot'
     AND pg_get_functiondef(p.oid) LIKE '%sincronizar_pendientes_familia%';
  IF v_n = 0 THEN
    RAISE EXCEPTION '0019: ingest_snapshot NO llama a sincronizar_pendientes_familia. El productor quedaría muerto. Abortando.';
  END IF;

  -- Y no puede haber perdido el productor de tecnología al reproducirse.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ingest_snapshot'
     AND pg_get_functiondef(p.oid) LIKE '%sincronizar_pendientes_tecnologia%';
  IF v_n = 0 THEN
    RAISE EXCEPTION '0019: al reproducir ingest_snapshot se PERDIÓ la llamada a sincronizar_pendientes_tecnologia (MVP-CIERRE F2). Abortando.';
  END IF;

  SELECT count(*) INTO v_n FROM public.pendientes_datos WHERE tipo = 'familia_nueva';
  RAISE NOTICE '0019 · GUARDA VERDE: CHECK con 8 tipos, productor y resolución creados, ingest_snapshot llama a AMBOS productores. familia_nueva arranca con % fila(s) (sin backfill, a propósito).', v_n;
  RAISE NOTICE '0019 · NO COMPROBADO AQUÍ: que el encolado real produzca la evidencia esperada. Eso se mide con una corrida de ingesta y queda en el reporte de cierre.';
END $guarda0019$;

COMMIT;
