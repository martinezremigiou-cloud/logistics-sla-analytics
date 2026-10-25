-- Fixture ROJO: cada RAISE de abajo esta roto. Se espera 1 hallazgo por
-- cada linea marcada con "-- ESPERA:".
BEGIN;

CREATE OR REPLACE FUNCTION g1() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_sku text; v_n int;
BEGIN
  -- ESPERA linea 9: RAISE_POCOS_ARGS (el bug real de 0011:395)
  RAISE EXCEPTION 'sku % inexistente en productos' USING errcode = 'P0002';

  -- ESPERA linea 12: RAISE_POCOS_ARGS (2 marcadores, 1 argumento)
  RAISE EXCEPTION 'de % a %', v_sku;

  -- ESPERA linea 15: RAISE_MUCHOS_ARGS (1 marcador, 2 argumentos)
  RAISE NOTICE 'solo uno: %', v_sku, v_n;

  -- ESPERA linea 18: RAISE_POCOS_ARGS (el %% no cuenta, el % suelto si)
  RAISE NOTICE '100%% de % filas';

  -- ESPERA linea 21: RAISE_MUCHOS_ARGS (0 marcadores, 1 argumento)
  RAISE EXCEPTION 'texto plano', v_sku;

  -- ESPERA linea 24: RAISE_ARG_VACIO (coma de mas)
  RAISE EXCEPTION 'a % b %', v_sku, , v_n;

  -- ESPERA linea 27: RAISE_SINTAXIS (formato armado con ||, plpgsql lo rechaza)
  RAISE EXCEPTION 'prefijo ' || v_sku;
END;
$$;

COMMIT;
