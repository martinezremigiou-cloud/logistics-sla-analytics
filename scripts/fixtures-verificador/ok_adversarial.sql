-- Fixture VERDE ADVERSARIAL: intentos de romper el verificador.
-- Todo esto es SQL correcto: no debe salir ni un hallazgo.
BEGIN;

CREATE OR REPLACE FUNCTION h1() RETURNS void LANGUAGE plpgsql AS $ext$
DECLARE v_a text;
BEGIN
  -- (A) ';' y ',' DENTRO de literales que son argumentos:
  --     1 marcador, 1 argumento (el ';' del literal no cierra la sentencia)
  RAISE EXCEPTION 'x=%', replace(v_a, ';', ',');

  -- (B) marcador pegado al final de la cadena
  RAISE NOTICE 'termina en marcador %', v_a;

  -- (C) comentario de linea CON ';' en medio de la sentencia multilinea
  RAISE EXCEPTION 'a=% b=%',   -- ojo: aqui va un ; de mentiras
        v_a,                   /* y aqui otro ; dentro de bloque */
        upper(v_a);

  -- (D) parentesis dentro de literales (no alteran la profundidad)
  RAISE EXCEPTION 'def=%', coalesce(v_a, '(inexistente) ) ) (');

  -- (E) el nivel omitido: 'RAISE ''texto %'', arg' equivale a EXCEPTION
  RAISE 'nivel omitido: %', v_a;

  -- (F) USING con parentesis y comas dentro, tras argumentos de formato
  RAISE EXCEPTION 'sku %', v_a USING errcode = 'P0002', hint = concat('a', 'b', 'c');

  -- (G) cuerpo ANIDADO con otro tag: el RAISE de adentro tambien se revisa
  EXECUTE $inner$
    DO $mas$
    BEGIN
      RAISE NOTICE 'anidado a dos niveles: % y %', 1, 2;
    END $mas$;
  $inner$;
END;
$ext$;

COMMIT;
