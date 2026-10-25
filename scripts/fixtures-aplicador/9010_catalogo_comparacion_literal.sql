-- ============================================================
-- [S7-C bis · P21] FIXTURE ROJO de la regla 4 de verificar-migracion.mjs.
--
-- Cada bloque de abajo es una forma distinta de la MISMA falla: comparar la
-- salida de `pg_get_function_identity_arguments()` -- que renderiza la lista
-- de identidad CON el nombre del parametro -- contra un literal de texto.
-- Es el bug real de `0022:421`, que era falso siempre y hacia abortar la
-- migracion acusando a `ingest_snapshot` de no existir.
--
-- ESPERADO: exit != 0, con
--   · CATALOGO_COMPARACION_TEXTUAL en las lineas 25, 31, 37, 43, 49, 55 y 62
--   · CATALOGO_COMPARACION_AMBIGUA en la linea 69 (compara contra una
--     variable: no se puede afirmar estaticamente -> revision humana)
-- Si algun dia esta fixture sale en verde, la regla 4 se rompio.
-- ============================================================
DO $rojo$
DECLARE
  v_oid oid;
  v_firma text := 'payload jsonb';
BEGIN
  -- (1) el orden clasico, con '='  → el caso literal de 0022
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid) = 'jsonb';

  -- (2) el orden invertido: el literal a la izquierda
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND 'jsonb' = pg_get_function_identity_arguments(p.oid);

  -- (3) desigualdad con <>
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid) <> 'jsonb';

  -- (4) desigualdad con !=
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid) != 'jsonb';

  -- (5) lista IN (...)
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid) IN ('jsonb', 'json');

  -- (6) LIKE, que "casi" funciona y por eso es peor
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%jsonb%';

  -- (7) con un cast de por medio, para que no baste con mirar el token
  --     inmediatamente posterior al parentesis de cierre
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid)::text = 'jsonb';

  -- (8) contra una VARIABLE: fail-closed, AMBIGUO y no ERROR — nadie puede
  --     afirmar estaticamente que valdra v_firma en tiempo de ejecucion.
  SELECT p.oid INTO v_oid
    FROM pg_proc p
   WHERE p.proname = 'ingest_snapshot'
     AND pg_get_function_identity_arguments(p.oid) = v_firma;

  RAISE NOTICE 'fixture rojo de la regla 4, oid=%', v_oid;
END;
$rojo$;
