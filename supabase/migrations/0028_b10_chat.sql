-- ============================================================
-- 0028 · [INV-B10] El chat: un registro que ADEMÁS es el techo.
--
-- QUÉ AGREGA. Una tabla de registro y una función que decide si una pregunta
-- entra. Nada más: el chat no guarda conversaciones (decisión de producto), no
-- guarda respuestas y no guarda el texto de la pregunta.
--
-- ────────────────────────────────────────────────────────────
-- (1) EL REGISTRO **ES** EL LIMITADOR, y no son dos cosas.
--
-- La ruta del chat es la primera del portal que **cuesta dinero por llamada**.
-- Hasta hoy, un usuario dándole mil veces a un botón solo gastaba CPU.
--
-- El diseño obvio serían dos piezas: un contador para limitar y una bitácora
-- para calibrar. Serían dos verdades sobre lo mismo y se desincronizarían — es
-- la lección de `enviado_hasta` en la 0027, que NO es columna sino
-- `max(hasta)`: **una verdad consultada no se puede desincronizar de sí
-- misma**. Aquí igual: el límite se cuenta sobre las filas del registro. No hay
-- contador que mantener.
--
-- (2) POR QUÉ EN UNA FUNCIÓN Y NO EN EL SERVICIO.
--
-- Tres razones, y la tercera es la que decide:
--
--   a. El techo vive en la BASE, donde no se puede olvidar de aplicarlo — el
--      mismo criterio que puso la idempotencia del correo en un UNIQUE.
--   b. SECURITY DEFINER evita que la ruta necesite la llave de servicio para
--      contar el consumo GLOBAL (que con RLS de dueño solo vería el propio).
--      Los call-sites de SUPABASE_SERVICE_ROLE_KEY **siguen en 8**: no sube.
--   c. **No hay ventana lee-y-escribe.** Contar en el servicio y luego insertar
--      es exactamente la carrera que este repo ya declaró dos veces (B82-1(a) y
--      B91-2). Aquí se cuenta y se inserta bajo el mismo advisory lock, así que
--      dos peticiones simultáneas no pueden pasar las dos.
--
-- El lock es GLOBAL y no por perfil, a propósito: con pocos usuarios y un
-- conteo de microsegundos la contención es nula, y a cambio los TRES límites
-- quedan exactos — incluido el global, que con un lock por perfil admitiría de
-- más.
--
-- (3) LO QUE **NO** REGISTRA, y por qué.
--
--   · **El texto de la pregunta.** Es lo que el usuario escribió y puede llevar
--     el nombre de un cliente. Guardarlo crearía una clase de dato que hoy no
--     existe y que nadie pidió. Se registra QUÉ intención resultó, no qué se
--     preguntó.
--   · **Los rechazos.** Solo se inserta cuando la pregunta ENTRA. Si un rechazo
--     dejara fila, un bucle rechazado escribiría millones — el limitador se
--     convertiría en el vector del problema que existe para evitar. Consecuencia
--     aceptada y declarada: «cuántas veces se topó la gente con el techo» NO se
--     puede consultar de aquí; sale del registro de la aplicación.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Un CREATE TABLE que nace VACÍA y un CREATE FUNCTION nuevo. Cero
--      DELETE, cero UPDATE, cero ALTER sobre tablas existentes. Revertir es
--      DROP FUNCTION + DROP TABLE y no pierde nada de nadie: la tabla no guarda
--      configuración, guarda consumo pasado.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** No toca ninguna tabla existente. La única referencia hacia fuera
--      es la FK a perfiles(id) con ON DELETE CASCADE, que es lectura del
--      catálogo de perfiles, no escritura. La guarda cuenta tablas y funciones
--      antes y después y aborta si el delta no es el esperado.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      Que la ruta del chat llame de verdad a la función ANTES de gastar un
--      token. Una función que nadie llama deja el techo en el papel. Se declara
--      en el RAISE NOTICE final y se prueba desde la aplicación.
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b10.tablas_antes',
    (SELECT count(*)::text FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'consumo_chat'), false);
  PERFORM set_config('inv_b10.funcs_antes',
    (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'chat_registrar_pregunta'), false);
END
$antes$;

-- ------------------------------------------------------------
-- (1) EL REGISTRO
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumo_chat (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sin DEFAULT auth.uid(): lo pone la función, que es la única que escribe.
  -- Un default aquí sería un NULL silencioso el día que la escriba otra cosa.
  perfil_id      uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,

  preguntado_en  timestamptz NOT NULL DEFAULT now(),

  -- Intención resuelta, o NULL cuando el enrutador dijo «no sé».
  -- NO es el texto de la pregunta.
  intencion      text CHECK (intencion IS NULL OR length(btrim(intencion)) BETWEEN 1 AND 40),

  -- Modelo que se usó. Va aquí porque el costo por pregunta depende de él y
  -- cambiará: sin esta columna, una factura futura no se podría explicar.
  modelo         text CHECK (modelo IS NULL OR length(btrim(modelo)) BETWEEN 1 AND 60),

  tokens_entrada integer CHECK (tokens_entrada IS NULL OR tokens_entrada >= 0),
  tokens_salida  integer CHECK (tokens_salida  IS NULL OR tokens_salida  >= 0)
);

-- Las dos consultas que hace el limitador: por perfil en una ventana, y global
-- en una ventana. Un índice por cada una, porque son los dos únicos accesos.
CREATE INDEX IF NOT EXISTS idx_consumo_chat_perfil_tiempo
  ON public.consumo_chat(perfil_id, preguntado_en DESC);
CREATE INDEX IF NOT EXISTS idx_consumo_chat_tiempo
  ON public.consumo_chat(preguntado_en DESC);

COMMENT ON TABLE public.consumo_chat IS
  '[INV-B10] Registro de preguntas SERVIDAS del chat. Es a la vez la bitacora de consumo y el sustrato del techo: el limite se cuenta sobre estas filas, no sobre un contador aparte, para que no haya dos verdades que desincronizar. NO guarda el texto de la pregunta (puede llevar nombres de clientes) ni las preguntas RECHAZADAS (un bucle rechazado escribiria sin tope). Solo la escribe chat_registrar_pregunta(), que es SECURITY DEFINER; la tabla no tiene ninguna policy.';

-- ------------------------------------------------------------
-- (2) EL CIERRE. RLS activa y CERO policies = nadie autenticado la alcanza.
--     Los REVOKE son la segunda vuelta de llave, igual que en envios_aviso.
-- ------------------------------------------------------------
ALTER TABLE public.consumo_chat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.consumo_chat FROM anon, authenticated;

-- ------------------------------------------------------------
-- (3) EL TECHO
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_registrar_pregunta(
  p_por_hora   integer,
  p_por_dia    integer,
  p_global_dia integer,
  p_intencion  text DEFAULT NULL,
  p_modelo     text DEFAULT NULL,
  p_tok_in     integer DEFAULT NULL,
  p_tok_out    integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- search_path fijo: sin esto, un esquema del llamador podría interponer una
-- tabla consumo_chat propia y esta función la escribiría con privilegios de su
-- dueño. Es el requisito estándar de toda SECURITY DEFINER.
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_perfil uuid := auth.uid();
  v_hora   integer;
  v_dia    integer;
  v_global integer;
BEGIN
  -- Sin sesión no hay techo que aplicar ni a quién cobrarle. La ruta ya exige
  -- sesión; esto es la segunda puerta, la que no depende de la aplicación.
  IF v_perfil IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'sin_sesion');
  END IF;

  IF p_por_hora < 1 OR p_por_dia < 1 OR p_global_dia < 1 THEN
    RAISE EXCEPTION '0028: los topes tienen que ser positivos (hora=%, dia=%, global=%)',
      p_por_hora, p_por_dia, p_global_dia;
  END IF;

  -- CONTAR E INSERTAR BAJO EL MISMO LOCK. Sin esto, dos peticiones simultáneas
  -- leen el mismo conteo y entran las dos: la carrera de B82-1(a) otra vez.
  -- El lock se suelta solo al terminar la transacción.
  PERFORM pg_advisory_xact_lock(hashtext('inv_b10.chat'));

  SELECT count(*) INTO v_hora
    FROM public.consumo_chat
   WHERE perfil_id = v_perfil AND preguntado_en > now() - interval '1 hour';

  SELECT count(*) INTO v_dia
    FROM public.consumo_chat
   WHERE perfil_id = v_perfil AND preguntado_en > now() - interval '1 day';

  SELECT count(*) INTO v_global
    FROM public.consumo_chat
   WHERE preguntado_en > now() - interval '1 day';

  IF v_hora >= p_por_hora THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'tope_hora',
                              'usadas', v_hora, 'tope', p_por_hora);
  END IF;
  IF v_dia >= p_por_dia THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'tope_dia',
                              'usadas', v_dia, 'tope', p_por_dia);
  END IF;
  IF v_global >= p_global_dia THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'tope_global',
                              'usadas', v_global, 'tope', p_global_dia);
  END IF;

  INSERT INTO public.consumo_chat (perfil_id, intencion, modelo, tokens_entrada, tokens_salida)
  VALUES (v_perfil, p_intencion, p_modelo, p_tok_in, p_tok_out);

  RETURN jsonb_build_object('permitido', true,
                            'restantes_hora',   p_por_hora   - v_hora   - 1,
                            'restantes_dia',    p_por_dia    - v_dia    - 1,
                            'restantes_global', p_global_dia - v_global - 1);
END
$fn$;

COMMENT ON FUNCTION public.chat_registrar_pregunta(integer, integer, integer, text, text, integer, integer) IS
  '[INV-B10] Decide si una pregunta del chat entra, y la registra en el mismo paso. Cuenta e inserta bajo un pg_advisory_xact_lock para que no exista la ventana lee-y-escribe. SECURITY DEFINER para poder contar el consumo GLOBAL sin que la ruta necesite la llave de servicio. Los topes son PARAMETROS y no constantes: se calibran desde la aplicacion, no con una migracion.';

-- La función es lo ÚNICO que authenticated puede tocar de este subsistema: la
-- tabla le está revocada, así que no hay forma de contar, leer ni borrar su
-- propio consumo para reiniciarse el techo.
--
-- ⚠️ SE REVOCA A `anon` POR SU NOMBRE, y NO basta con `FROM PUBLIC`.
--
-- Medido al aplicar esta migración por primera vez: la guarda abortó con
-- «anon puede EJECUTAR la funcion (1 grants)». La causa está en el
-- `pg_default_acl` de esta base, que el propio aplicador imprime antes de cada
-- corrida:
--
--     dueño=postgres  tipo=f  {postgres=X/postgres,anon=X/postgres,
--                              authenticated=X/postgres,service_role=X/postgres}
--
-- O sea: **toda función nueva de `public` nace con EXECUTE concedido a `anon`**,
-- explícitamente y por nombre. `REVOKE … FROM PUBLIC` revoca del pseudo-rol
-- PUBLIC y **no toca una concesión nominal**, así que dejaba la puerta abierta.
--
-- En una función SECURITY DEFINER eso no es un detalle: sería una función que
-- corre con privilegios de su dueño y que puede llamar cualquiera **sin haber
-- iniciado sesión**. Aquí el daño concreto habría sido acotado —`auth.uid()` es
-- NULL sin sesión y la función devuelve `sin_sesion` sin escribir— pero el
-- patrón es el peligroso, no este caso.
--
-- ⚠️ EL ALCANCE, MEDIDO — y es más chico de lo que yo dije.
--
-- Llamé a esto «un hallazgo de seguridad de toda la base», y eso se lee como
-- una brecha viva. **El mecanismo es real; la exposición es cero.** Recorridas
-- las funciones de `public`:
--
--     SECURITY DEFINER : n   →  `authenticated` en la mayoría, NADIE en el resto
--     invoker          :  1  →  PUBLIC, anon, authenticated
--
-- **Ni una sola SECURITY DEFINER es alcanzable por `anon`.** El riesgo real
-- —función que corre como su dueño y la llama cualquiera sin sesión— NO existe
-- hoy aquí, y las migraciones anteriores revocaron bien: la disciplina ya
-- estaba, y ésta fue la primera que estuvo a punto de saltársela.
--
-- La única con `anon` es `tocar_actualizado_en`, de la 0024. Nadie le escribió
-- ese GRANT: **nació con él**, que es la huella del default ACL cazada en el
-- acto. No importa porque es `invoker` —corre con los privilegios de quien
-- llama y no escala nada— y es una función de trigger, que fuera de un trigger
-- falla sola. Pero es la prueba de que la siguiente sí habría dolido.
REVOKE ALL ON FUNCTION public.chat_registrar_pregunta(integer, integer, integer, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_registrar_pregunta(integer, integer, integer, text, text, integer, integer) TO authenticated;

-- ------------------------------------------------------------
-- (4) GUARDA — por efecto donde se puede, y declarando lo que no.
-- ------------------------------------------------------------
DO $guarda0028$
DECLARE
  v_tablas_antes integer := coalesce(nullif(current_setting('inv_b10.tablas_antes', true), ''), '0')::integer;
  v_funcs_antes  integer := coalesce(nullif(current_setting('inv_b10.funcs_antes',  true), ''), '0')::integer;
  v_tabla     integer;
  v_func      integer;
  v_rls       boolean;
  v_policies  integer;
  v_priv      integer;
  v_filas     bigint;
  v_secdef    boolean;
  v_path      text[];
  v_exec_auth integer;
  v_exec_anon integer;
BEGIN
  SELECT count(*) INTO v_tabla FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'consumo_chat';
  IF v_tabla <> 1 OR v_tablas_antes <> 0 THEN
    RAISE EXCEPTION '0028: consumo_chat antes=% despues=% (esperado 0 -> 1). Abortando.', v_tablas_antes, v_tabla;
  END IF;

  SELECT count(*) INTO v_func FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'chat_registrar_pregunta';
  IF v_func <> 1 THEN
    RAISE EXCEPTION '0028: chat_registrar_pregunta antes=% despues=% (esperado 1). Abortando.', v_funcs_antes, v_func;
  END IF;

  -- La tabla nace VACÍA. Si trajera filas, algo la escribió antes que nadie.
  EXECUTE 'SELECT count(*) FROM public.consumo_chat' INTO v_filas;
  IF v_filas <> 0 THEN
    RAISE EXCEPTION '0028: consumo_chat nace con % filas y deberia nacer vacia. Abortando.', v_filas;
  END IF;

  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.consumo_chat'::regclass;
  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION '0028: consumo_chat SIN row level security. Abortando.';
  END IF;

  SELECT count(*) INTO v_policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'consumo_chat';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '0028: consumo_chat tiene % policies y no debe tener NINGUNA. Abortando.', v_policies;
  END IF;

  SELECT count(*) INTO v_priv FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'consumo_chat' AND grantee IN ('anon', 'authenticated');
  IF v_priv <> 0 THEN
    RAISE EXCEPTION '0028: consumo_chat conserva % privilegios para anon/authenticated. Abortando.', v_priv;
  END IF;

  -- Que sea SECURITY DEFINER **y** con search_path fijo. Lo primero sin lo
  -- segundo es una escalada de privilegio esperando a que alguien la use.
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_path
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'chat_registrar_pregunta';
  IF NOT coalesce(v_secdef, false) THEN
    RAISE EXCEPTION '0028: chat_registrar_pregunta NO es SECURITY DEFINER; no podria contar el consumo global. Abortando.';
  END IF;
  IF v_path IS NULL OR NOT (array_to_string(v_path, ',') LIKE '%search_path=%') THEN
    RAISE EXCEPTION '0028: chat_registrar_pregunta es SECURITY DEFINER SIN search_path fijo. Abortando.';
  END IF;

  -- authenticated ejecuta la función; anon no.
  SELECT count(*) INTO v_exec_auth FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public' AND routine_name = 'chat_registrar_pregunta' AND grantee = 'authenticated';
  SELECT count(*) INTO v_exec_anon FROM information_schema.role_routine_grants
   WHERE routine_schema = 'public' AND routine_name = 'chat_registrar_pregunta' AND grantee = 'anon';
  IF v_exec_auth < 1 THEN
    RAISE EXCEPTION '0028: authenticated no puede EJECUTAR la funcion; el chat no podria registrar nada. Abortando.';
  END IF;
  IF v_exec_anon <> 0 THEN
    RAISE EXCEPTION '0028: anon puede EJECUTAR la funcion (% grants). Abortando.', v_exec_anon;
  END IF;

  RAISE NOTICE '0028 · consumo_chat creada VACIA con RLS activa, 0 policies y 0 privilegios para anon/authenticated; chat_registrar_pregunta es SECURITY DEFINER con search_path fijo, ejecutable por authenticated y no por anon.';
  RAISE NOTICE '0028 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI: que la ruta del chat llame a esta funcion ANTES de gastar un token. Una funcion que nadie llama deja el techo en el papel. Se prueba desde la aplicacion (gate de O3).';
END
$guarda0028$;
