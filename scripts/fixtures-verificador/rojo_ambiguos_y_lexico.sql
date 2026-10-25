-- Fixture ROJO 2: ambiguedades (fail-closed) y errores lexicos.
BEGIN;

CREATE OR REPLACE FUNCTION k1() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_a text;
BEGIN
  -- ESPERA linea 8: RAISE_AMBIGUO (corchete de nivel superior en los args)
  RAISE EXCEPTION 'lista %', ARRAY['a', 'b'];

  -- ESPERA linea 11: RAISE_AMBIGUO (dos literales adyacentes SIN salto de linea)
  RAISE EXCEPTION 'parte uno %' ' parte dos', v_a;

  -- ESPERA linea 14: RAISE_AMBIGUO (el formato es una variable, no un literal)
  RAISE EXCEPTION v_a;
END;
$$;

-- ESPERA: PARENTESIS_FALTAN (falta cerrar) en el nivel superior
CREATE TABLE t (
  a int,
  b int
;

COMMIT;
