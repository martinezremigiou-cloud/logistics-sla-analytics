-- ============================================================
-- FIXTURE · transacción IMPLÍCITA (sin BEGIN;/COMMIT; propios), sin
-- hallazgos para verificar-migracion.mjs (0 RAISE, 0 cuerpos $...$).
--
-- Usada por aplicar-migracion.test.ts para probar, sin tocar la red, que
-- el registro en el ledger (G3.1) se previsualiza en --dry con
-- posición = "al final del archivo (transacción implícita)".
-- ============================================================
SELECT 1;
