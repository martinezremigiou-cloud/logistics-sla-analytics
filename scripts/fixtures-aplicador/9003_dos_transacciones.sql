-- ============================================================
-- FIXTURE · DOS transacciones explícitas de nivel superior en el mismo
-- archivo (caso ya señalado como STOP&ASK en docs/decisions/0005-migration-guards-and-replay.md,
-- regla 4). Sin hallazgos para verificar-migracion.mjs.
--
-- Usada por aplicar-migracion.test.ts para probar que el registro
-- automático en el ledger (G3.1) se OMITE a propósito cuando no hay un
-- único punto "antes del COMMIT" — nunca adivina dónde splicear.
-- ============================================================
BEGIN;
SELECT 1;
COMMIT;

BEGIN;
SELECT 2;
COMMIT;
