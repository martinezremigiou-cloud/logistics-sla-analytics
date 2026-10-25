-- ============================================================
-- FIXTURE ADVERSARIAL · un "COMMIT;" (y un "BEGIN;") de EJEMPLO dentro de
-- un comentario de bloque /* ... */, ambos a inicio de línea. Esta
-- migración en sí NO usa transacción explícita (implícita, sin BEGIN;/
-- COMMIT; propios) -- pero una regex cruda sobre el texto del archivo
-- (`/^[ \t]*COMMIT[ \t]*;/im`) "ve" ese COMMIT; de ejemplo como si fuera de
-- nivel superior real, y lo usaría para decidir DÓNDE splicear el registro
-- del ledger -- dentro del comentario, texto inerte que nunca se ejecuta.
--
-- ESPERADO (tras el fix del lexer): 0 transacciones explícitas reales
-- (nBegin=0, nCommit=0 de nivel superior), registro al FINAL del archivo,
-- nunca dentro del comentario.
-- ============================================================
/*
  Convención de este repo para transacciones explícitas (ver 0004-0012):
    BEGIN;
    ... contenido de la migración ...
    COMMIT;
  Este archivo, en cambio, usa transacción implícita.
*/
SELECT 1;
