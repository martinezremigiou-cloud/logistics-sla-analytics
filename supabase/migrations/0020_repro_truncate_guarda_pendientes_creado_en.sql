-- ============================================================
-- 0020 · [REPRODUCIBILIDAD] G1 — los tres huecos de privilegio, en UNA
--        sola transacción.
--
-- Ver `docs/decisions/0005-migration-guards-and-replay.md` y `docs/decisions/0007-privilege-guards-inside-functions.md`
-- (la ratificación MANDA donde discrepen).
--
-- Van juntos porque los tres son REVOKE/GRANT/ALTER sobre el mismo dominio
-- de permisos, ninguno depende de datos, y los tres son idempotentes. Tres
-- migraciones separadas multiplican por tres el riesgo del camino de pérdida
-- #1 (migración mal escrita) sin ganar nada.
--
--   (1) El `REVOKE TRUNCATE` + el `COMMENT ON CONSTRAINT` que la 0016 dejó
--       ESCRITOS y NUNCA APLICADOS. Se reusa su contenido; su CIFRA no.
--   (2) Guarda `is_admin()` DENTRO de `contar_pendientes()`.
--   (3) `familias.creado_en` / `familias.creado_por`.
--   (1c) [S7-B · 2026-08-07] `ALTER DEFAULT PRIVILEGES` para que la fuga de
--       TRUNCATE no se reabra con la próxima tabla. Ratificado en
--       `docs/decisions/0007-privilege-guards-inside-functions.md`. Entra en ESTA migración y no en
--       una nueva porque es la misma pieza que el REVOKE de (1b): sin él,
--       (1b) es limpieza de una vez y la regresión llega sola.
--
-- CRITERIO DE ÉXITO EXTERNO: la verificación HTTP de la 0020 (script de QA no incluido) en verde
-- tras aplicar. Este archivo no lo sustituye — lo que ese script mide por
-- HTTP con una sesión real no se puede medir desde aquí, y viceversa.
--
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo que no se pueda reconstruir
--      con una re-ingesta ni con otra migración?
--      **NO.** Cero DELETE, cero UPDATE de filas, cero cierre de pendientes.
--      Las únicas sentencias que tocan datos son dos `ADD COLUMN`, y añaden.
--      Las tres piezas son aditivas o restrictivas sobre PRIVILEGIOS y
--      METADATOS, y las tres se deshacen: `GRANT TRUNCATE … TO anon,
--      authenticated` revierte la (1); el `CREATE OR REPLACE` anterior está
--      reproducido ÍNTEGRO en el comentario de la pieza (2), así que volver
--      atrás es copiar y pegar; `ALTER TABLE … DROP COLUMN` revierte la (3);
--      y `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT
--      TRUNCATE ON TABLES TO anon, authenticated` revierte la (1c) [S7-B].
--      La ÚNICA información nueva no reconstruible es el sello `now()` que
--      reciben las filas históricas de `familias` — y precisamente por eso
--      se declara como FECHA FALSA en `COMMENT ON COLUMN`, en vez de dejar
--      que alguien la lea como un dato.
--
--   2. ¿Tiene tope de radio de impacto (ROW_COUNT) que aborte si toca más
--      filas de las previstas?
--      **No aplica: no hay UPDATE ni DELETE, así que no hay radio que topar.**
--      El equivalente aquí es el tope de privilegios, y sí está: la guarda
--      exige TRUNCATE en CERO y aborta si `service_role` perdió TRUNCATE o
--      si `authenticated` perdió SELECT sobre `productos` o `familias` — es
--      decir, falla si el REVOKE alcanzó a alguien que no era su objetivo.
--
--   3. ¿Decide qué cerrar/borrar/desactivar en función de la AUSENCIA de
--      datos (P17, la lección de la 0015)?
--      **NO cierra ni borra nada, ni con datos ni sin ellos.** Y si la
--      derivación de tablas volviera vacía, ABORTA ("escáner roto, no
--      verde") en vez de dar por bueno el silencio.
--      **MATIZ, porque la respuesta corta se quedaba corta:** lo que sí
--      depende del universo son CUATRO VEREDICTOS de la guarda — si el
--      TRUNCATE ya estaba en 0, si la RPC ya devolvía la forma neutra, si
--      las columnas ya existían, y si `pendientes_datos` no tiene abiertos.
--      En los cuatro casos el verde no prueba nada, y por eso los cuatro
--      llevan su `AVISO ANTI-VACUIDAD` explícito. El cuarto faltaba y era
--      el caro: sin él, una guarda que le apagara la bandeja al admin
--      pasaba en verde sobre una base sin pendientes abiertos —replay
--      limpio o post-resolución— afirmando lo contrario de lo que ocurría.
--
-- Aplicar con:
--   node --env-file=.env.db.local scripts/aplicar-migracion.mjs \
--     supabase/migrations/0020_repro_truncate_guarda_pendientes_creado_en.sql \
--     --irreversibilidad="No: cero DELETE/UPDATE de filas; privilegios y
--       metadatos, todos reversibles. Lo único no reconstruible es el sello
--       now() de familias.creado_en, declarado como fecha falsa en el COMMENT."
--
-- ============================================================
-- NOTA DE ABSORCIÓN DE LA 0016 · [S7-B] · 2026-08-07
-- Ratificada en (ver docs/decisions/0005-migration-guards-and-replay.md).
--
-- La migración 0016 (truncate y constraint portante)
-- SE RETIRA DEL DISCO. Se escribió, se revisó y **nunca se aplicó**; su
-- contenido lo absorbió esta migración. Si se quedara en disco, un replay
-- aplicaría 0016 **y** 0020 y la base reconstruida tendría un ledger de 21
-- entradas contra las 20 de producción: dos bases con ledgers distintos
-- rompen exactamente la promesa de este bloque.
--
-- DÓNDE QUEDÓ (no hace falta copia):
--   · estuvo en el historial del repositorio de origen; esta copia no la conserva.
--
--   · (los identificadores de commit y de blob se omiten en esta copia)
--   · su contenido íntegro está absorbido en las piezas (1a) y (1b) de abajo
--
--
-- ------------------------------------------------------------
-- QUÉ CONTENÍA LA 0016, PUNTO POR PUNTO, Y QUÉ PASÓ CON CADA COSA
-- ------------------------------------------------------------
-- (A) `COMMENT ON CONSTRAINT snapshots_hash_unique` (0016:34-42).
--     → **ABSORBIDO VERBATIM** en la pieza (1a) de abajo. Contrastado con
--       `diff` sobre las 9 líneas de la sentencia, normalizando solo la
--       sangría (la 0020 la indenta un nivel más): 0 diferencias. El texto
--       que acaba en el catálogo es byte a byte el mismo.
--     → 0020 AÑADE lo que la 0016 no tenía: una guarda que exige que el
--       COMMENT exista tras aplicar (pieza 1 de la guarda final).
--
-- (B) REVOKE TRUNCATE a `anon`/`authenticated` sobre las tablas de
--     `public` (0016:76-79).
--     → **ABSORBIDO**, con el mecanismo cambiado:
--       · 0016 iteraba `pg_tables`; 0020 itera `pg_class` con
--         `relkind IN ('r','p')`, que además cubre tablas particionadas.
--       · 0016 verificaba con `information_schema.role_table_grants`
--         (que solo lista entradas explícitas del ACL); 0020 verifica con
--         `has_table_privilege`, que es el privilegio EFECTIVO.
--     → **DESCARTADA** su cifra literal de tablas (0016:49). Estaba
--       obsoleta antes de nacer: la 0018 ya le había revocado TRUNCATE a
--       `familia_alias` por su cuenta. 0020 la deriva en vivo. La
--       consecuencia de descartarla es NINGUNA pérdida de cobertura: una
--       cifra escrita a mano no protegía nada, solo envejecía.
--
-- (C) Controles de la 0016 (0016:96-107): AVISO si el conteo ya era 0,
--     `authenticated` conserva SELECT sobre `productos`, `service_role`
--     conserva INSERT.
--     → **ABSORBIDOS los tres** y AMPLIADOS: 0020 añade la foto del ANTES
--       por GUC, el AVISO ANTI-VACUIDAD formal, `authenticated` conserva
--       SELECT sobre `familias`, y `service_role` conserva TRUNCATE.
--
-- (D) LAS 3 MENCIONES A `ingest_snapshot` DE LA 0016 — dicho explícito
--     porque es lo que más fácil se pierde en una absorción:
--       1. 0016:19  (prosa)   → absorbida en la prosa de la pieza (1a).
--       2. 0016:38  (COMMENT) → absorbida verbatim en el COMMENT.
--       3. 0016:40  (COMMENT) → absorbida verbatim en el COMMENT.
--     → **LAS TRES ESTÁN ABSORBIDAS. NINGUNA SE DESCARTÓ.** Las tres son
--       texto explicativo sobre por qué `snapshots_hash_unique` es la red
--       del reintento de escrituras; la 0016 **no ejecutaba** nada sobre
--       `ingest_snapshot` (ni CREATE, ni REPLACE, ni GRANT, ni PERFORM).
--       Comprobación exacta, con la 0016 recuperada de git:
--         (hecha con la 0016 recuperada del historial del repositorio de origen:
--           3 líneas mencionan ingest_snapshot: la 19, la 38 y la 40)
--       Sus contrapartes aquí son la prosa de (1a) y las dos líneas del
--       `COMMENT ON CONSTRAINT`. **AVISO para quien repita el conteo en
--       ESTE archivo: no da 3.** Hay dos menciones más que NO vienen de la
--       0016 — una en el `COMMENT ON COLUMN` de `familias.creado_por`
--       («ningún camino de escritura la puebla: ingest_snapshot,
--       aplicar_clasificacion_v2 y resolver_pendiente insertan solo
--       nombre») y las de esta misma nota. Contar líneas aquí NO es la
--       verificación; comparar las 3 de allá contra sus 3 destinos, sí.
--     → CONSECUENCIA DE RETIRAR LA 0016 SOBRE `ingest_snapshot`: NINGUNA.
--       La última redefinición vigente de esa función es la de
--       `0019_mvp2_familia_nueva.sql` (y la 0022 parte de ella), que no
--       depende en nada de la 0016.
--
-- LO QUE ESTA NOTA NO PUEDE COMPROBAR DESDE AQUÍ (P16): que el ledger de
-- migraciones de la base tenga 20 entradas y no 21. Este archivo no lee el
-- ledger; lo verifica `scripts/verificar-migracion.mjs` y la compuerta G-d.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (0) FOTO DEL ANTES — para que la guarda final pueda decir si esta
--     migración cambió algo o llegó tarde.
--
--     Una guarda que solo mira el DESPUÉS pasa por verde cuando el efecto
--     ya estaba: eso es exactamente lo que el control anti-vacuidad de la
--     0017/0018 y de `guarda-lista-blanca.mjs` vinieron a matar. Los
--     valores viajan a la guarda final en GUCs LOCALES a esta transacción
--     (`is_local := true`), así que mueren con el COMMIT o el ROLLBACK y
--     no ensucian la sesión.
-- ------------------------------------------------------------
DO $antes0020$
DECLARE
  v_auth      integer;
  v_anon      integer;
  v_pend      jsonb;
  v_columnas  integer;
  v_defpg     integer;
  v_defotros  text;
BEGIN
  -- La lista se DERIVA de pg_class EN VIVO, nunca se escribe a mano. La 0016
  -- decía "19 tablas"; hoy son 20 base y 19 con el privilegio, porque la 0018
  -- ya le revocó TRUNCATE a `familia_alias` por su cuenta (0018:311). Una
  -- lista congelada habría dejado fuera esa diferencia sin que nadie se
  -- entere — que es justo la disciplina de `scripts/guarda-lista-blanca.mjs`.
  SELECT count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
         count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRUNCATE'))
    INTO v_auth, v_anon
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p');

  -- El estado PREVIO de la fuga de `contar_pendientes()`: esta conexión de
  -- migración NO lleva JWT, así que `auth.uid()` es NULL y `is_admin()` es
  -- false. Si HOY devuelve contenido, la fuga está viva y la pieza (2) tiene
  -- algo real que cerrar.
  v_pend := public.contar_pendientes();

  SELECT count(*) INTO v_columnas
    FROM pg_attribute a
   WHERE a.attrelid = 'public.familias'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname IN ('creado_en','creado_por');

  -- [S7-B] El estado PREVIO del default ACL de `postgres` sobre
  -- `public`/tablas. Es el ANTES que hace falsificable la guarda de la
  -- pieza (1c): sin él, «hoy no concede D» pasa igual de verde en una base
  -- donde nunca lo concedió (y ahí el ALTER no habría cerrado nada).
  -- Medido contra producción: concesiones vivas
  -- (anon y authenticated) bajo el dueño `postgres`.
  SELECT count(*) INTO v_defpg
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND pg_get_userbyid(d.defaclrole) = 'postgres'
     AND a.privilege_type = 'TRUNCATE'
     AND pg_get_userbyid(a.grantee) IN ('anon','authenticated');

  -- Y quiénes MÁS lo conceden, derivado en vivo y no escrito a mano: es la
  -- lista de dueños cuyo default esta migración NO toca.
  SELECT string_agg(DISTINCT pg_get_userbyid(d.defaclrole), ', ')
    INTO v_defotros
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND pg_get_userbyid(d.defaclrole) <> 'postgres'
     AND a.privilege_type = 'TRUNCATE'
     AND pg_get_userbyid(a.grantee) IN ('anon','authenticated');

  PERFORM set_config('demo.mig0020_trunc_auth_antes', v_auth::text, true);
  PERFORM set_config('demo.mig0020_trunc_anon_antes', v_anon::text, true);
  PERFORM set_config('demo.mig0020_pend_antes',       v_pend::text, true);
  PERFORM set_config('demo.mig0020_fam_cols_antes',   v_columnas::text, true);
  PERFORM set_config('demo.mig0020_defacl_pg_antes',  v_defpg::text, true);

  RAISE NOTICE '0020 · ANTES · TRUNCATE: % tabla(s) para authenticated, % para anon.', v_auth, v_anon;
  RAISE NOTICE '0020 · ANTES · contar_pendientes() SIN JWT devolvió: %', v_pend;
  RAISE NOTICE '0020 · ANTES · familias tiene % de las 2 columnas de autoría.', v_columnas;
  RAISE NOTICE '0020 · ANTES · default ACL de `postgres` sobre public/tablas: % concesión(es) de TRUNCATE a anon/authenticated. Otros dueños que también lo conceden: %.',
    v_defpg, coalesce(v_defotros, '(ninguno)');
  RAISE NOTICE '0020 · ANTES · el rol que está aplicando esta migración es current_user=% (session_user=%). El `FOR ROLE postgres` de la pieza (1c) solo cierra el default de ESE dueño; si las tablas del proyecto las creara otro rol, el ALTER no las cubriría.',
    current_user, session_user;
END $antes0020$;

-- ------------------------------------------------------------
-- (1a) `snapshots_hash_unique` es una PIEZA PORTANTE. Que lo diga la base.
--      [Reusado íntegro de `0016_mvp_cierre_truncate_y_constraint_portante.sql`,
--       escrita y nunca aplicada.]
--
--      Historia: el reintento de F1 se extendió a las escrituras con este
--      argumento — "un 401 significa que `ingest_snapshot` nunca corrió, y
--      aun si esa premisa fallara, la RPC es idempotente por hash". La
--      segunda mitad era FALSA: la función no compara ningún hash. Lo
--      verificó la auditoría adversarial leyendo la definición desplegada.
--
--      El resultado neto era seguro, pero por otro mecanismo: es ESTE
--      constraint el que hace fallar un segundo intento con 23505 y
--      ROLLBACK. No vuelve la escritura inocua — la impide.
--
--      Consecuencia operativa, que es lo que importa: quitar este constraint
--      ya no es una decisión sobre duplicados de hash. Es quitarle la red al
--      reintento de escrituras de `/api/refresh` y `/api/refresh/archivo`.
--      Un comentario en el código no lo protege: quien vaya a tirarlo estará
--      mirando la BASE, no `reintento.ts`. Por eso el aviso vive aquí.
-- ------------------------------------------------------------
COMMENT ON CONSTRAINT snapshots_hash_unique ON public.snapshots IS
  'PIEZA PORTANTE — no quitar sin leer esto. Ademas de impedir snapshots '
  'duplicados, es la red de seguridad del reintento de ESCRITURAS de '
  '[MVP-CIERRE] F1 (src/lib/supabase/reintento.ts): si un 401 transitorio '
  'llegara a reintentarse sobre un ingest_snapshot que SI corrio, es este '
  'UNIQUE el que aborta el segundo intento con 23505 + ROLLBACK. '
  'ingest_snapshot NO compara ningun hash por su cuenta: esa idempotencia '
  'vive en JS (runEtl, via sinCambios), no en la RPC. Quitar este '
  'constraint deja el reintento de escrituras sin respaldo.';

-- ------------------------------------------------------------
-- (1b) TRUNCATE que nadie pidió, sobre TODAS las tablas base de `public`.
--      [Reusado de la 0016; su CIFRA "19 tablas" está obsoleta y se sustituye
--       por una derivación en vivo, que es la única que no envejece.]
--
--      `anon` y `authenticated` lo tienen por el GRANT por defecto de
--      Supabase, no por una decisión de este proyecto.
--
--      NO es alcanzable por PostgREST —no expone ese verbo— así que no es un
--      hallazgo explotable hoy. Pero TRUNCATE **no está sujeto a RLS**: toda
--      la defensa del proyecto (políticas por rol, `is_admin()`, fail-closed)
--      es irrelevante frente a él. Es un privilegio que nadie usa, que nadie
--      eligió, y cuyo peor caso es el vaciado de una tabla sin que ninguna
--      política pueda decir nada.
--
--      NO se le toca a `service_role`: es el rol con el que escribe el ETL.
--
--      LÍMITE DECLARADO, medido en `pg_default_acl` y no en la intuición:
--      hay DOS default ACLs vivos sobre `public` (uno de `postgres`, otro de
--      `supabase_admin`) que incluyen `D`. Este REVOKE barre las tablas que
--      existen AHORA; **toda tabla nueva vuelve a nacer con TRUNCATE**, la
--      cree quien la cree. Es el mismo matiz que ya obligó a la 0018 a
--      revocar `familia_alias` por su cuenta (0018:308-311).
--
--      [S7-B · 2026-08-07] ESE LÍMITE SE CIERRA A MEDIAS EN LA PIEZA (1c),
--      unas líneas más abajo — se ratificó tocar el default de
--      `postgres` y NO el de `supabase_admin`. Lo que queda abierto después
--      de (1c) está escrito allí y en la guarda final, con nombre y
--      apellido, en vez de quedar como un «ya lo cerramos».
-- ------------------------------------------------------------
DO $truncate0020$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM anon, authenticated', r.relname);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN
    RAISE EXCEPTION '0020: la derivación en vivo no devolvió NINGUNA tabla base en public — imposible en este proyecto. Escáner roto, no verde. Abortando.';
  END IF;

  RAISE NOTICE '0020 · REVOKE TRUNCATE emitido sobre % tabla(s) derivadas de pg_class.', v_n;
END $truncate0020$;

-- ------------------------------------------------------------
-- (1c) [S7-B · 2026-08-07] EL DEFAULT QUE REABRE LA FUGA.
--      Ratificado en (ver docs/decisions/0007-privilege-guards-inside-functions.md), decisión 1.
--
--      MEDIDO, no supuesto: `pg_default_acl` tiene DOS entradas para
--      `public` / tipo `r` (tablas) —dueño `postgres` y dueño
--      `supabase_admin`— y AMBAS conceden `arwdDxtm` a `anon` y a
--      `authenticated`. La `D` de esa cadena es TRUNCATE. Consecuencia:
--      toda tabla NUEVA en `public` nace con el hueco, y el REVOKE de (1b)
--      es limpieza de una vez que no impide la regresión. Ya pasó: la 0018
--      tuvo que revocarle TRUNCATE a `familia_alias` por su cuenta.
--
--      ALCANCE `FOR ROLE postgres` Y NADA MÁS. Es el rol con el que
--      `scripts/aplicar-migracion.mjs` aplica y, por tanto, el dueño de las
--      tablas que crea este proyecto.
--
--      **EL DEFAULT DE `supabase_admin` NO SE TOCA** — instrucción expresa
--      de producto. Es configuración de plataforma y no crea tablas nuestras.
--      RESIDUAL CONOCIDO Y ACEPTADO, que la guarda final vuelve a decir en
--      voz alta: una tabla creada POR `supabase_admin` en `public` seguirá
--      naciendo con TRUNCATE para `anon`/`authenticated`. No es un
--      descuido: es una decisión, y queda escrita para que nadie la
--      redescubra creyendo que la fuga estaba cerrada del todo.
--
--      REVERSIÓN, una línea:
--        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--          GRANT TRUNCATE ON TABLES TO anon, authenticated;
--
--      IDEMPOTENTE: `ALTER DEFAULT PRIVILEGES ... REVOKE` sobre un
--      privilegio ya ausente no es error, no toca nada y no avisa.
-- ------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- ------------------------------------------------------------
-- (2) Guarda `is_admin()` DENTRO de `contar_pendientes()`.
--     §P1 de la ratificación. `REVOKE EXECUTE` está DESCARTADO.
--
--     POR QUÉ DEVUELVE 0 Y NO UN ERROR — y por qué la alternativa tiraba la
--     pantalla de aterrizaje entera:
--       · `/api/dashboard` pasa por `requireSession` (cualquier rol), no por
--         `requireAdminSession`.
--       · `dashboard.service.ts:787-795` solo tolera los códigos de
--         `esNoDisponiblePorMigracion` = {42P01, 42883, PGRST202, PGRST205}
--         (`pg-errors.ts:57`). **`42501` NO está en ese set.**
--       · Con `REVOKE EXECUTE`, un KAM o un Visitante habría recibido 42501
--         → `throw` → 500 en la pantalla de aterrizaje completa, no una
--         insignia menos.
--     La tarjeta ya tiene su copy para ese rol («Los gestiona el
--     administrador»), así que un cero se pinta coherente.
--     NO se toca `pg-errors.ts` ni el set de tolerancia.
--
--     CAMBIO DE LENGUAJE, DECLARADO: la función vigente es `LANGUAGE sql`
--     (medido con `pg_get_functiondef`, no leído de la 0009). La forma
--     RATIFICADA de la guarda —`IF NOT public.is_admin() THEN RETURN … END
--     IF;`— es sintaxis plpgsql y no existe en SQL puro. Se convierte a
--     `LANGUAGE plpgsql` para poder escribirla LITERAL, en vez de traducirla
--     a un `CASE` que ya no sería la forma ratificada. Todo lo demás se
--     conserva: firma `()`, retorno `jsonb`, `STABLE`, `SECURITY DEFINER`,
--     `SET search_path = pg_catalog, public`, y el cuerpo palabra por
--     palabra (solo `SELECT` → `RETURN`).
--
--     CUERPO VIGENTE ANTES DE ESTA MIGRACIÓN, para poder deshacerlo sin ir a
--     buscarlo (copia literal de `pg_get_functiondef`):
--
--       CREATE OR REPLACE FUNCTION public.contar_pendientes()
--        RETURNS jsonb
--        LANGUAGE sql
--        STABLE SECURITY DEFINER
--        SET search_path TO 'pg_catalog', 'public'
--       AS $function$
--         SELECT jsonb_build_object(
--           'abiertos', (SELECT count(*) FROM public.pendientes_datos WHERE estado='abierto'),
--           'por_tipo', coalesce((SELECT jsonb_object_agg(tipo, c) FROM (
--               SELECT tipo, count(*) c FROM public.pendientes_datos
--               WHERE estado='abierto' GROUP BY tipo) t), '{}'::jsonb));
--       $function$
--
--     LOS DOS LLAMADORES, medidos: `/api/dashboard` y `/api/pendientes` usan
--     los dos `createSupabaseSessionClient()` — el JWT del usuario, NUNCA
--     `service_role`. Por eso la guarda discrimina por persona y no apaga la
--     bandeja del admin. Si algún día un llamador pasara a service_role,
--     `auth.uid()` sería NULL y esta función devolvería 0 al admin: queda
--     escrito aquí porque es el modo de fallo silencioso de este diseño.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contar_pendientes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $contar_pendientes$
BEGIN
  -- Forma RATIFICADA. No cambiar por un error: 42501 no está tolerado.
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('abiertos', 0, 'por_tipo', '{}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'abiertos', (SELECT count(*) FROM public.pendientes_datos WHERE estado='abierto'),
    'por_tipo', coalesce((SELECT jsonb_object_agg(tipo, c) FROM (
        SELECT tipo, count(*) c FROM public.pendientes_datos
        WHERE estado='abierto' GROUP BY tipo) t), '{}'::jsonb));
END;
$contar_pendientes$;

-- Mismo cierre de privilegios que ya está vigente (`{authenticated=X,
-- service_role=X}`), re-emitido para que NO dependa de que
-- `CREATE OR REPLACE` preserve el ACL: `authenticated` DEBE conservar el
-- EXECUTE — si lo perdiera, el 42501 que se acaba de descartar entraría por
-- la puerta de atrás y el dashboard daría 500.
REVOKE ALL   ON FUNCTION public.contar_pendientes() FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.contar_pendientes() FROM anon;
GRANT EXECUTE ON FUNCTION public.contar_pendientes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.contar_pendientes() TO service_role;

-- ------------------------------------------------------------
-- (3) `familias.creado_en` + `familias.creado_por`.
--     §P2 de la ratificación. Hoy no hay forma de auditar quién creó una
--     familia ni cuándo; lo más que se pudo dar fue una heurística por
--     `ctid`.
--
--     TAXO-10 (una columna nueva en una tabla con lista blanca nace SIN
--     GRANT) NO aplica aquí: S1 midió `select_de_tabla = TRUE` y
--     `columnas_con_acl_propio = 0` para `familias`, así que la columna nace
--     legible. **Se verifica igual en la guarda final** con
--     `has_column_privilege`, que es obligatorio por P16 y no opcional: el
--     costo es una consulta y el beneficio es no repetir P16.
-- ------------------------------------------------------------
ALTER TABLE public.familias ADD COLUMN IF NOT EXISTS creado_en  timestamptz DEFAULT now();
ALTER TABLE public.familias ADD COLUMN IF NOT EXISTS creado_por text;

-- El COMMENT se arma con el SELLO REAL de esta migración en vez de decir "el
-- timestamp de la 0020" en abstracto: quien lea la columna dentro de un año
-- necesita la fecha, no la referencia. El sello se recupera de la propia
-- columna (`min(creado_en)`), así que re-aplicar esta migración reconstruye
-- el MISMO texto en vez de estampar una fecha nueva y falsa.
DO $familias0020$
DECLARE
  v_sello    timestamptz;
  v_selladas bigint;
BEGIN
  SELECT min(creado_en) INTO v_sello FROM public.familias;
  v_sello := coalesce(v_sello, now());
  SELECT count(*) INTO v_selladas FROM public.familias WHERE creado_en <= v_sello;

  EXECUTE format(
    'COMMENT ON COLUMN public.familias.creado_en IS %L',
    '[0020] Fecha de alta de la familia. AVISO — FECHA FALSA EN LAS FILAS '
    || 'HISTORICAS: la columna nacio con DEFAULT now(), asi que las '
    || v_selladas::text || ' familia(s) que ya existian al aplicar la 0020 '
    || 'quedaron TODAS estampadas con el instante de la migracion ('
    || to_char(v_sello AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    || ' UTC = ' || to_char(v_sello AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD HH24:MI:SS')
    || ' CDMX). REGLA DE LECTURA: creado_en <= ese sello significa '
    || '"preexistente, fecha real desconocida", NO la fecha en que se creo la '
    || 'familia. Solo los valores ESTRICTAMENTE POSTERIORES al sello son '
    || 'fechas de alta reales. Y AUN ESOS SON INDICATIVOS, NO PRUEBA: esta '
    || 'columna NACE FALSIFICABLE. familias no tiene NINGUN trigger, y la '
    || 'policy familias_admin_update (using/check = is_admin()) mas el GRANT '
    || 'de UPDATE de tabla dejan que cualquier admin le escriba la fecha que '
    || 'quiera por PostgREST. El proyecto SI sabe hacer lo contrario cuando '
    || 'hace falta: la inmutabilidad del SKU la sostiene el trigger '
    || 'protect_sku_immutable sobre productos. Aqui no se construyo ninguno '
    || '(fuera del alcance de la 0020), asi que esto es un dato informativo, '
    || 'no una bitacora a prueba de manipulacion.');

  EXECUTE format(
    'COMMENT ON COLUMN public.familias.creado_por IS %L',
    '[0020] Quien dio de alta la familia. NULL en las ' || v_selladas::text
    || ' fila(s) historicas (autoria desconocida) y NULL tambien en toda alta '
    || 'posterior que no la escriba: al aplicar la 0020 NINGUN camino de '
    || 'escritura la puebla todavia (ingest_snapshot, aplicar_clasificacion_v2 '
    || 'y resolver_pendiente insertan en familias solo la columna nombre). '
    || 'Mientras siga asi, un NULL NO distingue "preexistente" de "creada por '
    || 'el ETL": poblarla es trabajo pendiente, no un efecto de esta migracion. '
    || 'Y cuando se pueble, NO sera una firma: igual que creado_en, esta '
    || 'columna nace FALSIFICABLE — sin trigger que la proteja y con '
    || 'familias_admin_update (is_admin()) por delante, cualquier admin puede '
    || 'escribir cualquier autor por PostgREST. Es autoria declarada, no '
    || 'autoria verificada.');

  RAISE NOTICE '0020 · familias.creado_en sellado en % para % fila(s) preexistente(s).', v_sello, v_selladas;
END $familias0020$;

-- PostgREST cachea el esquema y los privilegios. El event trigger
-- `pgrst_ddl_watch` (medido, vivo, ddl_command_end) ya emite este mismo
-- NOTIFY por su cuenta ante el DDL de arriba; se repite explícito como
-- defensa en profundidad, porque si el cache no se recarga las dos columnas
-- nuevas no existen para `/rest/v1/familias` y el check 3 de
-- la verificación HTTP de la 0020 seguiría en rojo con la migración aplicada.
-- Dentro de una transacción el NOTIFY se entrega en el COMMIT: en un ensayo
-- con ROLLBACK no sale, que es justo lo que se quiere.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- (4) GUARDA DEL EFECTO REAL — patrón P16, molde de 0017/0018/0019.
--
--     Comprueba lo que SÍ es comprobable desde aquí, y DECLARA con NOTICE
--     lo que no. Una guarda que verifica el mecanismo y asume el efecto no
--     es una guarda: por eso la pieza (2) no se conforma con "el cuerpo
--     contiene is_admin", sino que EJECUTA la función en los TRES casos que
--     importan —sin sesión, con un perfil real no-admin y con un admin
--     real— y compara cada uno contra el conteo directo de la tabla.
-- ------------------------------------------------------------
DO $guarda0020$
DECLARE
  v_auth_antes  integer;
  v_anon_antes  integer;
  v_pend_antes  jsonb;
  v_cols_antes  integer;
  v_defpg_antes integer;
  v_defpg       integer;
  v_defpg_quien text;
  v_defotr      integer;
  v_defotr_quien text;

  v_auth        integer;
  v_anon        integer;
  v_restantes   text;
  v_total       integer;

  v_oid         oid;
  v_src         text;
  v_frag        text[] := ARRAY[
                   'is_admin',
                   'pendientes_datos',
                   'jsonb_object_agg',
                   'abiertos',
                   'por_tipo',
                   'GROUP BY tipo',
                   'coalesce',
                   $q$estado='abierto'$q$
                 ];
  v_f           text;

  v_jwt_prev    text;
  v_sub_prev    text;
  v_admin       uuid;
  v_no_admin    uuid;
  v_neutro      jsonb;
  v_como_admin  jsonb;
  v_reales      bigint;

  v_defacl      integer;
  v_col_acl     integer;
  v_tipo        text;

  -- Cuenta los veredictos que salieron sobre un universo vacío, los que no
  -- se pudieron medir y —desde [S7-B]— los RESIDUALES CONOCIDOS que esta
  -- migración decide NO cerrar. Sin esto, el "GUARDA VERDE" final suena
  -- igual de rotundo con 0 reservas que con 4, y es justo la diferencia
  -- entre "probado" y "no contradicho".
  v_reservas    integer := 0;
BEGIN
  -- `nullif(…,'')` NO es adorno, y la razón es más estrecha de lo que
  -- parece. Medido sobre un GUC personalizado nuevo, en una sola sesión:
  --   A) primera lectura, jamás tocado ............ NULL
  --   B) dentro de la tx, tras set_config(local) ... '19'
  --   C) DESPUÉS del ROLLBACK, misma sesión ........ ''     ← el único ''
  -- O sea: nunca seteado devuelve NULL, no cadena vacía. La cadena vacía
  -- aparece SOLO cuando un intento previo en la MISMA sesión definió el
  -- parámetro y se revirtió — que es exactamente el caso de un reintento
  -- tras una migración fallida, o de un ensayo BEGIN/ROLLBACK seguido de la
  -- aplicación real por la misma conexión. Sin `nullif`, ese caso C revienta
  -- con 22P02 ("invalid input syntax for type integer") ANTES de llegar al
  -- IF de abajo: aborta igual (fail-closed), pero con un mensaje que no le
  -- dice a nadie que lo que faltó fue la foto del ANTES. Con `nullif`, A y C
  -- caen los dos en el IF y sale el mensaje correcto. Lo destapó el control
  -- negativo N9.
  v_auth_antes  := nullif(current_setting('demo.mig0020_trunc_auth_antes', true), '')::integer;
  v_anon_antes  := nullif(current_setting('demo.mig0020_trunc_anon_antes', true), '')::integer;
  v_pend_antes  := nullif(current_setting('demo.mig0020_pend_antes', true), '')::jsonb;
  v_cols_antes  := nullif(current_setting('demo.mig0020_fam_cols_antes', true), '')::integer;
  v_defpg_antes := nullif(current_setting('demo.mig0020_defacl_pg_antes', true), '')::integer;

  IF v_auth_antes IS NULL OR v_anon_antes IS NULL OR v_pend_antes IS NULL OR v_cols_antes IS NULL
     OR v_defpg_antes IS NULL THEN
    RAISE EXCEPTION '0020: la foto del ANTES no llegó a la guarda — el bloque (0) no corrió. Sin ella no hay control anti-vacuidad. Abortando.';
  END IF;

  -- ==========================================================
  -- PIEZA 1 · TRUNCATE en CERO
  -- ==========================================================
  SELECT count(*) FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
         count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'TRUNCATE')),
         count(*),
         string_agg(c.relname, ', ' ORDER BY c.relname)
           FILTER (WHERE has_table_privilege('authenticated', c.oid, 'TRUNCATE')
                      OR has_table_privilege('anon', c.oid, 'TRUNCATE'))
    INTO v_auth, v_anon, v_total, v_restantes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p');

  IF v_total = 0 THEN
    RAISE EXCEPTION '0020: la guarda no vio NINGUNA tabla base en public. Escáner roto, no verde. Abortando.';
  END IF;

  IF v_auth <> 0 OR v_anon <> 0 THEN
    RAISE EXCEPTION '0020: quedan tablas con TRUNCATE tras el REVOKE (authenticated: %, anon: %, de % medidas): %. Abortando.',
      v_auth, v_anon, v_total, v_restantes;
  END IF;

  -- Control anti-vacuidad: si ya estaba en 0 ANTES, esta pieza no revocó
  -- nada y su verificación pasaría por inútil.
  IF v_auth_antes = 0 AND v_anon_antes = 0 THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · AVISO ANTI-VACUIDAD: TRUNCATE ya estaba en 0 ANTES de correr — la pieza (1) no revocó nada y su verde no prueba nada.';
  ELSE
    RAISE NOTICE '0020 · PIEZA 1 VERDE: TRUNCATE de % a 0 para authenticated y de % a 0 para anon, sobre % tabla(s).',
      v_auth_antes, v_anon_antes, v_total;
  END IF;

  -- Que el REVOKE no se haya llevado nada más por delante.
  IF NOT has_table_privilege('authenticated', 'public.productos', 'SELECT') THEN
    RAISE EXCEPTION '0020: el REVOKE tocó más de lo debido — authenticated perdió SELECT sobre productos. Abortando.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.familias', 'SELECT') THEN
    RAISE EXCEPTION '0020: authenticated perdió SELECT sobre familias — el catálogo entero dejaría de leerse. Abortando.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.productos', 'INSERT') THEN
    RAISE EXCEPTION '0020: service_role perdió INSERT sobre productos — el ETL no podría escribir. Abortando.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.productos', 'TRUNCATE') THEN
    RAISE EXCEPTION '0020: service_role perdió TRUNCATE — el REVOKE alcanzó a un rol que no era su objetivo. Abortando.';
  END IF;

  -- El COMMENT portante de la 0016, que viajaba con el REVOKE.
  IF (SELECT obj_description(con.oid, 'pg_constraint')
        FROM pg_constraint con
       WHERE con.conrelid = 'public.snapshots'::regclass
         AND con.conname = 'snapshots_hash_unique') IS NULL THEN
    RAISE EXCEPTION '0020: snapshots_hash_unique quedó sin su COMMENT de pieza portante. Abortando.';
  END IF;

  -- ==========================================================
  -- PIEZA 1c · el DEFAULT de `postgres` ya no concede TRUNCATE
  --
  -- Se lee `pg_default_acl` DESPUÉS del ALTER y se exige CERO para el
  -- dueño `postgres`. No se comprueba «que el ALTER corrió» —eso sería
  -- verificar el mecanismo y asumir el efecto, P16— sino el catálogo que
  -- decide con qué ACL nace la próxima tabla.
  --
  -- ANTI-VACUIDAD (P19) · EL ESTADO QUE PONE ESTA GUARDA EN ROJO:
  --   borrar (o desviar a otro rol) la sentencia `ALTER DEFAULT
  --   PRIVILEGES FOR ROLE postgres` de la pieza (1c) y aplicar contra una
  --   base cuyo default de `postgres` sí concede `D`. Ese es el estado
  --   MEDIDO en producción (concesiones vivas: anon y
  --   authenticated), así que el rojo no es hipotético: es el estado de
  --   partida real de esta migración. Si `v_defpg_antes` llegara en 0, la
  --   guarda se vuelve vacua y lo dice con su AVISO en vez de sumar un
  --   verde que no probó nada.
  -- ==========================================================
  SELECT count(*), string_agg(DISTINCT pg_get_userbyid(a.grantee), ', ')
    INTO v_defpg, v_defpg_quien
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND pg_get_userbyid(d.defaclrole) = 'postgres'
     AND a.privilege_type = 'TRUNCATE'
     AND pg_get_userbyid(a.grantee) IN ('anon','authenticated');

  IF v_defpg <> 0 THEN
    RAISE EXCEPTION '0020 (1c): el default ACL de `postgres` sobre public/tablas SIGUE concediendo TRUNCATE a % (% concesión(es)) después del ALTER DEFAULT PRIVILEGES. Toda tabla nueva seguiría naciendo con el hueco. El ALTER no surtió efecto. Abortando.',
      coalesce(v_defpg_quien, '(?)'), v_defpg;
  END IF;

  IF v_defpg_antes = 0 THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · AVISO ANTI-VACUIDAD (pieza 1c): el default de `postgres` YA no concedía TRUNCATE ANTES de correr. El ALTER no cerró nada y este verde no prueba que la regresión esté cerrada — solo que hoy no está abierta por esa vía.';
  ELSE
    RAISE NOTICE '0020 · PIEZA 1c VERDE: el default ACL de `postgres` sobre public/tablas pasó de % concesión(es) de TRUNCATE a anon/authenticated a 0. Las tablas que cree ese rol ya nacen sin el hueco.', v_defpg_antes;
  END IF;

  -- RESIDUAL DECLARADO, NO ASUMIDO. Se deriva en vivo quiénes MÁS lo
  -- conceden; hoy, por decisión del PO, `supabase_admin` queda fuera del
  -- alcance de esta migración. Si mañana apareciera un tercer dueño, este
  -- NOTICE lo nombra solo.
  SELECT count(*), string_agg(DISTINCT pg_get_userbyid(d.defaclrole), ', ')
    INTO v_defotr, v_defotr_quien
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND pg_get_userbyid(d.defaclrole) <> 'postgres'
     AND a.privilege_type = 'TRUNCATE'
     AND pg_get_userbyid(a.grantee) IN ('anon','authenticated');

  IF v_defotr > 0 THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · RESIDUAL CONOCIDO Y ACEPTADO (pieza 1c), por decisión expresa del PO: el/los default(s) ACL de % SIGUEN concediendo TRUNCATE a anon/authenticated sobre public/tablas (% concesión(es) vivas). NO se tocan: es configuración de plataforma de Supabase. CONSECUENCIA CONCRETA, que queda ESCRITA y no supuesta: una tabla creada en `public` POR ESE ROL nacerá otra vez con TRUNCATE para anon y authenticated, y esta migración no lo impedirá. Quien cree una tabla así debe revocarlo en su propia migración, como hizo la 0018 con familia_alias.',
      coalesce(v_defotr_quien, '(?)'), v_defotr;
  ELSE
    RAISE NOTICE '0020 · pieza 1c: ningún OTRO dueño de default ACL concede TRUNCATE a anon/authenticated sobre public/tablas. El residual que el PO decidió no tocar no existe en ESTA base — si esta es producción, algo cambió respecto de la medición del 5-ago-2026 y hay que volver a mirarlo.';
  END IF;

  -- ==========================================================
  -- PIEZA 2 · contar_pendientes() — mecanismo Y efecto
  -- ==========================================================
  SELECT p.oid, p.prosrc INTO v_oid, v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'contar_pendientes'
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0020: contar_pendientes() no quedó creada con la firma esperada. Abortando.';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '0020: contar_pendientes NO es SECURITY DEFINER — dejaría de leer pendientes_datos, que es admin-only por RLS. Abortando.';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = v_oid) <> 's' THEN
    RAISE EXCEPTION '0020: contar_pendientes dejó de ser STABLE. Abortando.';
  END IF;
  IF (SELECT pg_get_function_result(v_oid)) <> 'jsonb' THEN
    RAISE EXCEPTION '0020: contar_pendientes ya no devuelve jsonb — los dos llamadores esperan {abiertos, por_tipo}. Abortando.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0020: anon puede EJECUTAR contar_pendientes. Abortando.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0020: authenticated NO puede ejecutar contar_pendientes — sería 42501, que NO está en CODIGOS_NO_DISPONIBLE_POR_MIGRACION, y /api/dashboard daría 500 para KAM y Visitante. Abortando.';
  END IF;

  -- "Verifica después que no perdiste nada": cada fragmento del cuerpo
  -- vigente tiene que seguir ahí. Un CREATE OR REPLACE sustituye la función
  -- ENTERA, así que olvidar una línea es silencioso.
  FOREACH v_f IN ARRAY v_frag LOOP
    IF position(v_f in v_src) = 0 THEN
      RAISE EXCEPTION '0020: el cuerpo nuevo de contar_pendientes() perdió el fragmento "%" que tenía el vigente. Abortando.', v_f;
    END IF;
  END LOOP;

  -- --- EFECTO, no solo mecanismo -------------------------------------
  -- Lado NO-ADMIN. Se fuerza el estado "sin JWT" para que la prueba sea
  -- determinista aunque la conexión traiga claims por cualquier motivo.
  v_jwt_prev := current_setting('request.jwt.claims', true);
  v_sub_prev := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  v_neutro := public.contar_pendientes();
  IF v_neutro <> jsonb_build_object('abiertos', 0, 'por_tipo', '{}'::jsonb) THEN
    RAISE EXCEPTION '0020: contar_pendientes() SIGUE respondiendo con contenido a quien no es admin: %. La guarda no surtió efecto. Abortando.', v_neutro;
  END IF;

  -- Lado NO-ADMIN CON IDENTIDAD REAL — el caso que de verdad mide
  -- la verificación HTTP de la 0020 (check 2, sesión kam efímera por HTTP).
  -- `auth.uid() IS NULL` prueba el borde; un uuid de un perfil que existe y
  -- NO es admin prueba el centro: que `is_admin()` diga false por el ROL y no
  -- por la ausencia de sesión.
  SELECT id INTO v_no_admin FROM public.perfiles WHERE rol <> 'admin' ORDER BY id LIMIT 1;
  IF v_no_admin IS NULL THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · NO COMPROBADO: no hay ningún perfil con rol distinto de admin, así que el caso central (sesión kam real) no se pudo probar aquí.';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_no_admin::text)::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_no_admin::text, true);
    v_neutro := public.contar_pendientes();
    IF v_neutro <> jsonb_build_object('abiertos', 0, 'por_tipo', '{}'::jsonb) THEN
      RAISE EXCEPTION '0020: con una sesión NO-admin real la RPC devolvió %, no la forma neutra. Abortando.', v_neutro;
    END IF;
    RAISE NOTICE '0020 · PIEZA 2 · con un perfil real no-admin la RPC devuelve la forma neutra: %', v_neutro;
  END IF;

  -- Lado ADMIN, con un uuid REAL de public.perfiles: la guarda no puede
  -- apagarle la bandeja a quien sí es admin. `auth.uid()` lee estos GUCs
  -- (medido en su definición), así que esto simula la sesión sin fabricar
  -- un JWT ni tocar auth.users.
  SELECT count(*) INTO v_reales FROM public.pendientes_datos WHERE estado = 'abierto';
  SELECT id INTO v_admin FROM public.perfiles WHERE rol = 'admin' ORDER BY id LIMIT 1;

  IF v_admin IS NULL THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · NO COMPROBADO: no hay ningún perfil con rol=admin, así que el lado ADMIN de contar_pendientes() no se pudo probar aquí.';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text)::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
    v_como_admin := public.contar_pendientes();
    IF (v_como_admin ->> 'abiertos')::bigint <> v_reales THEN
      RAISE EXCEPTION '0020: la guarda le APAGÓ la bandeja al admin — contar_pendientes() devolvió % y pendientes_datos tiene % abiertos. Abortando.',
        v_como_admin, v_reales;
    END IF;
    -- CONTROL ANTI-VACUIDAD DEL LADO ADMIN — el que faltaba, y era el que
    -- más caro costaba. Con `v_reales = 0` la comparación de arriba es
    -- `0 <> 0`: una migración que le APAGUE la bandeja al administrador pasa
    -- en verde y la línea de abajo afirmaría lo contrario de lo que ocurre.
    -- Reproducido: bandeja apagada por un mutante + `pendientes_datos` sin
    -- abiertos → "sigue devolviendo el conteo completo: 0 abiertos" + GUARDA
    -- VERDE. Los dos escenarios donde muerde no son hipotéticos: un replay
    -- sobre base limpia (que es LA promesa de reproducibilidad de este
    -- bloque) y una re-aplicación después de que el admin resuelva los pendientes.
    IF v_reales = 0 THEN
      v_reservas := v_reservas + 1;
      RAISE NOTICE '0020 · AVISO ANTI-VACUIDAD (lado admin): pendientes_datos no tiene NINGÚN abierto, así que la comparación fue 0 contra 0. Este verde NO prueba que la bandeja del admin siga encendida: con el universo vacío, una guarda que se la apagara pasaría igual. Vuelve a comprobarlo con pendientes abiertos, o con la verificación HTTP de la 0020.';
    ELSE
      RAISE NOTICE '0020 · PIEZA 2 · con un admin real la RPC sigue devolviendo el conteo completo: % abiertos.', v_reales;
    END IF;
  END IF;

  -- Restaurar los GUCs al valor con el que llegó la transacción. Son
  -- `is_local`, así que morirían con el COMMIT de todas formas; se restauran
  -- para no dejar una sesión con identidad prestada si algo se añade abajo.
  PERFORM set_config('request.jwt.claims', coalesce(v_jwt_prev, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub_prev, ''), true);

  -- Control anti-vacuidad de la pieza 2: si ANTES ya devolvía la forma
  -- neutra, la fuga no estaba viva y este verde no prueba el cierre.
  IF v_pend_antes = jsonb_build_object('abiertos', 0, 'por_tipo', '{}'::jsonb) THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · AVISO ANTI-VACUIDAD: contar_pendientes() ya devolvía la forma neutra ANTES (o no hay pendientes abiertos). Este verde NO prueba que la fuga estuviera abierta.';
  ELSE
    RAISE NOTICE '0020 · PIEZA 2 VERDE: sin sesión de admin la RPC pasó de % a %.', v_pend_antes, v_neutro;
  END IF;

  -- ==========================================================
  -- PIEZA 3 · familias.creado_en / creado_por
  -- ==========================================================
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.familias'::regclass AND a.attname = 'creado_en'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION '0020: familias.creado_en no quedó creada. Abortando.';
  END IF;
  IF v_tipo <> 'timestamp with time zone' THEN
    RAISE EXCEPTION '0020: familias.creado_en quedó como % y se esperaba timestamptz. Abortando.', v_tipo;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.familias'::regclass AND a.attname = 'creado_por'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_tipo IS NULL THEN
    RAISE EXCEPTION '0020: familias.creado_por no quedó creada. Abortando.';
  END IF;
  IF v_tipo <> 'text' THEN
    RAISE EXCEPTION '0020: familias.creado_por quedó como % y se esperaba text. Abortando.', v_tipo;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = 'public.familias'::regclass AND a.attname = 'creado_en'
       AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%now()%')
  THEN
    RAISE EXCEPTION '0020: familias.creado_en quedó SIN DEFAULT now() — las altas nuevas nacerían con NULL y la columna no auditaría nada. Abortando.';
  END IF;

  -- El sello tiene que haber alcanzado a TODAS las filas históricas: una
  -- columna de auditoría medio nula es peor que ninguna, porque el NULL se
  -- confunde con "no se sabe" en vez de con "preexistente".
  IF EXISTS (SELECT 1 FROM public.familias WHERE creado_en IS NULL) THEN
    RAISE EXCEPTION '0020: hay familias con creado_en NULL tras el ALTER. Abortando.';
  END IF;

  -- P16, OBLIGATORIO Y NO OPCIONAL (§P2): S1 midió que familias tiene SELECT
  -- de TABLA y 0 columnas con ACL propio, así que TAXO-10 no aplica y la
  -- columna nace legible. Se verifica igual — el costo es una consulta.
  IF NOT has_column_privilege('authenticated', 'public.familias', 'creado_en', 'SELECT') THEN
    RAISE EXCEPTION '0020: authenticated NO puede leer familias.creado_en (TAXO-10: columna nueva en tabla con lista blanca nace sin GRANT). Abortando.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.familias', 'creado_por', 'SELECT') THEN
    RAISE EXCEPTION '0020: authenticated NO puede leer familias.creado_por (TAXO-10). Abortando.';
  END IF;

  -- DE DÓNDE VIENE ESE VERDE, dicho en voz alta en vez de dejarlo parecer
  -- independiente (P16, y lo destapó el control negativo N10):
  -- `has_column_privilege` devuelve true si el privilegio está a nivel de
  -- COLUMNA **o** a nivel de TABLA. Mientras `familias` conserve el SELECT de
  -- tabla —que la pieza 1 ya exige unas líneas más arriba— estas dos
  -- comprobaciones NO PUEDEN dar falso: son verdes POR el grant de tabla, no
  -- porque las columnas nuevas tengan ACL propio. Siguen aquí porque miden el
  -- efecto que le importa al portal (¿se puede leer?) y porque se ponen rojas
  -- el día que `familias` pase a lista blanca. Lo que sí discrimina HOY es el
  -- conteo de columnas con ACL propio: S1 midió 0, y si sube, el mecanismo
  -- cambió y TAXO-10 vuelve a estar en juego.
  SELECT count(*) INTO v_col_acl
    FROM pg_attribute a
   WHERE a.attrelid = 'public.familias'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL;
  IF v_col_acl > 0 THEN
    RAISE NOTICE '0020 · AVISO: familias tiene % columna(s) con ACL propio; S1 midió 0. Dejó de ser una tabla con SELECT de tabla limpio: TAXO-10 vuelve a aplicar y el verde de has_column_privilege ya no es automático.', v_col_acl;
  END IF;

  IF col_description('public.familias'::regclass, (
        SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid = 'public.familias'::regclass AND a.attname = 'creado_en')) IS NULL
  THEN
    RAISE EXCEPTION '0020: familias.creado_en quedó sin COMMENT — la fecha falsa de las filas históricas quedaría implícita, que es justo lo que el PO pidió evitar. Abortando.';
  END IF;
  IF col_description('public.familias'::regclass, (
        SELECT a.attnum FROM pg_attribute a
         WHERE a.attrelid = 'public.familias'::regclass AND a.attname = 'creado_por')) IS NULL
  THEN
    RAISE EXCEPTION '0020: familias.creado_por quedó sin COMMENT. Abortando.';
  END IF;

  IF v_cols_antes = 2 THEN
    v_reservas := v_reservas + 1;
    RAISE NOTICE '0020 · AVISO ANTI-VACUIDAD: familias YA tenía las 2 columnas ANTES — la pieza (3) no las creó y su verde no prueba nada.';
  ELSE
    RAISE NOTICE '0020 · PIEZA 3 VERDE: familias pasó de % a 2 columnas de autoría, legibles por authenticated y comentadas.', v_cols_antes;
  END IF;

  -- ==========================================================
  -- LO QUE ESTA GUARDA **NO** PUEDE COMPROBAR DESDE SQL
  -- ==========================================================
  -- [S7-B] Este conteo ya NO es «lo no cerrado»: la pieza (1c) cerró la
  -- mitad de `postgres` y su residual está declarado arriba, con el nombre
  -- del dueño derivado en vivo. Lo que queda aquí es el TOTAL, para que el
  -- log tenga la cifra agregada sin tener que sumarla a mano.
  SELECT count(*) INTO v_defacl
    FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE n.nspname = 'public' AND d.defaclobjtype = 'r'
     AND a.privilege_type = 'TRUNCATE'
     AND pg_get_userbyid(a.grantee) IN ('anon','authenticated');

  RAISE NOTICE '0020 · default ACL de public/tablas que TODAVÍA conceden TRUNCATE a anon/authenticated, sumando TODOS los dueños: %. De ellos, los del dueño `postgres` son % (la pieza 1c los exige en 0 y aborta si no).', v_defacl, v_defpg;

  RAISE NOTICE '0020 · NO COMPROBADO AQUÍ (no se puede desde SQL, y es el flanco que la pieza 1c NO cubre): que una tabla creada MÁS ADELANTE nazca sin TRUNCATE. Esta guarda lee el catálogo de defaults, no crea una tabla de prueba para medir el ACL con el que nace. Lo que la pieza 1c garantiza es el INSUMO (el default de `postgres`); el EFECTO en una tabla futura solo lo puede comprobar la migración que la cree, o la aserción por corrida que la ratificación (docs/decisions/0005-migration-guards-and-replay.md) le encarga al protocolo del aplicador.';

  RAISE NOTICE '0020 · DIVERGENCIA DE INSTRUMENTOS (latente, no viva): esta migración deriva y verifica sobre relkind IN (r,p); la verificación HTTP de la 0020 filtra relkind = r. Hoy no hay ninguna tabla particionada en public, así que ambos miden el mismo conjunto. El día que exista una, esta migración le revoca TRUNCATE y ese script no la mira: su verde dejaría de cubrirla.';
  RAISE NOTICE '0020 · NO COMPROBADO AQUÍ (no se puede desde SQL): que /api/dashboard y /api/pendientes sigan respondiendo 200. Lo mide la verificación HTTP de la 0020 con una sesión kam real por HTTP, y ese es el criterio de éxito de este frente.';
  RAISE NOTICE '0020 · NO GARANTIZADO POR ESTA MIGRACIÓN: que familias.creado_en/creado_por sean confiables. Nacen sin trigger y con UPDATE abierto a is_admin(): son dato declarado, no bitácora inviolable. Está escrito en el COMMENT de cada columna.';
  RAISE NOTICE '0020 · NO COMPROBADO AQUÍ: que PostgREST haya recargado su cache de esquema. El NOTIFY se entrega en el COMMIT; si el check 3 de la verificación HTTP de la 0020 diera 42703, es cache, no migración.';
  RAISE NOTICE '0020 · NO COMPROBADO AQUÍ: que alguien ESCRIBA familias.creado_por. Hoy ningún camino lo hace; la columna queda lista, no poblada.';
  -- El cierre no puede sonar igual con 0 reservas que con 4. "Verde" y
  -- "probado" no son lo mismo, y quien lea el log tres meses después no va a
  -- ir a contar los AVISO de arriba.
  IF v_reservas = 0 THEN
    RAISE NOTICE '0020 · GUARDA VERDE: las tres piezas verificadas por efecto, no por intención. 0 reservas.';
  ELSE
    RAISE NOTICE '0020 · GUARDA VERDE CON RESERVAS: la migración pasó, pero % de sus veredictos salieron sobre un universo vacío, no se pudieron medir, o son un RESIDUAL CONOCIDO que se decidió no cerrar (ver los AVISO y el RESIDUAL de arriba). Verde aquí significa "no contradicho", no "probado". En una base de producción se espera al menos 1: el default ACL de supabase_admin, que el PO decidió no tocar.', v_reservas;
  END IF;
END $guarda0020$;

COMMIT;
