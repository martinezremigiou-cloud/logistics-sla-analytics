-- ============================================================
-- 0031 · [INV-B11] O2 · El puente `familia → ficha`. Una TABLA, no un algoritmo.
--
-- POR QUÉ ES UNA TABLA. Es el invariante del bloque, y sale de medir, no de
-- teoría:
--
--     SERIES 2 26      → Series2.md
--     BOTON DE ASISTENCIA → Boton-Asistencia.md   (sin la preposición «DE»)
--     SERIES 2 VIZOR   → Series2-Visor.md         (el portal lo escribe mal)
--     SERIES11 ALFA    → Pedestal-EAS-Series11-AM-Alfa.md
--
-- **Ningún algoritmo de texto acierta eso.** Y una búsqueda semántica que lo
-- intente acertará *casi* siempre — que sobre especificaciones técnicas
-- significa entregar las specs de OTRO producto, con tabla, con nombre de PDF y
-- con toda la cara de ser correcta.
--
-- Al ser dato y no código, se corrige sin desplegar.
--
-- ────────────────────────────────────────────────────────────
-- LA DECISIÓN QUE NO ES OBVIA: `ficha_ruta` NO LLEVA CLAVE FORÁNEA.
--
-- Lo natural sería `REFERENCES corpus_documentos(ruta)`. Se evaluaron las tres
-- formas y **las dos con FK pierden información**:
--
--   ON DELETE SET NULL → la ficha desaparece del corpus y el puente se vuelve
--       «esta familia no tiene ficha» **en silencio**. El usuario recibiría un
--       «no tengo ficha de este producto» impecable, y el problema sería que
--       alguien borró el archivo. Es exactamente el patrón que este proyecto
--       lleva tres bloques cazando: dos causas distintas con la misma salida.
--
--   ON DELETE CASCADE  → borra el renglón, y con él **el trabajo de revisión
--       humana**. Una limpieza del corpus tiraría decisiones humanas.
--
--   RESTRICT           → la sincronización no podría borrar una ficha. Un
--       puente bloqueando al corpus es la dependencia al revés.
--
-- **Sin FK, un puente que apunta a una ficha que ya no existe queda DANGLING —
-- y eso es INFORMACIÓN, no un bug.** Dice «el corpus cambió debajo del puente»,
-- y O4 puede reportarlo con esas palabras en vez de fingir que no hay ficha.
--
-- ────────────────────────────────────────────────────────────
-- LOS CUATRO ESTADOS, Y EL CUARTO ES IRREPRESENTABLE A PROPÓSITO.
--
--   ficha_ruta   revisado_en   significado
--   ----------   -----------   -----------------------------------------
--   NOT NULL     NULL          propuesta automática, sin revisar
--   NOT NULL     NOT NULL      un humano la revisó y la confirmó
--   NULL         NOT NULL      **un humano confirmó que NO hay ficha**
--   NULL         NULL          no significa nada  →  prohibido por CHECK
--
-- El tercero es el que un `NULL` solo no distinguiría: «revisado y no hay» es
-- distinto de «nadie lo ha mirado», y sin esa diferencia la cobertura no se
-- puede medir. Es la misma familia que `snapshots` registrando resultados y no
-- intentos (B10-3).
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Una tabla nueva que nace VACÍA. Cero DDL sobre tablas
--      existentes, cero DELETE, cero UPDATE. Revertir es un DROP.
--      Lo único que un día será irreconstruible es el trabajo de REVISIÓN
--      humana — y por eso `ficha_ruta` no lleva FK con CASCADE, que es justo lo que
--      lo borraría al limpiar el corpus.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** Nada lee ni escribe esta tabla todavía. La FK a `familias` es
--      CASCADE: si una familia deja de existir, su puente no significa nada.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      (a) Que alguien POBLE la tabla. Vacía, O4 contestaría «no tengo ficha»
--          para todo, y **eso se ve idéntico a un corpus sin fichas**.
--      (b) Que las rutas apunten a documentos que existan. Sin FK —a propósito,
--          ver arriba— nada impide un puente colgante; O4 tiene que detectarlo
--          y decirlo con sus palabras.
--      (c) Que alguien revise. `revisado_en NULL` es medible, pero que se revise
--          no lo fuerza el esquema.
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b11.puente_antes',
    (SELECT count(*)::text FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'corpus_familia_ficha'), false);
END
$antes$;

CREATE TABLE IF NOT EXISTS public.corpus_familia_ficha (
    familia_id   uuid        NOT NULL,
    -- SIN clave foránea a `corpus_documentos`, y es deliberado (ver cabecera).
    -- Un puente colgante es información: dice que el corpus cambió debajo.
    ficha_ruta   text,
    -- Cómo llegó aquí el renglón: 'exacta-normalizada' | 'humano'.
    -- No es decorativo: permite medir cuánto de la cobertura viene de una
    -- propuesta automática y cuánto de una decisión.
    origen       text        NOT NULL DEFAULT 'exacta-normalizada',
    revisado_por uuid,
    revisado_en  timestamptz,
    notas        text,
    creado_en    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT corpus_familia_ficha_pkey PRIMARY KEY (familia_id),
    CONSTRAINT corpus_familia_ficha_familia_fkey
        FOREIGN KEY (familia_id) REFERENCES public.familias(id) ON DELETE CASCADE,
    CONSTRAINT corpus_familia_ficha_revisor_fkey
        FOREIGN KEY (revisado_por) REFERENCES public.perfiles(id) ON DELETE SET NULL,
    CONSTRAINT corpus_familia_ficha_origen_valido
        CHECK (origen IN ('exacta-normalizada', 'humano')),
    -- El cuarto estado —sin ficha y sin revisar— no significa nada: para eso
    -- está NO tener renglón. Se vuelve irrepresentable en vez de documentarse.
    CONSTRAINT corpus_familia_ficha_estado_con_sentido
        CHECK (ficha_ruta IS NOT NULL OR revisado_en IS NOT NULL),
    -- Un renglón revisado tiene que decir QUIÉN. «Revisado por nadie» sería
    -- una firma sin firmante.
    CONSTRAINT corpus_familia_ficha_revision_completa
        CHECK ((revisado_en IS NULL) = (revisado_por IS NULL))
);

CREATE INDEX IF NOT EXISTS corpus_familia_ficha_ruta_idx
    ON public.corpus_familia_ficha (ficha_ruta);

-- Sin revisar: es la cola de trabajo de revisión, y se consulta a menudo.
CREATE INDEX IF NOT EXISTS corpus_familia_ficha_sin_revisar_idx
    ON public.corpus_familia_ficha (creado_en) WHERE revisado_en IS NULL;

ALTER TABLE public.corpus_familia_ficha ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.corpus_familia_ficha FROM anon, authenticated;

DO $guarda$
DECLARE
  v_antes     integer := current_setting('inv_b11.puente_antes', true)::integer;
  v_tabla     integer;
  v_rls       integer;
  v_policies  integer;
  v_privs     integer;
  v_fk_ficha  integer;
  v_checks    integer;
BEGIN
  SELECT count(*) INTO v_tabla FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'corpus_familia_ficha';
  IF v_tabla <> 1 THEN
    RAISE EXCEPTION '0031 ABORTA: la tabla no quedo creada';
  END IF;

  SELECT count(*) INTO v_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'corpus_familia_ficha' AND c.relrowsecurity = true;
  IF v_rls <> 1 THEN
    RAISE EXCEPTION '0031 ABORTA: RLS no quedo activa';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'corpus_familia_ficha';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '0031 ABORTA: esperaba 0 policies, hay %', v_policies;
  END IF;

  SELECT count(*) INTO v_privs FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'corpus_familia_ficha'
      AND grantee IN ('anon', 'authenticated');
  IF v_privs <> 0 THEN
    RAISE EXCEPTION '0031 ABORTA: anon/authenticated conservan % privilegio(s)', v_privs;
  END IF;

  -- La AUSENCIA de FK sobre `ficha_ruta` es una decision, no un olvido: se
  -- asevera que NO existe, para que nadie la agregue creyendo que ayuda.
  SELECT count(*) INTO v_fk_ficha FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'corpus_familia_ficha' AND con.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM unnest(con.conkey) k
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
        WHERE a.attname = 'ficha_ruta');
  IF v_fk_ficha <> 0 THEN
    RAISE EXCEPTION '0031 ABORTA: ficha_ruta tiene FK y NO debe tenerla (ver cabecera: un puente colgante es informacion)';
  END IF;

  SELECT count(*) INTO v_checks FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    WHERE c.relname = 'corpus_familia_ficha' AND con.contype = 'c'
      AND con.conname IN ('corpus_familia_ficha_estado_con_sentido', 'corpus_familia_ficha_revision_completa');
  IF v_checks <> 2 THEN
    RAISE EXCEPTION '0031 ABORTA: faltan los CHECK que vuelven irrepresentable el estado sin sentido (hay %)', v_checks;
  END IF;

  RAISE NOTICE '0031 · corpus_familia_ficha antes=% ahora=1, RLS activa, 0 policies, 0 privilegios para anon/authenticated, ficha_ruta SIN FK (deliberado), 2 CHECK de estado con sentido.', v_antes;
  RAISE NOTICE '0031 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI (tres cosas):';
  RAISE NOTICE '0031 ·   (a) Que alguien POBLE la tabla. Vacia, O4 contestaria «no tengo ficha» para todo, y eso se ve IDENTICO a un corpus sin fichas.';
  RAISE NOTICE '0031 ·   (b) Que las rutas apunten a documentos existentes. Sin FK -a proposito- nada impide un puente colgante; O4 tiene que detectarlo y decirlo con sus palabras.';
  RAISE NOTICE '0031 ·   (c) Que el PO revise. `revisado_en NULL` es medible, pero el esquema no fuerza que se mire.';
END
$guarda$;
