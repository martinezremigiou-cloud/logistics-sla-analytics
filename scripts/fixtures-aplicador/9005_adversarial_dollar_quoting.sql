-- ============================================================
-- FIXTURE ADVERSARIAL · un "COMMIT;" (y un "BEGIN;") de EJEMPLO dentro de
-- un comentario /* ... */ que a su vez vive DENTRO de un cuerpo con
-- dollar-quoting ($doc$...$doc$), ambos a inicio de línea. Esta migración
-- en sí NO usa transacción explícita propia (implícita) -- pero una regex
-- cruda sobre el texto del archivo no distingue "dentro de un cuerpo
-- $doc$...$doc$" de "nivel superior", y splicearía el registro del ledger
-- DENTRO de la definición de la función: texto inerte para el ledger (la
-- función se crearía igual, con ese texto de más en su cuerpo, pero el
-- INSERT jamás correría como sentencia propia).
--
-- ESPERADO (tras el fix del lexer): 0 transacciones explícitas reales
-- (nBegin=0, nCommit=0 de nivel superior — lexear() colapsa TODO el cuerpo
-- $doc$...$doc$ a un solo token opaco), registro al FINAL del archivo.
-- ============================================================
CREATE OR REPLACE FUNCTION public._prueba_s5_doc_ejemplo() RETURNS void
LANGUAGE plpgsql
AS $doc$
/*
  Ejemplo de transaccion explicita:
    BEGIN;
    COMMIT;
*/
BEGIN
  NULL;
END;
$doc$;
