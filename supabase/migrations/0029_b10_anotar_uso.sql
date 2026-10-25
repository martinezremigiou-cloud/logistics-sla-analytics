-- ============================================================
-- 0029 · [INV-B10] El consumo se anota en DOS fases, y por una razón de orden.
--
-- QUÉ ARREGLA. La 0028 dejó una función que cuenta e inserta en un solo paso.
-- Al escribir la ruta apareció que eso no alcanza, y el motivo es de secuencia:
--
--   · **El techo tiene que cobrarse ANTES de llamar al modelo.** Si se cobrara
--     después, un usuario que ya topó seguiría gastando una llamada por cada
--     intento — el bucle bloqueado seguiría pagando, que es exactamente lo que
--     el techo existe para impedir.
--   · Pero ANTES de llamar al modelo **no se sabe la intención ni los tokens**:
--     los produce la llamada.
--
-- La salida obvia era llamar dos veces a `chat_registrar_pregunta`: una para
-- cobrar y otra para anotar. **Eso habría insertado DOS filas por pregunta**,
-- con dos consecuencias feas: el techo efectivo se habría partido a la mitad y
-- el registro habría contado el doble de preguntas de las que hubo. Un
-- limitador que se cuenta a sí mismo mal es peor que no tenerlo, porque
-- convence.
--
-- Así que: `chat_registrar_pregunta` **devuelve el `id` de la fila** que creó, y
-- una función nueva la completa. Una pregunta, una fila.
--
-- ────────────────────────────────────────────────────────────
-- LA ANOTACIÓN ES IDEMPOTENTE, con el molde de `confirmarEnvio` (B9.1).
--
-- Solo completa filas que **todavía no se han anotado** (`tokens_entrada IS
-- NULL`). Anotar dos veces da el mismo resultado que anotar una, y una segunda
-- llamada no puede pisar el consumo ya registrado con otro número.
--
-- Y solo toca filas **del propio perfil** (`perfil_id = auth.uid()`). Sin eso,
-- cualquiera con un `id` ajeno podría escribir consumo en el registro de otro —
-- la función es SECURITY DEFINER, así que la RLS no la frena: **el filtro por
-- dueño ES la autorización aquí**, no un adorno.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Un CREATE OR REPLACE que solo AGREGA un campo al jsonb que ya
--      devolvía, y un CREATE FUNCTION nuevo. Cero DDL sobre tablas, cero
--      DELETE, cero UPDATE de datos existentes. `consumo_chat` estaba vacía al aplicar.
--      Revertir es reponer la función anterior y hacer DROP de la nueva.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** Toca dos funciones y ninguna tabla. El único consumidor de
--      `chat_registrar_pregunta` es `/api/chat`, que todavía no está desplegado.
--      La guarda comprueba que las dos existan, que sean SECURITY DEFINER con
--      search_path fijo, y que `anon` no pueda ejecutar ninguna.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      Que la ruta llame a `chat_anotar_uso` con el `id` que le devolvió la
--      primera. Si no lo hiciera, el techo seguiría bien pero el registro
--      quedaría sin intención ni tokens — se vería sano y no explicaría nada.
--      Se declara en el RAISE NOTICE y se prueba desde la aplicación.
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b10.anotar_antes',
    (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'chat_anotar_uso'), false);
END
$antes$;

-- ------------------------------------------------------------
-- (1) La de la 0028, ahora devolviendo el `id` de la fila que creó.
--     Mismo cuerpo, mismo lock, misma decisión: lo único que cambia es que
--     ahora se puede volver a encontrar lo que insertó.
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
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_perfil uuid := auth.uid();
  v_hora   integer;
  v_dia    integer;
  v_global integer;
  v_id     uuid;
BEGIN
  IF v_perfil IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'sin_sesion');
  END IF;

  IF p_por_hora < 1 OR p_por_dia < 1 OR p_global_dia < 1 THEN
    RAISE EXCEPTION '0029: los topes tienen que ser positivos (hora=%, dia=%, global=%)',
      p_por_hora, p_por_dia, p_global_dia;
  END IF;

  -- Contar e insertar bajo el mismo lock. Sin esto, dos peticiones simultáneas
  -- leen el mismo conteo y entran las dos: la carrera de B82-1(a).
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
  VALUES (v_perfil, p_intencion, p_modelo, p_tok_in, p_tok_out)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('permitido', true,
                            'id', v_id,
                            'restantes_hora',   p_por_hora   - v_hora   - 1,
                            'restantes_dia',    p_por_dia    - v_dia    - 1,
                            'restantes_global', p_global_dia - v_global - 1);
END
$fn$;

-- ------------------------------------------------------------
-- (2) La segunda fase: completar lo que solo se sabe DESPUÉS de preguntar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_anotar_uso(
  p_id        uuid,
  p_intencion text,
  p_modelo    text,
  p_tok_in    integer,
  p_tok_out   integer
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
     SET intencion      = coalesce(p_intencion, intencion),
         modelo         = coalesce(p_modelo, modelo),
         tokens_entrada = p_tok_in,
         tokens_salida  = p_tok_out
   WHERE id = p_id
     -- LA AUTORIZACIÓN. Esta función es SECURITY DEFINER, así que la RLS no la
     -- frena: sin este filtro, cualquiera con un id ajeno escribiría consumo en
     -- el registro de otro.
     AND perfil_id = v_perfil
     -- IDEMPOTENTE, con el molde de `confirmarEnvio`: solo completa lo que
     -- todavía no se anotó, así que una segunda llamada no pisa el consumo ya
     -- registrado con otro número.
     AND tokens_entrada IS NULL;

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  RETURN v_filas > 0;
END
$anotar$;

COMMENT ON FUNCTION public.chat_anotar_uso(uuid, text, text, integer, integer) IS
  '[INV-B10] Segunda fase del registro del chat: completa la intencion y los tokens de una fila que `chat_registrar_pregunta` ya creo. Existe porque el techo se cobra ANTES de llamar al modelo (si no, un bucle bloqueado seguiria pagando) y en ese momento todavia no se sabe ni la intencion ni el consumo. Idempotente (solo toca filas sin anotar) y acotada al propio perfil (el filtro por dueno ES la autorizacion: es SECURITY DEFINER y la RLS no la frena).';

-- El default ACL de esta base concede EXECUTE a `anon` POR NOMBRE en toda
-- función nueva de `public`; `FROM PUBLIC` no toca una concesión nominal.
-- Medido al aplicar la 0028, donde la guarda abortó por esto exactamente.
REVOKE ALL ON FUNCTION public.chat_anotar_uso(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_anotar_uso(uuid, text, text, integer, integer) TO authenticated;

-- `CREATE OR REPLACE` sobre la de la 0028 **no** restablece su ACL, pero se
-- reafirma: cuesta nada y quita la duda de si un replace lo tocó.
REVOKE ALL ON FUNCTION public.chat_registrar_pregunta(integer, integer, integer, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_registrar_pregunta(integer, integer, integer, text, text, integer, integer) TO authenticated;

-- ------------------------------------------------------------
-- (3) GUARDA — por efecto, y declarando lo que no puede ver.
-- ------------------------------------------------------------
DO $guarda0029$
DECLARE
  v_antes    integer := coalesce(nullif(current_setting('inv_b10.anotar_antes', true), ''), '0')::integer;
  r          record;
  v_exec_auth integer;
  v_exec_anon integer;
  v_filas    bigint;
BEGIN
  IF v_antes <> 0 THEN
    RAISE EXCEPTION '0029: chat_anotar_uso ya existia antes de esta migracion (%). Abortando.', v_antes;
  END IF;

  -- Las DOS funciones, con las mismas exigencias. Se recorren en bucle para que
  -- no exista la posibilidad de comprobar una y olvidar la otra.
  FOR r IN
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('chat_registrar_pregunta', 'chat_anotar_uso')
  LOOP
    IF NOT coalesce(r.prosecdef, false) THEN
      RAISE EXCEPTION '0029: %() NO es SECURITY DEFINER. Abortando.', r.proname;
    END IF;
    IF r.proconfig IS NULL OR NOT (array_to_string(r.proconfig, ',') LIKE '%search_path=%') THEN
      RAISE EXCEPTION '0029: %() es SECURITY DEFINER SIN search_path fijo. Abortando.', r.proname;
    END IF;

    SELECT count(*) INTO v_exec_auth FROM information_schema.role_routine_grants
     WHERE routine_schema = 'public' AND routine_name = r.proname AND grantee = 'authenticated';
    SELECT count(*) INTO v_exec_anon FROM information_schema.role_routine_grants
     WHERE routine_schema = 'public' AND routine_name = r.proname AND grantee = 'anon';

    IF v_exec_auth < 1 THEN
      RAISE EXCEPTION '0029: authenticated no puede EJECUTAR %(). Abortando.', r.proname;
    END IF;
    IF v_exec_anon <> 0 THEN
      RAISE EXCEPTION '0029: anon puede EJECUTAR %() (% grants). Abortando.', r.proname, v_exec_anon;
    END IF;
  END LOOP;

  -- El registro sigue vacío: esta migración no crea consumo.
  EXECUTE 'SELECT count(*) FROM public.consumo_chat' INTO v_filas;
  IF v_filas <> 0 THEN
    RAISE EXCEPTION '0029: consumo_chat tiene % filas y esta migracion no deberia crear ninguna. Abortando.', v_filas;
  END IF;

  RAISE NOTICE '0029 · chat_registrar_pregunta ahora devuelve el id de la fila; chat_anotar_uso creada. Las dos SECURITY DEFINER con search_path fijo, ejecutables por authenticated y NO por anon. consumo_chat sigue en 0 filas.';
  RAISE NOTICE '0029 · LO QUE NO PUEDE COMPROBAR DESDE AQUI: que la ruta llame a chat_anotar_uso con el id que le devolvio la primera. Si no lo hiciera, el techo seguiria bien pero el registro quedaria sin intencion ni tokens — se veria sano y no explicaria nada. Se prueba desde la aplicacion.';
END
$guarda0029$;
