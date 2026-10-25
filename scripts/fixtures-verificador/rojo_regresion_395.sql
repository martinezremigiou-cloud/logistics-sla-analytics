-- ============================================================
-- FIXTURE DE REGRESION PERMANENTE · el bug real de 0011_taxo.sql:395
--
-- Esto es lo que tumbo la migracion [INV-TAXO] entera. La
-- transaccion aborto completa y la base quedo 100% intacta, porque
-- Postgres COMPILA el cuerpo plpgsql al CREAR la funcion:
--
--   ERROR 42601: too few parameters specified for RAISE
--
-- La forma del bug: cadena de formato con UN marcador '%', CERO argumentos
-- de formato, y una clausula USING detras. USING NO aporta argumentos de
-- formato — confundirlo es justo el error que deja pasar el bug.
--
-- La migracion se habia verificado cifra por cifra con SELECTs read-only
-- contra la BD viva... pero nunca se compilo. De ahi la leccion que este
-- verificador convierte en puerta:
--   "una migracion verificada que nunca se compilo es una cifra sin query".
--
-- ESPERADO: exit != 0, con RAISE_POCOS_ARGS senalando la LINEA 31.
-- Si algun dia esta fixture pasa en verde, el verificador se rompio.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.regresion_395() RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_sku text := 'QS1PQRMXDWR13K';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.productos WHERE sku = v_sku) THEN
    RAISE EXCEPTION 'sku % inexistente en productos' USING errcode = 'P0002'; END IF;
END;
$fn$;

COMMIT;
