-- ============================================================
-- [S7-C bis · P21] FIXTURE VERDE · la forma CORRECTA no se marca.
--
-- Si la regla 4 se disparara aqui, seria inservible: estaria empujando a la
-- gente de vuelta a la comparacion de texto que causo el bug. `to_regprocedure`
-- resuelve por FIRMA DE TIPOS y devuelve NULL si la funcion no existe, que es
-- exactamente la semantica que la guarda de 0022 queria.
--
-- Incluye tambien el uso LEGITIMO de la funcion de catalogo: leerla para
-- imprimirla en un mensaje. Eso no es un predicado y no debe marcarse.
--
-- ESPERADO: exit 0, VERDE, y el contador de la cabecera del archivo tiene que
-- decir `1 pg_get_*() textual(es)` — la regla MIRO la llamada legitima y
-- decidio no marcarla. Si dijera 0, la regla no habria mirado nada y el verde
-- no valdria nada (P6).
-- ============================================================
DO $verde$
DECLARE
  v_oid oid;
  v_args text;
BEGIN
  -- La forma correcta: identidad, no texto.
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.ingest_snapshot(jsonb)');

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ingest_snapshot(jsonb) no existe. Abortando.';
  END IF;

  -- Uso legitimo: leer la lista para poder DECIRLA en el mensaje. No es un
  -- predicado; nadie decide nada con una comparacion de texto.
  SELECT pg_get_function_identity_arguments(v_oid) INTO v_args;
  RAISE NOTICE 'ingest_snapshot quedo con la lista de identidad: %', v_args;
END;
$verde$;
