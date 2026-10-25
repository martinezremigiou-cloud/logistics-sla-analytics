-- ============================================================
-- 0030 · [INV-B11] El corpus documental: documentos, trozos e INTENTOS.
--
-- QUÉ CREA Y POR QUÉ ESTÁN SEPARADOS. Tres tablas, y ninguna es un detalle de
-- normalización:
--
--   · `corpus_documentos` — uno por archivo. **La `ruta` es la clave primaria**,
--     y eso es una decisión, no comodidad: la ruta ES la identidad del
--     documento. Detectar «es el mismo, movido» exigiría comparar contenidos y
--     acertar, y equivocarse deja dos copias o pierde una. Un archivo movido es
--     baja + alta, que falla en voz alta.
--
--   · `corpus_trozos` — el texto que se recupera, con su embedding. Cuelga del
--     documento con **ON DELETE CASCADE**, y ahí está lo importante:
--     **la cascada ES el mecanismo de baja.** Borrar el documento borra sus
--     trozos en la misma transacción; no hay forma de dejar trozos huérfanos
--     contestando desde un archivo que ya no existe.
--
--   · `corpus_sync_intentos` — **lo único que git NO da.** El árbol de git es
--     el manifiesto, el SHA del blob es el hash, y el log de commits es la
--     auditoría de qué cambió. Pero git no sabe si NOSOTROS corrimos. Sin esta
--     tabla, «la sync corrió y no había nada» y «la sync no corrió» dejan la
--     misma evidencia: ninguna. **Es B10-3 exacto, y se cierra ANTES de nacer
--     en vez de heredarlo.**
--
-- ────────────────────────────────────────────────────────────
-- LA EXTENSIÓN `vector`, medida antes de escribirla.
--
-- `pg_available_extensions` dice `vector 0.8.0` **disponible y NO instalada**.
-- Se instala en el esquema `extensions`, que es donde esta base ya pone las
-- suyas — nunca en `public`, que es donde viven las tablas de negocio.
--
-- **La dimensión 1536 no es una preferencia: sale de reproducir el costo del
-- brief.** El corpus ≈ cientos de miles de tokens; a $0.02/M eso da **centavos**, que
-- es exactamente la cifra que el brief declaró para indexar todo. O sea
-- `text-embedding-3-small`, que son 1536 dimensiones. Si un día se cambia de
-- modelo, esta columna es lo que hay que migrar, y el número está aquí para que
-- se vea.
--
-- ────────────────────────────────────────────────────────────
-- `fuente_pdf` ES NULLABLE, Y EL NULL SIGNIFICA ALGO.
--
-- Medido sobre el corpus real: **alguna ficha de producto no declara `fuente_pdf`**.
-- El NULL no es «todavía no lo llenamos»: es «esta ficha no tiene PDF de
-- origen», y **la respuesta tiene que decirlo** en vez de omitir la cita en
-- silencio. Omitir se lee como «no hay nada que citar».
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Tres tablas nuevas que nacen VACÍAS y una extensión que se
--      instala. Cero DDL sobre tablas existentes, cero DELETE, cero UPDATE.
--      Revertir es DROP de las tres y de la extensión — y el contenido es
--      **reconstruible por completo**: se vuelve a indexar desde el corpus, que
--      es la fuente de verdad y vive fuera de esta base.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** Nada existente lee ni escribe estas tablas todavía. La única
--      operación con alcance fuera de su propio ámbito es `CREATE EXTENSION
--      vector`, que agrega tipos y operadores en el esquema `extensions`; no
--      toca `public` ni ninguna tabla de negocio.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      **Tres cosas, y las tres importan:**
--      (a) Que alguien REGISTRE los intentos. La tabla puede existir vacía para
--          siempre y el sistema se vería sano — que es el mismo agujero que
--          esta tabla existe para tapar.
--      (b) Que la sync consulte `esBorradoMasivo` antes de borrar. Desde SQL,
--          un DELETE de cientos de documentos por manifiesto truncado y uno legítimo
--          son idénticos.
--      (c) Que el `commit_sha` que se guarde sea el del árbol que de verdad se
--          leyó. Si el indexador guardara otro, la procedencia sería falsa y
--          se vería perfecta.
--      Las tres se declaran en el RAISE NOTICE y se prueban desde la aplicación.
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b11.tablas_antes',
    (SELECT count(*)::text FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE 'corpus\_%'), false);
END
$antes$;

-- ------------------------------------------------------------
-- (0) La extensión, en `extensions` y no en `public`.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- (1) Los documentos. `ruta` es la identidad.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corpus_documentos (
    ruta          text        NOT NULL,
    -- Hash del CONTENIDO. Con git es el SHA del blob y sale gratis del árbol.
    -- NUNCA una fecha: una fecha cambia al copiar el archivo sin tocarlo.
    hash          text        NOT NULL,
    -- El commit del que se leyó. Es lo que vuelve la procedencia verificable:
    -- «según la ficha X, versión de tal commit» en vez de «según la ficha X».
    commit_sha    text        NOT NULL,
    titulo        text,
    descripcion   text,
    -- NULL = «esta ficha no tiene PDF de origen». Lo dice la respuesta.
    fuente_pdf    text,
    bytes         integer     NOT NULL DEFAULT 0,
    indexado_en   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT corpus_documentos_pkey PRIMARY KEY (ruta),
    CONSTRAINT corpus_documentos_bytes_no_negativo CHECK (bytes >= 0)
);

-- ------------------------------------------------------------
-- (2) Los trozos. La CASCADA es el mecanismo de baja.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corpus_trozos (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    ruta          text        NOT NULL,
    orden         integer     NOT NULL,
    -- `Series2 > Características principales > Tabla comparativa`. Viaja DENTRO
    -- del texto además de aquí: un trozo llega solo al modelo, y «28 pulgadas»
    -- sin su sección no significa nada.
    ruta_seccion  text        NOT NULL,
    texto         text        NOT NULL,
    bytes         integer     NOT NULL DEFAULT 0,
    tiene_tabla   boolean     NOT NULL DEFAULT false,
    -- `true` cuando el trozo pasó del umbral y no se pudo partir más sin romper
    -- una tabla. Es la concesión declarada, no un error.
    excede        boolean     NOT NULL DEFAULT false,
    commit_sha    text        NOT NULL,
    embedding     extensions.vector(1536),
    creado_en     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT corpus_trozos_pkey PRIMARY KEY (id),
    CONSTRAINT corpus_trozos_ruta_fkey
        FOREIGN KEY (ruta) REFERENCES public.corpus_documentos(ruta) ON DELETE CASCADE,
    CONSTRAINT corpus_trozos_orden_unico UNIQUE (ruta, orden),
    CONSTRAINT corpus_trozos_bytes_no_negativo CHECK (bytes >= 0)
);

CREATE INDEX IF NOT EXISTS corpus_trozos_ruta_idx ON public.corpus_trozos (ruta);

-- ------------------------------------------------------------
-- (3) LOS INTENTOS. Lo único que git no da.
--
-- Se escribe una fila al EMPEZAR, no al terminar. Si se escribiera al final,
-- una corrida que muere a medias no dejaría rastro — y «murió» volvería a ser
-- indistinguible de «no corrió», que es justo lo que esta tabla evita.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corpus_sync_intentos (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    iniciado_en   timestamptz NOT NULL DEFAULT now(),
    terminado_en  timestamptz,
    -- El árbol que se leyó. NULL si la corrida ni llegó a leerlo.
    commit_sha    text,
    -- 'corriendo' | 'ok' | 'detenido' | 'error'.
    -- `detenido` NO es `error`: es la guarda de borrado masivo haciendo su
    -- trabajo, y confundirlos haría que una defensa se lea como una falla.
    resultado     text        NOT NULL DEFAULT 'corriendo',
    altas         integer     NOT NULL DEFAULT 0,
    cambios       integer     NOT NULL DEFAULT 0,
    bajas         integer     NOT NULL DEFAULT 0,
    sin_cambio    integer     NOT NULL DEFAULT 0,
    -- Por qué se detuvo, en palabras. Un `detenido` sin motivo obliga a
    -- adivinar, y adivinar es lo que este bloque lleva evitando.
    motivo        text,
    CONSTRAINT corpus_sync_intentos_pkey PRIMARY KEY (id),
    CONSTRAINT corpus_sync_intentos_resultado_valido
        CHECK (resultado IN ('corriendo', 'ok', 'detenido', 'error'))
);

CREATE INDEX IF NOT EXISTS corpus_sync_intentos_iniciado_idx
    ON public.corpus_sync_intentos (iniciado_en DESC);

-- ------------------------------------------------------------
-- (4) RLS: activa, CERO policies, y REVOKE como segunda vuelta de llave.
--
-- El corpus es documentación COMPARTIDA —no es dato de nadie— así que la
-- tentación es dar SELECT a `authenticated` y seguir. No se hace, y por el
-- mismo criterio que `consumo_chat` (0028): el acceso entra por una función
-- `SECURITY DEFINER` con `search_path` fijo, que llega en O4 junto con la
-- búsqueda. Mientras esa función no exista, **nadie lee estas tablas salvo la
-- llave de servicio**, que es lo correcto para una tabla que todavía no tiene
-- consumidor.
--
-- Los REVOKE no son redundantes con la RLS: la RLS filtra filas, el REVOKE
-- quita el privilegio. Con 0 policies la RLS ya niega todo a los roles
-- normales; el REVOKE lo dice también en la capa de permisos.
-- ------------------------------------------------------------
ALTER TABLE public.corpus_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_trozos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_sync_intentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.corpus_documentos FROM anon, authenticated;
REVOKE ALL ON public.corpus_trozos FROM anon, authenticated;
REVOKE ALL ON public.corpus_sync_intentos FROM anon, authenticated;

-- ------------------------------------------------------------
-- (5) La guarda. Comprueba lo que SÍ puede ver desde aquí.
-- ------------------------------------------------------------
DO $guarda$
DECLARE
  v_antes        integer := current_setting('inv_b11.tablas_antes', true)::integer;
  v_tablas       integer;
  v_rls_off      integer;
  v_policies     integer;
  v_privilegios  integer;
  v_vector       integer;
  v_cascada      integer;
BEGIN
  SELECT count(*) INTO v_tablas FROM pg_tables
    WHERE schemaname = 'public' AND tablename IN ('corpus_documentos', 'corpus_trozos', 'corpus_sync_intentos');
  IF v_tablas <> 3 THEN
    RAISE EXCEPTION '0030 ABORTA: esperaba 3 tablas corpus_*, hay %', v_tablas;
  END IF;

  SELECT count(*) INTO v_rls_off FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('corpus_documentos', 'corpus_trozos', 'corpus_sync_intentos')
      AND c.relrowsecurity = false;
  IF v_rls_off > 0 THEN
    RAISE EXCEPTION '0030 ABORTA: % tabla(s) corpus_* sin RLS activa', v_rls_off;
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('corpus_documentos', 'corpus_trozos', 'corpus_sync_intentos');
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '0030 ABORTA: esperaba 0 policies, hay %', v_policies;
  END IF;

  SELECT count(*) INTO v_privilegios FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('corpus_documentos', 'corpus_trozos', 'corpus_sync_intentos')
      AND grantee IN ('anon', 'authenticated');
  IF v_privilegios <> 0 THEN
    RAISE EXCEPTION '0030 ABORTA: anon/authenticated conservan % privilegio(s) sobre corpus_*', v_privilegios;
  END IF;

  SELECT count(*) INTO v_vector FROM pg_extension WHERE extname = 'vector';
  IF v_vector <> 1 THEN
    RAISE EXCEPTION '0030 ABORTA: la extension vector no quedo instalada';
  END IF;

  -- La cascada NO es un adorno: es el mecanismo de baja. Sin ella, borrar un
  -- documento dejaria sus trozos contestando desde un archivo que ya no existe.
  SELECT count(*) INTO v_cascada FROM pg_constraint
    WHERE conname = 'corpus_trozos_ruta_fkey' AND confdeltype = 'c';
  IF v_cascada <> 1 THEN
    RAISE EXCEPTION '0030 ABORTA: corpus_trozos_ruta_fkey no borra en cascada';
  END IF;

  RAISE NOTICE '0030 · tablas corpus_* antes=% ahora=3, RLS activa en las tres, 0 policies, 0 privilegios para anon/authenticated, extension vector instalada, cascada de bajas verificada.', v_antes;
  RAISE NOTICE '0030 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI (tres cosas):';
  RAISE NOTICE '0030 ·   (a) Que alguien REGISTRE los intentos. La tabla puede quedarse vacia para siempre y el sistema se veria sano, que es el mismo agujero que existe para tapar (B10-3).';
  RAISE NOTICE '0030 ·   (b) Que la sync consulte la guarda de borrado masivo ANTES de borrar. Desde SQL, un DELETE de 200 documentos por manifiesto truncado y uno legitimo son identicos.';
  RAISE NOTICE '0030 ·   (c) Que el commit_sha guardado sea el del arbol que de verdad se leyo. Un commit_sha falso produce una procedencia que se ve perfecta.';
END
$guarda$;
