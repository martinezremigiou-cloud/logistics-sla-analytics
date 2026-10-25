-- ============================================================
-- FIXTURE · transacción EXPLÍCITA (BEGIN;...COMMIT;), sin hallazgos para
-- verificar-migracion.mjs (0 RAISE, 0 cuerpos $...$).
--
-- Usada por aplicar-migracion.test.ts para probar, sin tocar la red, que
-- el registro en el ledger (G3.1) se previsualiza en --dry con
-- posición = "antes del COMMIT; ... (transacción explícita)".
-- ============================================================
BEGIN;

SELECT 1;

COMMIT;
