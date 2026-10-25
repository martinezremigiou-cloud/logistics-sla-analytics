-- ============================================================
-- 0040 · [CHAT-B1] El registro aprende a contar la SEGUNDA llamada.
--
-- QUÉ ARREGLA. Hasta hoy una pregunta del chat era UNA llamada al modelo: la que
-- clasifica. CHAT-B1 añade una segunda —la que redacta desde la ficha— y las dos
-- **cuestan precios distintos**: el clasificador manda pocos tokens de entrada y
-- devuelve un JSON mínimo; el redactor manda mucho más y devuelve prosa.
--
-- Sumarlas en `tokens_entrada` habría hecho **incalculable cuál subió**, que es
-- justo lo que el bloque tiene que poder medir: el proveedor cambia a DeepSeek
-- por costo Y el prompt crece por la ficha, y los dos efectos van en direcciones
-- opuestas. Un solo par de columnas no puede responder «¿el ahorro compensó?».
--
-- Por eso son COLUMNAS NUEVAS y no una suma.
--
-- ────────────────────────────────────────────────────────────
-- `redaccion_estado` NO ES DECORACIÓN, y por eso va aunque no haya tokens.
--
-- La redacción termina en uno de nueve estados y **no se colapsan**, por la
-- misma razón que `ResultadoFicha` tiene ocho: «no lo intenté», «no me dejaron
-- por el perímetro» y «lo intenté y la guarda mordió» mandan a mirar cosas
-- opuestas. Sin esta columna, un cero en tokens significaría las tres a la vez
-- y el reporte no podría distinguir «el redactor nunca se pasó» de «la
-- contención nunca corrió» — que es exactamente la ambigüedad que hace que un
-- verde no pruebe nada.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (las tres preguntas de la casa)
--
--   1. ¿Destruye datos?
--      NO. Sólo agrega cuatro columnas anulables y una función nueva. Las
--      filas que hoy tiene `consumo_chat` quedan intactas, con las columnas
--      nuevas en NULL — que es la verdad: ninguna de ellas tuvo redacción.
--
--   2. ¿Se puede deshacer?
--      SÍ, entera:
--        DROP FUNCTION IF EXISTS public.chat_anotar_redaccion(uuid, text, text, integer, integer);
--        ALTER TABLE public.consumo_chat
--          DROP COLUMN modelo_redactor, DROP COLUMN tokens_entrada_redaccion,
--          DROP COLUMN tokens_salida_redaccion, DROP COLUMN redaccion_estado;
--      Ninguna lectura del portal desplegado hoy conoce estas columnas.
--
--   3. ¿Qué pasa si se aplica dos veces?
--      Nada. `ADD COLUMN IF NOT EXISTS` y `CREATE OR REPLACE FUNCTION` son
--      idempotentes, y la guarda final vuelve a comprobar lo mismo.
--
-- ────────────────────────────────────────────────────────────
-- ⚠️ MIENTRAS ESTA MIGRACIÓN NO ESTÉ APLICADA, el gasto del redactor NO QUEDA
-- REGISTRADO. La ruta llama a `chat_anotar_redaccion` dentro de un `.catch(()
-- => {})`, para que una RPC ausente no tumbe la respuesta del usuario — la misma
-- decisión que `chat_anotar_uso`. El costo de ese silencio se dice aquí para que
-- nadie lo descubra a golpes: **ésta es la primera del despliegue, no la
-- última**, o se sirve prosa sin saber lo que cuesta.
-- ============================================================

DO $antes$
DECLARE
  v_cols integer;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'consumo_chat'
     AND column_name IN ('modelo_redactor', 'tokens_entrada_redaccion',
                         'tokens_salida_redaccion', 'redaccion_estado');
  PERFORM set_config('chat_b1.cols_antes', v_cols::text, false);
END
$antes$;

-- ------------------------------------------------------------
-- (1) Las cuatro columnas.
-- ------------------------------------------------------------
ALTER TABLE public.consumo_chat
  ADD COLUMN IF NOT EXISTS modelo_redactor          text,
  ADD COLUMN IF NOT EXISTS tokens_entrada_redaccion integer,
  ADD COLUMN IF NOT EXISTS tokens_salida_redaccion  integer,
  ADD COLUMN IF NOT EXISTS redaccion_estado         text;

-- El CHECK va aparte y con `NOT VALID` deliberadamente NO usado: la tabla no
-- tiene filas con valor en esta columna (acaba de nacer), así que validar es
-- gratis y deja la restricción de verdad en pie desde el primer día.
DO $chk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'consumo_chat_redaccion_estado_ck'
       AND conrelid = 'public.consumo_chat'::regclass
  ) THEN
    ALTER TABLE public.consumo_chat
      ADD CONSTRAINT consumo_chat_redaccion_estado_ck
      CHECK (redaccion_estado IS NULL OR redaccion_estado IN (
        'sin_intento',          -- no había redactor, o no era rama documental
        'fuera_del_perimetro',  -- la lista blanca lo paró: NO cruzó al modelo
        'sin_texto',            -- el documento no tenía nada que leer
        'sin_tiempo',           -- no quedaba presupuesto de la petición
        'limpia',               -- se verificó y se enseñó
        'sucia',                -- la contención mordió; se enseñó el verbatim
        'no_esta',              -- el modelo dijo honestamente que no está
        'ilegible',             -- devolvió algo que no es la forma esperada
        'fallo'                 -- no se pudo hablar con el proveedor
      ));
  END IF;
END
$chk$;

COMMENT ON COLUMN public.consumo_chat.modelo_redactor IS
  '[CHAT-B1] Proveedor/modelo de la SEGUNDA llamada (la que redacta). Separado de `modelo` porque los dos escalones pueden ser de proveedores distintos y tienen precios distintos.';
COMMENT ON COLUMN public.consumo_chat.redaccion_estado IS
  '[CHAT-B1] En cual de los nueve estados termino el intento de redaccion. Va AUNQUE no haya tokens: sin el, un cero significaria a la vez «no lo intente», «no me dejaron» y «la guarda mordio», y el reporte no podria distinguir «el redactor nunca se paso» de «la contencion nunca corrio».';

-- ------------------------------------------------------------
-- (2) La anotación de la segunda llamada.
--
--     Hermana de `chat_anotar_uso` y con su mismo molde: SECURITY DEFINER,
--     `search_path` fijo, idempotente y acotada al propio perfil.
--
--     NO se fusiona con `chat_anotar_uso` a propósito: esa función **sólo se
--     llama en el camino largo** (cuelga de `nombreModelo`, que el atajo de chip
--     nunca llena), y `documental` ES uno de los diez chips. Fusionarlas habría
--     dejado la redacción de un chip sin registrar — costando dinero y dejando
--     la fila diciendo «no gastó ninguno», que es falso.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_anotar_redaccion(
  p_id      uuid,
  p_modelo  text,
  p_estado  text,
  p_tok_in  integer,
  p_tok_out integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $anotar$
DECLARE
  v_perfil uuid := auth.uid();
  v_filas  integer;
BEGIN
  IF v_perfil IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.consumo_chat
     SET modelo_redactor          = coalesce(p_modelo, modelo_redactor),
         redaccion_estado         = coalesce(p_estado, redaccion_estado),
         tokens_entrada_redaccion = p_tok_in,
         tokens_salida_redaccion  = p_tok_out
   WHERE id = p_id
     -- LA AUTORIZACIÓN. Es SECURITY DEFINER, así que la RLS no la frena: sin
     -- este filtro, cualquiera con un id ajeno escribiría en el registro de otro.
     AND perfil_id = v_perfil
     -- IDEMPOTENTE, con el molde de `chat_anotar_uso`: sólo completa lo que
     -- todavía no se anotó, así que una segunda llamada no pisa lo registrado.
     AND redaccion_estado IS NULL;

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas > 0;
END
$anotar$;

COMMENT ON FUNCTION public.chat_anotar_redaccion(uuid, text, text, integer, integer) IS
  '[CHAT-B1] Tercera fase del registro del chat: anota lo que costo la llamada que REDACTA desde la ficha. Existe aparte de chat_anotar_uso porque esa solo corre en el camino largo, y la intencion documental tambien se dispara desde un chip — donde no hay clasificador y por tanto no habria fila que completar. Idempotente y acotada al propio perfil.';

-- El default ACL de esta base concede EXECUTE a `anon` POR NOMBRE en toda
-- función nueva de `public`; `FROM PUBLIC` no toca una concesión nominal.
-- Medido al aplicar la 0028, donde la guarda abortó por esto exactamente.
REVOKE ALL ON FUNCTION public.chat_anotar_redaccion(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_anotar_redaccion(uuid, text, text, integer, integer) TO authenticated;

-- ------------------------------------------------------------
-- (3) GUARDA — por efecto, y declarando lo que no puede ver.
-- ------------------------------------------------------------
DO $guarda0040$
DECLARE
  v_cols      integer;
  v_secdef    boolean;
  v_config    text;
  v_exec_auth integer;
  v_exec_anon integer;
  v_sucias    integer;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'consumo_chat'
     AND column_name IN ('modelo_redactor', 'tokens_entrada_redaccion',
                         'tokens_salida_redaccion', 'redaccion_estado');
  IF v_cols <> 4 THEN
    RAISE EXCEPTION '0040: esperaba 4 columnas nuevas en consumo_chat y hay %. Abortando.', v_cols;
  END IF;

  SELECT p.prosecdef, array_to_string(p.proconfig, ',')
    INTO v_secdef, v_config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'chat_anotar_redaccion';

  IF v_secdef IS NULL THEN
    RAISE EXCEPTION '0040: chat_anotar_redaccion() no existe. Abortando.';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION '0040: chat_anotar_redaccion() NO es SECURITY DEFINER. Abortando.';
  END IF;
  IF v_config IS NULL OR v_config NOT LIKE '%search_path=%' THEN
    RAISE EXCEPTION '0040: chat_anotar_redaccion() es SECURITY DEFINER SIN search_path fijo. Abortando.';
  END IF;

  SELECT count(*) INTO v_exec_auth FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public' AND routine_name = 'chat_anotar_redaccion' AND grantee = 'authenticated';
  SELECT count(*) INTO v_exec_anon FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public' AND routine_name = 'chat_anotar_redaccion' AND grantee = 'anon';

  IF v_exec_auth < 1 THEN
    RAISE EXCEPTION '0040: authenticated no puede EJECUTAR chat_anotar_redaccion(). Abortando.';
  END IF;
  IF v_exec_anon <> 0 THEN
    RAISE EXCEPTION '0040: anon puede EJECUTAR chat_anotar_redaccion() (% grants). Abortando.', v_exec_anon;
  END IF;

  -- Ninguna fila existente puede haber quedado con un estado fuera del CHECK:
  -- la columna acaba de nacer y todas tienen que estar en NULL.
  SELECT count(*) INTO v_sucias FROM public.consumo_chat WHERE redaccion_estado IS NOT NULL;
  IF v_sucias <> 0 THEN
    RAISE EXCEPTION '0040: % filas ya traen redaccion_estado y esta migracion no escribe ninguna. Abortando.', v_sucias;
  END IF;

  RAISE NOTICE '0040 · consumo_chat gana 4 columnas para la segunda llamada; chat_anotar_redaccion creada, SECURITY DEFINER con search_path fijo, ejecutable por authenticated y NO por anon. Ninguna fila existente tocada.';
  RAISE NOTICE '0040 · LO QUE NO PUEDE COMPROBAR DESDE AQUI, y son tres cosas: (1) que la ruta llame a chat_anotar_redaccion con el id que devolvio chat_registrar_pregunta — si no lo hiciera, la prosa se serviria sin que nadie sepa lo que cuesta, y la fila se veria sana; (2) que el PERIMETRO de carpetas se respete, porque vive en TypeScript (lib/chat/entrega.ts) y no en esta base: desde aqui no hay forma de ver que texto cruzo hacia el proveedor; (3) que los nueve valores del CHECK sean los mismos nueve de EstadoRedaccion en el codigo — son dos copias del mismo hecho y solo una prueba de aplicacion las cotea.';
END
$guarda0040$;
