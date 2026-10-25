-- ============================================================
-- [S7-C bis · P21] CONTROL NEGATIVO OBLIGATORIO de la regla 4.
--
-- Todo lo de abajo es la cadena exacta del bug, pero NINGUNA de las
-- apariciones es un predicado: viven en comentarios y en literales de texto.
-- Una regla escrita con un `grep`/regex cruda marcaria este archivo entero y
-- estaria cazando un TEXTO, no una COMPARACION — y mandaria a "corregir" una
-- linea que no se ejecuta.
--
-- Esto no es hipotetico. `supabase/migrations/0022_repro_registro_de_forzado.sql`
-- cita la linea VIEJA (la equivocada) dentro de un comentario `--`, en las
-- lineas 421 y 423, y ese comentario vive DENTRO de un cuerpo `$...$`. Si la
-- regla mirara comentarios, marcaria la 0022 — que es justo el archivo donde
-- el bug YA esta corregido con `to_regprocedure`.
--
-- ESPERADO: exit 0, VERDE, y `0 pg_get_*() textual(es)` en la cabecera del
-- archivo: el lexer no emite ni un token por ninguna de estas apariciones.
-- ============================================================

-- Comentario de linea, a nivel superior:
--     AND pg_get_function_identity_arguments(p.oid) = 'jsonb'

/*
  Comentario de bloque, a nivel superior:
      AND pg_get_function_identity_arguments(p.oid) = 'jsonb'
      AND 'jsonb' = pg_get_function_identity_arguments(p.oid)
*/

DO $control$
BEGIN
  -- Comentario de linea DENTRO de un cuerpo $...$ — la forma exacta de la
  -- nota de correccion de 0022:421:
  --
  --     AND pg_get_function_identity_arguments(p.oid) = 'jsonb'
  --
  -- y era FALSA SIEMPRE.

  /*
    Y de bloque, tambien dentro del cuerpo:
        AND pg_get_function_identity_arguments(p.oid) IN ('jsonb')
  */

  -- Y como LITERAL DE TEXTO: aqui la cadena si llega al lexer, pero como UN
  -- token `cadena` opaco. No hay ninguna palabra `pg_get_...` que emparejar.
  RAISE NOTICE 'la linea vieja decia: AND pg_get_function_identity_arguments(p.oid) = ''jsonb''';
END;
$control$;
