-- Fixture VERDE: todo esto es RAISE CORRECTO. Ni un solo hallazgo.
BEGIN;

CREATE OR REPLACE FUNCTION f1() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_a text; v_b int; v_def text;
BEGIN
  -- (1) USING con VARIAS opciones separadas por coma de nivel superior:
  --     0 marcadores, 0 argumentos. Si el verificador contara el USING
  --     diria "2 argumentos" y daria falso positivo.
  RAISE EXCEPTION 'sin marcadores' USING errcode = '22023', hint = 'a, b, c', detail = 'x';

  -- (2) coma DENTRO de parentesis: 1 marcador, 1 argumento
  RAISE EXCEPTION 'def=%', coalesce(v_def, '(inexistente)');

  -- (3) coma DENTRO de un literal: 1 marcador, 1 argumento
  RAISE EXCEPTION 'lista: %', 'uno, dos, tres';

  -- (4) %% literal + 1 marcador real: 1 argumento
  RAISE NOTICE 'avance 100%% del lote %', v_b;

  -- (5) comilla escapada '' dentro de la cadena, sin marcadores
  RAISE EXCEPTION 'no existe snapshot de fuente ''stock'' — abortando.';

  -- (6) multilinea: 2 marcadores, 2 argumentos en otra linea
  RAISE EXCEPTION
      'SKU inmutable: no se puede modificar el SKU (% -> %)',
      v_a, v_b;

  -- (7) 3 marcadores, 3 argumentos, con USING al final
  RAISE WARNING 'a=% b=% c=%', v_a, v_b, v_a USING errcode = '01000';

  -- (8) parentesis anidados y funciones con varios argumentos
  RAISE INFO 'total=%', greatest(coalesce(v_b, 0), least(1, 2, 3));

  -- (9) formas SIN cadena de formato
  RAISE EXCEPTION USING message = 'via USING', errcode = 'P0002';
  RAISE division_by_zero;
  RAISE EXCEPTION SQLSTATE '22012' USING message = 'x';
  RAISE LOG 'nada que formatear';

  -- (11) porcentaje literal solo: 0 marcadores, 0 argumentos
  RAISE NOTICE '100%% aplicado';

  -- (12) el % vive en el USING, NO en la cadena de formato: 0 y 0
  RAISE EXCEPTION 'sin marcador' USING hint = 'subio 20% el mes pasado';

  -- (13) el % vive en un ARGUMENTO, no en el formato: 1 marcador, 1 argumento
  RAISE NOTICE '%', 'un valor con % adentro';

  -- (14) continuacion estandar SQL: dos literales separados por salto de
  --      linea son UNA sola cadena de formato -> 1 marcador, 1 argumento
  RAISE EXCEPTION 'primera parte con %'
                  ' y segunda parte sin marcador'
      , v_a;

  /* comentario de bloque con /* anidado */ que menciona
     RAISE EXCEPTION 'esto % no existe'; y no debe contarse */
  -- RAISE EXCEPTION 'comentario de linea con % suelto';

  BEGIN
    RAISE; -- re-lanza
  EXCEPTION WHEN others THEN
    RAISE;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION f2() RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_a text;
BEGIN
  RAISE EXCEPTION 'cuerpo con tag: %', 1;
  -- (10) dollar-quoting DENTRO de un literal: no abre ningun cuerpo.
  -- (Va en un cuerpo con tag propio, porque un doble-dolar dentro de un
  -- cuerpo de doble-dolar SI lo terminaria: eso es Postgres, no el
  -- verificador. Y el delimitador de cierre se busca de forma LEXICA:
  -- escribirlo dentro de un comentario tambien cierra el cuerpo.)
  RAISE DEBUG 'un texto con $$ y $p9$ adentro, y un % de verdad', v_a;
END;
$fn$;

DO $p3$
DECLARE v_n int := 1;
BEGIN
  RAISE NOTICE 'anidado: % · % · %', v_n, v_n, v_n;
END $p3$;

COMMIT;
