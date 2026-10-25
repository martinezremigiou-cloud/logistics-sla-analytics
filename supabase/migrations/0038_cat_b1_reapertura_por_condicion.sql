-- ============================================================
-- 0038 · [CAT-B1 · R-1] La REAPERTURA de `sku_sin_tecnologia` deja de colgar
--        del TEXTO DEL MOTIVO. El `WHERE` del `ON CONFLICT ... DO UPDATE`
--        pasa de tres lineas a dos: se elimina la condicion del motivo.
--
-- EL PRINCIPIO QUE GOBIERNA ESTE ARCHIVO, y del que se deriva todo lo demas:
--
--        LO QUE CERRO UNA CONDICION, LO REABRE LA CONDICION;
--        LO QUE CERRO UNA PERSONA, SOLO LO REABRE UNA PERSONA.
--
--     -- antes (0015, conservado tal cual por la 0037)
--     WHERE pendientes_datos.estado = 'resuelto'
--       AND pendientes_datos.resuelto_por = 'auto:ingesta'
--       AND <una tercera linea que comparaba el texto del motivo con un patron>;
--     -- despues
--     WHERE pendientes_datos.estado = 'resuelto'
--       AND pendientes_datos.resuelto_por = 'auto:ingesta';
--
-- (La tercera linea no se transcribe en este archivo NI UNA SOLA VEZ fuera de
-- la guarda que la prohibe. La guarda de abajo la busca por texto en `prosrc`
-- y esa busqueda es un must-NOT-contain: una copia literal aqui no la volveria
-- vacua —el archivo no es la funcion— pero si volveria ilegible el veredicto
-- para quien lea el diff. La regla del repo es la misma que aplico la 0037.)
--
-- ------------------------------------------------------------
-- DE QUE CUERPO PARTE ESTA MIGRACION — MEDIDO CONTRA LA BASE VIVA HOY,
-- NO SUPUESTO POR EL NUMERO DE ARCHIVO NI POR LA FECHA DE LA 0037
--
-- La 0037 se aplico un dia antes (ledger: version omitida), o sea
-- AYER en horas de reloj y HOY en horas de trabajo. Aun asi se volvio a pedir
-- el cuerpo a la base — «el repo es una COPIA» no admite excepcion por
-- cercania:
--
--     SELECT p.prosrc, pg_get_function_identity_arguments(p.oid), ...
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE p.proname = 'sincronizar_pendientes_tecnologia' AND n.nspname = 'public';
--     -> 1 fila · args [p_snapshot uuid] · RETURNS jsonb
--        SECURITY DEFINER · search_path = pg_catalog, public
--        13 418 bytes · 265 lineas
--        md5    e6fd83ae83def7615bc14a3eb276f43b
--        sha256 (omitido en esta copia)
--
--     diff -u <cuerpo de 0037:300-562, con el \n inicial> <prosrc vivo>
--       -> SIN DIFERENCIAS, exit 0 · los dos ficheros 13 418 bytes, mismo sha256
--
-- **EMPATA BYTE A BYTE CON `0037_cat_b1_bandeja_mismas_capas.sql`, lineas
-- 300-562.** De ahi parte este archivo: el cuerpo de abajo ES ese prosrc con
-- DOS hunks de diferencia y ninguno mas —el comentario de la reapertura y la
-- linea que se retira—, empalmados a maquina y no transcritos a mano.
--
-- ------------------------------------------------------------
-- LAS CUATRO RAZONES, RE-MEDIDAS CONTRA LA BASE
-- (vigente del momento, id omitido; fuente stock)
--
-- 1. **CERO filas cumplen hoy la linea que se quita.** Filas con
--    tipo = 'sku_sin_tecnologia', estado 'resuelto', resuelto_por
--    'auto:ingesta': **n**. De esas, las que pasaban el filtro del motivo
--    viejo: **0**. En TODA la tabla, cualquier tipo: **0**. No protege nada y
--    no habilita nada: lo unico que hace es apagar las reaperturas
--    legitimas que la 0037 creo.
--
-- 2. **`resuelto_por` YA separa el sujeto que la 0015 queria proteger.** Los
--    cerradores de la bandeja entera son CINCO y solo UNO es automatico:
--      auto:ingesta n · hlara@example.com n (algunos de ellos en este tipo)
--      · 0011_taxo n · po n · bridge n
--    El motivo no anadia proteccion: anadia una LISTA BLANCA DE CADENAS que
--    hay que acordarse de ampliar. La 0037 estreno un motivo nuevo («El SKU ya
--    tiene tecnologia asignada...») y nadie se acordo.
--
-- 3. **La guarda se apoyaba en PROSA QUE SE RENDERIZA AL USUARIO.**
--    `src/components/pendientes/pendiente-fila.tsx:262` hace
--      `const motivo = pendiente.resolucion && typeof pendiente.resolucion.motivo === "string" ? ... : null;`
--    y lo MUESTRA en la fila resuelta. El dia que alguien suavice ese texto o
--    le quite la tilde, la comparacion deja de casar y la reapertura falla EN
--    SILENCIO: nada se pone rojo, simplemente deja de reabrir.
--
-- 4. **`resolucion.origen` no lo lee nadie en la interfaz.** Medido con
--    `grep -rn "version_predicado\|resolucion" --include=*.ts --include=*.tsx src/`:
--    `origen` (el de la 0037) no aparece en ninguna lectura de la vista; es
--    campo de auditoria puro y estructurado. Si alguna vez hiciera falta una
--    segunda condicion, va AHI y no sobre el motivo.
--
-- ------------------------------------------------------------
-- ⚠ PRE-CONDICION DECLARADA: **ESTE CAMBIO ES UN NO-OP SOBRE LOS DATOS DE HOY.**
--
-- Cero filas cumplen la linea que se quita, y los cerrados por
-- `auto:ingesta` NO reabren porque su tecnologia no esta vacia: medido, de los
-- ellos, los que hoy no tienen tecnologia en NINGUNA de las dos capas son **0**.
--
--   **LA BANDEJA NO DEBE MOVERSE: N antes, N despues;
--     `sku_sin_tecnologia` M antes, M despues, Y EL MISMO CONJUNTO.**
--   **SI LA GUARDA MUEVE LA BANDEJA, LA MIGRACION ESTA MAL.**
--
-- No se vende el arreglo como si moviera un numero. Lo que hace es CERRAR UNA
-- VENTANA QUE ESTA ABIERTA: el primer SKU al que se le vacie la tecnologia
-- despues de haber sido auto-cerrado quedaria `resuelto` PARA SIEMPRE con la
-- bandeja callada, y eso es exactamente lo que la 0037 dejo escrito como
-- «trampa con victimas» en su NOTICE final. Hoy hay victimas posibles y
-- cero reales; esta migracion quita la trampa antes de que la pise alguien.
--
-- Y por eso la guarda de abajo aborta TAMBIEN si la bandeja se mueve: un verde
-- sobre un mundo distinto del medido no es un verde, es P25.
--
-- ------------------------------------------------------------
-- LO QUE ESTA MIGRACION **NO** HACE, y no se re-interpreta
--
--   · NO toca los otros SEIS tipos de la bandeja. La funcion solo puede
--     escribir filas de `sku_sin_tecnologia` (el `INSERT` fija el tipo y el
--     `ON CONFLICT` va por `(tipo, clave_natural)`), y la guarda lo MIDE con
--     el conteo de los abiertos de TODOS los tipos, no solo de este.
--   · NO toca `resolver_pendiente`, `derivaciones.ts`, la ficha ni
--     `productos_override` — eso es CAT-B2.
--   · NO toca NADA relacionado con los VERTICAL. Otra ventana, otra foto.
--     `UN-CAMBIO-A-LA-VEZ-O-NINGUNO-ES-ATRIBUIBLE`.
--   · **NO preserva la resolucion anterior al reabrir.** El `SET` del
--     `ON CONFLICT` pone `resolucion = NULL`, asi que el cierre viejo se
--     pierde. Guardarlo (`resolucion_previa` en el payload) se PROPUSO
--     y no se ha pedido: queda anotado como PROPUESTA VIVA y no
--     se implementa. La rama R1 de la sonda comprueba que hoy se pierde —para
--     que el dia que se decida conservarlo, la prueba que cambia sea visible.
--   · **NO cambia `version_predicado`.** Sigue valiendo 'ambas_capas'. Medido:
--     no lo lee NADIE fuera de los .sql (grep en `src/` y `scripts/`: cero
--     ocurrencias). Bumparlo seria una SEGUNDA COPIA de «que cuerpo corre»,
--     y la primera —`prosrc`— es la que la guarda lee. Un cambio a la vez.
--   · NO re-abre la decision del trinquete de la 0036: esta funcion sigue
--     mencionando `p.tecnologia`, asi que **re-aplicar la 0036 sigue abortando**.
--     Es la misma consecuencia que dejo la 0037, sin cambio.
--
-- ------------------------------------------------------------
-- LO QUE ESTA MIGRACION DEJA VIVO Y HAY QUE DECIR EN VOZ ALTA
--
-- **LA LISTA BLANCA NO DESAPARECE: CAMBIA DE EJE.** Antes era una lista de
-- CADENAS DE PROSA (los motivos); ahora es una lista de SUJETOS con un solo
-- elemento (`auto:ingesta`). Si manana naciera un segundo cerrador automatico
-- con otro nombre —`auto:correo`, `auto:lo-que-sea`— esta condicion NO lo
-- cubriria y sus cierres quedarian igual de clavados. La diferencia que si
-- importa: un nombre de rol no se le renderiza a nadie y no lo cambia un
-- retoque de copy. Queda declarado en el NOTICE final, con nombre.
--
-- ------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO, y es la afirmacion central de este archivo.** Esta migracion es
--      ESTRUCTURAL: cambia una funcion. La guarda LLAMA a la funcion DOS
--      VECES contra el snapshot vigente —(3d) con la sonda puesta y (3e)
--      limpia— y las dos llamadas TIENEN QUE MOVER CERO FILAS REALES; si
--      mueven una sola, la guarda aborta y la transaccion revierte. Eso es lo
--      contrario de lo que hizo la 0037, que si cerro pendientes reales.
--      HAY INSERT Y DELETE DE SONDA: una marca, tres productos y dos
--      pendientes, todos con la clave reservada `__probe_0038__`. Se borran en
--      el mismo bloque POR `id` (pendientes, marcas) o POR IGUALDAD contra los
--      SKU reservados (productos, cuya PK es el `sku`), NUNCA por predicado
--      abierto. En `clasificacion_v2` esta migracion NO ESCRIBE NADA y por eso
--      TAMPOCO BORRA nada ahi: comprueba que no haya filas con esos SKU y
--      aborta si las hubiera. La sonda no sobrevive al camino feliz (se borra)
--      ni al infeliz (ROLLBACK de la transaccion explicita).
--      REVERTIR el cambio de la funcion: re-aplicar tal cual el
--      `CREATE OR REPLACE` de `0037_cat_b1_bandeja_mismas_capas.sql:296-563`.
--      Es literal y esta verificado byte a byte contra el `prosrc` vivo de
--      hoy (md5 e6fd83ae83def7615bc14a3eb276f43b). No hay datos que revertir.
--
--   2. ¿Radio de impacto acotado?
--      **Si.** UNA funcion. Cero DROP, cero TRUNCATE, cero ALTER de tabla,
--      cero DELETE sobre filas de negocio. Las unicas escrituras en tablas son
--      las cinco filas de sonda con clave reservada. Ningun pendiente resuelto
--      por un humano se toca: la rama R2 de la sonda lo EJERCE, no lo supone.
--
--   3. ¿Que NO puede comprobar esta migracion desde donde esta?
--      **Que nadie mas dependa del texto del motivo.** Esta migracion quita la
--      dependencia de UN sitio —el `WHERE` de la reapertura—; si otra capa
--      (`resolver_pendiente`, un reporte, un workflow) compara ese texto, aqui
--      no se ve. Medido y declarado abajo: quien lo LEE es
--      `pendiente-fila.tsx:262`, y lo lee para MOSTRARLO, no para decidir.
--      **Que vuelva a correr una ingesta de `fuente = 'stock'`.** La funcion
--      solo se llama desde `ingest_snapshot` dentro de un
--      `IF snap->>'fuente' = 'stock'` (0013:378, reproducido en 0019:352,
--      0022:234 y 0036:326). Una ingesta de ADUANA no reabre nada.
--      **Que el estado `descartado` siga fuera.** La primera linea del `WHERE`
--      exige `estado = 'resuelto'`, asi que un descarte no se reabre; eso se
--      lee en el codigo pero la sonda NO lo ejerce (tres ramas, no cuatro).
--      Va dicho en un `RAISE NOTICE` para que se sepa que es lectura y no
--      medicion.
--      Los demas huecos van enumerados en los `RAISE NOTICE` finales.
--
-- Aplicar con:
--   node scripts/verificar-migracion.mjs supabase/migrations/0038_cat_b1_reapertura_por_condicion.sql
--   node --env-file=.env.db scripts/aplicar-migracion.mjs \
--     supabase/migrations/0038_cat_b1_reapertura_por_condicion.sql \
--     --irreversibilidad="NO cierra ni reabre ninguna fila real: es un NO-OP
--       medido sobre los datos de hoy y la guarda ABORTA si la bandeja se
--       mueve (los mismos abiertos antes y despues, los mismos de sku_sin_tecnologia, el mismo
--       conjunto). Cambia una funcion; se revierte re-aplicando el CREATE OR
--       REPLACE de 0037:296-563, verificado byte a byte contra el prosrc vivo.
--       Los INSERT son una sonda de cinco filas con clave reservada
--       __probe_0038__ que se borra en la misma transaccion por id o por
--       igualdad contra esos SKU, nunca por predicado abierto."
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) DE DONDE PARTE, MEDIDO AL APLICAR — **EVIDENCIA, NO VEREDICTO.**
--
-- Este bloque no decide nada y no cuenta como veredicto: imprime contra que
-- cuerpo se esta aplicando el reemplazo, para que el log de la aplicacion lo
-- diga en vez de que haya que creerselo de la cabecera. Los veredictos estan
-- todos DESPUES del `CREATE OR REPLACE`, en (3), y miden la COSA (el cuerpo
-- que quedo y lo que hace), no su historia.
--
-- Lo unico que aborta aqui es que la funcion NO EXISTA: sin ella no hay nada
-- que reemplazar y el `CREATE OR REPLACE` estaria creando una funcion nueva
-- sin que nadie lo hubiera decidido.
--
-- NO aborta si el md5 no empata, y es deliberado: en una RE-APLICACION el
-- cuerpo vivo ya seria el de esta misma migracion, y una guarda que impide
-- re-aplicar es una guarda que rompe el replay. Dice lo que ve y sigue.
-- ------------------------------------------------------------
DO $procedencia0038$
DECLARE
  v_src   text;
  v_md5   text;
  v_esperado constant text := 'e6fd83ae83def7615bc14a3eb276f43b';
  v_tenia integer;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.sincronizar_pendientes_tecnologia(uuid)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION '0038: no existe public.sincronizar_pendientes_tecnologia(uuid). Esta migracion REEMPLAZA un cuerpo existente; si no hay ninguno, lo que toca aplicar antes son la 0013/0015/0037 y no esta. Abortando.';
  END IF;

  v_md5 := md5(v_src);
  v_tenia := (length(v_src) - length(replace(v_src, 'LIKE ''El SKU salió del catálogo%''', ''))) / length('LIKE ''El SKU salió del catálogo%''');

  IF v_md5 = v_esperado THEN
    RAISE NOTICE '0038 - PROCEDENCIA: el cuerpo vivo es EXACTAMENTE el de la 0037 (md5 %, % bytes, % lineas) y trae la linea que esta migracion retira % vez(veces). Es el punto de partida declarado en la cabecera, medido aqui y no supuesto.',
      v_md5, octet_length(v_src), array_length(string_to_array(v_src, chr(10)), 1), v_tenia;
  ELSE
    RAISE NOTICE '0038 - PROCEDENCIA: el cuerpo vivo NO es el de la 0037. md5 vivo = %, esperado = %. % bytes, % lineas, y la linea que esta migracion retira aparece % vez(veces). Si ese contador es 0 lo mas probable es que sea una RE-APLICACION de esta misma 0038 y no hay nada que temer; si es 1 o mas, alguien cambio el cuerpo entre la 0037 y ahora y el diff de este archivo NO describe lo que se esta reemplazando. Sigue adelante a proposito: los veredictos miden el cuerpo que QUEDA, no el que habia.',
      v_md5, v_esperado, octet_length(v_src), array_length(string_to_array(v_src, chr(10)), 1), v_tenia;
  END IF;
END $procedencia0038$;

-- ------------------------------------------------------------
-- (2) LA FUNCION.
--     Cuerpo base: el `prosrc` VIVO medido hoy, byte a byte igual a
--     `0037_cat_b1_bandeja_mismas_capas.sql:300-562`. Lo que cambia son DOS
--     hunks y ninguno mas:
--       · el comentario de la REAPERTURA, reescrito entero (el de la 0015 y
--         la enmienda de la 0037 describian un `WHERE` de tres lineas);
--       · el `WHERE` del `ON CONFLICT ... DO UPDATE`, que pierde su tercera
--         linea y termina en la segunda.
--     Lo que NO cambia: la guarda de universo vacio (0015), los dos predicados
--     simetricos de la 0037, el auto-cierre (1/2), el auto-cierre (2/2) —que
--     conserva intacto su propio texto de motivo—, la firma, el
--     SECURITY DEFINER, el `search_path` y el JSON de salida.
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
  -- [0015 · 0038] REAPERTURA POR CONDICIÓN. Antes de la 0015 esto era un
  -- `DO NOTHING` puro y un pendiente cerrado por error no volvía nunca. La
  -- 0015 abrió la puerta y la dejó con DOS llaves: QUIÉN cerró y CON QUÉ TEXTO
  -- cerró. La 0038 retira la segunda y deja la regla que de verdad gobierna:
  --
  --     LO QUE CERRÓ UNA CONDICIÓN, LO REABRE LA CONDICIÓN;
  --     LO QUE CERRÓ UNA PERSONA, SOLO LO REABRE UNA PERSONA.
  --
  -- El sujeto lo separa `resuelto_por`, y lo separa ENTERO: medido sobre la
  -- bandeja, los cerradores son cinco y `auto:ingesta` es el único automático.
  -- Por eso las dos líneas de abajo bastan y la tercera no añadía protección.
  --
  -- LO QUE SIGUE SIN REABRIRSE, a propósito: lo que resolvió un HUMANO —su
  -- decisión manda, y reabrirla sería el «pendiente zombi» que el UNIQUE de la
  -- 0009 existe para impedir— y lo que está en `descartado`, que ni siquiera
  -- llega a la primera línea.
  --
  -- [0038] LO QUE SE RETIRA Y POR QUÉ, sin transcribirlo: la tercera línea
  -- comparaba el TEXTO DEL MOTIVO contra un patrón. Esa cadena es PROSA QUE SE
  -- LE RENDERIZA AL USUARIO —`pendiente-fila.tsx:262` la lee y la muestra tal
  -- cual—, así que el día que alguien la suavice o le quite una tilde, la
  -- comparación deja de casar y la reapertura falla EN SILENCIO. Y además era
  -- una lista blanca que había que acordarse de ampliar: la 0037 estrenó un
  -- motivo nuevo y nadie se acordó, con lo que los cierres por «ya tiene
  -- tecnología» quedaban clavados el día que se les vaciara la tecnología.
  -- Si alguna vez hace falta una segunda condición, va sobre `origen`, que es
  -- campo de auditoría estructurado y que la interfaz no lee.
  --
  -- (El patrón retirado NO se transcribe aquí a propósito: la guarda de la
  -- 0038 lo busca por texto en `prosrc` y una copia literal en un comentario
  -- la volvería vacua —roja para siempre, en este caso—. Es el mismo motivo
  -- por el que la 0037 no transcribió su predicado.)
  --
  -- ⚠ LO QUE ESTA REAPERTURA PIERDE, dicho porque el diff no lo enseña: al
  -- reabrir, el `SET` de abajo pone `resolucion = NULL`, así que la resolución
  -- anterior NO se conserva. Guardarla (`resolucion_previa`) se PROPUSO y el
  -- PO no lo ha pedido; mientras no lo pida, no se hace.
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
    AND pendientes_datos.resuelto_por = 'auto:ingesta';
  GET DIAGNOSTICS v_encolados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (1/2): ya tiene tecnología ----------
  -- [0037] PIEZA (1) · CIERRA si la FUENTE **O** la capa congelada la traen.
  --
  -- No se pudo dejar el `FROM public.clasificacion_v2 v` que tenía la 0015.
  -- La reescritura es necesaria para LOS cerrados, pero NO por la misma razón en los
  -- cerrados — y esto se corrige aquí porque la primera versión de este comentario
  -- daba una razón que sólo vale para una parte del conjunto:
  --
  --   · unos NO tienen fila en `clasificacion_v2`. Ahí el `FROM` es un
  --     INNER JOIN, no emparejan, y el `OR` no se llega a evaluar nunca.
  --   · otros SÍ tienen fila, con la tecnología vacía. A ésos el join no
  --     los mata: fallan por otra cosa — `public.productos` NO ESTÁ en el `FROM`,
  --     así que una condición sobre `p.tecnologia` no es escribible ahí sin
  --     reestructurar.
  --
  -- (Medido contra el vigente: todos = los sin fila + los con fila y `tecnologia`
  -- vacía. La conclusión aguanta para todos; la razón, no. Un resultado
  -- correcto sostenido por una razón que sólo vale para una parte es P25, y es
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
    -- reaperturas REALES, NO la cardinalidad del predicado. Un 0 aquí con N
    -- SKU en el predicado significa "los N ya estaban abiertos", no "no hay".
    'encolados',          v_encolados,
    'cerrados_con_tec',   v_cerrados,
    'cerrados_por_baja',  v_baja,
    -- Testigo en tiempo de ejecución de QUÉ versión contestó, para no tener
    -- que leer `prosrc` desde fuera.
    'version_predicado',  'ambas_capas'
  );
END;
$fn$;

-- Se reemiten tal cual los emitia la 0013:292-293, la 0015:206-207 y la
-- 0037:570-571. Un `CREATE OR REPLACE` conserva los privilegios, asi que esto
-- es idempotente; se reemite igual porque el coste es cero y el riesgo de NO
-- hacerlo no lo es: en este repo ya hubo una funcion que nacio ejecutable por
-- `anon` via `pg_default_acl`. La guarda (3f) lo MIDE en vez de confiar.
REVOKE ALL    ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) TO service_role;

-- ------------------------------------------------------------
-- (3) LA GUARDA.
--
--     SEIS veredictos, y ninguno de los seis basta solo:
--       (3a) el cuerpo nuevo quedo COMPLETO        — must-contain propio
--       (3b) la linea retirada YA NO ESTA          — **must-NOT-contain**, el
--            unico testigo que distingue «se quito la linea» de «se reescribio
--            igual»: (3a) sale verde con la linea puesta, porque lo que (3a)
--            comprueba es que las otras dos sigan ahi
--       (3c) LA VENTANA, CONTADA sobre datos reales — la CAUSA del no-op
--       (3d) la SONDA, tres ramas, ejerciendo el EFECTO y no el mecanismo
--       (3e) la corrida limpia + **la bandeja NO se movio** — el EFECTO
--       (3f) el ACL de la funcion
--
--     SEIS, Y SE CUENTAN SEIS. Cada uno incrementa `v_reservas` exactamente
--     una vez y el cierre exige `v_reservas = 6` exacto, no `>= 1`. Es el
--     molde de la 0037, que llego a el corrigiendo un P20 de tres formas a la
--     vez (cabecera que decia cinco, cinco incrementos para seis veredictos y
--     un umbral `< 1` que dejaba borrar cuatro gratis).
--
--     POR QUE (3c) Y (3e) NO SON EL MISMO VEREDICTO, que es la pregunta obvia:
--     (3c) mide la CAUSA —cuantas de las filas auto-cerradas tienen hoy la
--     tecnologia vacia en las dos capas, o sea cuantas REABRIRIA este cambio—
--     y (3e) mide el EFECTO —si la bandeja se movio—. Si solo estuviera (3e),
--     un verde no distinguiria «no reabrio nada porque no habia nada que
--     reabrir» de «no reabrio nada porque la reapertura esta rota»; la rama R1
--     de (3d) es la que separa esos dos, y (3c) es la que dice, con numeros
--     del mundo real y no de la sonda, por que hoy toca cero.
-- ------------------------------------------------------------
DO $guarda0038$
DECLARE
  v_src        text;
  v_frag       text;
  v_primero    text;
  v_faltan     text[] := ARRAY[]::text[];
  v_sobran     text[] := ARRAY[]::text[];

  -- (3a) FRAGMENTOS OBLIGATORIOS. La guarda must-contain de la 0037 vive en la
  -- 0037 y NO se re-ejecuta al aplicar esta: si este `CREATE OR REPLACE`
  -- perdiera una pieza —por ejemplo empalmando por error el cuerpo de la 0015,
  -- que es el ancestro mas parecido— no habria nada que lo detuviera y la
  -- bandeja volveria a mirar UNA sola capa en silencio. Por eso la lista de la
  -- 0037 viaja aqui entera, ampliada con lo propio de esta migracion.
  v_obligatorios text[] := ARRAY[
    -- lo propio de la 0038: el `WHERE` que queda, y que TERMINA en la segunda
    -- linea. El `;` dentro del fragmento es la parte que trabaja: sin el, el
    -- fragmento casaria igual con el `WHERE` de tres lineas.
    'WHERE pendientes_datos.estado = ''resuelto''',
    'AND pendientes_datos.resuelto_por = ''auto:ingesta'';',
    -- el motivo del AUTO-CIERRE (2/2) NO se toca. Va aqui porque el error mas
    -- facil al hacer este cambio es borrar por busqueda todas las lineas que
    -- mencionan ese texto, y una de ellas es la que ESCRIBE el motivo.
    'El SKU salió del catálogo: el pendiente dejó de aplicar.',
    -- la guarda de universo vacio de la 0015, que ninguna lista anterior pinno
    'v_snap IS NULL OR v_productos = 0',
    -- las dos piezas simetricas de la 0037
    'NOT (c.tiene_tec_fuente OR c.tiene_tec_v2)',
    '(src_capas.tiene_tec_fuente OR src_capas.tiene_tec_v2)',
    'LEFT JOIN public.productos pf',
    'pf.snapshot_id = v_snap',
    'LEFT JOIN public.clasificacion_v2 vf',
    '''origen'',',
    '''capas_consultadas'',',
    '''version_predicado'','
  ];

  -- (3b) FRAGMENTOS PROHIBIDOS. Los DOS aparecian EXACTAMENTE UNA VEZ en el
  -- `prosrc` que estaba vivo antes de esta migracion (medido hoy sobre el
  -- volcado), asi que esta comprobacion PUEDE ponerse roja: se pondria si el
  -- `CREATE OR REPLACE` no hubiera surtido efecto, o si alguien reintrodujera
  -- la condicion sobre el motivo.
  --   · el primero prohibe ESA condicion;
  --   · el segundo prohibe CUALQUIER condicion sobre el motivo, con el patron
  --     que sea. Es el trinquete del principio: si algun dia hace falta una
  --     segunda condicion, va sobre `origen`, que es campo de auditoria y no
  --     se le renderiza a nadie.
  v_prohibidos text[] := ARRAY[
    'LIKE ''El SKU salió del catálogo%''',
    'resolucion ->> ''motivo'''
  ];

  v_naive      integer;

  -- (3c) la ventana, contada
  v_snap            uuid;
  v_resueltos_auto  bigint;
  v_pasaban_viejo   bigint;
  v_reabririan      bigint;

  -- (3d) la sonda
  v_clave      text := '__probe_0038__';
  v_sku_r1     text := '__probe_0038__/R1-auto-cerrado-sin-tec';
  v_sku_r2     text := '__probe_0038__/R2-humano-cerrado-sin-tec';
  v_sku_r3     text := '__probe_0038__/R3-sin-pendiente-sin-tec';
  v_humano     text := '__probe_0038__/persona@sonda';
  v_skus       text[];
  v_marca_id   uuid;
  v_res        jsonb;
  v_ids        uuid[];
  v_estado     text;
  v_detpor     text;
  v_respor     text;
  v_resol      jsonb;
  v_n          bigint;

  -- (3e) la bandeja, antes y despues
  v_band_antes    text[];
  v_band_despues  text[];
  v_band_n_antes    bigint;
  v_band_n_despues  bigint;
  v_tec_n_antes     bigint;
  v_tec_n_despues   bigint;
  v_dif           bigint;

  -- (3f)
  v_anon       boolean;
  v_auth       boolean;
  v_svc        boolean;

  v_reservas   integer := 0;
BEGIN
  -- ==========================================================
  -- (3a) EL CUERPO NUEVO QUEDO COMPLETO
  -- ==========================================================
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.sincronizar_pendientes_tecnologia(uuid)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION '0038: no existe sincronizar_pendientes_tecnologia(uuid) despues del CREATE OR REPLACE. Abortando.';
  END IF;

  FOREACH v_frag IN ARRAY v_obligatorios LOOP
    IF position(v_frag IN v_src) = 0 THEN
      v_faltan := v_faltan || v_frag;
    END IF;
  END LOOP;

  IF array_length(v_faltan, 1) IS NOT NULL THEN
    -- El subindice se saca ANTES del RAISE a proposito: un corchete entre los
    -- argumentos deja al verificador estatico sin poder afirmar la aridad y lo
    -- reporta como AMBIGUO. Lo midio la 0037; aqui se hereda la forma.
    v_primero := v_faltan[1];
    RAISE EXCEPTION '0038: al cuerpo nuevo de sincronizar_pendientes_tecnologia le FALTAN % de % fragmentos obligatorios. El primero que falta es: <<%>>. Este cambio retira UNA linea; si falta cualquier otra cosa, lo que se empalmo no es el cuerpo de la 0037 con un hunk, y la bandeja puede haber vuelto a mirar una sola capa. Abortando.',
      array_length(v_faltan, 1), array_length(v_obligatorios, 1), v_primero;
  END IF;
  RAISE NOTICE '0038 - (3a) el cuerpo nuevo conserva los % fragmentos obligatorios, incluidas las DOS lineas que sobreviven en el WHERE de la reapertura, el motivo del auto-cierre por baja y las dos piezas simetricas de la 0037.', array_length(v_obligatorios, 1);
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (3b) LA LINEA RETIRADA YA NO ESTA — EL TESTIGO QUE DISTINGUE
  --      «SE QUITO» DE «SE REESCRIBIO IGUAL»
  -- ==========================================================
  FOREACH v_frag IN ARRAY v_prohibidos LOOP
    IF position(v_frag IN v_src) > 0 THEN
      v_sobran := v_sobran || v_frag;
    END IF;
  END LOOP;

  IF array_length(v_sobran, 1) IS NOT NULL THEN
    v_primero := v_sobran[1];   -- fuera del RAISE, misma razon que arriba
    RAISE EXCEPTION '0038: el cuerpo nuevo TODAVIA cuelga del texto del motivo en % sitio(s). El primero es: <<%>>. O el CREATE OR REPLACE no surtio efecto, o alguien reintrodujo la condicion. Lo que cerro una condicion lo reabre la condicion: el sujeto lo separa resuelto_por, no la prosa. Abortando.',
      array_length(v_sobran, 1), v_primero;
  END IF;

  -- ANTI-VACUIDAD, POR EL LADO CONTRARIO AL HABITUAL (P19 invertido). El
  -- fragmento prohibido lleva el `LIKE` y el `%` a proposito: la cadena suelta
  -- «El SKU salió del catálogo» SIGUE VIVA en el cuerpo, porque es el motivo
  -- que ESCRIBE el auto-cierre (2/2). Prohibirla a secas no habria sido una
  -- guarda vacua sino una IMPOSIBLE: roja para siempre, aun con el cambio bien
  -- hecho. Se mide cuantas veces aparece para que el motivo quede contado y no
  -- argumentado: tiene que ser 1 (antes de esta migracion eran 2).
  v_naive := (length(v_src) - length(replace(v_src, 'El SKU salió del catálogo', ''))) / length('El SKU salió del catálogo');
  RAISE NOTICE '0038 - (3b) la condicion sobre el texto del motivo YA NO ESTA: ninguno de los % fragmentos prohibidos sobrevive. ANTI-VACUIDAD: la cadena suelta del motivo aparece % vez(veces) en el cuerpo -es el texto que el auto-cierre por baja ESCRIBE-, asi que prohibirla sin el LIKE habria sido una guarda imposible de poner verde, no una guarda vacua. Por eso los fragmentos llevan el operador dentro.',
    array_length(v_prohibidos, 1), v_naive;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (3c) LA VENTANA, CONTADA SOBRE DATOS REALES — LA CAUSA DEL NO-OP
  --
  -- Tres cifras del mismo conjunto (los pendientes de este tipo cerrados por
  -- `auto:ingesta`), y cada una contesta una pregunta distinta:
  --   · cuantos hay                      -> el tamano de la poblacion afectada
  --   · cuantos pasaban el filtro VIEJO  -> lo que la linea retirada protegia
  --   · cuantos reabre ESTE cambio HOY   -> si la migracion es o no un no-op
  -- La tercera es la unica que puede abortar, y aborta hacia el lado incomodo:
  -- si sale > 0 el cambio HARIA SU TRABAJO, pero contra un mundo distinto del
  -- que describe la cabecera. Un verde sobre otro mundo no es un verde.
  -- ==========================================================
  SELECT s.id INTO v_snap
    FROM public.snapshots s
   WHERE s.fuente = 'stock'
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT 1;

  IF v_snap IS NULL THEN
    RAISE EXCEPTION '0038: no hay ningun snapshot de fuente stock. La guarda no puede medir nada y la sonda no tendria donde vivir. Abortando.';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE pd.resolucion ->> 'motivo' LIKE 'El SKU salió del catálogo%'),
         -- [R-1 reparo] `p.sku IS NOT NULL` NO es adorno: sin el, un SKU auto-cerrado que
         -- ademas SALIO del catalogo cuenta como «lo reabre este cambio» — y no lo reabre,
         -- porque el unico que reabre es el ON CONFLICT del encolado, cuyo universo exige
         -- `p.snapshot_id = v_snap`. El error iba al lado seguro (aborto falso, nunca verde
         -- falso), pero el NOTICE afirmaba un conteo EXACTO que no lo era, y el aborto
         -- habria parado una migracion correcta con un mensaje que dice lo contrario de lo
         -- que pasa. Medido: los dos numeros coinciden — la divergencia era
         -- LATENTE, no activa.
         count(*) FILTER (WHERE p.sku IS NOT NULL
                            AND NOT ((p.tecnologia IS NOT NULL AND btrim(p.tecnologia) <> '')
                                  OR (v.tecnologia IS NOT NULL AND btrim(v.tecnologia) <> '')))
    INTO v_resueltos_auto, v_pasaban_viejo, v_reabririan
    FROM public.pendientes_datos pd
    LEFT JOIN public.productos p         ON p.sku = pd.clave_natural AND p.snapshot_id = v_snap
    LEFT JOIN public.clasificacion_v2 v  ON v.sku = pd.clave_natural
   WHERE pd.tipo = 'sku_sin_tecnologia'
     AND pd.estado = 'resuelto'
     AND pd.resuelto_por = 'auto:ingesta';

  IF v_reabririan > 0 THEN
    RAISE EXCEPTION '0038: PRE-CONDICION ROTA. Hay % pendiente(s) cerrado(s) por auto:ingesta cuyo SKU no tiene tecnologia en NINGUNA de las dos capas, sobre un total de % cerrados por la ingesta. Esta migracion los REABRIRIA, que es exactamente para lo que existe y seria correcto; pero la cabecera declara un NO-OP medido (cero) y la bandeja se moveria. El mundo cambio desde la medicion: hay que re-medir, re-declarar la precondicion y volver a aplicar. Abortando sin tocar nada.',
      v_reabririan, v_resueltos_auto;
  END IF;

  RAISE NOTICE '0038 - (3c) LA VENTANA, CONTADA. Pendientes sku_sin_tecnologia cerrados por auto:ingesta: %. De esos, los que pasaban el filtro VIEJO del motivo: % -esa es la medida de lo que la linea retirada protegia: nada-. Los que ESTE cambio reabre hoy: %, porque su tecnologia no esta vacia. Por eso la migracion es un NO-OP sobre los datos de hoy, y por eso NO se vende como si moviera un numero: lo que cierra es la ventana que dejaria clavado al PRIMER SKU al que se le vacie la tecnologia.',
    v_resueltos_auto, v_pasaban_viejo, v_reabririan;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (3d) LA SONDA — TRES RAMAS, Y LA SEGUNDA ES LA QUE HACE QUE LA PRIMERA
  --      VALGA
  --
  --   R1 · pendiente CERRADO por `auto:ingesta` con el motivo de «ya tiene
  --        tecnologia», y el SKU SIN tecnologia en ninguna capa -> ABRE
  --   R2 · pendiente CERRADO POR UNA PERSONA, mismo SKU sin tecnologia en
  --        ninguna capa                                         -> SIGUE RESUELTO
  --   R3 · SKU SIN pendiente previo y sin tecnologia en ninguna capa -> ENCOLA
  --
  -- ⚠ SIN R2, R1 ES VACUA: reabrir absolutamente todo —borrar el `WHERE`
  --   entero— tambien la pondria verde, y eso seria el «pendiente zombi» que
  --   el UNIQUE de la 0009 existe para impedir.
  -- ⚠ SIN R3, la corrida podria no haber hecho NADA y R2 saldria verde POR
  --   INACCION: una funcion que no toca una sola fila deja «sigue resuelto».
  --
  -- Y R1 no puede salir verde por accidente: su motivo es el de «ya tiene
  -- tecnologia», que es justo el que el filtro retirado RECHAZABA. Con el
  -- cuerpo de la 0037 esta rama sale ROJA. Es la unica de las tres que cambia
  -- de color con esta migracion.
  --
  -- Las tres se verifican RELEYENDO LA FILA, no leyendo el codigo, y no solo
  -- por el `estado`: tambien por `detectado_por`, que es el testigo de POR
  -- DONDE paso la fila. La sonda escribe `__probe_0038__` ahi y la funcion
  -- escribe 'etl'; asi R1 prueba que la reabrio el `ON CONFLICT` y R2 prueba
  -- que a esa fila no la toco nadie.
  --
  -- La sonda vive en el snapshot VIGENTE a proposito. Con un snapshot falso el
  -- auto-cierre (2/2) veria los SKU reales como «salidos del catalogo» y
  -- los cerraria TODOS. Se retira al final POR `id` (pendientes, marcas) o POR
  -- IGUALDAD contra los SKU reservados (productos, cuya PK es el `sku`), nunca
  -- por predicado abierto.
  -- ==========================================================
  v_skus := ARRAY[v_sku_r1, v_sku_r2, v_sku_r3];

  -- En `clasificacion_v2` esta migracion NO ESCRIBE, y por eso TAMPOCO BORRA:
  -- se comprueba que no haya nada con esos SKU. Si lo hubiera, la sonda no
  -- estaria midiendo lo que dice medir (las tres ramas exigen «sin tecnologia
  -- en NINGUNA capa») y lo correcto es pararse, no barrer una tabla ajena.
  IF EXISTS (SELECT 1 FROM public.clasificacion_v2 WHERE sku = ANY(v_skus)) THEN
    RAISE EXCEPTION '0038: hay filas en clasificacion_v2 con los SKU reservados de la sonda (%). Esta migracion no escribe en esa tabla y no va a borrar de ella; con esas filas puestas, las tres ramas medirian otra cosa. Abortando.', v_clave;
  END IF;

  -- residuo de una corrida abortada, por si acaso
  SELECT array_agg(pdx.id) INTO v_ids FROM public.pendientes_datos pdx WHERE pdx.clave_natural = ANY(v_skus);
  IF v_ids IS NOT NULL THEN DELETE FROM public.pendientes_datos WHERE id = ANY(v_ids); END IF;
  DELETE FROM public.productos WHERE sku = ANY(v_skus);
  DELETE FROM public.marcas    WHERE nombre = v_clave;

  -- ---- LA BANDEJA, ANTES. Se mide AQUI: despues de limpiar el residuo y
  --      ANTES de la primera llamada a la funcion, que es lo unico de esta
  --      migracion capaz de mover una fila real. Se excluyen los SKU de la
  --      sonda en las dos mediciones, no en una sola.
  SELECT count(*), array_agg(pd.tipo || '|' || pd.clave_natural ORDER BY pd.tipo, pd.clave_natural)
    INTO v_band_n_antes, v_band_antes
    FROM public.pendientes_datos pd
   WHERE pd.estado = 'abierto'
     AND NOT (pd.clave_natural = ANY(v_skus));

  SELECT count(*) INTO v_tec_n_antes
    FROM public.pendientes_datos pd
   WHERE pd.tipo = 'sku_sin_tecnologia' AND pd.estado = 'abierto'
     AND NOT (pd.clave_natural = ANY(v_skus));

  INSERT INTO public.marcas (nombre) VALUES (v_clave) RETURNING id INTO v_marca_id;

  -- Los tres productos van al VIGENTE y con `tecnologia` NULL: las tres ramas
  -- necesitan un SKU que el encolado seleccione.
  INSERT INTO public.productos (sku, marca_id, snapshot_id, tecnologia, descr_origen, resv)
  VALUES (v_sku_r1, v_marca_id, v_snap, NULL, v_clave, 0),
         (v_sku_r2, v_marca_id, v_snap, NULL, v_clave, 0),
         (v_sku_r3, v_marca_id, v_snap, NULL, v_clave, 0);

  -- R1 replica la forma EXACTA de los reales, `origen` incluido: si la
  -- sonda cerrara con una resolucion de fantasia, estaria probando su propia
  -- idea de como cierra la ingesta en vez de como cierra de verdad.
  -- R2 lleva un cerrador que no es `auto:ingesta` y un motivo que tampoco
  -- casaba con el filtro viejo: lo unico que lo protege es el sujeto.
  INSERT INTO public.pendientes_datos
        (tipo, clave_natural, estado, detectado_por, snapshot_id, payload, resolucion, resuelto_por, resuelto_en)
  VALUES ('sku_sin_tecnologia', v_sku_r1, 'resuelto', v_clave, v_snap,
          jsonb_build_object('sku', v_sku_r1),
          jsonb_build_object('accion', 'auto_cierre',
                             'motivo', 'El SKU ya tiene tecnología asignada: el pendiente dejó de aplicar.',
                             'origen', 'fuente',
                             'snapshot', v_snap),
          'auto:ingesta', now()),
         ('sku_sin_tecnologia', v_sku_r2, 'resuelto', v_clave, v_snap,
          jsonb_build_object('sku', v_sku_r2),
          jsonb_build_object('accion', 'resolver',
                             'motivo', 'Lo cerro una PERSONA desde la bandeja.'),
          v_humano, now());

  -- LA CORRIDA. Es la misma llamada que hara la siguiente ingesta de stock.
  v_res := public.sincronizar_pendientes_tecnologia(v_snap);

  -- ---- rama R1: lo que cerro la CONDICION, lo reabre la CONDICION ----
  SELECT pd.estado, pd.detectado_por, pd.resuelto_por, pd.resolucion
    INTO v_estado, v_detpor, v_respor, v_resol
    FROM public.pendientes_datos pd
   WHERE pd.tipo = 'sku_sin_tecnologia' AND pd.clave_natural = v_sku_r1;

  IF v_estado IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION '0038: SONDA RAMA R1 ROJA. Un pendiente cerrado por auto:ingesta con el motivo de "ya tiene tecnologia", cuyo SKU no tiene tecnologia en NINGUNA de las dos capas, quedo en estado "%" y tenia que quedar "abierto". La reapertura sigue colgando del texto del motivo: es exactamente la ventana que esta migracion viene a cerrar, y con el cuerpo de la 0037 esta rama sale asi. Abortando.',
      coalesce(v_estado, '(no existe la fila)');
  END IF;
  IF v_detpor IS DISTINCT FROM 'etl' OR v_respor IS NOT NULL OR v_resol IS NOT NULL THEN
    RAISE EXCEPTION '0038: SONDA RAMA R1 ROJA POR EL CAMINO. La fila esta abierta, pero detectado_por = "%" (tenia que ser "etl", que es lo que escribe la funcion), resuelto_por = "%" y resolucion = "%" (los dos tenian que quedar nulos). Abierta sin haber pasado por el ON CONFLICT no prueba la reapertura: prueba que alguien la dejo abierta. Abortando.',
      coalesce(v_detpor, '(nulo)'), coalesce(v_respor, '(nulo)'), coalesce(v_resol::text, '(nulo)');
  END IF;

  -- ---- rama R2: lo que cerro una PERSONA, solo lo reabre una PERSONA ----
  SELECT pd.estado, pd.detectado_por, pd.resuelto_por, pd.resolucion
    INTO v_estado, v_detpor, v_respor, v_resol
    FROM public.pendientes_datos pd
   WHERE pd.tipo = 'sku_sin_tecnologia' AND pd.clave_natural = v_sku_r2;

  IF v_estado IS DISTINCT FROM 'resuelto' OR v_respor IS DISTINCT FROM v_humano THEN
    RAISE EXCEPTION '0038: SONDA RAMA R2 ROJA. Un pendiente cerrado POR UNA PERSONA, con el mismo SKU sin tecnologia en ninguna capa, quedo en estado "%" con resuelto_por "%": tenia que seguir "resuelto" y con su cerrador intacto. El WHERE de la reapertura perdio tambien la linea del sujeto y esto reabre decisiones humanas: es el pendiente zombi. Abortando.',
      coalesce(v_estado, '(no existe la fila)'), coalesce(v_respor, '(nulo)');
  END IF;
  IF v_detpor IS DISTINCT FROM v_clave OR v_resol IS NULL THEN
    RAISE EXCEPTION '0038: SONDA RAMA R2 ROJA POR EL CAMINO. La fila sigue resuelta, pero detectado_por = "%" cuando la sonda lo escribio como "%", o su resolucion quedo nula. El ON CONFLICT SI la toco y volvio a dejarla resuelta por otra via: el estado final coincide por casualidad y no por la regla. Abortando.',
      coalesce(v_detpor, '(nulo)'), v_clave;
  END IF;

  -- ---- rama R3: sin esto, la corrida podria no haber hecho NADA ----
  SELECT count(*) INTO v_n
    FROM public.pendientes_datos pd
   WHERE pd.tipo = 'sku_sin_tecnologia' AND pd.clave_natural = v_sku_r3
     AND pd.estado = 'abierto' AND pd.detectado_por = 'etl';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0038: SONDA RAMA R3 ROJA. Un SKU sin tecnologia en ninguna capa y sin pendiente previo genero % fila(s) abiertas con detectado_por = etl, y tenia que generar 1. El encolado no esta insertando, y sin eso la rama R2 seria verde por INACCION: una funcion que no mueve nada tambien deja "sigue resuelto". Abortando.', v_n;
  END IF;

  RAISE NOTICE '0038 - (3d) SONDA VERDE, LAS TRES RAMAS: reabre lo que cerro la CONDICION (R1, y con el cuerpo de la 0037 esta rama sale roja), NO reabre lo que cerro una PERSONA (R2, que es lo que impide que R1 sea vacua) y SI encola lo que nadie ha contestado (R3, que es lo que impide que R2 sea verde por inaccion). Verificado releyendo las filas -estado, detectado_por, resuelto_por y resolucion-, no leyendo el codigo. La corrida de la sonda devolvio: %', v_res::text;
  RAISE NOTICE '0038 - (3d) LO QUE LA RAMA R1 DEJA MEDIDO Y NO ES UNA VICTORIA: al reabrir, la resolucion anterior se PIERDE (resolucion, resuelto_por y resuelto_en quedan nulos). Conservarla en el payload como resolucion_previa se PROPUSO y el PO no lo ha pedido; queda como propuesta viva. Hoy la sonda EXIGE que se pierda, asi que el dia que se decida conservarla esta guarda se pondra roja y habra que venir a cambiarla a proposito.';
  v_reservas := v_reservas + 1;

  -- ---- retirada de la sonda ----
  SELECT array_agg(pdx.id) INTO v_ids FROM public.pendientes_datos pdx WHERE pdx.clave_natural = ANY(v_skus);
  IF v_ids IS NOT NULL THEN DELETE FROM public.pendientes_datos WHERE id = ANY(v_ids); END IF;
  DELETE FROM public.productos WHERE sku = ANY(v_skus);
  IF v_marca_id IS NOT NULL THEN DELETE FROM public.marcas WHERE id = v_marca_id; END IF;

  IF EXISTS (SELECT 1 FROM public.pendientes_datos WHERE clave_natural = ANY(v_skus))
     OR EXISTS (SELECT 1 FROM public.productos WHERE sku = ANY(v_skus))
     OR EXISTS (SELECT 1 FROM public.marcas WHERE nombre = v_clave) THEN
    RAISE EXCEPTION '0038: la sonda no se pudo borrar y quedarian filas basura con la clave reservada %. Causa mas probable: el rol que aplica esta migracion NO es el DUENO de estas tablas y RLS si le aplica. Aplicar con el rol dueno. Nada se aplico.', v_clave;
  END IF;
  RAISE NOTICE '0038 - sonda retirada por id (pendientes_datos y marcas) o por igualdad contra los SKU reservados (productos, cuya PK es el sku), nunca por predicado abierto: no queda ninguna fila con la clave reservada %. En clasificacion_v2 no se escribio ni se borro nada.', v_clave;

  -- ==========================================================
  -- (3e) LA CORRIDA LIMPIA + **LA BANDEJA NO SE MOVIO**
  --
  -- Segunda llamada, ya sin sonda, y la unica que mide lo que promete la
  -- cabecera. Se juzga por DOS caminos distintos y ninguno vale solo:
  --   · EL JSON que devuelve la funcion (lo que ELLA dice que hizo);
  --   · LA TABLA leida otra vez (lo que de verdad quedo).
  -- Creerle solo al JSON seria medir la representacion en vez de la cosa, y
  -- creerle solo al conteo seria aceptar «N y N» con dos filas distintas
  -- intercambiadas: por eso ademas del conteo se compara EL CONJUNTO.
  --
  -- El conjunto se toma de TODOS los tipos, no solo de `sku_sin_tecnologia`.
  -- Eso NO es decorado: la funcion fija el tipo en su `INSERT`, asi que una
  -- version que encolara con otro tipo moveria los N sin mover los M, y un
  -- veredicto que solo mirara este tipo no lo veria. Lo que esta comparacion
  -- NO puede ver: cambios en filas que ya estaban resueltas o descartadas
  -- —solo mira las abiertas—; para eso esta (3c), que cuenta las cerradas.
  -- ==========================================================
  v_res := public.sincronizar_pendientes_tecnologia(v_snap);

  IF (v_res ->> 'encolados')::int <> 0
     OR (v_res ->> 'cerrados_con_tec')::int <> 0
     OR (v_res ->> 'cerrados_por_baja')::int <> 0 THEN
    RAISE EXCEPTION '0038: la corrida limpia MOVIO filas y esta migracion se declaro NO-OP. Devolvio %. Con la bandeja convergida -26 abiertos que son exactamente los 26 SKU del predicado- lo correcto es 0 encolados, 0 cerrados_con_tec y 0 cerrados_por_baja. O la migracion esta mal, o el mundo cambio desde la medicion y hay que re-medir antes de aplicar. Abortando.',
      v_res::text;
  END IF;

  SELECT count(*), array_agg(pd.tipo || '|' || pd.clave_natural ORDER BY pd.tipo, pd.clave_natural)
    INTO v_band_n_despues, v_band_despues
    FROM public.pendientes_datos pd
   WHERE pd.estado = 'abierto'
     AND NOT (pd.clave_natural = ANY(v_skus));

  SELECT count(*) INTO v_tec_n_despues
    FROM public.pendientes_datos pd
   WHERE pd.tipo = 'sku_sin_tecnologia' AND pd.estado = 'abierto'
     AND NOT (pd.clave_natural = ANY(v_skus));

  -- Diferencia simetrica REAL: cada EXCEPT en su propio par de parentesis y
  -- las dos ramas vivas. Un solo EXCEPT solo ve lo que se perdio, no lo que
  -- aparecio.
  SELECT count(*) INTO v_dif
    FROM ((SELECT unnest(v_band_antes)   EXCEPT SELECT unnest(v_band_despues))
          UNION ALL
          (SELECT unnest(v_band_despues) EXCEPT SELECT unnest(v_band_antes))) d;

  IF v_band_n_antes <> v_band_n_despues OR v_tec_n_antes <> v_tec_n_despues OR v_dif <> 0 THEN
    RAISE EXCEPTION '0038: LA BANDEJA SE MOVIO Y ESTA MIGRACION ESTA MAL. Abiertos de todos los tipos: % antes, % despues. De sku_sin_tecnologia: % antes, % despues. Filas que estan en uno de los dos conjuntos y no en el otro: %. La precondicion declarada es un NO-OP exacto: mismos conteos Y EL MISMO CONJUNTO. Si los conteos empatan y la diferencia no es 0, se intercambiaron filas y es peor todavia. Abortando.',
      v_band_n_antes, v_band_n_despues, v_tec_n_antes, v_tec_n_despues, v_dif;
  END IF;

  RAISE NOTICE '0038 - (3e) LA BANDEJA NO SE MOVIO, y se dice con su denominador. Abiertos de TODOS los tipos: % antes y % despues. De sku_sin_tecnologia: % antes y % despues. Diferencia simetrica del conjunto completo (no del conteo): %. La corrida limpia devolvio %, o sea que ni encolo, ni cerro por tecnologia, ni cerro por baja. Las dos llamadas de esta guarda -la de la sonda y esta- dejaron la bandeja como estaba.',
    v_band_n_antes, v_band_n_despues, v_tec_n_antes, v_tec_n_despues, v_dif, v_res::text;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- (3f) EL ACL DE LA FUNCION
  -- ==========================================================
  SELECT has_function_privilege('anon',          'public.sincronizar_pendientes_tecnologia(uuid)', 'EXECUTE'),
         has_function_privilege('authenticated', 'public.sincronizar_pendientes_tecnologia(uuid)', 'EXECUTE'),
         has_function_privilege('service_role',  'public.sincronizar_pendientes_tecnologia(uuid)', 'EXECUTE')
    INTO v_anon, v_auth, v_svc;

  IF v_anon OR v_auth THEN
    RAISE EXCEPTION '0038: la funcion quedo EJECUTABLE por anon=% o authenticated=%. Es SECURITY DEFINER y ahora ademas REABRE pendientes: ejecutable sin sesion es una puerta para mover la bandeja desde fuera. Abortando.', v_anon, v_auth;
  END IF;
  IF NOT v_svc THEN
    RAISE EXCEPTION '0038: service_role NO puede ejecutar la funcion. La ingesta la llama desde ingest_snapshot y dejaria de sincronizar la bandeja en silencio. Abortando.';
  END IF;
  RAISE NOTICE '0038 - (3f) ACL MEDIDA (no recordada): anon=% authenticated=% service_role=%. Es la reparticion esperada desde la 0013.', v_anon, v_auth, v_svc;
  v_reservas := v_reservas + 1;

  -- ==========================================================
  -- LO QUE ESTA MIGRACION **NO** PUEDE COMPROBAR DESDE DONDE ESTA
  -- ==========================================================
  RAISE NOTICE '0038 - NO COMPROBADO AQUI: que nadie MAS dependa del texto del motivo. Esta migracion quita esa dependencia de UN sitio, el WHERE de la reapertura. Medido: quien LEE resolucion.motivo es pendiente-fila.tsx:262, y lo lee para MOSTRARLO, no para decidir. Lo que no se puede medir desde la base es un reporte, un workflow de n8n o un consumidor futuro que compare ese texto; si existe, sigue siendo prosa sosteniendo una decision.';
  RAISE NOTICE '0038 - QUEDA VIVO Y CON NOMBRE: la lista blanca no desaparece, CAMBIA DE EJE. Antes era una lista de CADENAS DE PROSA (los motivos); ahora es una lista de SUJETOS con un solo elemento (auto:ingesta). Si manana nace un segundo cerrador automatico con otro nombre, sus cierres quedaran igual de clavados y habra que ampliar esta condicion. La diferencia que si importa: un nombre de rol no se le renderiza a nadie y no lo cambia un retoque de copy.';
  RAISE NOTICE '0038 - NO EJERCIDO POR LA SONDA, solo leido en el codigo: el estado "descartado". La primera linea del WHERE exige estado = resuelto, asi que un descarte no se reabre; la sonda monta TRES ramas y ninguna es un descarte. Es lectura, no medicion, y por eso va dicho aqui.';
  RAISE NOTICE '0038 - DEPENDENCIA HACIA ADELANTE, heredada de la 0037 y sin cambio: la sincronizacion CONTINUA de la bandeja depende de que corra una ingesta de fuente=stock. ingest_snapshot llama a esta funcion dentro de un IF snap->>fuente = stock (0013:378, reproducido en 0019:352, 0022:234 y 0036:326), asi que una ingesta de ADUANA no reabre ni encola nada. Quien quiera forzarlo sin esperar, llama a la funcion con service_role.';
  RAISE NOTICE '0038 - SIN CAMBIO RESPECTO A LA 0037, dicho para que nadie lo descubra a golpes: esta funcion sigue mencionando p.tecnologia, asi que RE-APLICAR LA 0036 SIGUE ABORTANDO por su propio trinquete (0036:608-611). No es un fallo: es su guarda sobre un mundo que cambio por decision del PO.';
  RAISE NOTICE '0038 - FUERA DE ALCANCE POR ESCRITO: los otros SEIS tipos de la bandeja, resolver_pendiente, derivaciones.ts, la ficha y productos_override (eso es CAT-B2), y todo lo relacionado con los 70 VERTICAL. Un cambio a la vez o ninguno es atribuible.';

  -- ==========================================================
  -- EL CONTADOR DE VEREDICTOS
  -- ==========================================================
  IF v_reservas <> 6 THEN
    RAISE EXCEPTION '0038: el contador de veredictos vale % y el numero estructural es 6 exacto (3a 3b 3c 3d 3e 3f, uno cada uno). Si esto salta, o un veredicto declarado dejo de contarse -y el resumen de abajo estaria mintiendo sobre cuanto se midio- o alguien conto dos veces el mismo. Abortando.', v_reservas;
  END IF;
  RAISE NOTICE '0038 - GUARDA VERDE CON RESERVAS: % veredicto(s) medidos aqui, que son los 6 declarados en la cabecera de la guarda. Verde significa "no contradicho", no "probado": lo que esta guarda no alcanza va enumerado arriba, uno por uno. Y lo que esta guarda NO demuestra aunque lo parezca: que reabrir sea la politica correcta. Eso lo decidio el PO; aqui solo se comprueba que el codigo hace lo que esa decision dice.', v_reservas;
END $guarda0038$;

COMMIT;

-- ============================================================
-- MARCHA ATRAS
--
--   -- LA FUNCION, y es lo UNICO que hay que deshacer: esta migracion no
--   -- escribe ni borra ninguna fila de negocio (la sonda se retira sola
--   -- dentro de la misma transaccion, y la guarda aborta si la bandeja se
--   -- movio). Re-aplicar tal cual el `CREATE OR REPLACE FUNCTION
--   -- public.sincronizar_pendientes_tecnologia(p_snapshot uuid DEFAULT NULL)`
--   -- de `supabase/migrations/0037_cat_b1_bandeja_mismas_capas.sql`
--   -- (lineas 296-563). Es literal: ese cuerpo es el que estaba vivo antes de
--   -- esta migracion, verificado byte a byte contra `prosrc`
--   -- (md5 e6fd83ae83def7615bc14a3eb276f43b).
--
-- LO QUE SE RECUPERA AL DESHACER: nada de datos. Lo que se recupera es la
-- ventana: la reapertura vuelve a colgar del texto del motivo y los pendientes
-- auto-cerrados por «ya tiene tecnologia» vuelven a quedar clavados el dia que
-- se les vacie la tecnologia. Deshacer esto no es neutro; es reabrir un agujero
-- que hoy no tiene victimas y manana puede tenerlas.
--
-- LO QUE **NO** SE DESHACE CON ESO: si entre la aplicacion y la marcha atras
-- corriera una ingesta de stock y esta version reabriera pendientes, esos
-- pendientes se quedan abiertos. No es un dano —estar abierto es el estado por
-- omision de una pregunta sin contestar— pero hay que saberlo: la vuelta atras
-- de la funcion no vuelve a cerrar lo que la funcion nueva abrio.
-- ============================================================
