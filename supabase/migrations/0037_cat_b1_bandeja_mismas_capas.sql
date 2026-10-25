-- ============================================================
-- 0037 · [CAT-B1 · Tramo D] La bandeja de `sku_sin_tecnologia` pasa a leer
--        LAS DOS CAPAS: la FUENTE (`productos.tecnologia`) y la CONGELADA
--        (`clasificacion_v2.tecnologia`).
--
-- LA REGLA QUE GOBIERNA ESTE ARCHIVO, y de la que se deriva todo lo demas:
--
--        LA-GUARDA-QUE-CIERRA-LEE-LAS-MISMAS-CAPAS-QUE-LA-QUE-ENCOLA
--
-- ------------------------------------------------------------
-- DE QUE CUERPO PARTE ESTA MIGRACION — MEDIDO CONTRA LA BASE VIVA, NO
-- SUPUESTO POR EL NUMERO DE ARCHIVO
--
-- `sincronizar_pendientes_tecnologia` la creo la 0013 y la 0015 la volvio a
-- definir entera (guarda de universo vacio + reapertura acotada). El repo es
-- una COPIA; la unica fuente de «que corre hoy» es una peticion a la base.
-- Se hizo esa peticion:
--
--     SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE p.proname = 'sincronizar_pendientes_tecnologia' AND n.nspname = 'public';
--     -> 1 fila · args [p_snapshot uuid] · RETURNS jsonb
--        SECURITY DEFINER · search_path = pg_catalog, public
--        6 677 bytes · 156 lineas
--
-- Y se diffeo contra las candidatas del repo:
--
--     diff -u <cuerpo de 0015:50-204> <prosrc vivo>   -> SIN DIFERENCIAS, exit 0
--     sha256 de los dos ficheros:
--       (huella omitida en esta copia)
--
-- **EMPATA BYTE A BYTE CON `0015_mvp_cierre_autocierre_seguro.sql`, lineas
-- 50-204.** De ahi parte este archivo. Partir de la 0013 habria revertido en
-- silencio las dos correcciones de la 0015 — la guarda de universo vacio (que
-- impedia cerrar la bandeja entera ante una ingesta degenerada) y la
-- reapertura acotada — que es exactamente la clase de perdida que no deja
-- rastro: la funcion seguiria compilando y devolviendo su JSON.
--
-- ------------------------------------------------------------
-- QUE ESTABA MAL, Y POR QUE NO ES CULPA DE LA 0013
--
-- Hasta la 0036 solo existia UNA capa con tecnologia: `clasificacion_v2`. Y
-- sobre UNA capa, el encolado y el auto-cierre de la 0013/0015 YA ERAN
-- complementos exactos:
--
--     encola  si   (v.sku IS NULL OR v.tecnologia IS NULL OR btrim(v.tecnologia) = '')   == NO tiene v2
--     cierra  si   (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> '')              == SI tiene v2
--
-- O sea: la regla que encabeza este archivo NO se rompio por descuido de la
-- 0013. **Se cumplia por accidente de que solo habia una capa que leer.** La
-- 0036 agrego la segunda (`productos.tecnologia`, el texto crudo del archivo)
-- y con eso la simetria dejo de ser automatica — sin que ninguna linea de la
-- 0013 cambiara. Es el mismo patron que este repo ya tiene escrito: un
-- invariante que se sostenia solo porque el universo tenia un elemento.
--
-- ------------------------------------------------------------
-- EL NUDO, MEDIDO CONTRA EL VIGENTE DEL MOMENTO (id omitido en esta copia)
-- (fuente `stock`)
--
--   catalogo vigente ....................... N
--   con tecnologia en la FUENTE ............ n
--   sin tecnologia en la fuente ............ n
--      · CON valor en la capa congelada ..... n   <- EL NUDO, no se toca
--      · sin valor en ninguna ............... n   <- los que quedan abiertos
--   predicado vivo hoy (mira solo v2) ...... n   = falsos + reales
--   pendientes `sku_sin_tecnologia` abiertos  n
--   cerrados hoy con motivo «ya tiene tecnologia» ... 0
--
-- Los falsos son SKU que TIENEN tecnologia en el archivo (p. ej. ANH677-D,
-- EGQ095-Q, JE016-YD, todos `BRAND1`) y no tienen ficha en `clasificacion_v2`.
-- La bandeja le esta preguntando al admin algo que el archivo ya contesto.
--
-- ------------------------------------------------------------
-- POR QUE LAS DOS PIEZAS VAN EN LA MISMA MIGRACION
--
-- Cualquiera de las dos SOLA deja un estado PEOR que el actual:
--
--   · Solo el ENCOLADO -> los ya encolados NO se desencolan (un encolado
--     no desencola: es un INSERT, no un DELETE) y quedan abiertos PARA
--     SIEMPRE, preguntando algo ya contestado.
--
--   · Solo el AUTO-CIERRE -> los del nudo entrarian al encolado (que
--     seguiria mirando solo v2... no: seguirian fuera). Lo grave es lo otro:
--     con el encolado viejo y el cierre nuevo, un SKU podria ser encolado y
--     auto-cerrado en la MISMA corrida, y la reapertura acotada de la 0015 NO
--     reabre lo cerrado por «ya tiene tecnologia» — asi que la condicion
--     quedaria viva y la tarjeta CALLADA PARA SIEMPRE. Hoy esa trampa no
--     tiene victimas (cero filas cerradas con ese motivo, medido arriba); las
--     tendria desde la primera ingesta posterior a una 0037 asimetrica.
--
-- Por eso las dos van en el MISMO `CREATE OR REPLACE`, y por eso la guarda de
-- abajo comprueba que sean NEGACIONES EXACTAS y no solo que los conteos
-- salgan: un conteo correcto con predicados asimetricos es P25 en estado puro
-- — el resultado correcto por la razon equivocada.
--
-- ------------------------------------------------------------
-- COMO SE ESCRIBIERON LOS DOS PREDICADOS PARA QUE LA SIMETRIA SE VEA
--
-- Los dos se apoyan en los MISMOS DOS ATOMOS, con el mismo nombre en los dos
-- sitios:
--
--     tiene_tec_fuente := (p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
--     tiene_tec_v2     := (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> '')
--
--     ENCOLA  si   NOT (tiene_tec_fuente OR tiene_tec_v2)
--     CIERRA  si       (tiene_tec_fuente OR tiene_tec_v2)
--
-- Y LOS DOS ATOMOS SON DE DOS VALORES, NO DE TRES — que es la unica forma de
-- que `NOT X` sea de verdad el complemento de `X` en SQL. `col IS NOT NULL`
-- nunca devuelve NULL, y `FALSE AND NULL` es `FALSE`, asi que el atomo vale
-- TRUE o FALSE y jamas NULL. Si alguien lo simplificara a `btrim(col) <> ''`
-- —que «parece» lo mismo— el atomo pasaria a valer NULL cuando la columna es
-- NULL, y entonces NI el encolado NI el cierre lo tomarian: el SKU se caeria
-- por la grieta de en medio, sin pendiente y sin cierre.
--
-- QUIEN VIGILA ESA GRIETA ES LA RAMA E DE LA SONDA (4d), NO LA SUMA DE (4c).
-- La (4c) reescribe los atomos en su propio SQL en vez de ejecutar los de la
-- funcion, y sobre una X de dos valores `count(NOT X) + count(X) = count(*)`
-- es una TAUTOLOGIA: no hay dato que la ponga roja. La rama E si ejecuta la
-- funcion — un atomo de tres valores en el encolado la deja sin insertar la
-- fila y la guarda aborta.
--
-- LA ASIMETRIA QUE SI QUEDA, Y ES DELIBERADA: el encolado recorre el universo
-- «productos del snapshot vigente»; el cierre recorre «pendientes abiertos».
-- Un pendiente cuyo SKU ya no esta en el vigente tiene `tiene_tec_fuente` =
-- FALSE (LEFT JOIN sin fila) y lo cierra el auto-cierre (2/2) por «salio del
-- catalogo», que es su trabajo. Medido: ningun pendiente abierto sin
-- producto en el vigente, asi que 2/2 no cierra nada en esta corrida.
--
-- ------------------------------------------------------------
-- LO QUE ESTA MIGRACION **NO** HACE
--   · NO toca la rama de MARCA (`marca_ambigua`, `marca_west`). No tienen
--     auto-cierre y construirlo exige una decision que no se ha tomado.
--     Fuera de alcance por escrito.
--   · NO toca `productos_override`, `derivaciones.ts` ni `resolver_pendiente`.
--   · NO toca `clasificacion_v2` con DROP, DELETE ni TRUNCATE. Lo unico que
--     escribe ahi es UNA fila de sonda con clave reservada, borrada por
--     igualdad contra ese SKU reservado, nunca por predicado abierto.
--     (`clasificacion_v2` tiene el SKU por clave: ahi «por id» y «por sku»
--     son la misma cosa, y se dice «por sku» para no afirmar de mas.)
--   · NO decide CUAL de las dos tecnologias gana en la pantalla. La 0036 dejo
--     esa decision abierta y aqui sigue sin tomarse: el cierre GUARDA LAS DOS
--     (`tecnologia_fuente` y `tecnologia_v2`) y ademas dice de cual salio la
--     respuesta (`origen`). El campo escalar `tecnologia` que ya existia se
--     conserva por compatibilidad y, cuando las dos capas tienen valor, toma
--     el de la fuente — es un desempate de CAMPO DE AUDITORIA, no una regla
--     de producto, y no destruye informacion porque los dos valores crudos
--     viajan en el mismo objeto.
--   · NO cambia el vocabulario de `payload.poblacion`. Se conservan EXACTOS
--     los tres valores (`alta_reciente`, `preexistente_sin_ficha`,
--     `ficha_sin_tecnologia`) porque `pendiente-fila.tsx:183-187` los mapea a
--     texto y hace `ORIGEN[poblacion] ?? poblacion`: un valor nuevo no romperia
--     la vista, le escupiria al usuario el token crudo en snake_case.
--
-- ------------------------------------------------------------
-- LO QUE SE RETIRA, DICHO PARA QUE EL DIFF NO PAREZCA UNA PERDIDA
--
-- La declaracion `v_reabiertos integer := 0;`. Medido sobre el prosrc vivo:
-- aparece UNA sola vez en las 156 lineas, que es su propia declaracion. Nunca
-- se asigna, nunca se lee y nunca sale en el JSON. Es codigo muerto desde la
-- 0015 y se va; no hay comportamiento detras.
--
-- ------------------------------------------------------------
-- LO QUE ESTA MIGRACION DEJA VIVO Y HAY QUE DECIR EN VOZ ALTA
--
-- **LA REAPERTURA ACOTADA SE VUELVE UNA TRAMPA CON VICTIMAS.** La 0015:94-95
-- justifica no reabrir lo cerrado por «ya tiene tecnologia» asi: «si vuelve a
-- faltarle, el SKU no esta en este universo y no llega hasta aqui».
-- **Esa justificacion es falsa, y ya lo era antes de esta migracion.** Si a un
-- SKU cerrado por ese motivo se le vacia la tecnologia, el encolado SI lo
-- selecciona (por eso mismo: ya no tiene), SI llega al `ON CONFLICT`, y ahi el
-- `WHERE` lo rechaza porque su motivo no empieza por «El SKU salio del
-- catalogo». Resultado: queda `resuelto` para siempre y la bandeja calla.
--
-- Hoy eso tiene CERO victimas porque hay CERO filas cerradas con ese motivo.
-- Despues de esta migracion habra varias. **No se arregla aqui a proposito:**
-- ampliar el `WHERE` de la reapertura es una decision de politica sobre que
-- se reabre y que no, y esta por decidir — es vecina de la pieza (3) que sigue
-- esperando su «abrir» o «cerrar». Queda declarada, con nombre, en el NOTICE
-- final y en el reporte del bloque.
--
-- ------------------------------------------------------------
-- EL TRINQUETE DE LA 0036 QUE ESTA MIGRACION ROMPE **A PROPOSITO**
--
-- `0036:608-611` aborta si `sincronizar_pendientes_tecnologia` deja de
-- mencionar `clasificacion_v2` o si menciona `p.tecnologia`. Ese trinquete se
-- escribio para que repuntar la bandeja a la columna cruda fuera UNA DECISION
-- y no un efecto colateral. **Esta migracion ES esa decision, tomada
-- explicitamente**, y cumple la mitad que importa: sigue leyendo `clasificacion_v2`
-- (la 0036 no queda contradicha en su premisa de convivencia) y ademas lee la
-- cruda. Pero la segunda condicion —«no menciona `p.tecnologia`»— deja de
-- valer.
--
-- CONSECUENCIA OPERATIVA, para que nadie la descubra a golpes: **RE-APLICAR
-- la 0036 despues de esta migracion ABORTA** con su propio mensaje. No es un
-- fallo: es su guarda haciendo su trabajo sobre un mundo que cambio. Si
-- alguna vez hay que re-aplicar la 0036, se re-aplica esta despues.
--
-- ------------------------------------------------------------
-- LA VARA NO ES EL JSON — `EL-ROW_COUNT-DE-UN-UPSERT-NO-ES-EL-TAMANO-DEL-PREDICADO`
--
-- `encolados` es el `ROW_COUNT` de un `INSERT ... ON CONFLICT ... DO UPDATE
-- ... WHERE`: cuenta inserciones y reaperturas REALES. Los SKU que el
-- predicado selecciona pero que YA tienen su pendiente abierto chocan, fallan
-- el `WHERE` de la reapertura y **no se cuentan**. Por eso, con los reales
-- ya abiertos, lo correcto que devuelve esta funcion es `encolados = 0` — y
-- quien lea ese 0 esperando la cardinalidad del predicado esta midiendo otra cosa. La guarda (4e)
-- imprime LAS DOS cifras juntas y con su nombre: el ROW_COUNT y la
-- cardinalidad del predicado contada con un SELECT aparte.
--
-- ------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **ESTA MIGRACION NO ES SOLO ESTRUCTURAL: CIERRA PENDIENTES
--      REALES `sku_sin_tecnologia`.** Y no por un efecto colateral — la
--      guarda LLAMA A LA FUNCION DOS VECES contra el snapshot vigente: una
--      en (4d), con la sonda puesta, y otra en (4e), limpia. Cada llamada
--      hace el trabajo de verdad: los falsos positivos pasan a
--      `resuelto` con `resuelto_por = 'auto:ingesta'`. Es exactamente lo que
--      haria la siguiente ingesta; adelantarlo aqui es lo que permite MEDIR
--      el efecto en el momento de aplicar en vez de creerlo. La cifra real
--      la imprime el NOTICE «ESTA MIGRACION NO ES SOLO ESTRUCTURAL».
--      NO es irreconstruible: lo cerrado por ESTA version lleva una marca que
--      ninguna version anterior escribia — la clave `origen` en `resolucion`.
--      REVERTIR el cierre (sin tocar nada resuelto por un humano ni por la
--      version vieja):
--        UPDATE public.pendientes_datos
--           SET estado = 'abierto', resolucion = NULL,
--               resuelto_por = NULL, resuelto_en = NULL
--         WHERE tipo = 'sku_sin_tecnologia'
--           AND estado = 'resuelto'
--           AND resuelto_por = 'auto:ingesta'
--           AND resolucion ? 'origen';
--      HAY ADEMAS INSERT Y DELETE de SONDA: una marca, cinco productos, una
--      ficha `clasificacion_v2` y tres pendientes, todos con la clave
--      reservada `__probe_0037__`. Se borran en el mismo bloque POR `id` o
--      POR IGUALDAD contra los SKU (o el nombre) reservados de la sonda,
--      nunca por predicado abierto — la misma redaccion de la pregunta 2, y
--      es la exacta: `pendientes_datos` y `marcas` se borran por `id`;
--      `clasificacion_v2` y `productos` por SKU, que en las dos ES su clave.
--      No sobreviven al camino feliz (se borran) ni al infeliz (ROLLBACK de
--      la transaccion explicita).
--
--   2. ¿Radio de impacto acotado?
--      **Si.** Una funcion y las filas de `pendientes_datos` de UN tipo
--      (`sku_sin_tecnologia`) que hoy estan `abierto`. Cero DROP, cero
--      TRUNCATE, cero ALTER de tabla. Los DELETE son por `id` o por igualdad
--      contra los SKU reservados de la sonda, nunca por predicado abierto.
--      NO se toca ningun pendiente resuelto por un humano: el auto-cierre
--      filtra `estado = 'abierto'`. Medido: los resueltos por
--      `hlara@example.com` tienen valor en las DOS capas, asi que el
--      encolado tampoco los mira.
--
--   3. ¿Que NO puede comprobar esta migracion desde donde esta?
--      **Que el archivo siga trayendo la tecnologia.** Todo el beneficio de
--      esta migracion descansa en que `productos.tecnologia` venga poblada
--      desde el Excel. Si una ingesta futura la dejara vacia, los cerrados no se
--      reabren (ver «lo que deja vivo», arriba) y ademas el predicado volveria
--      a crecer. Eso se vigila en el ETL y en la bandeja, no aqui.
--      **Y que vuelva a correr una ingesta de `fuente = 'stock'`.** La
--      convergencia que esta migracion deja hecha es de HOY; la que venga
--      despues la produce `ingest_snapshot`, que llama a esta funcion DENTRO
--      de un `IF snap->>'fuente' = 'stock'` (0013:378, reproducido igual en
--      0019:352, 0022:234 y 0036:326). Una ingesta de ADUANA no resincroniza
--      nada de `sku_sin_tecnologia`. Va tambien en un `RAISE NOTICE`.
--      Los demas huecos van enumerados en los `RAISE NOTICE` finales.
--
-- Aplicar con:
--   node scripts/verificar-migracion.mjs supabase/migrations/0037_cat_b1_bandeja_mismas_capas.sql
--   node --env-file=.env.db scripts/aplicar-migracion.mjs \
--     supabase/migrations/0037_cat_b1_bandeja_mismas_capas.sql \
--     --irreversibilidad="Si cierra: la guarda llama a la funcion contra el
--       snapshot vigente y eso pasa a resuelto los pendientes
--       sku_sin_tecnologia (los falsos positivos), con resuelto_por
--       auto:ingesta y la marca resolucion->origen que solo escribe esta
--       version. Reversible con el UPDATE de la pregunta 1. Los INSERT son
--       una sonda con clave reservada __probe_0037__ que se borra en la misma
--       transaccion por id o por igualdad contra esos SKU reservados, nunca
--       por predicado abierto."
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) LA FUNCION, CON LAS DOS PIEZAS EN EL MISMO `CREATE OR REPLACE`.
--     Cuerpo base: `0015_mvp_cierre_autocierre_seguro.sql:50-204`, verificado
--     byte a byte contra el `prosrc` vivo (ver cabecera). Lo que cambia:
--       · el predicado del ENCOLADO   -> NOT (fuente OR v2)
--       · el predicado del AUTO-CIERRE (1/2) ->  (fuente OR v2)
--       · `resolucion` del cierre dice DE DONDE salio la respuesta
--       · `payload` del encolado declara las capas que se consultaron
--       · se retira la variable muerta `v_reabiertos`
--     Lo que NO cambia: la guarda de universo vacio, la reapertura acotada,
--     el auto-cierre (2/2) por baja, la firma, el SECURITY DEFINER y el
--     `search_path`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_pendientes_tecnologia(p_snapshot uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_snap      uuid;
  v_productos integer := 0;
  v_encolados integer := 0;
  v_cerrados  integer := 0;
  v_baja      integer := 0;
BEGIN
  v_snap := coalesce(
    p_snapshot,
    (SELECT s.id FROM public.snapshots s
      WHERE s.fuente = 'stock' ORDER BY s.created_at DESC, s.id DESC LIMIT 1)
  );

  -- [0015] GUARDA DE UNIVERSO. Cuántos productos tiene REALMENTE el snapshot
  -- que se va a evaluar. Con `v_snap` NULL o con un snapshot sin productos,
  -- el `NOT EXISTS` del auto-cierre por baja es verdadero para TODOS: cerraba
  -- la bandeja entera. Un catálogo vacío no es "todos los SKU se dieron de
  -- baja" — es una ingesta degenerada, y ante la duda no se toca nada.
  SELECT count(*) INTO v_productos
    FROM public.productos p WHERE p.snapshot_id = v_snap;

  IF v_snap IS NULL OR v_productos = 0 THEN
    RETURN jsonb_build_object(
      'snapshot',          v_snap,
      'productos',         v_productos,
      'encolados',         0,
      'reabiertos',        0,
      'cerrados_con_tec',  0,
      'cerrados_por_baja', 0,
      'version_predicado', 'ambas_capas',
      'omitido',           'universo vacío: el snapshot no tiene productos, no se evalúa nada'
    );
  END IF;

  -- ---------- ENCOLADO (+ REAPERTURA) ----------
  -- [0037] LOS DOS ÁTOMOS, calculados UNA vez y con el mismo nombre que usa
  -- el auto-cierre (1/2) de más abajo. Los dos son de DOS valores —nunca
  -- NULL— porque `IS NOT NULL` no devuelve NULL y `FALSE AND NULL` es FALSE;
  -- ésa es la condición sin la cual `NOT (a OR b)` no sería el complemento
  -- exacto de `(a OR b)`.
  WITH capas AS (
    SELECT
      p.sku,
      p.familia_id,
      p.descr_origen,
      (p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')  AS tiene_tec_fuente,
      (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> '')  AS tiene_tec_v2,
      (v.sku IS NOT NULL)                                       AS tiene_ficha,
      m.nombre                                                  AS marca_origen,
      f.nombre                                                  AS familia_origen
    FROM public.productos p
    LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
    LEFT JOIN public.marcas   m ON m.id = p.marca_id
    LEFT JOIN public.familias f ON f.id = p.familia_id
    WHERE p.snapshot_id = v_snap
  ),
  sin_tecnologia AS (
    SELECT
      c.sku,
      (c.familia_id IS NULL)  AS sin_familia,
      c.tiene_ficha,
      EXISTS (
        SELECT 1 FROM public.cambios cb
         WHERE cb.snapshot_id = v_snap
           AND cb.entidad = 'producto'
           AND cb.tipo = 'ALTA'
           AND cb.sku = c.sku
      )                       AS alta_reciente,
      c.marca_origen,
      c.familia_origen,
      c.descr_origen
    FROM capas c
    -- [0037] PIEZA (2) · ENCOLA sólo si NINGUNA de las dos capas la trae.
    -- Es la negación EXACTA del `WHERE` de la pieza (1): los mismos dos
    -- átomos, en el mismo orden, unidos por el mismo OR, con un NOT delante.
    -- El de allá abajo está escrito sin negar y se lee de un vistazo.
    --
    -- (Y el predicado de allá NO se transcribe aquí a propósito: la guarda de
    -- esta migración lo busca por texto en `prosrc`, y una copia literal en un
    -- comentario la volvería vacua — verde aunque el predicado real se hubiera
    -- borrado. Se midió: con la copia puesta, el fragmento aparecía 2 veces.)
    WHERE NOT (c.tiene_tec_fuente OR c.tiene_tec_v2)
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
      -- El vocabulario de `poblacion` NO cambia: lo mapea a texto
      -- `pendiente-fila.tsx:183-187` y un valor nuevo saldría crudo en la vista.
      'poblacion',      CASE WHEN NOT t.tiene_ficha AND t.alta_reciente THEN 'alta_reciente'
                             WHEN NOT t.tiene_ficha                      THEN 'preexistente_sin_ficha'
                             ELSE 'ficha_sin_tecnologia' END,
      'evidencia',      (CASE WHEN NOT t.tiene_ficha AND t.alta_reciente
                                THEN 'Entró como ALTA en el snapshot ' || coalesce(v_snap::text,'(sin snapshot)') || ' y no tiene ficha en clasificacion_v2'
                              WHEN NOT t.tiene_ficha
                                THEN 'Ya estaba en el catálogo y nunca tuvo ficha en clasificacion_v2'
                              ELSE 'Tiene ficha en clasificacion_v2 pero con la tecnología vacía' END)
                        || ', y el archivo tampoco la trae (productos.tecnologia vacía): se consultaron LAS DOS capas'
                        || CASE WHEN t.sin_familia THEN '. Además NO tiene familia asignada.' ELSE '.' END,
      -- [0037] Deja por escrito en el propio pendiente QUÉ se consultó antes
      -- de preguntar. Un pendiente que no dice dónde miró no se puede auditar.
      'capas_consultadas', jsonb_build_array('productos.tecnologia', 'clasificacion_v2.tecnologia'),
      'sin_familia',    t.sin_familia,
      'marca_origen',   t.marca_origen,
      'familia_origen', t.familia_origen,
      'descr_origen',   t.descr_origen
    )
  FROM sin_tecnologia t
  -- [0015] REAPERTURA ACOTADA. Antes era `DO NOTHING` puro: un pendiente
  -- cerrado por error nunca volvía. Ahora se reabre SOLO si lo cerró la
  -- propia ingesta por "salió del catálogo" y el SKU volvió a aparecer.
  --
  -- Lo que NO se reabre, a propósito:
  --   · lo que resolvió o descartó un HUMANO — su decisión manda, y
  --     reabrirla sería el "pendiente zombi" que el UNIQUE de 0009 existe
  --     para impedir;
  --   · lo cerrado por "ya tiene tecnología".
  --
  -- [0037] ⚠ LA RAZÓN QUE LA 0015 DABA PARA ESTO SEGUNDO ES FALSA, y aquí se
  -- corrige la afirmación aunque no se cambie el código. Decía: «si vuelve a
  -- faltarle, el SKU no está en este universo y no llega hasta aquí». Sí
  -- llega: si se le vacía la tecnología, el predicado de arriba lo selecciona
  -- —precisamente porque ya no la tiene— y choca aquí, donde este `WHERE` lo
  -- rechaza. Queda `resuelto` para siempre. Hoy hay 0 filas con ese motivo;
  -- desde esta migración habrá ~20. Ampliar este `WHERE` es una decisión de
  -- política que le toca al PO y NO se toma aquí.
  ON CONFLICT (tipo, clave_natural) DO UPDATE SET
    estado        = 'abierto',
    payload       = EXCLUDED.payload,
    snapshot_id   = EXCLUDED.snapshot_id,
    detectado_por = EXCLUDED.detectado_por,
    detectado_en  = now(),
    resolucion    = NULL,
    resuelto_por  = NULL,
    resuelto_en   = NULL
  WHERE pendientes_datos.estado = 'resuelto'
    AND pendientes_datos.resuelto_por = 'auto:ingesta'
    AND pendientes_datos.resolucion ->> 'motivo' LIKE 'El SKU salió del catálogo%';
  GET DIAGNOSTICS v_encolados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (1/2): ya tiene tecnología ----------
  -- [0037] PIEZA (1) · CIERRA si la FUENTE **O** la capa congelada la traen.
  --
  -- No se pudo dejar el `FROM public.clasificacion_v2 v` que tenía la 0015.
  -- La reescritura es necesaria para LOS 20, pero NO por la misma razón en los
  -- 20 — y esto se corrige aquí porque la primera versión de este comentario
  -- daba una razón que sólo vale para una parte del conjunto:
  --
  --   · 12 de los 20 NO tienen fila en `clasificacion_v2`. Ahí el `FROM` es un
  --     INNER JOIN, no emparejan, y el `OR` no se llega a evaluar nunca.
  --   ·  8 de los 20 SÍ tienen fila, con la tecnología vacía. A ésos el join no
  --     los mata: fallan por otra cosa — `public.productos` NO ESTÁ en el `FROM`,
  --     así que una condición sobre `p.tecnologia` no es escribible ahí sin
  --     reestructurar.
  --
  -- (Medido contra el vigente: 20 = 12 sin fila + 8 con fila y `tecnologia`
  -- vacía. La conclusión aguanta para los 20; la razón, no. Un resultado
  -- correcto sostenido por una razón que sólo vale para 12 de 20 es P25, y es
  -- el defecto que este bloque lleva persiguiendo desde el Tramo A.)
  --
  -- Por eso las dos capas se traen con LEFT JOIN dentro de una subconsulta que
  -- calcula LOS MISMOS DOS ÁTOMOS que el encolado, y el predicado queda a la
  -- vista, sin negar, justo debajo.
  UPDATE public.pendientes_datos pd
     SET estado       = 'resuelto',
         resuelto_por = 'auto:ingesta',
         resuelto_en  = now(),
         resolucion   = jsonb_build_object(
           'accion',     'auto_cierre',
           'motivo',     'El SKU ya tiene tecnología asignada: el pendiente dejó de aplicar.',
           'tecnologia', src_capas.tecnologia,
           -- [0037] DE DÓNDE SALIÓ LA RESPUESTA. Un cierre que no dice por qué
           -- cerró es un cierre que nadie puede auditar después. Y además es
           -- la marca que distingue lo cerrado por ESTA versión: ninguna
           -- anterior escribía la clave `origen`, así que revertir es exacto.
           'origen',            src_capas.origen,
           'tecnologia_fuente', src_capas.tec_fuente,
           'tecnologia_v2',     src_capas.tec_v2,
           'snapshot',          v_snap
         )
    FROM (
      SELECT
        pd2.id AS pendiente_id,
        (pf.tecnologia IS NOT NULL AND btrim(pf.tecnologia) <> '')  AS tiene_tec_fuente,
        (vf.tecnologia IS NOT NULL AND btrim(vf.tecnologia) <> '')  AS tiene_tec_v2,
        nullif(btrim(pf.tecnologia), '')                            AS tec_fuente,
        nullif(btrim(vf.tecnologia), '')                            AS tec_v2,
        -- Desempate de CAMPO DE AUDITORÍA, no regla de producto: los dos
        -- valores crudos viajan aparte, así que no se pierde nada.
        coalesce(nullif(btrim(pf.tecnologia), ''), nullif(btrim(vf.tecnologia), '')) AS tecnologia,
        -- [0037] EL `CASE` ES **TOTAL**, y esto no es estilo. `origen` es la
        -- MARCA DE REVERSION declarada en el checklist de irreversibilidad:
        -- la marcha atras revierte por `resolucion ? 'origen'` y confia en su
        -- valor para saber quien cerro que. Con un `ELSE 'clasificacion_v2'`
        -- el caso «NINGUNA capa trae tecnologia» se etiquetaba como si la
        -- capa congelada hubiera contestado. Salia bien SOLO porque el WHERE
        -- externo filtra esa fila — correccion POR CONTEXTO, no por
        -- construccion, y si alguien reusa esta subconsulta en otro sitio la
        -- marca miente y la reversion quirurgica toca filas que no cerro v2.
        -- Con la rama explicita y el `ELSE NULL`, el caso imposible queda
        -- INEXPRESABLE EN EL VALOR: es el antidoto estructural de P25 que
        -- este repo ya tiene escrito — volver el caso malo indecible en vez
        -- de prohibirlo en un comentario.
        CASE
          WHEN (pf.tecnologia IS NOT NULL AND btrim(pf.tecnologia) <> '')
           AND (vf.tecnologia IS NOT NULL AND btrim(vf.tecnologia) <> '') THEN 'ambas'
          WHEN (pf.tecnologia IS NOT NULL AND btrim(pf.tecnologia) <> '') THEN 'fuente'
          WHEN (vf.tecnologia IS NOT NULL AND btrim(vf.tecnologia) <> '') THEN 'clasificacion_v2'
          ELSE NULL
        END AS origen
      FROM public.pendientes_datos pd2
      LEFT JOIN public.productos pf
             ON pf.sku = pd2.clave_natural
            AND pf.snapshot_id = v_snap
      LEFT JOIN public.clasificacion_v2 vf
             ON vf.sku = pd2.clave_natural
     WHERE pd2.tipo = 'sku_sin_tecnologia'
       AND pd2.estado = 'abierto'
    ) src_capas
   WHERE pd.id = src_capas.pendiente_id
     AND (src_capas.tiene_tec_fuente OR src_capas.tiene_tec_v2);
  GET DIAGNOSTICS v_cerrados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (2/2): salió del catálogo ----------
  -- Ya solo puede correr con un universo NO vacío (guarda de arriba).
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
    'productos',          v_productos,
    -- ⚠ `encolados` es ROW_COUNT de un upsert: cuenta inserciones y
    -- reaperturas REALES, NO la cardinalidad del predicado. Un 0 aquí con 26
    -- SKU en el predicado significa "los 26 ya estaban abiertos", no "no hay".
    'encolados',          v_encolados,
    'cerrados_con_tec',   v_cerrados,
    'cerrados_por_baja',  v_baja,
    -- Testigo en tiempo de ejecución de QUÉ versión contestó, para no tener
    -- que leer `prosrc` desde fuera.
    'version_predicado',  'ambas_capas'
  );
END;
$fn$;

-- Se reemiten tal cual los emitía la 0013:292-293 y la 0015:206-207. Un
-- `CREATE OR REPLACE` conserva los privilegios, así que esto es idempotente;
-- se reemite igual porque el coste es cero y el riesgo de NO hacerlo no lo
-- es: en este repo ya hubo una función que nació ejecutable por `anon` vía
-- `pg_default_acl`. La guarda (4f) lo MIDE en vez de confiar.
REVOKE ALL    ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) TO service_role;

-- ------------------------------------------------------------
-- (2) LA GUARDA.
--
--     SEIS veredictos, y ninguno de los seis basta solo:
--       (4a) el cuerpo nuevo quedó COMPLETO      — must-contain propio
--       (4b) el cuerpo viejo YA NO ESTÁ          — must-NOT-contain
--       (4c) sanity de la reescritura de ESTA guarda — NO caza la lógica de
--            3 valores; quien la caza es la rama E de (4d). Ver su cabecera
--       (4d) la SONDA, cinco ramas, ejerciendo el EFECTO y no el mecanismo
--       (4e) la corrida limpia + las cifras con su denominador
--       (4f) el ACL de la función
--
--     SEIS, Y SE CUENTAN SEIS. Cada uno incrementa `v_reservas` una vez y el
--     cierre exige `v_reservas = 6` exacto. Antes esto era P20 puro —un
--     umbral que no separa— y de tres formas a la vez: la cabecera decía
--     «cinco» y enumeraba SEIS; los incrementos eran CINCO porque (4b) no
--     contaba; y el umbral era `< 1`. Con ese `< 1`, (4b) se podía borrar
--     gratis (no contaba nada) y de los cinco que sí contaban se podían
--     borrar CUATRO: cinco veredictos de seis fuera, contador en 1, verde.
-- ------------------------------------------------------------
DO $guarda0037$
DECLARE
  v_src        text;
  v_frag       text;
  v_primero    text;
  v_faltan     text[] := ARRAY[]::text[];
  v_sobran     text[] := ARRAY[]::text[];

  -- (4a) FRAGMENTOS OBLIGATORIOS. La guarda must-contain de la 0022 vive en
  -- la 0022 y NO se re-ejecuta al aplicar ésta: si este `CREATE OR REPLACE`
  -- perdiera una pieza, no habría nada que lo detuviera. Por eso la lista
  -- viaja con el cambio que la necesita.
  v_obligatorios text[] := ARRAY[
    'tiene_tec_fuente',                                      -- el átomo de la FUENTE existe
    'tiene_tec_v2',                                          -- el átomo de la capa congelada existe
    'NOT (c.tiene_tec_fuente OR c.tiene_tec_v2)',            -- PIEZA 2: el encolado, negado
    '(src_capas.tiene_tec_fuente OR src_capas.tiene_tec_v2)',-- PIEZA 1: el cierre, sin negar
    'LEFT JOIN public.productos pf',                         -- el cierre LEE la fuente (y con LEFT, no INNER)
    'pf.snapshot_id = v_snap',                               -- y la lee PINEADA al vigente
    'LEFT JOIN public.clasificacion_v2 vf',                  -- el cierre sigue leyendo la curada
    '''origen'',',                                           -- el cierre dice DE DÓNDE salió
    '''tecnologia_fuente'',',                                -- y guarda los DOS valores crudos
    '''tecnologia_v2'',',
    '''capas_consultadas'',',                                -- el encolado declara dónde miró
    '''version_predicado'','                                 -- testigo de versión en el JSON
  ];

  -- (4b) FRAGMENTOS PROHIBIDOS: texto que SÓLO existe en el cuerpo viejo.
  -- No son inventados — se comprobó que los DOS aparecen en el `prosrc` que
  -- estaba vivo antes de esta migración (0015:57 y 0015:118), así que esta
  -- comprobación PUEDE ponerse roja: se pondría si el `CREATE OR REPLACE`
  -- no hubiera surtido efecto o si alguien reintrodujera el predicado viejo.
  v_prohibidos text[] := ARRAY[
    'AND (v.sku IS NULL',          -- cabeza del predicado ASIMÉTRICO del encolado viejo
    '''tecnologia'', v.tecnologia' -- la `resolucion` del cierre viejo, que sólo miraba v2
  ];

  v_naive_origen  integer;
  v_naive_tec     integer;

  -- (4c)
  v_universo    bigint;
  v_encolable   bigint;
  v_cerrable    bigint;
  v_con_fuente  bigint;

  -- (4d) la sonda
  v_clave      text := '__probe_0037__';
  v_sku_a      text := '__probe_0037__/A-fuente-con-pendiente';
  v_sku_b      text := '__probe_0037__/B-ninguna-con-pendiente';
  v_sku_c      text := '__probe_0037__/C-solo-v2-con-pendiente';
  v_sku_d      text := '__probe_0037__/D-fuente-sin-pendiente';
  v_sku_e      text := '__probe_0037__/E-ninguna-sin-pendiente';
  v_skus       text[];
  v_marca_id   uuid;
  v_snap       uuid;
  v_res        jsonb;
  v_ids        uuid[];
  v_estado     text;
  v_origen     text;
  v_resol      jsonb;
  v_n          bigint;

  -- (4e)
  v_abiertos_antes   bigint;
  v_abiertos_despues bigint;
  v_cerrados_nuevos  bigint;
  v_desalineados     bigint;
  -- Los `descartado` NO son ruido: son la unica causa de desalineacion que la
  -- funcion no puede resolver sola, y por eso el aborto los nombra.
  v_descartados      bigint;

  -- (4f)
  v_anon       boolean;
  v_auth       boolean;
  v_svc        boolean;

  v_reservas   integer := 0;
BEGIN
  -- ==========================================================
  -- (4a) EL CUERPO NUEVO QUEDÓ COMPLETO
  -- ==========================================================
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.sincronizar_pendientes_tecnologia(uuid)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION '0037: no existe sincronizar_pendientes_tecnologia(uuid) despues del CREATE OR REPLACE. Abortando.';
  END IF;

  FOREACH v_frag IN ARRAY v_obligatorios LOOP
    IF position(v_frag IN v_src) = 0 THEN
      v_faltan := v_faltan || v_frag;
    END IF;
  END LOOP;

  IF array_length(v_faltan, 1) IS NOT NULL THEN
    -- El subindice se saca ANTES del RAISE a proposito: un `[` entre los
    -- argumentos deja al verificador estatico sin poder afirmar la aridad
    -- (plpgsql equilibra parentesis, no corchetes, al separar argumentos), y
    -- lo reporta como AMBIGUO. Se midio: con `v_faltan[1]` dentro, este
    -- archivo salia en 1 con dos ambiguedades. Una guarda que deja ciego al
    -- instrumento que la vigila no es gratis.
    v_primero := v_faltan[1];
    RAISE EXCEPTION '0037: al cuerpo nuevo de sincronizar_pendientes_tecnologia le FALTAN % de % fragmentos obligatorios. El primero que falta es: <<%>>. Una de las dos piezas no quedo escrita, y cualquiera de las dos sola deja un estado PEOR que el actual. Abortando.',
      array_length(v_faltan, 1), array_length(v_obligatorios, 1), v_primero;
  END IF;

  -- ANTI-VACUIDAD (P19). Los fragmentos llevan contexto a proposito: buscar
  -- las palabras sueltas habria sido una guarda incapaz de fallar. Se MIDE
  -- cuantas veces aparecen para que el motivo quede contado y no argumentado.
  v_naive_origen := (length(v_src) - length(replace(v_src, 'origen', ''))) / length('origen');
  v_naive_tec    := (length(v_src) - length(replace(v_src, 'tecnologia', ''))) / length('tecnologia');
  RAISE NOTICE '0037 - ANTI-VACUIDAD DE LOS FRAGMENTOS (P19): la palabra suelta "origen" aparece % veces en el cuerpo (marca_origen, familia_origen, descr_origen...) y "tecnologia" aparece % veces. Buscar ESAS habria sido verde aunque las dos piezas se hubieran quedado como estaban. Por eso los % fragmentos de arriba llevan contexto.',
    v_naive_origen, v_naive_tec, array_length(v_obligatorios, 1);
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (4b) EL CUERPO VIEJO YA NO ESTA
  -- ==========================================================
  FOREACH v_frag IN ARRAY v_prohibidos LOOP
    IF position(v_frag IN v_src) > 0 THEN
      v_sobran := v_sobran || v_frag;
    END IF;
  END LOOP;

  IF array_length(v_sobran, 1) IS NOT NULL THEN
    v_primero := v_sobran[1];   -- fuera del RAISE, misma razon que arriba
    RAISE EXCEPTION '0037: el cuerpo nuevo TODAVIA contiene % fragmento(s) del predicado VIEJO, que solo miraba clasificacion_v2. El primero es: <<%>>. O el CREATE OR REPLACE no surtio efecto, o alguien reintrodujo la asimetria. Abortando.',
      array_length(v_sobran, 1), v_primero;
  END IF;
  RAISE NOTICE '0037 - el predicado viejo YA NO ESTA: ninguno de los % fragmentos que solo existian en el cuerpo de la 0015 sobrevive en el cuerpo nuevo.', array_length(v_prohibidos, 1);
  v_reservas := v_reservas + 1;   -- (4b) TAMBIEN es un veredicto y ahora cuenta

  -- ==========================================================
  -- (4c) SANITY DE MI PROPIA REESCRITURA — **NO** ES EL DETECTOR DE LA GRIETA
  --
  -- QUE MIDE DE VERDAD, y es todo lo que mide: que sobre los datos reales del
  -- vigente, `count(NOT X) + count(X) = count(*)` con los atomos TAL COMO LOS
  -- ESCRIBO AQUI, en esta consulta.
  --
  -- QUE **NO** MIDE, dicho aqui porque la version anterior de este comentario
  -- afirmaba lo contrario y era FALSA: esto NO caza «un atomo sin su
  -- IS NOT NULL». Esa grieta se introduciria EN LA FUNCION, y la funcion no
  -- participa en esta medicion — aqui se REESCRIBEN los atomos, no se ejecutan
  -- los suyos. Es P27, medir la REPRESENTACION en vez de la COSA. Y peor:
  -- sobre una X de dos valores esta suma es una TAUTOLOGIA — no existe dato
  -- que la ponga roja por ese motivo. Es P19, una guarda incapaz de fallar por
  -- aquello que decia cazar.
  --
  -- QUIEN SI CAZA ESA GRIETA: la rama E de la sonda, en (4d), que EJECUTA la
  -- funcion contra datos puestos a proposito. Un atomo de tres valores en el
  -- encolado dejaria al SKU de la rama E —tecnologia NULL en LAS DOS capas—
  -- sin fila en la bandeja, y (4d) aborta con «SONDA RAMA E ROJA». Ese es el
  -- veredicto que hay que mirar; este no. (4a) aporta lo suyo por texto: que
  -- la funcion mencione estos mismos atomos.
  --
  -- POR QUE NO SE BORRA: sigue valiendo como sanity de ESTA consulta. Las
  -- cifras del NOTICE de (4e) salen de aqui, y si esta reescritura estuviera
  -- rota, ese NOTICE mentiria sin que nada lo dijera. Lo que se corrige no es
  -- el codigo: es lo que AFIRMA valer.
  -- ==========================================================
  SELECT s.id INTO v_snap
    FROM public.snapshots s
   WHERE s.fuente = 'stock'
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT 1;

  IF v_snap IS NULL THEN
    RAISE EXCEPTION '0037: no hay ningun snapshot de fuente stock. La guarda no puede medir nada y la sonda no tendria donde vivir. Abortando.';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE NOT ((p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
                             OR (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> ''))),
    count(*) FILTER (WHERE     ((p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
                             OR (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> ''))),
    count(*) FILTER (WHERE      (p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> ''))
    INTO v_universo, v_encolable, v_cerrable, v_con_fuente
    FROM public.productos p
    LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
   WHERE p.snapshot_id = v_snap;

  IF v_encolable + v_cerrable <> v_universo THEN
    RAISE EXCEPTION '0037: la reescritura de los atomos que hace ESTA guarda no particiona el catalogo vigente: encolable=% mas cerrable=% no suma el universo=%. La consulta de la guarda esta rota y las cifras de (4e) saldrian de una base mal contada. Abortando.',
      v_encolable, v_cerrable, v_universo;
  END IF;
  RAISE NOTICE '0037 - (4c) SANITY DE LA CONSULTA DE LA GUARDA, NO DE LA FUNCION: sobre el snapshot vigente %, con los atomos REESCRITOS AQUI, encolable=% mas cerrable=% suma exactamente el universo=%. Eso dice que MI reescritura particiona, y nada mas. NO dice que los predicados de la funcion particionen: sobre un atomo de dos valores esta suma es una tautologia y no existe dato que la rompa. Quien caza la grieta del atomo de TRES valores es la rama E de la sonda (4d), que EJECUTA la funcion, apoyada en el must-contain de (4a).',
    v_snap, v_encolable, v_cerrable, v_universo;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (4d) LA SONDA — EL EFECTO, NO EL MECANISMO, Y LAS DOS RAMAS
  --
  -- Que `prosrc` contenga el texto correcto NO prueba que la fila se cierre.
  -- Y UNA SONDA DE UN SOLO PASO EJERCE EL CAMINO QUE YA FUNCIONABA: cerrar
  -- por `clasificacion_v2` es justo lo que hacia la version vieja. Por eso la
  -- sonda monta CINCO casos, y cada uno puede ponerse rojo por su cuenta:
  --
  --   A · tecnologia en la FUENTE + pendiente abierto  -> tiene que CERRARSE  (rama nueva)
  --   B · sin tecnologia en NINGUNA + pendiente abierto-> tiene que SEGUIR ABIERTO
  --   C · tecnologia solo en V2 + pendiente abierto    -> tiene que CERRARSE  (rama vieja)
  --   D · tecnologia en la FUENTE y SIN pendiente      -> NO se encola        (el bug original)
  --   E · sin tecnologia en NINGUNA y SIN pendiente    -> SI se encola        (anti-vacuidad de D)
  --
  -- D sin E seria una guarda tramposa: «no aparecio ninguna fila» tambien es
  -- verde si el encolado esta roto y no inserta nunca. E es lo que obliga a
  -- que el silencio de D signifique algo.
  --
  -- C existe porque hoy los pendientes abiertos tienen CERO valor en v2
  -- (por construccion del predicado viejo): sin la sonda, la rama de la capa
  -- congelada quedaria sin ejercer contra datos reales — P17, el universo
  -- vacio en el conjunto con el que uno se evalua.
  --
  -- La sonda vive en el snapshot VIGENTE a proposito: asi el auto-cierre
  -- (2/2) no ve ningun SKU fuera de catalogo y no puede cerrar nada ajeno.
  -- Se retira al final del bloque POR `id` o POR IGUALDAD contra los SKU (o
  -- el nombre) reservados de la sonda, nunca por predicado abierto: en
  -- `pendientes_datos` y `marcas` va por `id`; en `clasificacion_v2` y
  -- `productos` por SKU, que en las dos ES la clave primaria (0001:154,
  -- 0008:60). Si no se pudiera borrar, se aborta y el ROLLBACK de la
  -- transaccion explicita no deja rastro.
  -- ==========================================================
  v_skus := ARRAY[v_sku_a, v_sku_b, v_sku_c, v_sku_d, v_sku_e];

  -- residuo de una corrida abortada, por si acaso
  SELECT array_agg(pdx.id) INTO v_ids FROM public.pendientes_datos pdx WHERE pdx.clave_natural = ANY(v_skus);
  IF v_ids IS NOT NULL THEN DELETE FROM public.pendientes_datos WHERE id = ANY(v_ids); END IF;
  DELETE FROM public.clasificacion_v2 WHERE sku = ANY(v_skus);
  DELETE FROM public.productos        WHERE sku = ANY(v_skus);
  DELETE FROM public.marcas           WHERE nombre = v_clave;

  INSERT INTO public.marcas (nombre) VALUES (v_clave) RETURNING id INTO v_marca_id;

  INSERT INTO public.productos (sku, marca_id, snapshot_id, tecnologia, descr_origen, resv)
  VALUES (v_sku_a, v_marca_id, v_snap, 'TEC-DE-LA-FUENTE', v_clave, 0),
         (v_sku_b, v_marca_id, v_snap, NULL,               v_clave, 0),
         (v_sku_c, v_marca_id, v_snap, NULL,               v_clave, 0),
         (v_sku_d, v_marca_id, v_snap, 'TEC-DE-LA-FUENTE', v_clave, 0),
         (v_sku_e, v_marca_id, v_snap, NULL,               v_clave, 0);

  INSERT INTO public.clasificacion_v2 (sku, tecnologia, fuente_version, updated_by)
  VALUES (v_sku_c, 'TEC-DE-LA-V2', v_clave, v_clave);

  INSERT INTO public.pendientes_datos (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
  VALUES ('sku_sin_tecnologia', v_sku_a, 'abierto', v_clave, v_snap, jsonb_build_object('sku', v_sku_a)),
         ('sku_sin_tecnologia', v_sku_b, 'abierto', v_clave, v_snap, jsonb_build_object('sku', v_sku_b)),
         ('sku_sin_tecnologia', v_sku_c, 'abierto', v_clave, v_snap, jsonb_build_object('sku', v_sku_c));

  SELECT count(*) INTO v_abiertos_antes
    FROM public.pendientes_datos
   WHERE tipo = 'sku_sin_tecnologia' AND estado = 'abierto'
     AND NOT (clave_natural = ANY(v_skus));

  -- LA CORRIDA. Es la misma llamada que hara la siguiente ingesta.
  v_res := public.sincronizar_pendientes_tecnologia(v_snap);

  -- ---- rama A: cierra por la FUENTE, y lo dice ----
  SELECT estado, resolucion INTO v_estado, v_resol
    FROM public.pendientes_datos WHERE tipo = 'sku_sin_tecnologia' AND clave_natural = v_sku_a;
  v_origen := v_resol ->> 'origen';
  IF v_estado IS DISTINCT FROM 'resuelto' THEN
    RAISE EXCEPTION '0037: SONDA RAMA A ROJA. Un SKU con tecnologia en la FUENTE y un pendiente abierto quedo en estado "%" y tenia que quedar "resuelto". La pieza (1), el auto-cierre que mira las dos capas, NO esta surtiendo efecto: es exactamente el caso de los 20 falsos positivos. Abortando.',
      coalesce(v_estado, '(no existe la fila)');
  END IF;
  IF v_origen IS DISTINCT FROM 'fuente' THEN
    RAISE EXCEPTION '0037: SONDA RAMA A ROJA. El pendiente SI se cerro, pero su resolucion dice origen="%" en vez de "fuente", y su tecnologia_fuente es "%". Un cierre que no dice de donde salio la respuesta es un cierre que nadie puede auditar despues. Abortando.',
      coalesce(v_origen, '(sin clave origen)'), coalesce(v_resol ->> 'tecnologia_fuente', '(null)');
  END IF;

  -- ---- rama B: sin tecnologia en ninguna capa, sigue abierto ----
  SELECT estado INTO v_estado
    FROM public.pendientes_datos WHERE tipo = 'sku_sin_tecnologia' AND clave_natural = v_sku_b;
  IF v_estado IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION '0037: SONDA RAMA B ROJA. Un SKU SIN tecnologia en ninguna de las dos capas quedo en estado "%" y tenia que seguir "abierto". El auto-cierre esta cerrando de mas y la bandeja se quedaria callada sobre SKU que nadie ha clasificado. Abortando.',
      coalesce(v_estado, '(no existe la fila)');
  END IF;

  -- ---- rama C: cierra por la capa congelada, y lo dice ----
  SELECT estado, resolucion INTO v_estado, v_resol
    FROM public.pendientes_datos WHERE tipo = 'sku_sin_tecnologia' AND clave_natural = v_sku_c;
  v_origen := v_resol ->> 'origen';
  IF v_estado IS DISTINCT FROM 'resuelto' OR v_origen IS DISTINCT FROM 'clasificacion_v2' THEN
    RAISE EXCEPTION '0037: SONDA RAMA C ROJA. Un SKU con tecnologia SOLO en clasificacion_v2 quedo en estado "%" con origen "%": se esperaba "resuelto" con origen "clasificacion_v2". Al reescribir el auto-cierre para que mirara la fuente se perdio el camino que YA funcionaba. Abortando.',
      coalesce(v_estado, '(no existe la fila)'), coalesce(v_origen, '(sin clave origen)');
  END IF;

  -- ---- rama D: con tecnologia en la fuente, NO se encola ----
  SELECT count(*) INTO v_n
    FROM public.pendientes_datos WHERE tipo = 'sku_sin_tecnologia' AND clave_natural = v_sku_d;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0037: SONDA RAMA D ROJA. Un SKU con tecnologia en la FUENTE y sin pendiente previo genero % fila(s) en la bandeja. La pieza (2), el encolado que mira las dos capas, NO esta surtiendo efecto: la bandeja seguiria preguntando algo que el archivo ya contesto. Abortando.', v_n;
  END IF;

  -- ---- rama E: sin tecnologia en ninguna, SI se encola ----
  --      (sin esta rama, la D seria verde tambien con el encolado roto)
  SELECT count(*) INTO v_n
    FROM public.pendientes_datos
   WHERE tipo = 'sku_sin_tecnologia' AND clave_natural = v_sku_e AND estado = 'abierto';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0037: SONDA RAMA E ROJA. Un SKU sin tecnologia en NINGUNA capa y sin pendiente previo genero % fila(s) abiertas y tenia que generar 1. El encolado no esta insertando, y sin eso la rama D de arriba seria verde por vacuidad. Abortando.', v_n;
  END IF;

  RAISE NOTICE '0037 - SONDA VERDE, LAS CINCO RAMAS: cierra por la FUENTE (A) diciendo origen=fuente, cierra por la capa congelada (C) diciendo origen=clasificacion_v2, deja abierto lo que no tiene nada (B), NO encola lo que el archivo ya contesto (D) y SI encola lo que nadie ha contestado (E). Verificado releyendo las filas, no leyendo el codigo. La corrida de la sonda devolvio: %', v_res::text;
  v_reservas := v_reservas + 1;

  -- ---- retirada de la sonda: por `id` o por igualdad contra los SKU/el
  --      nombre reservados, nunca por predicado abierto ----
  SELECT array_agg(pdx.id) INTO v_ids FROM public.pendientes_datos pdx WHERE pdx.clave_natural = ANY(v_skus);
  IF v_ids IS NOT NULL THEN DELETE FROM public.pendientes_datos WHERE id = ANY(v_ids); END IF;
  DELETE FROM public.clasificacion_v2 WHERE sku = ANY(v_skus);
  DELETE FROM public.productos        WHERE sku = ANY(v_skus);
  IF v_marca_id IS NOT NULL THEN DELETE FROM public.marcas WHERE id = v_marca_id; END IF;

  IF EXISTS (SELECT 1 FROM public.pendientes_datos WHERE clave_natural = ANY(v_skus))
     OR EXISTS (SELECT 1 FROM public.clasificacion_v2 WHERE sku = ANY(v_skus))
     OR EXISTS (SELECT 1 FROM public.productos WHERE sku = ANY(v_skus))
     OR EXISTS (SELECT 1 FROM public.marcas WHERE nombre = v_clave) THEN
    RAISE EXCEPTION '0037: la sonda no se pudo borrar y quedarian filas basura con la clave reservada %. Causa mas probable: el rol que aplica esta migracion NO es el DUENO de estas tablas y RLS si le aplica. Aplicar con el rol dueno. Nada se aplico.', v_clave;
  END IF;
  RAISE NOTICE '0037 - sonda retirada por id o por igualdad contra los SKU reservados, nunca por predicado abierto (pendientes_datos y marcas van por id; clasificacion_v2 y productos por SKU, que en las dos ES la clave primaria): no queda ninguna fila con la clave reservada %.', v_clave;

  -- ==========================================================
  -- (4e) LA CORRIDA LIMPIA + LAS CIFRAS, CON SU DENOMINADOR
  --
  -- Segunda llamada, ya sin sonda. Sirve para dos cosas a la vez: deja la
  -- bandeja convergida con cifras limpias, y comprueba IDEMPOTENCIA — si la
  -- primera corrida hizo bien su trabajo, esta no puede tener nada que hacer.
  -- ==========================================================
  v_res := public.sincronizar_pendientes_tecnologia(v_snap);

  IF (v_res ->> 'encolados')::bigint <> 0
     OR (v_res ->> 'cerrados_con_tec')::bigint <> 0
     OR (v_res ->> 'cerrados_por_baja')::bigint <> 0 THEN
    RAISE EXCEPTION '0037: la funcion NO es idempotente. Corrida inmediatamente despues de si misma y sin que nada cambiara, devolvio %. Una segunda pasada que sigue moviendo filas significa que encolado y cierre no son complementos: se estan pasando el mismo SKU el uno al otro. Abortando.',
      v_res::text;
  END IF;

  SELECT count(*) INTO v_abiertos_despues
    FROM public.pendientes_datos WHERE tipo = 'sku_sin_tecnologia' AND estado = 'abierto';

  -- EL INVARIANTE, no la cifra de memoria: los pendientes abiertos tienen que
  -- ser EXACTAMENTE los SKU del predicado nuevo. Se compara contra un conteo
  -- medido ahora, no contra un numero escrito a mano, que envejeceria.
  --
  -- EL UNIVERSO DEL INVARIANTE SE RESTRINGE A LOS SKU SOBRE LOS QUE LA FUNCION
  -- **PUEDE** ACTUAR, y sin esa restriccion esta migracion se vuelve
  -- INAPLICABLE PARA SIEMPRE en cuanto un admin descarte un pendiente:
  --
  --   · DESCARTAR deja `estado = 'descartado'` (0009:75, 0014:67, y es accion
  --     de primera clase de la bandeja en produccion — `src/app/api/
  --     pendientes/[id]/route.ts`).
  --   · El auto-cierre NO lo toca: filtra `estado = 'abierto'`.
  --   · El `ON CONFLICT` NO lo reabre: exige `estado = 'resuelto'` con motivo
  --     de baja.
  --
  --   Resultado: su SKU sigue cumpliendo el predicado del encolado y no tiene
  --   fila ABIERTA, para siempre y sin que nada este roto. Con un solo
  --   descarte esto daria abiertos=N-1 contra encolable=N -> RAISE EXCEPTION
  --   -> ROLLBACK, y la condicion NO se va sola nunca. Sin descartados todavia:
  --   la ventana esta ABIERTA, no cerrada. (Medido aparte: RESOLVER no rompe
  --   nada — un resuelto con tecnologia sale del predicado por si solo.)
  --
  -- MEDIDO HOY, para no vender el arreglo como si cambiara una cifra: sobre
  -- el vigente del momento, el predicado SIN restringir y el predicado CON el
  -- `NOT EXISTS` dan LOS DOS el mismo numero, y hay algunos resueltos (los del
  -- humano, que tienen valor en las dos capas y ya no cumplen el predicado).
  -- O sea: este `NOT EXISTS` es HOY un no-op exacto. No se pone para arreglar
  -- un numero de hoy — se pone para que el primer descarte de manana no deje
  -- esta migracion inaplicable para siempre.
  --
  -- El mismo `NOT EXISTS` va en el calculo de abajo y en LAS DOS ramas de la
  -- diferencia simetrica: tres sitios, un solo criterio.
  SELECT count(*) INTO v_encolable
    FROM public.productos p
    LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
   WHERE p.snapshot_id = v_snap
     AND NOT ((p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
           OR (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> ''))
     AND NOT EXISTS (SELECT 1 FROM public.pendientes_datos q
                      WHERE q.tipo = 'sku_sin_tecnologia' AND q.clave_natural = p.sku
                        AND q.estado <> 'abierto');

  -- Y NO SE COMPARAN LOS CONTEOS, SE COMPARAN LOS CONJUNTOS. Dos cardinales
  -- iguales no son el mismo conjunto: N abiertos que fueran LOS OTROS N
  -- pasarian un `count = count` sin despeinarse. Se mide la diferencia
  -- simetrica, que solo vale 0 si son literalmente los mismos SKU.
  --
  -- CADA `EXCEPT` VA EN SU PROPIO PAR DE PARENTESIS, Y NO ES COSMETICA.
  -- `EXCEPT` y `UNION ALL` tienen la MISMA precedencia y asocian por la
  -- izquierda, asi que la forma sin parentesis —`A EXCEPT B UNION ALL B EXCEPT
  -- A`— se parsea `(((A EXCEPT B) UNION ALL B) EXCEPT A)`, y ese ultimo
  -- `EXCEPT A` ANIQUILA la rama `A \ B` entera: solo sobrevive `B \ A`. Medido
  -- con dos casos de juguete, con la MISMA forma sintactica que tenia este
  -- archivo, contra Postgres:
  --
  --     A={a1,a2,X}     B={a1,a2,Y}   simetrica real 2 · sin parentesis dio 1
  --     A={a1,a2,SOBRA} B={a1,a2}     simetrica real 1 · sin parentesis dio 0
  --
  -- Y MEDIDO TAMBIEN CONTRA LOS DATOS REALES, que es mas contundente que el
  -- juguete: con la funcion vieja todavia viva (o sea, ANTES de aplicar esta
  -- migracion), sobre el vigente del momento, A = pendientes abiertos y B = el
  -- predicado nuevo acotado:
  --
  --     A \ B = n    (los falsos positivos)      B \ A = 0
  --     forma vieja -> 0        forma nueva -> n
  --
  -- Varios SKU desalineados y la medicion decia CERO. La rama que sobrevivia
  -- era justo la vacia.
  --
  -- HOY ESO NO ERA UN AGUJERO, y hay que decir por que en vez de suponerlo: la
  -- condicion de abajo tambien exige `v_abiertos_despues = v_encolable`, y con
  -- cardinales iguales y un lado contenido en el otro se sigue la igualdad de
  -- conjuntos. Pero el comentario y el NOTICE AFIRMABAN medir la simetrica y
  -- eso era falso — P25, el resultado correcto por la razon equivocada — y el
  -- dia que alguien relaje el chequeo de cardinal, media deteccion desaparece
  -- sin que nada se ponga rojo.
  SELECT count(*) INTO v_desalineados FROM (
    (
      SELECT pdx.clave_natural AS sku
        FROM public.pendientes_datos pdx
       WHERE pdx.tipo = 'sku_sin_tecnologia' AND pdx.estado = 'abierto'
      EXCEPT
      SELECT p.sku
        FROM public.productos p
        LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
       WHERE p.snapshot_id = v_snap
         AND NOT ((p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
               OR (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> ''))
         AND NOT EXISTS (SELECT 1 FROM public.pendientes_datos q
                          WHERE q.tipo = 'sku_sin_tecnologia' AND q.clave_natural = p.sku
                            AND q.estado <> 'abierto')
    )
    UNION ALL
    (
      SELECT p.sku
        FROM public.productos p
        LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
       WHERE p.snapshot_id = v_snap
         AND NOT ((p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
               OR (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> ''))
         AND NOT EXISTS (SELECT 1 FROM public.pendientes_datos q
                          WHERE q.tipo = 'sku_sin_tecnologia' AND q.clave_natural = p.sku
                            AND q.estado <> 'abierto')
      EXCEPT
      SELECT pdx.clave_natural
        FROM public.pendientes_datos pdx
       WHERE pdx.tipo = 'sku_sin_tecnologia' AND pdx.estado = 'abierto'
    )
  ) d;

  -- EL ABORTO NO PUEDE SER MUDO. Si esto salta, lo primero que hay que saber
  -- es si lo bloqueo un DESCARTE — la unica causa que no se va sola y que un
  -- humano provoca desde la bandeja. Se mide aparte para poder NOMBRARLA.
  SELECT count(*) FILTER (WHERE estado = 'descartado')
    INTO v_descartados
    FROM public.pendientes_datos
   WHERE tipo = 'sku_sin_tecnologia';

  IF v_abiertos_despues <> v_encolable OR v_desalineados <> 0 THEN
    RAISE EXCEPTION '0037: la bandeja NO quedo alineada con el predicado. Quedan % pendientes abiertos, el predicado nuevo selecciona % SKU del catalogo vigente sobre los que la funcion PUEDE actuar, y % SKU estan en uno de los dos lados y no en el otro. Pendientes sku_sin_tecnologia en estado DESCARTADO ahora mismo: % - si ese numero NO es 0, esa es la causa mas probable y se desatasca decidiendo que hacer con esos descartes, porque ni el auto-cierre ni el ON CONFLICT los tocan. Si sobran, la bandeja sigue preguntando de mas; si faltan, hay SKU sin clasificar y sin tarjeta. Abortando.',
      v_abiertos_despues, v_encolable, v_desalineados, v_descartados;
  END IF;

  SELECT count(*) INTO v_cerrados_nuevos
    FROM public.pendientes_datos
   WHERE tipo = 'sku_sin_tecnologia' AND estado = 'resuelto'
     AND resuelto_por = 'auto:ingesta' AND resolucion ? 'origen';

  RAISE NOTICE '0037 - CIFRAS, CON EL DENOMINADOR DICHO. Snapshot vigente %: catalogo = % productos, de los cuales % traen tecnologia en la FUENTE. Pendientes sku_sin_tecnologia abiertos ANTES de esta migracion = % (medido antes de la sonda, excluyendola). DESPUES = %, y no solo el conteo: la diferencia simetrica REAL -cada EXCEPT en su propio par de parentesis, las dos ramas vivas- contra los % SKU del predicado nuevo es %. Ese % es el predicado ACOTADO a los SKU sobre los que la funcion puede actuar: excluye los que tienen un pendiente en estado distinto de abierto, y hay % en estado descartado. Cerrados por ESTA version (los que llevan la marca resolucion->origen) = %.',
    v_snap, v_universo, v_con_fuente, v_abiertos_antes, v_abiertos_despues, v_encolable, v_desalineados, v_encolable, v_descartados, v_cerrados_nuevos;

  RAISE NOTICE '0037 - LA VARA NO ES EL JSON (EL-ROW_COUNT-DE-UN-UPSERT-NO-ES-EL-TAMANO-DEL-PREDICADO): la corrida limpia devolvio %. Ese encolados=0 NO significa "no hay nada que encolar": significa que los % SKU del predicado YA tenian su pendiente abierto, chocaron contra el ON CONFLICT y fallaron el WHERE de la reapertura, asi que no se contaron. La cardinalidad del predicado se cuenta con un SELECT aparte, y es la que sale arriba.',
    v_res::text, v_encolable;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (4f) EL ACL DE LA FUNCION
  -- ==========================================================
  -- `has_function_privilege` LANZA si el rol no existe, asi que se pregunta
  -- antes por el catalogo: un rol ausente no puede tener el privilegio, y esa
  -- es la respuesta honesta (FALSE), no una excepcion que tumbe la migracion.
  v_anon := to_regrole('anon')          IS NOT NULL AND has_function_privilege('anon',          'public.sincronizar_pendientes_tecnologia(uuid)', 'EXECUTE');
  v_auth := to_regrole('authenticated') IS NOT NULL AND has_function_privilege('authenticated', 'public.sincronizar_pendientes_tecnologia(uuid)', 'EXECUTE');
  v_svc  := to_regrole('service_role')  IS NOT NULL AND has_function_privilege('service_role',  'public.sincronizar_pendientes_tecnologia(uuid)', 'EXECUTE');

  IF v_anon OR v_auth THEN
    RAISE EXCEPTION '0037: la funcion quedo EJECUTABLE por anon=% o authenticated=%. Es SECURITY DEFINER y cierra pendientes: ejecutable sin sesion es una puerta para vaciar la bandeja desde fuera. Abortando.', v_anon, v_auth;
  END IF;
  IF NOT v_svc THEN
    RAISE EXCEPTION '0037: service_role NO puede ejecutar la funcion. La ingesta la llama desde ingest_snapshot y dejaria de sincronizar la bandeja en silencio. Abortando.';
  END IF;
  RAISE NOTICE '0037 - ACL MEDIDA (no recordada): anon=% authenticated=% service_role=%. Es la reparticion esperada desde la 0013.', v_anon, v_auth, v_svc;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- LO QUE ESTA MIGRACION **HACE** AL APLICARSE, DICHO EN VOZ ALTA
  -- ==========================================================
  RAISE NOTICE '0037 - ESTA MIGRACION **NO ES SOLO ESTRUCTURAL**: CIERRA ~20 PENDIENTES REALES. La guarda llama a sincronizar_pendientes_tecnologia DOS VECES contra el snapshot vigente -(4d) con la sonda puesta y (4e) limpia- y esas llamadas hacen el trabajo de verdad: los falsos positivos pasan a estado resuelto con resuelto_por=auto:ingesta. Cerrados por ESTA version en esta aplicacion, contados ahora mismo: %. No es un efecto colateral ni una prueba en seco: es exactamente lo que haria la siguiente ingesta, adelantado aqui para poder MEDIRLO en el momento de aplicar en vez de creerlo. Revertible con el UPDATE de la pregunta 1 del checklist, que se apoya en la marca resolucion->origen.',
    v_cerrados_nuevos;
  RAISE NOTICE '0037 - DEPENDENCIA HACIA ADELANTE, que ningun NOTICE decia: la sincronizacion CONTINUA de la bandeja depende de que corra una ingesta de fuente=stock. ingest_snapshot llama a esta funcion DENTRO de un IF snap->>fuente = stock -la linea del IF: 0013:378, reproducida tal cual en 0019:352, 0022:234 y 0036:326-, asi que una ingesta de ADUANA no resincroniza NADA de sku_sin_tecnologia. Consecuencia practica: entre dos cargas de stock la bandeja puede quedarse quieta aunque haya ingestas, y eso NO es un fallo, es el gate. Quien quiera forzar la convergencia sin esperar a la ingesta, llama a la funcion con service_role.';

  -- ==========================================================
  -- LO QUE ESTA MIGRACION **NO PUEDE COMPROBAR DESDE DONDE ESTA**
  -- ==========================================================
  RAISE NOTICE '0037 - NO COMPROBADO AQUI: que el ARCHIVO siga trayendo la tecnologia. Todo el beneficio descansa en que productos.tecnologia venga poblada desde el Excel (hoy: % de % productos del vigente la traen en la FUENTE; sumando la capa congelada, % de %). Si una ingesta futura la dejara vacia, el predicado volveria a crecer y ademas los cerrados NO se reabririan solos. Eso se vigila en src/services/etl/** y en la bandeja, no aqui.',
    v_con_fuente, v_universo, v_cerrable, v_universo;
  RAISE NOTICE '0037 - QUEDA VIVO Y CON NOMBRE: la REAPERTURA ACOTADA se vuelve una trampa CON VICTIMAS. El ON CONFLICT solo reabre lo cerrado por "El SKU salio del catalogo", asi que si a uno de los % cerrados por esta migracion se le vacia la tecnologia en las DOS capas, el encolado lo selecciona, choca aqui y queda resuelto PARA SIEMPRE con la bandeja callada. Antes de hoy eso tenia CERO victimas posibles porque no habia ninguna fila cerrada con ese motivo. Ampliar ese WHERE es una decision de politica del PO y NO se toma en esta migracion.',
    v_cerrados_nuevos;
  RAISE NOTICE '0037 - TRINQUETE DE LA 0036 ROTO A PROPOSITO: 0036:608-611 aborta si esta funcion menciona p.tecnologia. Ahora la menciona, porque el PO decidio que la bandeja mire las dos capas. Sigue mencionando clasificacion_v2, asi que la premisa de convivencia de la 0036 no queda contradicha. CONSECUENCIA: re-aplicar la 0036 despues de esta migracion ABORTA. Si hay que re-aplicarla, se re-aplica esta despues.';
  RAISE NOTICE '0037 - NO DECIDIDO AQUI: cual de las dos tecnologias gana en la PANTALLA. El cierre guarda las dos (tecnologia_fuente y tecnologia_v2) y dice de cual salio; el escalar tecnologia toma la de la fuente cuando hay ambas, y eso es un desempate de campo de auditoria, no una regla de producto. La 0036 dejo esa decision al PO y aqui sigue sin tomarse.';
  RAISE NOTICE '0037 - NO COMPROBADO AQUI: la COPY de la bandeja. pendiente-fila.tsx:183-187 traduce poblacion con un vocabulario que solo habla de la ficha v2 ("ya estaba, nunca tuvo ficha v2"). El vocabulario NO se cambio a proposito -un valor nuevo saldria crudo en snake_case al usuario- pero desde hoy un pendiente significa que faltan LAS DOS capas, y el texto no lo dice. Es trabajo de la capa de vista.';
  RAISE NOTICE '0037 - FUERA DE ALCANCE POR ESCRITO: la rama de MARCA (marca_ambigua, marca_west) no tiene auto-cierre y esta migracion no se lo construye; productos_override, derivaciones.ts y resolver_pendiente tampoco se tocan (son la pieza 3, que espera la decision del PO).';

  -- EL UMBRAL ES EL NUMERO ESTRUCTURAL REAL, NO UN 1 QUE NO SEPARA (P20).
  -- Son SEIS veredictos —(4a) (4b) (4c) (4d) (4e) (4f)— y cada uno incrementa
  -- exactamente una vez. Se compara con `<>` y no con `<` a proposito: asi
  -- tambien salta si alguien contara de mas. Borrar CUALQUIERA de los seis
  -- pone esto rojo, que es lo que un umbral tiene que hacer.
  IF v_reservas <> 6 THEN
    RAISE EXCEPTION '0037: el contador de veredictos vale % y el numero estructural es 6 exacto (4a 4b 4c 4d 4e 4f, uno cada uno). Si esto salta, o un veredicto declarado dejo de contarse -y el resumen de abajo estaria mintiendo sobre cuanto se midio- o alguien conto dos veces el mismo. Abortando.', v_reservas;
  END IF;
  RAISE NOTICE '0037 - GUARDA VERDE CON RESERVAS: % veredicto(s) medidos aqui, que son los 6 declarados en la cabecera de la guarda. Verde significa "no contradicho", no "probado": lo que esta guarda no alcanza va enumerado arriba, uno por uno, empezando por (4c), que NO prueba lo que su nombre viejo sugeria.', v_reservas;
END $guarda0037$;

COMMIT;

-- ============================================================
-- MARCHA ATRAS
--
--   -- 1) LA FUNCION: re-aplicar tal cual el `CREATE OR REPLACE FUNCTION
--   --    public.sincronizar_pendientes_tecnologia(p_snapshot uuid DEFAULT NULL)`
--   --    de `supabase/migrations/0015_mvp_cierre_autocierre_seguro.sql`
--   --    (lineas 46-207). Es literal: ese cuerpo es el que estaba vivo antes
--   --    de esta migracion, verificado byte a byte contra `prosrc`.
--
--   -- 2) LOS PENDIENTES QUE ESTA MIGRACION CERRO. La clave `origen` es la
--   --    marca que ninguna version anterior escribia, asi que el UPDATE es
--   --    exacto: no toca nada resuelto por un humano ni por la version vieja.
--   UPDATE public.pendientes_datos
--      SET estado = 'abierto', resolucion = NULL,
--          resuelto_por = NULL, resuelto_en = NULL
--    WHERE tipo = 'sku_sin_tecnologia'
--      AND estado = 'resuelto'
--      AND resuelto_por = 'auto:ingesta'
--      AND resolucion ? 'origen';
--
-- ORDEN: da igual cual primero — la funcion no lee la clave `origen` y el
-- UPDATE no depende de la version de la funcion. Lo que NO da igual es
-- hacer solo (1): la bandeja volveria a mirar una sola capa y los cerrados
-- seguirian cerrados, que es el peor de los dos mundos.
--
-- Y LO QUE **NO** SE PIERDE AL DESHACER, dicho para que nadie lo suponga: el
-- contenido de `productos.tecnologia` no se toca ni aqui ni en la marcha
-- atras. Esta migracion no escribe en el catalogo; solo decide a quien se le
-- pregunta.
-- ============================================================
