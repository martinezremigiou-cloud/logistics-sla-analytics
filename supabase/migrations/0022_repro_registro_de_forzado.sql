-- ============================================================
-- 0022 · [REPRODUCIBILIDAD · S7-B] El forzado de una ingesta queda
--        REGISTRADO: quién dijo ser y por qué.
--
-- Contrato: `docs/decisions/0003-empty-and-degraded-input-guards.md` — se ratificó una guarda
-- que RECHAZA un snapshot cuyo universo de filas se derrumba contra el
-- vigente anterior, y exigió un escape hatch con tres condiciones. Esta
-- migración implementa la tercera, y SOLO la tercera:
--
--     «(c) queda registrado con quién y cuándo».
--
-- LO QUE ESTA MIGRACIÓN **NO** HACE, para que nadie lo dé por hecho:
--   · NO implementa la guarda del derrumbe (umbral 50 %, medido contra las corridas
--     reales). Eso vive en S7-A, en `src/**`. Esta migración solo abre
--     el cajón donde ese frente deja constancia.
--   · NO valida el contenido de `forzado_por` ni de `forzado_motivo`. Ni
--     un CHECK, ni un NOT NULL, ni un trigger.
--   · NO impide forzar. Registrar no es autorizar.
--
-- EL «QUIÉN» ES DÉBIL, Y ESO SE ESCRIBE EN LA BASE, NO EN UN DOC.
-- Las rutas de ingesta se autentican con `INGEST_SECRET` compartido, no
-- con una sesión de usuario: no hay `auth.uid()` del que derivar la
-- identidad. Así que `forzado_por` es lo que el llamador ESCRIBIÓ de sí
-- mismo. Es identidad AUTO-DECLARADA y NO AUTENTICADA — sirve para
-- reconstruir una decisión, no para atribuir responsabilidad. Queda dicho
-- en el `COMMENT ON COLUMN` de la propia columna, que es donde lo va a
-- leer quien la consulte dentro de un año.
--
-- EL «CUÁNDO» YA EXISTE: `snapshots.created_at` (0001:125, NOT NULL
-- DEFAULT now()). No se duplica. Un forzado se fecha con el snapshot que
-- produjo, porque es el mismo acto.
--
-- ------------------------------------------------------------
-- CONTRATO CON S7-A — CONTRASTADO CONTRA SU CÓDIGO, NO ACORDADO DE PALABRA
-- ------------------------------------------------------------
-- Medido sobre el árbol de trabajo:
--   · `src/services/etl/persist.ts:287-306` (`buildIngestPayload`) emite
--     `forzado_por` y `forzado_motivo` DENTRO del objeto `snapshot` del
--     payload, con `p.forzadoPor` / `p.forzadoMotivo`.
--   · `src/services/etl/types.ts:219-225` declara esos dos campos y ya
--     apunta a esta migración por nombre.
--   · `src/lib/api/forzar-universo.ts` los recoge de las cabeceras
--     `x-forzar-por` / `x-forzar-motivo` y documenta —igual que este
--     archivo— que la identidad es AUTO-DECLARADA.
-- Las claves del jsonb que lee la RPC de abajo son EXACTAMENTE esas dos.
-- Si S7-A las renombra, esta migración deja de registrar nada y NINGUNA
-- guarda —ni aquí ni en la base— lo detectaría: el registro se quedaría
-- en NULL, que es indistinguible de «no se forzó». Queda escrito.
--
-- ------------------------------------------------------------
-- DE QUÉ VERSIÓN DE `ingest_snapshot` PARTE ESTA MIGRACIÓN
-- ------------------------------------------------------------
-- De la de **`0019_mvp2_familia_nueva.sql`**, que es la ÚLTIMA
-- redefinición vigente — NO de la 0005 ni de la 0009 ni de la 0013.
-- `CREATE OR REPLACE FUNCTION` sustituye la función ENTERA: partir de una
-- versión vieja habría revertido en silencio el trabajo de MVP-2 (el alta
-- de `familiasNuevas` y la llamada a `sincronizar_pendientes_familia`) y
-- de MVP-CIERRE (`sincronizar_pendientes_tecnologia`). El cuerpo de abajo
-- es el de 0019 VERBATIM salvo DOS columnas en el primer INSERT.
--
-- La guarda final no se fía de esta afirmación: relee `prosrc` del
-- catálogo y exige que cada pieza de la 0019 siga ahí.
--
-- ------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (G3 · obligatorio antes de aplicar)
-- «¿esta migración borra, cierra o marca como resuelto algo que no se
--  puede reconstruir?»
--
--   NO BORRA NADA DEL USUARIO. Cero UPDATE de filas existentes, cero
--   TRUNCATE, cero DROP de objetos, cero cierre de pendientes. Las
--   sentencias que tocan datos son dos `ADD COLUMN IF NOT EXISTS`, y
--   añaden columnas NULL.
--
--   HAY UN INSERT Y UN DELETE, y no se esconden: la guarda (4c) INSERTA
--   un snapshot SONDA con `hash = '__probe_0022__'` llamando a la propia
--   `ingest_snapshot`, lee lo que quedó grabado y lo BORRA en el mismo
--   bloque. Es la única forma de comprobar el EFECTO en vez del mecanismo
--   (P16): que el cuerpo contenga la palabra `forzado_por` no prueba que
--   el valor llegue a la tabla. La sonda no sobrevive a la transacción ni
--   en el camino feliz (se borra) ni en el infeliz (ROLLBACK), y su
--   `fuente` es `__probe_0022__`, así que jamás puede confundirse con un
--   snapshot de `stock` ni disparar los productores de pendientes.
--
--   ES REVERSIBLE:
--     ALTER TABLE public.snapshots DROP COLUMN forzado_motivo;
--     ALTER TABLE public.snapshots DROP COLUMN forzado_por;
--     -- y para la función, el `CREATE OR REPLACE` de 0019 tal cual.
--
--   TOPE DE RADIO DE IMPACTO: no hay UPDATE ni DELETE sobre datos reales,
--   así que no hay radio que topar. El equivalente aquí es que la sonda
--   se identifique por una clave RESERVADA y se borre POR ID, nunca por
--   predicado abierto.
--
-- Aplicar con:
--   node --env-file=.env.db.local scripts/aplicar-migracion.mjs \
--     supabase/migrations/0022_repro_registro_de_forzado.sql \
--     --irreversibilidad="No: dos ADD COLUMN y un CREATE OR REPLACE.
--       El unico INSERT es una sonda con hash reservado que la propia
--       guarda borra por id dentro de la misma transaccion."
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) LAS DOS COLUMNAS.
--     `text` y no un enum: no hay un conjunto cerrado de motivos y
--     tampoco un catálogo de personas (ver arriba: no hay sesión).
--     NULLABLE y sin DEFAULT a propósito — el NULL es la señal, y es la
--     única que puede serlo para las filas históricas, que se
--     ingirieron cuando forzar ni siquiera existía como concepto.
-- ------------------------------------------------------------
ALTER TABLE public.snapshots ADD COLUMN IF NOT EXISTS forzado_por    text;
ALTER TABLE public.snapshots ADD COLUMN IF NOT EXISTS forzado_motivo text;

COMMENT ON COLUMN public.snapshots.forzado_por IS
  '[0022] Quien declaro estar forzando esta ingesta, saltandose la guarda '
  'de derrumbe de universo (docs/decisions/0003-empty-and-degraded-input-guards.md, condicion (c) del escape '
  'hatch). AVISO CENTRAL: es una identidad AUTO-DECLARADA y NO AUTENTICADA. '
  'Las rutas de ingesta (/api/refresh y /api/refresh/archivo) se autentican '
  'con el secreto compartido INGEST_SECRET, no con una sesion de usuario, '
  'asi que NO hay auth.uid() del que derivar quien es. Este campo contiene '
  'literalmente lo que el llamador escribio de si mismo: sirve para '
  'RECONSTRUIR una decision, NO para ATRIBUIR responsabilidad, y no debe '
  'usarse como prueba en una auditoria. Ninguna restriccion lo valida (sin '
  'CHECK, sin NOT NULL, sin FK a perfiles). '
  'NULL = corrida NORMAL, no forzada: es el valor de toda ingesta que paso '
  'la guarda por las buenas y de todas las filas anteriores a esta '
  'migracion. El CUANDO no vive aqui: es snapshots.created_at, porque '
  'forzar y crear el snapshot son el mismo acto.';

COMMENT ON COLUMN public.snapshots.forzado_motivo IS
  '[0022] Por que se forzo esta ingesta: el texto libre que el llamador dio '
  'como justificacion al saltarse la guarda de derrumbe de universo '
  '(docs/decisions/0003-empty-and-degraded-input-guards.md). Texto libre SIN VALIDAR — ninguna restriccion '
  'exige que sea no vacio, ni coherente, ni distinto de "porque si". '
  'NULL = corrida NORMAL, no forzada. Se lee SIEMPRE junto a forzado_por, '
  'que es identidad auto-declarada y no autenticada: los dos campos valen '
  'lo mismo que la honestidad de quien llamo a la ingesta.';

-- ------------------------------------------------------------
-- (2) `ingest_snapshot` lee las dos claves del payload.
--
--     CUERPO DE `0019_mvp2_familia_nueva.sql` VERBATIM salvo el primer
--     INSERT, que gana dos columnas. Se reproduce ENTERO porque
--     `CREATE OR REPLACE` sustituye la funcion completa — misma
--     disciplina y misma advertencia que dejaron la 0013 y la 0019.
--
--     `snap ->> 'forzado_por'` sobre una clave AUSENTE devuelve NULL, que
--     es exactamente el valor que significa "corrida normal". Por eso NO
--     hace falta `coalesce` ni `nullif`: un payload que no menciona el
--     forzado produce una fila no forzada, sin ninguna rama extra. Y un
--     payload que manda cadena vacia guarda cadena vacia — se declara: no
--     se normaliza aqui, porque normalizar en la RPC escondería un
--     llamador que dice forzar sin decir quien.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_snapshot(payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  snap    jsonb := payload -> 'snapshot';
  snap_id uuid;
BEGIN
  -- [0022] + forzado_por, forzado_motivo. ÚNICA diferencia con 0019.
  INSERT INTO public.snapshots (fuente, hash, periodo, archivo, filas, created_by,
                                forzado_por, forzado_motivo)
  VALUES (snap->>'fuente', snap->>'hash', snap->>'periodo', snap->>'archivo',
          nullif(snap->>'filas','')::integer, snap->>'created_by',
          snap->>'forzado_por', snap->>'forzado_motivo')
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

-- PostgREST cachea el esquema y los privilegios. El event trigger
-- `pgrst_ddl_watch` ya emite este NOTIFY ante el DDL de arriba; se repite
-- explícito como defensa en profundidad. Dentro de una transacción se
-- entrega en el COMMIT: en un ensayo con ROLLBACK no sale.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- (3) GUARDA DEL EFECTO REAL — patrón P16, molde de 0017/0018/0019/0020.
--     Cuatro comprobaciones, y para cada una está escrito arriba de ella
--     EL ESTADO QUE LA PONE EN ROJO (P19). Ninguna entra sin eso.
-- ------------------------------------------------------------
DO $guarda0022$
DECLARE
  v_tipo_por    text;
  v_tipo_mot    text;

  v_tabla_sel   boolean;
  v_col_acl     integer;
  v_lee_por_ant boolean;
  v_lee_mot_ant boolean;
  v_grant_hecho boolean := false;

  v_oid         oid;
  v_src         text;
  v_frag        text[] := ARRAY[
                  'sincronizar_pendientes_tecnologia',
                  'sincronizar_pendientes_familia',
                  'familiasNuevas',
                  'marcasNuevas',
                  'kam_raw',
                  'kam_desconocido',
                  'stock_por_almacen',
                  'embarques',
                  'cambios',
                  'is_historial',
                  'forzado_por',
                  'forzado_motivo'
                ];
  v_f           text;

  v_probe       uuid;
  v_probe_clave text := '__probe_0022__';
  v_grab_por    text;
  v_grab_mot    text;
  v_grab_by     text;

  v_leido_por   text;
  v_visible     integer;
  v_rol_error   text;
  v_lec_error   text;

  v_forzados    bigint;
  v_reservas    integer := 0;
BEGIN
  -- ==========================================================
  -- (3a) LAS COLUMNAS EXISTEN Y SON `text`
  --
  -- ROJO SI: el `ADD COLUMN` no corrió, o alguien dejó `snapshots` con una
  -- columna homónima de otro tipo (p. ej. un enum o un uuid), que es el
  -- escenario en el que `snap->>'forzado_por'` reventaría en runtime con
  -- 22P02 dentro de la ingesta, no aquí.
  -- ==========================================================
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_por
    FROM pg_attribute a
   WHERE a.attrelid = 'public.snapshots'::regclass AND a.attname = 'forzado_por'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_tipo_por IS NULL THEN
    RAISE EXCEPTION '0022: snapshots.forzado_por no quedó creada. Abortando.';
  END IF;
  IF v_tipo_por <> 'text' THEN
    RAISE EXCEPTION '0022: snapshots.forzado_por quedó como % y se esperaba text. Abortando.', v_tipo_por;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_mot
    FROM pg_attribute a
   WHERE a.attrelid = 'public.snapshots'::regclass AND a.attname = 'forzado_motivo'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_tipo_mot IS NULL THEN
    RAISE EXCEPTION '0022: snapshots.forzado_motivo no quedó creada. Abortando.';
  END IF;
  IF v_tipo_mot <> 'text' THEN
    RAISE EXCEPTION '0022: snapshots.forzado_motivo quedó como % y se esperaba text. Abortando.', v_tipo_mot;
  END IF;

  -- Los COMMENT no son decoración: son donde vive la advertencia de que el
  -- «quién» no está autenticado. Si se pierden, la columna miente por
  -- omisión. ROJO SI: alguien reescribe este archivo quitando un COMMENT.
  IF col_description('public.snapshots'::regclass, (
        SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid = 'public.snapshots'::regclass AND a.attname = 'forzado_por')) IS NULL THEN
    RAISE EXCEPTION '0022: snapshots.forzado_por quedó sin COMMENT — la advertencia de identidad no autenticada se perdería. Abortando.';
  END IF;
  IF col_description('public.snapshots'::regclass, (
        SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid = 'public.snapshots'::regclass AND a.attname = 'forzado_motivo')) IS NULL THEN
    RAISE EXCEPTION '0022: snapshots.forzado_motivo quedó sin COMMENT. Abortando.';
  END IF;

  -- ==========================================================
  -- (3b) ¿ES `snapshots` UNA TABLA CON LISTA BLANCA DE COLUMNAS?
  --      SE MIDE, NO SE SUPONE. Ese es el encargo literal.
  --
  -- El precedente que se citó al encargar esto fue `familias` (0020), pero
  -- `familias` NO es el caso peligroso. El caso peligroso es TAXO-10
  -- (0012-P3): `clasificacion_v2`, `productos_override` y
  -- `productos_metadata` tienen REVOKE de tabla + GRANT de columna, y una
  -- columna nueva ahí NACE DENEGADA para `authenticated`.
  --
  -- Medición previa hecha sobre el repo, y que ESTA guarda vuelve a hacer
  -- contra el catálogo vivo por si el repo miente: ninguna migración
  -- 0001..0021 emite REVOKE ni GRANT sobre `public.snapshots`, así que
  -- conserva el SELECT de TABLA de los default privileges de Supabase y la
  -- columna nueva debería nacer legible. «Debería» no basta: si el ANTES
  -- sale denegado, se emite el GRANT de columna aquí mismo.
  -- ==========================================================
  v_tabla_sel   := has_table_privilege('authenticated', 'public.snapshots', 'SELECT');
  v_lee_por_ant := has_column_privilege('authenticated', 'public.snapshots', 'forzado_por', 'SELECT');
  v_lee_mot_ant := has_column_privilege('authenticated', 'public.snapshots', 'forzado_motivo', 'SELECT');

  SELECT count(*) INTO v_col_acl
    FROM pg_attribute a
   WHERE a.attrelid = 'public.snapshots'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL;

  RAISE NOTICE '0022 · MEDIDO (no supuesto): snapshots · SELECT de TABLA para authenticated = % · columnas con ACL propio = % · forzado_por legible ANTES de cualquier GRANT de esta migración = % · forzado_motivo = %.',
    v_tabla_sel, v_col_acl, v_lee_por_ant, v_lee_mot_ant;

  IF NOT (v_lee_por_ant AND v_lee_mot_ant) THEN
    -- `snapshots` SÍ es lista blanca (o perdió el SELECT de tabla): la
    -- columna nació denegada y hay que otorgarla explícitamente.
    EXECUTE 'GRANT SELECT (forzado_por, forzado_motivo) ON TABLE public.snapshots TO authenticated';
    v_grant_hecho := true;
    RAISE NOTICE '0022 · snapshots resultó ser una tabla con LISTA BLANCA de columnas (TAXO-10): las dos columnas nuevas nacieron DENEGADAS y esta migración emitió el GRANT SELECT de columna para authenticated.';
  ELSE
    RAISE NOTICE '0022 · snapshots conserva SELECT de TABLA (lista blanca = NO): las columnas nuevas nacen legibles y NO se emitió ningún GRANT. Si mañana snapshots pasara a lista blanca como clasificacion_v2, esta rama cambiaría sola.';
  END IF;

  -- Comprobación por CATÁLOGO, se haya emitido el GRANT o no.
  --
  -- DE DÓNDE VIENE SU VERDE, dicho en voz alta (P16, y es la lección N10
  -- que la 0020 ya dejó escrita): `has_column_privilege` devuelve true si
  -- el privilegio está a nivel de COLUMNA **o** a nivel de TABLA. Mientras
  -- `snapshots` conserve el SELECT de tabla —hoy lo conserva, medido
  -- arriba— estas dos comprobaciones NO PUEDEN dar falso: son verdes POR
  -- el grant de tabla. Es decir: **hoy esta comprobación no puede ponerse
  -- roja**, y eso no es un descuido, es su límite, y por eso NO es la
  -- única. Se pone roja el día que `snapshots` pase a lista blanca Y el
  -- GRANT de arriba nombre mal las columnas. La que SÍ puede fallar hoy es
  -- la lectura real de (3e).
  IF NOT has_column_privilege('authenticated', 'public.snapshots', 'forzado_por', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.snapshots', 'forzado_motivo', 'SELECT') THEN
    RAISE EXCEPTION '0022: authenticated NO puede leer snapshots.forzado_por/forzado_motivo tras aplicar (TAXO-10: columna nueva en tabla con lista blanca nace sin GRANT, y el GRANT de esta migración no lo arregló). Abortando.';
  END IF;

  IF v_tabla_sel THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0022 · AVISO ANTI-VACUIDAD: `snapshots` tiene SELECT de TABLA para authenticated, así que la comprobación por catálogo de la legibilidad de columna es VERDE POR CONSTRUCCIÓN y no prueba nada por sí sola. Lo que prueba algo es la lectura real de (3e).';
  END IF;

  -- ==========================================================
  -- (3c) LA FUNCIÓN CONSERVA TODO LO DE 0019 (mecanismo).
  --
  -- ROJO SI: una redefinición futura de `ingest_snapshot` parte de una
  -- versión vieja y pierde una pieza — que es EXACTAMENTE el accidente que
  -- esta migración podría haber cometido si hubiera partido de la 0005.
  -- Reproducible a mano: quitar la línea de `sincronizar_pendientes_familia`
  -- del cuerpo de arriba y aplicar → rojo con el nombre del fragmento.
  -- ==========================================================
  -- CORRECCIÓN, hallada por el REPLAY del PO sobre Postgres 16
  -- limpio. Esta línea decía:
  --
  --     AND pg_get_function_identity_arguments(p.oid) = 'jsonb'
  --
  -- y era FALSA SIEMPRE: `pg_get_function_identity_arguments()` devuelve la
  -- lista CON el nombre del parámetro — `payload jsonb`, no `jsonb`. Medido
  -- en los dos lados (réplica limpia y PRODUCCIÓN): el predicado daba false,
  -- `v_oid` quedaba NULL y la 0022 abortaba en el RAISE de abajo acusando a
  -- la función de no existir. Es la cara B de P19: no una guarda que no
  -- puede fallar, sino una que no puede PASAR — misma raíz, una condición
  -- que solo se leyó y nunca se ejerció contra un catálogo real.
  --
  -- `to_regprocedure` resuelve por FIRMA DE TIPOS (que es lo que identifica a
  -- la función) y devuelve NULL si no existe — exactamente la semántica que
  -- esta guarda quiere, y no se rompe si mañana alguien renombra el
  -- parámetro. Verificado: resuelve a `ingest_snapshot(jsonb)`, y
  -- `to_regprocedure('public.no_existe_jamas(jsonb)')` da NULL.
  --
  -- NINGUNA de las tres capas de este repo podía ver esto: `--dry` no
  -- conecta, la suite no conecta, y el verificador es ESTÁTICO. Solo el
  -- replay contra una base real. Queda escrito en la sección "QUÉ NO CAZA"
  -- de `scripts/verificar-migracion.mjs`.
  --
  -- Hermanos del mismo predicado, medidos y NO tocados aquí: `0017:183`
  -- (sale true, pero por COINCIDENCIA — el autor escribió los nombres de los
  -- parámetros) y `0020:729` (sale true de verdad: función sin argumentos,
  -- cuya lista de identidad es la cadena vacía).
  SELECT p.oid, p.prosrc INTO v_oid, v_src
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.ingest_snapshot(jsonb)');

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0022: ingest_snapshot(jsonb) no quedó creada con la firma esperada. Abortando.';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '0022: ingest_snapshot dejó de ser SECURITY DEFINER. Abortando.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0022: anon o authenticated pueden EJECUTAR ingest_snapshot. El REVOKE no surtió efecto. Abortando.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0022: service_role NO puede ejecutar ingest_snapshot — el ETL dejaría de escribir. Abortando.';
  END IF;

  FOREACH v_f IN ARRAY v_frag LOOP
    IF position(v_f in v_src) = 0 THEN
      RAISE EXCEPTION '0022: el cuerpo nuevo de ingest_snapshot PERDIÓ el fragmento "%" que traía la definición de 0019. Una redefinición parcial revertiría MVP-2 en silencio. Abortando.', v_f;
    END IF;
  END LOOP;

  -- ==========================================================
  -- (3d) EL EFECTO, NO EL MECANISMO — la sonda.
  --
  -- Que `prosrc` contenga la palabra `forzado_por` NO prueba que el valor
  -- llegue a la tabla: eso es P16 en estado puro. Aquí se llama a la RPC
  -- real con un payload que trae las dos claves y se RELEE la fila.
  --
  -- ROJO SI (y las tres son reproducibles quitando una línea de arriba):
  --   · el INSERT de `snapshots` no lista las columnas nuevas → se relee
  --     NULL y revienta con «no llegó a la tabla»;
  --   · lee la clave equivocada del payload (p. ej. `forzado` en vez de
  --     `forzado_por`) → mismo rojo;
  --   · la ingesta deja de devolver el id → rojo antes de leer.
  --
  -- La sonda usa `fuente = '__probe_0022__'`, NO 'stock': así no dispara
  -- `sincronizar_pendientes_tecnologia` ni `sincronizar_pendientes_familia`
  -- y no puede tocar la bandeja. Se borra POR ID al final del bloque.
  -- ==========================================================
  DELETE FROM public.snapshots WHERE hash = v_probe_clave;   -- residuo de una corrida abortada

  v_probe := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',         v_probe_clave,
      'hash',           v_probe_clave,
      'periodo',        '1970-01',
      'archivo',        v_probe_clave,
      'filas',          '0',
      'created_by',     '0022_repro_registro_de_forzado',
      'forzado_por',    v_probe_clave || '/quien',
      'forzado_motivo', v_probe_clave || '/motivo')
  ));

  IF v_probe IS NULL THEN
    RAISE EXCEPTION '0022: la sonda a ingest_snapshot no devolvió id. Abortando.';
  END IF;

  SELECT s.forzado_por, s.forzado_motivo, s.created_by
    INTO v_grab_por, v_grab_mot, v_grab_by
    FROM public.snapshots s WHERE s.id = v_probe;

  IF v_grab_por IS DISTINCT FROM (v_probe_clave || '/quien') THEN
    RAISE EXCEPTION '0022: ingest_snapshot NO grabó forzado_por. Se envió "%" y la fila quedó con "%". La columna existe pero la RPC no la puebla: el registro del forzado seria una promesa vacia. Abortando.',
      v_probe_clave || '/quien', coalesce(v_grab_por, '(NULL)');
  END IF;
  IF v_grab_mot IS DISTINCT FROM (v_probe_clave || '/motivo') THEN
    RAISE EXCEPTION '0022: ingest_snapshot NO grabó forzado_motivo. Se envió "%" y la fila quedó con "%". Abortando.',
      v_probe_clave || '/motivo', coalesce(v_grab_mot, '(NULL)');
  END IF;
  IF v_grab_by IS DISTINCT FROM '0022_repro_registro_de_forzado' THEN
    RAISE EXCEPTION '0022: la sonda perdió created_by — el INSERT de snapshots cambió de forma. Abortando.';
  END IF;

  -- CONTROL NEGATIVO de la propia sonda, para que su verde signifique algo:
  -- una corrida NO forzada tiene que dejar NULL en las dos columnas, que es
  -- lo que el COMMENT promete. Si aquí saliera cualquier otra cosa, el NULL
  -- dejaría de poder leerse como "no forzada" y el COMMENT estaría
  -- mintiendo.
  --
  -- SE PRUEBAN LAS DOS FORMAS, porque NO son la misma:
  --   (i)  claves AUSENTES del jsonb;
  --   (ii) claves PRESENTES con `null` de JSON — que es EXACTAMENTE lo que
  --        manda el productor real. Medido en
  --        `src/services/etl/persist.ts:287-306` (`buildIngestPayload`):
  --        emite siempre `forzado_por` y `forzado_motivo` dentro de
  --        `snapshot`, con `p.forzadoPor` / `p.forzadoMotivo`, que valen
  --        `null` en toda corrida no forzada. Probar solo (i) habría dejado
  --        sin cubrir el caso de producción.
  -- Las dos deben dar SQL NULL vía `->>`, y se comprueba en vez de
  -- razonarse.
  --
  -- ROJO SI: alguien le pone a la columna un DEFAULT, o mete un coalesce en
  -- la RPC que convierta la ausencia (o el null) en cadena vacía.
  DELETE FROM public.snapshots WHERE id = v_probe;
  v_probe := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',     v_probe_clave,
      'hash',       v_probe_clave,
      'periodo',    '1970-01',
      'archivo',    v_probe_clave,
      'filas',      '0',
      'created_by', '0022_repro_registro_de_forzado')
  ));

  SELECT s.forzado_por, s.forzado_motivo INTO v_grab_por, v_grab_mot
    FROM public.snapshots s WHERE s.id = v_probe;

  IF v_grab_por IS NOT NULL OR v_grab_mot IS NOT NULL THEN
    RAISE EXCEPTION '0022: una ingesta SIN las claves de forzado dejó forzado_por=% / forzado_motivo=% en vez de NULL. El NULL ya no significa "corrida normal" y el COMMENT de las columnas seria falso. Abortando.',
      coalesce(v_grab_por,'(NULL)'), coalesce(v_grab_mot,'(NULL)');
  END IF;

  -- (ii) la forma REAL del productor: claves presentes con `null` de JSON.
  DELETE FROM public.snapshots WHERE id = v_probe;
  v_probe := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',         v_probe_clave,
      'hash',           v_probe_clave,
      'periodo',        '1970-01',
      'archivo',        v_probe_clave,
      'filas',          '0',
      'created_by',     '0022_repro_registro_de_forzado',
      -- `NULL::text` y no `NULL` a secas: `jsonb_build_object` es
      -- polimórfica y un NULL sin tipo no se puede resolver.
      'forzado_por',    NULL::text,
      'forzado_motivo', NULL::text)
  ));

  SELECT s.forzado_por, s.forzado_motivo INTO v_grab_por, v_grab_mot
    FROM public.snapshots s WHERE s.id = v_probe;

  IF v_grab_por IS NOT NULL OR v_grab_mot IS NOT NULL THEN
    RAISE EXCEPTION '0022: una ingesta con forzado_por/forzado_motivo en `null` de JSON —la forma que emite buildIngestPayload en toda corrida NO forzada— dejó forzado_por=% / forzado_motivo=% en vez de NULL. Abortando.',
      coalesce(v_grab_por,'(NULL)'), coalesce(v_grab_mot,'(NULL)');
  END IF;

  RAISE NOTICE '0022 · SONDA VERDE: con las claves pobladas la RPC graba los dos valores; sin ellas y con null de JSON graba NULL en los dos. Verificado por lectura de la fila, no por lectura del código.';

  -- ==========================================================
  -- (3e) LEGIBILIDAD REAL POR `authenticated` — con la fila de la sonda
  --      todavía viva, asumiendo el rol de verdad.
  --
  -- `has_column_privilege` (3b) mira el catálogo; esto EJECUTA la lectura
  -- como el rol que va a hacerla, así que cubre a la vez el privilegio de
  -- columna y la policy de RLS (`snapshots_select_auth`, USING true).
  --
  -- ROJO SI: `snapshots` pasara a lista blanca y el GRANT de (3b) no se
  -- emitiera o se emitiera sobre las columnas equivocadas → 42501; o si
  -- alguien retirara la policy de SELECT → la fila no aparece y salta el
  -- mensaje de "leyó NULL".
  --
  -- DEGRADACIÓN DECLARADA: si el rol que aplica la migración NO puede
  -- asumir `authenticated`, no se puede medir desde aquí y se dice con
  -- NOTICE en vez de fingir un verde. Eso NO enmascara el caso rojo: el
  -- catálogo de (3b) ya abortó si el privilegio faltaba.
  -- ==========================================================
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
  EXCEPTION WHEN OTHERS THEN
    v_rol_error := SQLERRM;
  END;

  IF v_rol_error IS NOT NULL THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0022 · NO COMPROBADO (lectura real): el rol que aplica esta migración no pudo asumir `authenticated` (%). La legibilidad queda comprobada solo por catálogo (has_column_privilege), no por lectura.', v_rol_error;
  ELSE
    -- Las DOS lecturas se hacen DENTRO del rol prestado. La cuenta de
    -- filas visibles se calcula aquí y no después del RESET: medirla como
    -- `postgres` habría sido justo el defecto que este bloque evita —
    -- comprobar con un rol lo que otro rol tiene que poder hacer.
    BEGIN
      SELECT count(*) INTO v_visible
        FROM public.snapshots s WHERE s.hash = v_probe_clave;
      SELECT s.forzado_por INTO v_leido_por
        FROM public.snapshots s WHERE s.hash = v_probe_clave;
    EXCEPTION WHEN insufficient_privilege THEN
      v_lec_error := SQLERRM;
    END;
    PERFORM set_config('role', 'none', true);

    IF v_lec_error IS NOT NULL THEN
      RAISE EXCEPTION '0022: con el rol `authenticated` la lectura de snapshots.forzado_por falló con 42501 (%). La columna nueva nació denegada y el GRANT de (3b) no lo arregló. Abortando.', v_lec_error;
    END IF;

    -- La sonda viva en este punto es la del CONTROL NEGATIVO, que dejó
    -- `forzado_por` en NULL a propósito: por eso NO se compara el VALOR.
    -- Lo que se prueba aquí es (i) que la lectura no revienta con 42501 y
    -- (ii) que la fila ES VISIBLE para `authenticated` bajo RLS.
    IF v_visible IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '0022: con el rol `authenticated` la fila de la sonda NO es visible (filas vistas: %). O la policy snapshots_select_auth desapareció, o RLS bloquea la lectura del portal. Abortando.',
        coalesce(v_visible, -1);
    END IF;
    IF v_leido_por IS NOT NULL THEN
      RAISE EXCEPTION '0022: incoherencia interna — la sonda del control negativo debía tener forzado_por NULL y `authenticated` leyó "%". Abortando.', v_leido_por;
    END IF;
    RAISE NOTICE '0022 · LECTURA REAL VERDE: con el rol authenticated se leyó snapshots.forzado_por sin 42501, y la fila es visible bajo la policy snapshots_select_auth (% fila).', v_visible;
  END IF;

  -- Limpieza de la sonda. POR ID, nunca por predicado abierto.
  DELETE FROM public.snapshots WHERE id = v_probe;
  IF EXISTS (SELECT 1 FROM public.snapshots WHERE hash = v_probe_clave) THEN
    RAISE EXCEPTION '0022: la sonda no se pudo borrar y quedaría una fila basura en snapshots. Causa más probable: el rol que aplica esta migración NO es el DUEÑO de public.snapshots, así que RLS sí le aplica y la tabla no tiene policy de DELETE (es inmutable por diseño, 0002). Aplicar con el rol dueño. Nada se aplicó.';
  END IF;
  RAISE NOTICE '0022 · sonda retirada: no queda ninguna fila con hash %.', v_probe_clave;

  -- ==========================================================
  -- CENSO INFORMATIVO + LO QUE ESTA GUARDA NO PUEDE COMPROBAR
  -- ==========================================================
  SELECT count(*) INTO v_forzados FROM public.snapshots WHERE forzado_por IS NOT NULL;
  RAISE NOTICE '0022 · snapshots con forzado_por NO NULL tras aplicar: % (se espera 0: ninguna corrida histórica se forzó, porque la guarda que se fuerza aún no existe).', v_forzados;

  IF v_grant_hecho THEN
    RAISE NOTICE '0022 · AVISO: esta corrida SÍ tuvo que emitir un GRANT de columna. Eso significa que `snapshots` cambió de régimen de privilegios respecto de lo medido en el repo — vale la pena mirar qué migración se lo hizo.';
  END IF;

  RAISE NOTICE '0022 · NO COMPROBADO AQUÍ (no se puede desde SQL, P16): que la GUARDA DE DERRUMBE exista. Esta migración solo abre el registro; el rechazo del snapshot que se derrumba lo construye S7-A en src/**. Mientras esa guarda no exista, estas dos columnas SIEMPRE valdrán NULL y su verde no prueba que nadie pueda forzar sin dejar rastro: prueba que, cuando alguien lo haga, hay dónde escribirlo.';
  RAISE NOTICE '0022 · NO COMPROBADO AQUÍ: que el llamador MANDE forzado_por/forzado_motivo. La RPC los lee si vienen; que vengan depende de buildIngestPayload y de las rutas de ingesta, que esta migración no toca. Si el frente de S7-A olvida enviarlos, esto queda en NULL y NO hay ninguna guarda —ni aquí ni en la base— que lo detecte.';
  RAISE NOTICE '0022 · NO GARANTIZADO POR ESTA MIGRACIÓN: que forzado_por identifique a nadie. Es identidad auto-declarada sobre INGEST_SECRET compartido, sin sesión, sin CHECK y sin trigger. Está escrito en el COMMENT de la columna y se repite aquí porque es el límite del diseño, no un detalle de implementación.';
  RAISE NOTICE '0022 · NO COMPROBADO AQUÍ: que PostgREST haya recargado su cache de esquema. El NOTIFY se entrega en el COMMIT; un 42703 sobre /rest/v1/snapshots?select=forzado_por sería cache, no migración.';

  IF v_reservas = 0 THEN
    RAISE NOTICE '0022 · GUARDA VERDE: columnas, comentarios, privilegios, integridad del cuerpo de 0019 y ESCRITURA REAL verificados por efecto. 0 reservas.';
  ELSE
    RAISE NOTICE '0022 · GUARDA VERDE CON RESERVAS: % veredicto(s) no se pudieron medir desde aquí (ver los NO COMPROBADO de arriba). Verde significa "no contradicho", no "probado".', v_reservas;
  END IF;
END $guarda0022$;

COMMIT;

-- ============================================================
-- MARCHA ATRÁS
--
--   ALTER TABLE public.snapshots DROP COLUMN IF EXISTS forzado_motivo;
--   ALTER TABLE public.snapshots DROP COLUMN IF EXISTS forzado_por;
--
-- y para la función, re-aplicar el `CREATE OR REPLACE FUNCTION
-- public.ingest_snapshot(payload jsonb)` de
-- `supabase/migrations/0019_mvp2_familia_nueva.sql` tal cual (es la
-- definición de la que parte esta migración, así que volver es literal).
--
-- ORDEN OBLIGATORIO al deshacer: PRIMERO la función, DESPUÉS las columnas.
-- Al revés, la función seguiría insertando en columnas inexistentes y
-- TODA ingesta fallaría con 42703 durante la ventana entre las dos
-- sentencias.
-- ============================================================
