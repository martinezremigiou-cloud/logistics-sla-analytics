-- Fixture ROJO 3: integridad LEXICA. El cuerpo $$ nunca se cierra, asi que
-- Postgres no podria ni parsear el archivo. El verificador debe reportar
-- LEX_DOLAR_ABIERTO (y NO intentar adivinar nada mas adentro).
-- Ojo: el BEGIN; del nivel superior tampoco tiene COMMIT;, pero el ambito
-- quedo roto y por eso no se reporta TX_ABIERTA: primero se arregla lo lexico.
BEGIN;
CREATE FUNCTION z() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE (cuerpo sin terminar);
END;
