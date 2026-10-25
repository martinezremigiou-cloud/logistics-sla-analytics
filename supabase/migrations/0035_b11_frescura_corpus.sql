-- ============================================================
-- 0035 · [INV-B11] O7 · El testigo de frescura puede LEERSE.
--
-- La `0032` dejó esto escrito con todas sus letras y lo difirió a propósito:
--
--     «`corpus_sync_intentos` NO se abre, y es una decisión, no un olvido: es
--      telemetría de operación y nadie la necesita todavía. **El testigo de
--      frescura de O7 la va a querer**, y esa es su migración, no ésta.»
--
-- Ésta es esa migración. El consumidor ya existe.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ ESTA TABLA VALE MÁS QUE UNA FECHA, y es la razón de todo O7:
--
-- `corpus_documentos` dice CUÁNDO CAMBIÓ ALGO. No dice cuándo se MIRÓ. Con solo
-- esa fecha, un testigo diría *«última actualización: hace 6 días»* y el lector
-- no tendría cómo saber si la sincronización lleva seis días sin correr o
-- corrió anoche y no había nada nuevo.
--
-- **Es exactamente la deuda B10-3, que este proyecto lleva un bloque entero sin
-- poder cerrar en la ingesta** — `snapshots` registra RESULTADOS, no INTENTOS,
-- y por eso «corrió sin novedad» y «no corrió» dejan la misma evidencia:
-- ninguna.
--
-- Aquí no pasa, porque la `0030` escribe una fila **al EMPEZAR**. Con las dos
-- fechas juntas el testigo puede decir la verdad completa:
--
--     indexado hace 6 días  ·  revisado hace 2 horas, sin novedad
--
-- ────────────────────────────────────────────────────────────
-- QUÉ SE CONCEDE, Y QUÉ NO.
--
-- SOLO `SELECT`, y sobre las columnas de la tabla entera. Se pensó en acotar a
-- una vista con tres columnas, y **no se hizo por una razón**: una vista es una
-- superficie más que mantener, y lo que hay dentro —cuándo corrió, si se
-- detuvo, por qué— no es sensible. Es telemetría de un corpus que todo el mundo
-- puede leer desde la 0032.
--
-- `motivo` es el único campo con texto libre, y lo escribe la guarda de borrado
-- masivo del propio repo (`esBorradoMasivo`), no un usuario. No hay dato de
-- nadie ahí dentro.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Un GRANT y una policy. Cero DDL, cero DELETE, cero UPDATE.
--      Revertir es REVOKE + DROP POLICY y no pierde ninguna fila.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** Una tabla, solo SELECT, solo `authenticated`. `anon` no se toca
--      y la guarda asevera que sigue en 0 — abrir lectura a un rol es
--      exactamente cuándo hay que volver a comprobar al otro.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      **Que el testigo DIGA la verdad.** Que la tabla se pueda leer no dice
--      que la pantalla distinga «no corrió» de «corrió sin novedad» — esa es
--      la distinción que justifica todo esto, y vive en el código que la
--      pinta. La guarda lee como `authenticated` y compara conteos; el resto
--      se prueba con `frescura.test.ts` y con la revisión visual.
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b11.intentos_grants_antes',
    (SELECT count(*)::text FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'corpus_sync_intentos' AND grantee = 'authenticated'), false);
END
$antes$;

GRANT SELECT ON public.corpus_sync_intentos TO authenticated;

DROP POLICY IF EXISTS corpus_sync_intentos_lectura ON public.corpus_sync_intentos;
CREATE POLICY corpus_sync_intentos_lectura ON public.corpus_sync_intentos
  FOR SELECT TO authenticated USING (true);

DO $guarda$
DECLARE
  v_antes      integer := current_setting('inv_b11.intentos_grants_antes', true)::integer;
  v_anon       integer;
  v_escritura  integer;
  v_total      integer;
  v_ve         integer;
BEGIN
  -- (a) `anon` sigue sin nada.
  SELECT count(*) INTO v_anon FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'corpus_sync_intentos' AND grantee = 'anon';
  IF v_anon <> 0 THEN
    RAISE EXCEPTION '0035 ABORTA: anon gano % privilegio(s) sobre corpus_sync_intentos', v_anon;
  END IF;

  -- (b) `authenticated` NO puede escribir. La sincronizacion corre con la
  --     llave de servicio y nadie mas tiene por que tocar esta tabla.
  SELECT count(*) INTO v_escritura FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'corpus_sync_intentos'
      AND grantee = 'authenticated' AND privilege_type <> 'SELECT';
  IF v_escritura <> 0 THEN
    RAISE EXCEPTION '0035 ABORTA: authenticated tiene % privilegio(s) de escritura sobre corpus_sync_intentos', v_escritura;
  END IF;

  -- (c) EL CONTROL POSITIVO. No se cuentan privilegios: SE LEE. Es la leccion
  --     de la 0032 -- una guarda que cuenta grants demuestra la ausencia de
  --     dano y nunca la presencia de funcion.
  SELECT count(*) INTO v_total FROM public.corpus_sync_intentos;
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_ve FROM public.corpus_sync_intentos;
  EXECUTE 'RESET ROLE';

  IF v_ve <> v_total THEN
    RAISE EXCEPTION '0035 ABORTA: authenticated ve %/% intentos', v_ve, v_total;
  END IF;

  IF v_total = 0 THEN
    RAISE NOTICE '0035 · AVISO: no hay ningun intento registrado, asi que el control positivo NO se ejercio. Dos ceros que coinciden no prueban que se pueda leer. Volver a correr despues de una sincronizacion.';
  ELSE
    RAISE NOTICE '0035 · CONTROL POSITIVO OK: como authenticated se leyeron % intentos — los mismos que hay.', v_ve;
  END IF;

  RAISE NOTICE '0035 · grants a authenticated sobre corpus_sync_intentos: antes=% ahora=1 (SELECT y nada mas). anon sigue en 0.', v_antes;
  RAISE NOTICE '0035 · POR QUE ESTA TABLA Y NO UNA FECHA: corpus_documentos dice cuando CAMBIO algo, no cuando se MIRO. Con las dos fechas el testigo distingue «lleva 6 dias sin correr» de «corrio anoche y no habia nada nuevo» — que es justo lo que la ingesta NO puede decir (deuda B10-3).';
  RAISE NOTICE '0035 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI: que el testigo DIGA la verdad. Que la tabla se lea no dice que la pantalla distinga los dos silencios. Eso vive en el codigo que la pinta.';
END
$guarda$;
