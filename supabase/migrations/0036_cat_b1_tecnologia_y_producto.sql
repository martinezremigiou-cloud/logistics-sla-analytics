-- ============================================================
-- 0036 · [CAT-B1 · Tramo A] `productos` recupera los DOS NIVELES que el
--        archivo ya traia: `tecnologia` y `producto`.
--
-- EL ESTADO QUE ESTA MIGRACION CIERRA, dicho con precision porque es la
-- razon de que exista:
--
--   El cambio previo en el codigo dejo el lado de JS COMPLETO — `ProductoCanon` y
--   `ProductoRow` declaran los dos campos, el parser los lee, el diff y el
--   hash los propagan, y `buildIngestPayload` (persist.ts:318-327) ya manda
--   `tecnologia` y `producto` dentro de cada objeto de `productos`.
--   Del otro lado NO HAY COLUMNA: `public.productos` se define una sola vez
--   (0001:144-162) y no las tiene.
--
--   Consecuencia exacta, y es la peor forma de fallar: el payload manda las
--   claves, la RPC no las nombra, el INSERT las ignora. CERO error, CERO
--   fila afectada, snapshot escrito y verde. El unico rastro seria un
--   SELECT posterior que nadie hace. Por eso las columnas y la RPC van en
--   la MISMA migracion: una columna sin RPC que la puebla y una RPC que
--   escribe en una columna inexistente son las dos mitades de un 42703.
--
-- ------------------------------------------------------------
-- LO QUE ESTA MIGRACION **NO** HACE
--   · NO rellena las 2 columnas en las filas existentes. Nacen NULL y se
--     pueblan en la SIGUIENTE ingesta, cuando el ETL vuelva a correr. No
--     hay backfill posible: el dato vive en el Excel, no en la base.
--   · NO decide QUE tecnologia gana. Ver el apartado de convivencia.
--   · NO toca `clasificacion_v2`, ni la bandeja de pendientes, ni
--     `sincronizar_pendientes_tecnologia`. Hay guarda que lo asevera.
--   · NO abre ninguna lectura nueva al portal: hoy NINGUN `select` de
--     `src/**` nombra estas dos columnas salvo `loadPrevState`
--     (persist.ts:223), que corre con la llave de servicio.
--
-- ------------------------------------------------------------
-- LA CONVIVENCIA QUE ESTO CREA, Y QUE HAY QUE DECIR EN VOZ ALTA
--
-- A partir de aqui la base tiene DOS columnas llamadas `tecnologia`:
--
--   · `clasificacion_v2.tecnologia` — la CURADA. La escribe un admin por la
--     bandeja (`resolver_pendiente`, 0011/0013/0014) y es la que alimenta
--     `sku_sin_tecnologia` (0013:176-177 el `LEFT JOIN public.clasificacion_v2 v`,
--     0013:196-199 el CRITERIO del pendiente). La cita de este archivo decia
--     196-199 para el JOIN y el JOIN esta en 176: corregido antes de aplicar.
--   · `productos.tecnologia` — la CRUDA, tal como venia en el archivo, que
--     es la que agrega esta migracion.
--
-- NADA EN SQL DECIDE CUAL GANA, y esta migracion no lo decide tampoco:
-- escribe la cruda y deja la curada intacta. La guarda de abajo asevera que
-- la bandeja SIGUE leyendo la curada — como TRINQUETE, no como prueba de
-- este cambio (hoy es verde por construccion, y se declara que lo es).
-- Quien gane en la pantalla es una decision de producto.
--
-- ------------------------------------------------------------
-- EL GRANT: MEDIDO, NO SUPUESTO (deuda TAXO-10, citada en 0022:401)
--
-- «columna nueva en tabla con LISTA BLANCA nace sin GRANT» — y una columna
-- sin GRANT la lee el portal como si no existiera, con un 42501 que el
-- cliente traduce a 403.
--
-- Medido sobre el repo, y se dice con el comando:
--
--     grep -rn "public\.productos\b" --include=*.sql supabase/migrations/ \
--       | grep -iv "productos_" | grep -i "revoke\|grant"      -> 0 lineas
--
-- La lista blanca de 0012-P3 cubre EXACTAMENTE tres tablas —
-- `clasificacion_v2`, `productos_override`, `productos_metadata`
-- (0012:704-708)— y `productos` NO es ninguna de ellas: conserva el SELECT
-- de TABLA de los privilegios por defecto de Supabase, asi que una columna
-- nueva nace LEGIBLE y NO hace falta ningun GRANT.
--
-- AUN ASI LA GUARDA LO MIDE CONTRA EL CATALOGO VIVO y emite el GRANT de
-- columna si el ANTES sale denegado — mismo molde que 0022:355-384. El repo
-- describe lo que se aplico DESDE el repo; no describe lo que alguien haya
-- hecho por Studio o por el MCP. Un GRANT que no hace falta se declara y no
-- se emite; el que haga falta se emite y se declara tambien.
--
-- ------------------------------------------------------------
-- RLS: MEDIDA, NO RECORDADA
--
-- `productos` tiene RLS activa (0002:75) y una sola policy:
-- `productos_select_auth` — FOR SELECT TO authenticated USING (true)
-- (0002:106-111). Es una policy de FILA y no enumera columnas, asi que una
-- columna nueva la hereda sin tocar nada: no hay que crear, alterar ni
-- recrear ninguna policy. Lo que NO hereda de la policy es el privilegio de
-- columna — eso es el apartado del GRANT, y son cosas distintas: la policy
-- decide QUE FILAS, el grant decide QUE COLUMNAS. La guarda comprueba las
-- dos por separado y, ademas, LEYENDO de verdad con el rol `authenticated`.
--
-- ------------------------------------------------------------
-- DE QUE VERSION DE `ingest_snapshot` PARTE ESTA MIGRACION
--
-- De la de **`0022_repro_registro_de_forzado.sql`**, que es la ULTIMA
-- redefinicion vigente. Medido: ninguna migracion 0023..0035 emite
-- `CREATE OR REPLACE FUNCTION public.ingest_snapshot`; la unica mencion
-- posterior es la nota de 0024:419, que tambien la da por vigente.
-- `CREATE OR REPLACE` sustituye la funcion ENTERA: partir de 0019 habria
-- revertido en silencio el registro del forzado (S7-B), y partir de 0013 se
-- habria llevado por delante ademas el alta de familias nuevas de MVP-2.
--
-- El cuerpo de abajo es el de 0022 VERBATIM salvo el bloque de `productos`.
-- No es una afirmacion de confianza: se produjo empalmando las lineas
-- 155-176 y 188-248 de 0022 sin tocarlas, y el `diff -u` contra 0022:155-248
-- devuelve UN SOLO HUNK, integramente dentro del bloque de `productos`:
-- las TRES listas ampliadas (columnas del INSERT, expresiones del SELECT,
-- asignaciones del DO UPDATE SET) MAS el bloque de comentario que las nombra.
-- Antes esta linea decia «exactamente tres cambios» y el comentario no se
-- contaba: en este repo el numero es el que se cita despues, asi que se
-- corrige aqui. Lo que la frase afirma de fondo -- nada se perdio fuera del
-- bloque de productos -- si se sostiene, y se midio con `diff`, no se declaro.
--
-- ------------------------------------------------------------
-- LA GUARDA MUST-CONTAIN VIAJA CON ESTA MIGRACION, Y ES EL PUNTO
--
-- 0022:274-287 declara 12 fragmentos obligatorios y aborta nombrando el que
-- falte (0022:464-468). **Esa guarda vive en la 0022 y NO se re-ejecuta al
-- aplicar esta.** Si este `CREATE OR REPLACE` perdiera una pieza, no habria
-- nada que lo detuviera: el trinquete se perderia justo en el commit que
-- mas lo necesita. Asi que la lista se reproduce ENTERA aqui y se amplia
-- con lo que este bloque agrega.
--
-- Y LOS FRAGMENTOS NUEVOS SE ELIGIERON PARA QUE PUEDAN FALLAR (P19). El
-- fragmento ingenuo `producto` aparece muchas veces en el cuerpo —
-- `productos`, `payload->productos`, `public.productos`— asi que buscarlo
-- seria una guarda VACUA: verde aunque las tres listas se hubieran quedado
-- como estaban. La guarda CUENTA esas apariciones y las imprime, para que
-- el motivo de no usarlo quede medido y no argumentado.
--
-- ------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Dos `ADD COLUMN IF NOT EXISTS` que nacen NULL y un
--      `CREATE OR REPLACE` de una funcion. Cero DROP, cero TRUNCATE, cero
--      UPDATE de filas reales, cero pendiente cerrado.
--      HAY INSERT Y DELETE, y no se esconden: la guarda (4e) ingiere una
--      SONDA —una marca, un SKU y cuatro snapshots, todos con la clave
--      reservada `__probe_0036__`— llamando a la propia `ingest_snapshot`, y
--      la borra POR ID en el mismo bloque. Es la unica forma de comprobar el
--      EFECTO y no el mecanismo: que `prosrc` contenga la palabra
--      `tecnologia` no prueba que el valor llegue a la fila. La sonda no
--      sobrevive ni al camino feliz (se borra) ni al infeliz (ROLLBACK de la
--      transaccion explicita), y su `fuente` NO es `stock`, asi que no
--      dispara ningun productor de pendientes.
--      REVERTIR:
--        -- primero la funcion, DESPUES las columnas (ver MARCHA ATRAS al pie)
--        ALTER TABLE public.productos DROP COLUMN IF EXISTS producto;
--        ALTER TABLE public.productos DROP COLUMN IF EXISTS tecnologia;
--
--   2. ¿Radio de impacto acotado?
--      **Si.** Una tabla y una funcion. El unico DELETE es por `id` (o por
--      el `sku` reservado de la sonda), nunca por predicado abierto. No se
--      toca ninguna fila de negocio: las 2 columnas nacen NULL en todas.
--
--   3. ¿Que NO puede comprobar esta migracion desde donde esta?
--      **Que el dato exista aguas arriba.** Que la RPC sepa escribir las dos
--      columnas no dice que el parser las traiga pobladas: si el Excel
--      cambia de forma o el parser devuelve null, esta migracion sigue
--      verde y las 2 columnas quedan NULL en toda la tabla — que es
--      indistinguible de «no hay dato». Eso se prueba con la suite del ETL
--      y con un SELECT despues de la siguiente ingesta real. Los demas
--      huecos van enumerados en los RAISE NOTICE finales.
--
-- Aplicar con:
--   node scripts/verificar-migracion.mjs supabase/migrations/0036_cat_b1_tecnologia_y_producto.sql
--   node --env-file=.env.db scripts/aplicar-migracion.mjs \
--     supabase/migrations/0036_cat_b1_tecnologia_y_producto.sql \
--     --irreversibilidad="No: dos ADD COLUMN IF NOT EXISTS que nacen NULL y
--       un CREATE OR REPLACE. El unico INSERT es una sonda con clave
--       reservada __probe_0036__ que la propia guarda borra por id dentro de
--       la misma transaccion."
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) LAS DOS COLUMNAS.
--     `text` y NULL, sin DEFAULT y sin CHECK, y las tres decisiones son
--     deliberadas:
--       · `text` porque no hay catalogo de tecnologias ni de productos que
--         referenciar — a diferencia de `marca` y `familia`, estos dos
--         viajan como TEXTO CRUDO del archivo (types.ts:160-169). Un FK
--         aqui inventaria un catalogo que nadie curo.
--       · NULL porque el archivo trae celdas vacias y porque las filas
--         historicas no pueden tener valor: el NULL es la senal.
--       · sin DEFAULT porque un default convierte «no venia» en «venia
--         vacio» y borra esa senal.
--     `IF NOT EXISTS` — mismo estilo que 0022:110-111, que es la migracion
--     mas cercana en forma: la que agrego columnas a una tabla viva.
-- ------------------------------------------------------------
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS tecnologia text;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS producto   text;

COMMENT ON COLUMN public.productos.tecnologia IS
  '[0036 CAT-B1] Tecnologia TAL COMO VIENE EN EL ARCHIVO de inventario: texto '
  'crudo, sin catalogo, sin normalizar y sin validar (ni CHECK, ni FK, ni NOT '
  'NULL). NO ES LA TECNOLOGIA CURADA: esa es clasificacion_v2.tecnologia, la '
  'que un admin captura por la bandeja de pendientes y la que alimenta el '
  'pendiente sku_sin_tecnologia (0013). Desde esta migracion la base tiene las '
  'DOS y NADA EN SQL DECIDE CUAL GANA: quien gane en la pantalla es una '
  'decision de producto, no un default de la base. '
  'NULL = el archivo no traia valor en esa celda, o la fila se escribio antes '
  'de esta migracion. No hay backfill posible porque el dato vive en el Excel: '
  'estas columnas se pueblan en la SIGUIENTE ingesta. '
  'La escribe unicamente ingest_snapshot, leyendo la clave tecnologia del '
  'objeto de productos del payload (buildIngestPayload, persist.ts:318-327).';

COMMENT ON COLUMN public.productos.producto IS
  '[0036 CAT-B1] Nivel PRODUCTO del archivo de inventario, el segundo de los '
  'dos que el parser descartaba en silencio. Texto crudo, sin catalogo y sin '
  'validar, igual que tecnologia. OJO CON EL NOMBRE: la columna producto vive '
  'en la tabla productos y NO es su nombre ni su descripcion; la descripcion '
  'del archivo es descr_origen. '
  'NULL = celda vacia en el archivo, o fila anterior a esta migracion. '
  'La escribe unicamente ingest_snapshot leyendo la clave producto del '
  'payload; ningun otro camino la puebla.';

-- ------------------------------------------------------------
-- (2) `ingest_snapshot` escribe las dos columnas.
--
--     CUERPO DE `0022_repro_registro_de_forzado.sql` VERBATIM salvo el
--     bloque de `productos`, que gana DOS columnas en sus TRES listas. Se
--     reproduce ENTERO porque `CREATE OR REPLACE` sustituye la funcion
--     completa — misma disciplina y misma advertencia que dejaron la 0013,
--     la 0019 y la 0022.
--
--     `p->>'tecnologia'` sobre una clave AUSENTE devuelve NULL, que es
--     exactamente el valor que significa «el archivo no traia nada». Por eso
--     no hay `coalesce` ni `nullif`: normalizar aqui convertiria «no vino»
--     en «vino vacio» y borraria la unica senal que hay.
--
--     EL CONTRATO JS<->SQL NO LO COMPRUEBA NADIE EN CALIENTE: la clave es
--     una cadena de un lado (`persist.ts:318-327`) y un `p->>'...'` del
--     otro. Si no coinciden, la RPC lee NULL y lo escribe sin quejarse. Por
--     eso la guarda (4e) manda un payload REAL y RELEE la fila.
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

  -- [CAT-B1] + tecnologia, producto. UNICA diferencia con 0022.
  --
  -- TRES LISTAS PARALELAS Y HAY QUE TOCAR LAS TRES. Se nombran para que
  -- nadie las cuente mal al releer:
  --   (i)   las COLUMNAS del INSERT,
  --   (ii)  las EXPRESIONES del SELECT -- donde se leen las claves del jsonb,
  --   (iii) las ASIGNACIONES del ON CONFLICT DO UPDATE SET.
  -- Olvidar (iii) es el fallo silencioso perfecto: el dato entra en el ALTA
  -- del SKU y NUNCA se actualiza despues. La sonda de la guarda ingiere DOS
  -- veces el mismo SKU justamente para ejercer ese camino.
  INSERT INTO public.productos (sku, marca_id, familia_id, tecnologia, producto, class, descr_origen, cliente, resv, snapshot_id)
  SELECT p->>'sku',
    (SELECT id FROM public.marcas WHERE nombre = p->>'marca'),
    (SELECT id FROM public.familias WHERE nombre = p->>'familia'),
    p->>'tecnologia', p->>'producto',
    p->>'class', p->>'descr_origen', p->>'cliente',
    coalesce((p->>'resv')::integer,0), snap_id
  FROM jsonb_array_elements(coalesce(payload->'productos','[]'::jsonb)) AS p
  ON CONFLICT (sku) DO UPDATE SET
    marca_id=EXCLUDED.marca_id, familia_id=EXCLUDED.familia_id,
    tecnologia=EXCLUDED.tecnologia, producto=EXCLUDED.producto, class=EXCLUDED.class,
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
-- (3) PostgREST cachea el esquema Y los privilegios. El event trigger
--     `pgrst_ddl_watch` ya emite este NOTIFY ante el DDL de arriba; se
--     repite explicito como defensa en profundidad. Dentro de una
--     transaccion se entrega en el COMMIT: en un ensayo con ROLLBACK no
--     sale. Aqui importa mas que en 0022: son DOS COLUMNAS NUEVAS, y un
--     `select=tecnologia` contra una cache vieja da 42703 aunque la
--     migracion este perfecta.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- (4) LA GUARDA — patron P16, molde de 0017/0019/0020/0022.
--     Seis bloques, y para cada uno esta escrito arriba EL ESTADO QUE LO
--     PONE EN ROJO (P19). Ninguno entra sin eso, y el que hoy no puede
--     ponerse rojo lo dice de si mismo y se cuenta como RESERVA.
-- ------------------------------------------------------------
DO $guarda0036$
DECLARE
  v_col          text;
  v_tipo         text;
  v_notnull      boolean;
  v_def          text;
  -- `integer` y no `smallint` aunque `pg_attribute.attnum` sea smallint: se
  -- pasa a `col_description(oid, integer)` y aqui no hay compilador que
  -- avise si la coercion no fuera implicita.
  v_attnum       integer;

  v_tabla_sel    boolean;
  v_col_acl      integer;
  v_lee_tec_ant  boolean;
  v_lee_prod_ant boolean;
  v_grant_hecho  boolean := false;

  v_rls          boolean;
  v_policies     integer;

  v_oid          oid;
  v_src          text;
  v_oid_band     oid;
  v_src_band     text;
  v_naive        integer;
  v_frag         text[] := ARRAY[
                   -- Las 12 de 0022:274-287, reproducidas ENTERAS porque esa
                   -- guarda NO se re-ejecuta al aplicar esta.
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
  v_f            text;

  v_clave        text := '__probe_0036__';
  v_sku          text := '__probe_0036__/sku';
  v_marca_id     uuid;
  v_snaps        uuid[] := ARRAY[]::uuid[];
  v_s            uuid;
  v_tec          text;
  v_prod         text;

  v_rol_error    text;
  v_lec_error    text;
  v_visible      integer;
  v_tec_auth     text;

  v_filas        bigint;
  v_pobladas     bigint;
  v_reservas     integer := 0;
BEGIN
  -- ==========================================================
  -- (4a) LAS DOS COLUMNAS EXISTEN, SON `text`, SON NULLABLE, NO TIENEN
  --      DEFAULT Y CONSERVAN SU COMMENT.
  --
  -- ROJO SI: el ADD COLUMN no corrio; o ya existia una columna homonima de
  -- otro tipo (un enum, un uuid), que es el caso en el que `p->>'tecnologia'`
  -- reventaria con 22P02 DENTRO de una ingesta y no aqui; o alguien le pone
  -- NOT NULL (toda ingesta con una celda vacia fallaria) o un DEFAULT (que
  -- convierte "no venia" en "vino vacio" y borra la unica senal que hay).
  -- ==========================================================
  FOREACH v_col IN ARRAY ARRAY['tecnologia', 'producto'] LOOP
    SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid), a.attnum
      INTO v_tipo, v_notnull, v_def, v_attnum
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.productos'::regclass
       -- `attname::text` y no `attname` a secas: el molde de 0012:715-719.
       -- Comparar `name` contra una VARIABLE text depende de un operador
       -- de catalogo; el cast lo vuelve una comparacion de textos y ya.
       AND a.attname::text = v_col AND a.attnum > 0 AND NOT a.attisdropped;

    IF v_tipo IS NULL THEN
      RAISE EXCEPTION '0036: productos.% no quedo creada. Abortando.', v_col;
    END IF;
    IF v_tipo <> 'text' THEN
      RAISE EXCEPTION '0036: productos.% quedo como % y se esperaba text. Abortando.', v_col, v_tipo;
    END IF;
    IF v_notnull THEN
      RAISE EXCEPTION '0036: productos.% quedo NOT NULL. El archivo trae celdas vacias y las filas historicas no pueden tener valor: toda ingesta fallaria. Abortando.', v_col;
    END IF;
    IF v_def IS NOT NULL THEN
      RAISE EXCEPTION '0036: productos.% tiene DEFAULT (%). Un default convierte "no venia en el archivo" en "vino vacio" y borra la senal que el NULL lleva. Abortando.', v_col, v_def;
    END IF;
    IF col_description('public.productos'::regclass, v_attnum) IS NULL THEN
      RAISE EXCEPTION '0036: productos.% quedo sin COMMENT. Ahi vive el aviso de que esta columna es la CRUDA y no la curada de clasificacion_v2: sin el, la columna miente por omision a quien la consulte dentro de un ano. Abortando.', v_col;
    END IF;
  END LOOP;

  -- ==========================================================
  -- (4b) EL GRANT · TAXO-10. SE MIDE, NO SE SUPONE.
  --
  -- «columna nueva en tabla con lista blanca nace sin GRANT» (0022:401). El
  -- repo dice que `productos` NO es lista blanca — 0001..0035 no emite ni un
  -- GRANT ni un REVOKE sobre ella, y las tres tablas de 0012-P3 son otras —
  -- pero el repo describe lo que se aplico DESDE el repo. Aqui se pregunta
  -- al catalogo vivo y, si el ANTES sale denegado, se emite el GRANT.
  --
  -- ROJO SI: `productos` hubiera pasado a lista blanca Y el GRANT de abajo
  -- nombrara mal las columnas. Con SELECT de tabla vigente esta rama NO
  -- PUEDE ponerse roja, y por eso se declara como reserva: la que si puede
  -- es la lectura real de (4e).
  -- ==========================================================
  v_tabla_sel    := has_table_privilege('authenticated', 'public.productos', 'SELECT');
  v_lee_tec_ant  := has_column_privilege('authenticated', 'public.productos', 'tecnologia', 'SELECT');
  v_lee_prod_ant := has_column_privilege('authenticated', 'public.productos', 'producto', 'SELECT');

  SELECT count(*) INTO v_col_acl
    FROM pg_attribute a
   WHERE a.attrelid = 'public.productos'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL;

  RAISE NOTICE '0036 - MEDIDO (no supuesto): productos - SELECT de TABLA para authenticated = % - columnas con ACL propio = % - tecnologia legible ANTES de cualquier GRANT de esta migracion = % - producto = %.',
    v_tabla_sel, v_col_acl, v_lee_tec_ant, v_lee_prod_ant;

  IF NOT (v_lee_tec_ant AND v_lee_prod_ant) THEN
    EXECUTE 'GRANT SELECT (tecnologia, producto) ON TABLE public.productos TO authenticated';
    v_grant_hecho := true;
    RAISE NOTICE '0036 - productos RESULTO SER una tabla con LISTA BLANCA de columnas (TAXO-10): las dos columnas nuevas nacieron DENEGADAS y esta migracion emitio el GRANT SELECT de columna para authenticated. El repo NO lo predecia, asi que el regimen de privilegios de productos cambio fuera del repo: vale la pena averiguar quien y cuando.';
  ELSE
    RAISE NOTICE '0036 - productos conserva SELECT de TABLA (lista blanca = NO, justo lo que predecia el repo): las columnas nuevas nacen legibles y NO se emitio ningun GRANT. Emitirlo igual habria sido ruido con dano: un privilegio que hoy no cambia nada y que el dia que productos pase a lista blanca daria la falsa impresion de tenerlo cubierto.';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.productos', 'tecnologia', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.productos', 'producto', 'SELECT') THEN
    RAISE EXCEPTION '0036: authenticated NO puede leer productos.tecnologia/producto tras aplicar (TAXO-10: columna nueva en tabla con lista blanca nace sin GRANT, y el GRANT de este bloque no lo arreglo). El portal las leeria como si no existieran. Abortando.';
  END IF;

  IF v_tabla_sel THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0036 - AVISO ANTI-VACUIDAD: productos tiene SELECT de TABLA para authenticated, asi que la comprobacion por catalogo de la legibilidad de columna es VERDE POR CONSTRUCCION (has_column_privilege devuelve true si el privilegio esta a nivel de columna O de tabla) y no prueba nada por si sola. Lo que prueba algo es la lectura real de (4e).';
  END IF;

  -- ==========================================================
  -- (4c) RLS · lo que una columna nueva hereda y lo que no.
  --
  -- La policy decide QUE FILAS; el grant decide QUE COLUMNAS. Son cosas
  -- distintas y por eso se comprueban por separado. `productos_select_auth`
  -- es FOR SELECT TO authenticated USING (true): no enumera columnas, asi
  -- que una columna nueva la hereda sin tocar nada.
  --
  -- ROJO SI: alguien hubiera apagado la RLS de productos (la tabla quedaria
  -- abierta a cualquier autenticado con solo el grant de tabla) o retirado
  -- la policy de SELECT (el portal dejaria de ver filas, no columnas).
  -- Esta migracion no toca ninguna de las dos: es una MEDICION de su
  -- premisa, no una prueba de su cambio, y se declara como tal.
  -- ==========================================================
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = 'public.productos'::regclass;
  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION '0036: public.productos tiene la RLS DESACTIVADA. Con el grant de tabla y sin RLS la tabla queda abierta entera a cualquier autenticado, y estas dos columnas nuevas entrarian en esa apertura. Abortando.';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policy pol WHERE pol.polrelid = 'public.productos'::regclass;
  IF NOT EXISTS (SELECT 1 FROM pg_policy pol
                  WHERE pol.polrelid = 'public.productos'::regclass
                    AND pol.polname = 'productos_select_auth') THEN
    RAISE EXCEPTION '0036: no existe la policy productos_select_auth sobre public.productos. Con RLS activa y sin policy de SELECT, el portal deja de ver TODA la tabla, no solo las columnas nuevas. Abortando.';
  END IF;
  RAISE NOTICE '0036 - RLS MEDIDA (no recordada): productos tiene RLS activa y % policy(s), y productos_select_auth sigue puesta. Una columna nueva NO exige crear, alterar ni recrear ninguna policy: la policy es de FILA (USING true) y no enumera columnas. Lo que si podia faltarle a una columna nueva es el privilegio, y eso es (4b).', v_policies;

  -- ==========================================================
  -- (4d) LA FUNCION CONSERVA TODO LO DE 0022 Y GANA LO DE CAT-B1
  --      (mecanismo).
  --
  -- ROJO SI: una redefinicion futura parte de una version vieja y pierde
  -- una pieza — que es EXACTAMENTE el accidente que esta migracion podia
  -- haber cometido partiendo de 0019. Reproducible a mano: quitar la linea
  -- de `sincronizar_pendientes_familia` del cuerpo de arriba y aplicar.
  --
  -- `to_regprocedure` y NO `pg_get_function_identity_arguments(...) = 'jsonb'`:
  -- esa comparacion es FALSA SIEMPRE (devuelve `payload jsonb`), abortaba la
  -- 0022 acusando a una funcion perfectamente creada, y es la REGLA 4 del
  -- verificador estatico de este repo.
  -- ==========================================================
  SELECT p.oid, p.prosrc INTO v_oid, v_src
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.ingest_snapshot(jsonb)');

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0036: ingest_snapshot(jsonb) no quedo creada con la firma esperada. Abortando.';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '0036: ingest_snapshot dejo de ser SECURITY DEFINER. Abortando.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0036: anon o authenticated pueden EJECUTAR ingest_snapshot. El REVOKE no surtio efecto. Abortando.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0036: service_role NO puede ejecutar ingest_snapshot - el ETL dejaria de escribir. Abortando.';
  END IF;

  -- LO NUEVO, UNA COMPROBACION POR LISTA, con el mensaje que nombra el
  -- fallo exacto de cada una. Son TRES listas paralelas y las tres tienen
  -- que estar: la de columnas del INSERT, la del SELECT y la del
  -- ON CONFLICT DO UPDATE SET.
  IF position('tecnologia, producto, class' in v_src) = 0 THEN
    RAISE EXCEPTION '0036: la lista de COLUMNAS del INSERT de productos no nombra tecnologia y producto. El payload las manda, el INSERT las ignora: cero error, cero fila afectada, snapshot escrito. Abortando.';
  END IF;
  IF position('p->>''tecnologia''' in v_src) = 0 THEN
    RAISE EXCEPTION '0036: el SELECT del INSERT de productos no lee la clave tecnologia del jsonb. Si la clave no coincide con la que manda buildIngestPayload, la RPC lee NULL y lo escribe sin quejarse. Abortando.';
  END IF;
  IF position('p->>''producto''' in v_src) = 0 THEN
    RAISE EXCEPTION '0036: el SELECT del INSERT de productos no lee la clave producto del jsonb. Abortando.';
  END IF;
  IF position('tecnologia=EXCLUDED.tecnologia' in v_src) = 0 THEN
    RAISE EXCEPTION '0036: el ON CONFLICT DO UPDATE SET no asigna tecnologia. ES EL FALLO SILENCIOSO PERFECTO: el dato entra en el ALTA del SKU y NUNCA se actualiza despues, y como el ALTA si funciona, todo parece correcto. Abortando.';
  END IF;
  IF position('producto=EXCLUDED.producto' in v_src) = 0 THEN
    RAISE EXCEPTION '0036: el ON CONFLICT DO UPDATE SET no asigna producto. Mismo fallo silencioso: entra en el ALTA y nunca se actualiza. Abortando.';
  END IF;

  -- Por que esos cinco fragmentos llevan su contexto pegado y no son la
  -- palabra suelta: SE MIDE, para que el motivo no sea un argumento.
  v_naive := (length(v_src) - length(replace(v_src, 'producto', ''))) / length('producto');
  RAISE NOTICE '0036 - ANTI-VACUIDAD DE LOS FRAGMENTOS (P19): la palabra suelta "producto" aparece % veces en el cuerpo de ingest_snapshot (productos, public.productos, el arreglo del payload...). Buscar ESA habria sido una guarda incapaz de fallar: verde aunque las tres listas se hubieran quedado como estaban. Por eso los cinco fragmentos de arriba llevan contexto.', v_naive;

  FOREACH v_f IN ARRAY v_frag LOOP
    IF position(v_f in v_src) = 0 THEN
      RAISE EXCEPTION '0036: el cuerpo nuevo de ingest_snapshot PERDIO el fragmento "%" que traia la definicion de 0022. Una redefinicion parcial revertiria en silencio el registro del forzado (S7-B) o el alta de familias de MVP-2, y la guarda MUST-CONTAIN de la 0022 NO se re-ejecuta al aplicar esta. Abortando.', v_f;
    END IF;
  END LOOP;

  -- TRINQUETE SOBRE LA CONVIVENCIA. A partir de esta migracion hay DOS
  -- columnas `tecnologia` en la base: la curada (clasificacion_v2) y la
  -- cruda (productos). La bandeja de pendientes tiene que seguir leyendo la
  -- CURADA — si algun dia se repunta a la cruda, que sea una decision.
  --
  -- ROJO SI: alguien reescribio `sincronizar_pendientes_tecnologia` para
  -- leer `p.tecnologia`. Hoy NO puede ponerse rojo porque esta migracion no
  -- toca esa funcion: se cuenta como reserva y se dice.
  SELECT p.oid, p.prosrc INTO v_oid_band, v_src_band
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.sincronizar_pendientes_tecnologia(uuid)');

  IF v_oid_band IS NULL THEN
    RAISE EXCEPTION '0036: no existe sincronizar_pendientes_tecnologia(uuid). La cabecera de esta migracion afirma que la bandeja sigue leyendo la tecnologia CURADA y no puede comprobarlo si la funcion no esta. Abortando.';
  END IF;
  IF position('clasificacion_v2' in v_src_band) = 0 THEN
    RAISE EXCEPTION '0036: sincronizar_pendientes_tecnologia ya NO lee clasificacion_v2. La premisa de convivencia de esta migracion es falsa y agregar la columna cruda ahora mezclaria dos fuentes sin que nadie lo decidiera. Abortando.';
  END IF;
  IF position('p.tecnologia' in v_src_band) > 0 THEN
    RAISE EXCEPTION '0036: sincronizar_pendientes_tecnologia referencia p.tecnologia, es decir la columna CRUDA que agrega esta migracion. La bandeja dejaria de preguntar por los SKU sin ficha curada y cerraria pendientes con el texto del archivo. Abortando.';
  END IF;
  v_reservas := v_reservas + 1;
  RAISE NOTICE '0036 - TRINQUETE DECLARADO, y verde por construccion hoy: la bandeja sigue leyendo clasificacion_v2 y no menciona la columna cruda. Esta comprobacion NO prueba nada de ESTE cambio (la migracion no toca esa funcion); existe para que el dia que alguien repunte la bandeja a la columna cruda sea una decision y no un efecto colateral.';

  -- ==========================================================
  -- (4e) EL EFECTO, NO EL MECANISMO — la sonda.
  --
  -- Que `prosrc` contenga la palabra `tecnologia` NO prueba que el valor
  -- llegue a la fila: eso es P16 en estado puro. Aqui se llama a la RPC real
  -- con un payload con las dos claves y se RELEE la fila.
  --
  -- Y SE INGIERE DOS VECES EL MISMO SKU A PROPOSITO. Una sola ingesta
  -- ejerce solo el ALTA, que es justo el camino que SI funciona cuando falta
  -- la lista del DO UPDATE SET: una sonda de un solo paso habria salido
  -- verde sobre el fallo que mas importa.
  --
  -- La sonda usa `fuente = '__probe_0036__'`, NO 'stock': asi no dispara
  -- `sincronizar_pendientes_tecnologia` ni `sincronizar_pendientes_familia`
  -- y no puede tocar la bandeja. Se borra por id al final del bloque, y si
  -- no se pudiera borrar se aborta: con el ROLLBACK de la transaccion
  -- explicita no queda rastro ni en el camino infeliz.
  -- ==========================================================
  DELETE FROM public.productos WHERE sku = v_sku;                    -- residuo de una corrida abortada
  DELETE FROM public.snapshots WHERE hash IN (v_clave || '/1', v_clave || '/2', v_clave || '/3', v_clave || '/4');
  DELETE FROM public.marcas    WHERE nombre = v_clave;

  -- (i) ALTA. Prueba la lista de COLUMNAS del INSERT y la del SELECT.
  v_s := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',     v_clave,
      'hash',       v_clave || '/1',
      'periodo',    '1970-01',
      'archivo',    v_clave,
      'filas',      '1',
      'created_by', '0036_cat_b1_tecnologia_y_producto'),
    'marcasNuevas', jsonb_build_array(v_clave),
    'productos', jsonb_build_array(jsonb_build_object(
      'sku',          v_sku,
      'marca',        v_clave,
      'tecnologia',   v_clave || '/tec1',
      'producto',     v_clave || '/prod1',
      'class',        v_clave,
      'descr_origen', v_clave,
      'cliente',      v_clave,
      'resv',         0))
  ));
  IF v_s IS NULL THEN
    RAISE EXCEPTION '0036: la sonda a ingest_snapshot no devolvio id. Abortando.';
  END IF;
  v_snaps := v_snaps || v_s;

  SELECT pr.tecnologia, pr.producto INTO v_tec, v_prod
    FROM public.productos pr WHERE pr.sku = v_sku;

  IF v_tec IS DISTINCT FROM (v_clave || '/tec1') OR v_prod IS DISTINCT FROM (v_clave || '/prod1') THEN
    RAISE EXCEPTION '0036: en el ALTA la RPC no grabo las dos columnas. Se envio tecnologia="%" producto="%" y la fila quedo con tecnologia="%" producto="%". O la lista de columnas del INSERT no las nombra, o el SELECT lee otras claves del jsonb. Abortando.',
      v_clave || '/tec1', v_clave || '/prod1', coalesce(v_tec, '(NULL)'), coalesce(v_prod, '(NULL)');
  END IF;

  -- (ii) EL MISMO SKU OTRA VEZ, con valores distintos. Prueba la lista del
  --      ON CONFLICT DO UPDATE SET, que es la que se olvida.
  v_s := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',     v_clave,
      'hash',       v_clave || '/2',
      'periodo',    '1970-01',
      'archivo',    v_clave,
      'filas',      '1',
      'created_by', '0036_cat_b1_tecnologia_y_producto'),
    'marcasNuevas', jsonb_build_array(v_clave),
    'productos', jsonb_build_array(jsonb_build_object(
      'sku',          v_sku,
      'marca',        v_clave,
      'tecnologia',   v_clave || '/tec2',
      'producto',     v_clave || '/prod2',
      'class',        v_clave,
      'descr_origen', v_clave,
      'cliente',      v_clave,
      'resv',         0))
  ));
  v_snaps := v_snaps || v_s;

  SELECT pr.tecnologia, pr.producto INTO v_tec, v_prod
    FROM public.productos pr WHERE pr.sku = v_sku;

  IF v_tec IS DISTINCT FROM (v_clave || '/tec2') OR v_prod IS DISTINCT FROM (v_clave || '/prod2') THEN
    RAISE EXCEPTION '0036: EL FALLO SILENCIOSO PERFECTO ESTA AQUI. El mismo SKU se volvio a ingerir con tecnologia="%" producto="%" y la fila sigue con tecnologia="%" producto="%": el dato entra en el ALTA y NUNCA se actualiza. Falta la tercera lista, la del ON CONFLICT DO UPDATE SET. Abortando.',
      v_clave || '/tec2', v_clave || '/prod2', coalesce(v_tec, '(NULL)'), coalesce(v_prod, '(NULL)');
  END IF;

  -- (iii) LECTURA REAL POR `authenticated`, con la fila viva y con VALOR.
  --
  -- (4b) mira el catalogo; esto EJECUTA la lectura como el rol que va a
  -- hacerla, asi que cubre a la vez el privilegio de columna y la policy de
  -- RLS. Y a diferencia de la sonda de 0022 —que tenia que conformarse con
  -- comprobar que leia NULL— aqui se compara el VALOR: si lo que lee
  -- authenticated no es lo que escribio la RPC, esto se pone rojo.
  --
  -- DEGRADACION DECLARADA: si el rol que aplica no puede asumir
  -- `authenticated`, se dice con NOTICE en vez de fingir un verde. No
  -- enmascara el caso rojo: el catalogo de (4b) ya habria abortado.
  BEGIN
    PERFORM set_config('role', 'authenticated', true);
  EXCEPTION WHEN OTHERS THEN
    v_rol_error := SQLERRM;
  END;

  IF v_rol_error IS NOT NULL THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0036 - NO COMPROBADO (lectura real): el rol que aplica esta migracion no pudo asumir authenticated (%). La legibilidad de las dos columnas queda comprobada solo por catalogo, que con SELECT de tabla es verde por construccion.', v_rol_error;
  ELSE
    BEGIN
      SELECT count(*) INTO v_visible FROM public.productos pr WHERE pr.sku = v_sku;
      SELECT pr.tecnologia INTO v_tec_auth FROM public.productos pr WHERE pr.sku = v_sku;
    EXCEPTION WHEN insufficient_privilege THEN
      v_lec_error := SQLERRM;
    END;
    PERFORM set_config('role', 'none', true);

    IF v_lec_error IS NOT NULL THEN
      RAISE EXCEPTION '0036: con el rol authenticated la lectura de productos.tecnologia fallo con 42501 (%). La columna nueva nacio denegada y el GRANT de (4b) no lo arreglo: el portal la leeria como si no existiera. Abortando.', v_lec_error;
    END IF;
    IF v_visible IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '0036: con el rol authenticated la fila de la sonda NO es visible (filas vistas: %). O la policy productos_select_auth desaparecio, o RLS bloquea la lectura del portal. Abortando.', coalesce(v_visible, -1);
    END IF;
    IF v_tec_auth IS DISTINCT FROM (v_clave || '/tec2') THEN
      RAISE EXCEPTION '0036: authenticated leyo productos.tecnologia = "%" cuando la fila tiene "%". Abortando.', coalesce(v_tec_auth, '(NULL)'), v_clave || '/tec2';
    END IF;
    RAISE NOTICE '0036 - LECTURA REAL VERDE: como authenticated se leyo productos.tecnologia sin 42501, la fila es visible bajo productos_select_auth y el valor leido es EL MISMO que escribio la RPC. Esta si puede ponerse roja: no compara privilegios, compara el dato.';
  END IF;

  -- (iv) CONTROL NEGATIVO, en sus DOS formas, porque no son la misma:
  --      (a) claves AUSENTES del jsonb;
  --      (b) claves PRESENTES con `null` de JSON, que es EXACTAMENTE lo que
  --          manda el productor real: persist.ts:318-327 emite siempre
  --          `tecnologia` y `producto`, y valen null cuando el archivo trae
  --          la celda vacia. Probar solo (a) dejaria sin cubrir el caso de
  --          produccion.
  --      Las dos tienen que dejar SQL NULL, no cadena vacia. Y de paso
  --      vuelven a ejercer el DO UPDATE SET en el sentido contrario: un SKU
  --      que PIERDE su tecnologia en el archivo tiene que perderla aqui.
  --
  -- ROJO SI: alguien mete un coalesce en la RPC que convierta la ausencia o
  -- el null en cadena vacia, o le pone un DEFAULT a la columna.
  v_s := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',     v_clave,
      'hash',       v_clave || '/3',
      'periodo',    '1970-01',
      'archivo',    v_clave,
      'filas',      '1',
      'created_by', '0036_cat_b1_tecnologia_y_producto'),
    'marcasNuevas', jsonb_build_array(v_clave),
    'productos', jsonb_build_array(jsonb_build_object(
      'sku',   v_sku,
      'marca', v_clave,
      'resv',  0))
  ));
  v_snaps := v_snaps || v_s;

  SELECT pr.tecnologia, pr.producto INTO v_tec, v_prod
    FROM public.productos pr WHERE pr.sku = v_sku;
  IF v_tec IS NOT NULL OR v_prod IS NOT NULL THEN
    RAISE EXCEPTION '0036: una ingesta SIN las dos claves dejo tecnologia="%" producto="%" en vez de NULL. El NULL dejaria de significar "el archivo no traia nada" y el COMMENT de las columnas seria falso. Abortando.',
      coalesce(v_tec, '(NULL)'), coalesce(v_prod, '(NULL)');
  END IF;

  v_s := public.ingest_snapshot(jsonb_build_object(
    'snapshot', jsonb_build_object(
      'fuente',     v_clave,
      'hash',       v_clave || '/4',
      'periodo',    '1970-01',
      'archivo',    v_clave,
      'filas',      '1',
      'created_by', '0036_cat_b1_tecnologia_y_producto'),
    'marcasNuevas', jsonb_build_array(v_clave),
    'productos', jsonb_build_array(jsonb_build_object(
      'sku',        v_sku,
      'marca',      v_clave,
      -- `NULL::text` y no `NULL` a secas: jsonb_build_object es polimorfica
      -- y un NULL sin tipo no se puede resolver.
      'tecnologia', NULL::text,
      'producto',   NULL::text,
      'resv',       0))
  ));
  v_snaps := v_snaps || v_s;

  SELECT pr.tecnologia, pr.producto INTO v_tec, v_prod
    FROM public.productos pr WHERE pr.sku = v_sku;
  IF v_tec IS NOT NULL OR v_prod IS NOT NULL THEN
    RAISE EXCEPTION '0036: una ingesta con tecnologia/producto en null de JSON -la forma que emite buildIngestPayload cuando la celda viene vacia- dejo tecnologia="%" producto="%" en vez de NULL. Abortando.',
      coalesce(v_tec, '(NULL)'), coalesce(v_prod, '(NULL)');
  END IF;

  RAISE NOTICE '0036 - SONDA VERDE: con las claves pobladas la RPC graba los dos valores en el ALTA, los ACTUALIZA cuando el SKU vuelve, y graba NULL cuando las claves faltan o vienen en null. Verificado releyendo la fila, no leyendo el codigo.';

  -- Limpieza. Por id (o por el sku reservado), nunca por predicado abierto.
  -- El orden es forzoso: productos apunta a snapshots y a marcas.
  DELETE FROM public.productos WHERE sku = v_sku;
  FOREACH v_s IN ARRAY v_snaps LOOP
    DELETE FROM public.snapshots WHERE id = v_s;
  END LOOP;
  SELECT m.id INTO v_marca_id FROM public.marcas m WHERE m.nombre = v_clave;
  IF v_marca_id IS NOT NULL THEN
    DELETE FROM public.marcas WHERE id = v_marca_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.productos WHERE sku = v_sku)
     OR EXISTS (SELECT 1 FROM public.snapshots WHERE archivo = v_clave)
     OR EXISTS (SELECT 1 FROM public.marcas WHERE nombre = v_clave) THEN
    RAISE EXCEPTION '0036: la sonda no se pudo borrar y quedarian filas basura. Causa mas probable: el rol que aplica esta migracion NO es el DUENO de estas tablas, asi que RLS si le aplica y snapshots no tiene policy de DELETE (es inmutable por diseno, 0002). Aplicar con el rol dueno. Nada se aplico.';
  END IF;
  RAISE NOTICE '0036 - sonda retirada: no queda ninguna fila con la clave reservada %.', v_clave;

  -- ==========================================================
  -- (4f) CENSO + LO QUE ESTA GUARDA NO PUEDE COMPROBAR DESDE AQUI
  -- ==========================================================
  SELECT count(*) INTO v_filas FROM public.productos;
  SELECT count(*) INTO v_pobladas FROM public.productos
   WHERE tecnologia IS NOT NULL OR producto IS NOT NULL;
  RAISE NOTICE '0036 - CENSO, con el denominador dicho: public.productos tiene % filas EN TOTAL (la tabla entera, NO el snapshot vigente - esta tabla es de estado actual y arrastra SKU remanentes) y % de ellas tienen alguna de las dos columnas nuevas poblada. Se esperan 0: nacen NULL, no hay backfill posible porque el dato vive en el Excel, y se pueblan en la SIGUIENTE ingesta.', v_filas, v_pobladas;

  IF v_grant_hecho THEN
    RAISE NOTICE '0036 - AVISO: esta corrida SI tuvo que emitir un GRANT de columna. Eso significa que productos cambio de regimen de privilegios respecto de lo medido en el repo: vale la pena mirar que lo hizo.';
  END IF;

  RAISE NOTICE '0036 - NO COMPROBADO AQUI: que el PARSER traiga las dos columnas pobladas. La sonda prueba que la RPC escribe lo que le manden con esas dos claves; que el Excel traiga los dos niveles y que el parser los lea vive en src/services/etl/** y en su suite, no aqui. Si el parser mandara null en todas las filas, esta migracion seguiria verde y las columnas quedarian NULL en toda la tabla, que es indistinguible de "no hay dato".';
  RAISE NOTICE '0036 - NO COMPROBADO AQUI: que el PORTAL las lea. Medido con grep el 2026-09-17: ningun select de src/** nombra tecnologia ni producto sobre la tabla productos, asi que para el portal siguen siendo invisibles y eso es trabajo de otro tramo.';
  RAISE NOTICE '0036 - ACOPLE DE ORDEN, Y NO ES SILENCIOSO: el ETL SI las selecciona. Un cambio previo en el codigo ya cambio el select de loadPrevState (persist.ts:223) para nombrarlas, y assertPrevOk (persist.ts:70-74) LANZA ante cualquier error. Por tanto, con ese cambio en el arbol y SIN esta migracion aplicada, TODA ingesta muere con "prev_state_no_disponible: productos: column productos.tecnologia does not exist" ANTES de llegar al INSERT. La cabecera de este archivo describia el riesgo contrario (una columna muda que se pierde en silencio); ese era el riesgo del codigo SIN el commit. Con el commit puesto, el fallo es ruidoso y total. CONSECUENCIA OPERATIVA: esta migracion se aplica ANTES o JUNTO con el despliegue de 75140k6, nunca despues.';
  RAISE NOTICE '0036 - NO COMPROBADO AQUI: que PostgREST haya recargado su cache de esquema. El NOTIFY se entrega en el COMMIT; un 42703 sobre select=tecnologia justo despues seria cache, no migracion.';
  RAISE NOTICE '0036 - NO DECIDIDO POR ESTA MIGRACION: cual de las DOS tecnologias gana. Desde ahora hay dos columnas con ese nombre - la curada de clasificacion_v2 (bandeja) y la cruda de productos (archivo) - y ningun SQL las reconcilia. Nadie cambio de fuente aqui; cuando haga falta elegir, es decision del PO.';
  RAISE NOTICE '0036 - NO COMPROBADO AQUI: que ingest_snapshot siga siendo el UNICO escritor de productos. Hoy lo es (las demas apariciones de INSERT INTO public.productos en supabase/migrations son versiones ANTERIORES de esta misma funcion: 0005, 0009, 0013, 0019, 0022). Si manana aparece otro camino de escritura, dejaria las dos columnas en NULL por ese camino y ninguna guarda lo detectaria.';

  -- El `IF v_reservas = 0` que habia aqui NO PODIA EJECUTARSE NUNCA: el
  -- incremento del trinquete de convivencia es INCONDICIONAL, asi que al
  -- llegar a este punto v_reservas siempre vale >= 1. Era un mensaje
  -- inalcanzable afirmando un estado que el propio codigo vuelve imposible --
  -- la cara B de P19, la misma que 0022:412-440 documenta por escrito.
  -- Se sustituye por una asercion que SI puede ponerse roja: si el conteo cae
  -- por debajo del minimo estructural, es que una reserva declarada dejo de
  -- contarse, y eso merece saberse.
  IF v_reservas < 1 THEN
    RAISE EXCEPTION '0036: el contador de reservas vale % y el minimo estructural es 1 (el trinquete de convivencia incrementa siempre). Si esto salta, una reserva declarada dejo de contarse y el veredicto de abajo estaria mintiendo.', v_reservas;
  END IF;
  RAISE NOTICE '0036 - GUARDA VERDE CON RESERVAS: % veredicto(s) no se pudieron medir desde aqui o son verdes por construccion (ver los avisos de arriba). Verde significa "no contradicho", no "probado".', v_reservas;
END $guarda0036$;

COMMIT;

-- ============================================================
-- MARCHA ATRAS
--
--   -- PRIMERO la funcion: re-aplicar el CREATE OR REPLACE FUNCTION
--   -- public.ingest_snapshot(payload jsonb) de
--   -- supabase/migrations/0022_repro_registro_de_forzado.sql tal cual (es la
--   -- definicion de la que parte esta migracion, asi que volver es literal).
--
--   ALTER TABLE public.productos DROP COLUMN IF EXISTS producto;
--   ALTER TABLE public.productos DROP COLUMN IF EXISTS tecnologia;
--
-- ORDEN OBLIGATORIO: PRIMERO la funcion, DESPUES las columnas. Al reves, la
-- funcion seguiria insertando en columnas inexistentes y TODA ingesta
-- fallaria con 42703 durante la ventana entre las dos sentencias.
--
-- Y FALTA UN PASO QUE NO ES SQL, sin el cual esta receta TUMBA LA INGESTA:
--   -- ANTES de soltar las columnas hay que revertir tambien el select de
--   -- `loadPrevState` (src/services/etl/persist.ts:223), que desde ese cambio
--   -- nombra `tecnologia` y `producto`. `assertPrevOk` lanza ante
--   -- cualquier error, asi que con ese select vivo y las columnas caidas el
--   -- ETL no pierde dos campos: no corre. Quien siga esta marcha atras al pie
--   -- de la letra sin este paso deja la ingesta muerta.
--
-- Y LO QUE SE PIERDE AL DESHACER, dicho para que nadie lo descubra despues:
-- el contenido de las dos columnas. No hay backfill que lo recupere -- el
-- dato vive en el Excel, asi que volver a tenerlo exige volver a ingerir.
-- ============================================================
