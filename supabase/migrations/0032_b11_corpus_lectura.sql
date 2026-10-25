-- ============================================================
-- 0032 · [INV-B11] El corpus se puede LEER. Y la guarda lo comprueba leyendo.
--
-- QUÉ ARREGLA, y lo encontró el pase visual en el navegador:
--
--     clic en «¿Qué dice la ficha del KYA2490?»
--       →  «No pude consultar la documentación en este momento.»
--
-- Los datos estaban —documentos, trozos y puentes— y el chat no
-- podía verlos. La `0030` y la `0031` hicieron `REVOKE ALL ... FROM anon,
-- authenticated` y **nunca devolvieron el SELECT a `authenticated`**. Un
-- `SELECT` sin privilegio no devuelve cero filas: **lanza**, así que el servicio
-- caía en `fallo_consulta`.
--
-- ────────────────────────────────────────────────────────────
-- LA GUARDA DE LA 0030 MIDIÓ LA DIRECCIÓN EQUIVOCADA, Y ESO ES LO QUE HAY QUE
-- APRENDER DE AQUÍ.
--
-- Decía «0 privilegios para anon/authenticated» y **pasaba**. Era cierto y era
-- exactamente lo que se quería para `anon`.
--
--     La guarda demostró la AUSENCIA DE DAÑO.
--     Nunca demostró la PRESENCIA DE FUNCIÓN.
--
-- Es P19 en su forma menos vistosa: una guarda correcta, verde, que deja la
-- tabla inservible. Y el antídoto es el que este proyecto ya usa en todas
-- partes menos aquí — **el control positivo**: por cada «esto NO puede», un
-- «esto SÍ puede».
--
-- Por eso la guarda de ESTA migración no cuenta privilegios: **se convierte en
-- `authenticated` y lee**. Si no puede, la migración aborta.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ POLÍTICA PERMISIVA Y NO `SECURITY DEFINER`.
--
-- Es la regla de producto sobre el individualismo, aplicada literalmente:
--
--     Exactamente DOS cosas se filtran por `perfil_id`: proyectos y
--     seguimientos. Todo lo demás es compartido.
--
-- El corpus es documentación de producto: **todos ven las mismas fichas**. Una
-- política `USING (true)` es la lectura correcta de esa regla, no un atajo — y
-- es el mismo molde que ya usan `productos`, `familias` y `stock_por_almacen`.
--
-- Y se concede **SOLO `SELECT`**, que es MÁS estricto que esas tres: ellas
-- conservan el ACL por omisión (INSERT/UPDATE/DELETE concedidos) y confían todo
-- a que no exista una policy que los permita. Aquí el privilegio tampoco está.
-- Escribir en el corpus es trabajo de la sincronización, con la llave de
-- servicio.
--
-- `corpus_sync_intentos` NO se abre, y es una decisión, no un olvido: es
-- telemetría de operación y nadie la necesita todavía. **El testigo de frescura
-- de O7 la va a querer**, y esa es su migración, no ésta. Conceder por si acaso
-- es cómo se ensancha un permiso sin que nadie recuerde por qué.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Tres GRANT de SELECT y tres policies nuevas. Cero DDL sobre
--      columnas, cero DELETE, cero UPDATE de datos. Revertir es REVOKE + DROP
--      POLICY, y no pierde ninguna fila.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** Solo las tres tablas del corpus, solo SELECT, solo para
--      `authenticated`. `anon` NO se toca y la guarda asevera que sigue en 0 —
--      abrir lectura a un rol es justo cuando hay que volver a comprobar al
--      otro.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      Que el chat use el cliente de SESIÓN y no el de servicio. Con el de
--      servicio esto habría funcionado igual **y sin RLS de por medio**, así
--      que un GRANT correcto no prueba que el camino sea el correcto. Se
--      declara en el RAISE NOTICE y se prueba desde la aplicación.
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b11.grants_antes',
    (SELECT count(*)::text FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name LIKE 'corpus\_%' AND grantee = 'authenticated'), false);
END
$antes$;

-- ------------------------------------------------------------
-- (1) El privilegio. SOLO SELECT.
-- ------------------------------------------------------------
GRANT SELECT ON public.corpus_documentos TO authenticated;
GRANT SELECT ON public.corpus_trozos TO authenticated;
GRANT SELECT ON public.corpus_familia_ficha TO authenticated;

-- ------------------------------------------------------------
-- (2) La política. Con RLS activa y CERO policies, el GRANT solo no alcanza:
--     la RLS niega todo. Hacen falta las dos, y por eso la guarda lee de
--     verdad en vez de comprobar una de las dos y suponer la otra.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS corpus_documentos_lectura ON public.corpus_documentos;
CREATE POLICY corpus_documentos_lectura ON public.corpus_documentos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS corpus_trozos_lectura ON public.corpus_trozos;
CREATE POLICY corpus_trozos_lectura ON public.corpus_trozos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS corpus_familia_ficha_lectura ON public.corpus_familia_ficha;
CREATE POLICY corpus_familia_ficha_lectura ON public.corpus_familia_ficha
  FOR SELECT TO authenticated USING (true);

-- ------------------------------------------------------------
-- (3) LA GUARDA, y esta vez con las dos direcciones.
-- ------------------------------------------------------------
DO $guarda$
DECLARE
  v_antes      integer := current_setting('inv_b11.grants_antes', true)::integer;
  v_anon       integer;
  v_escritura  integer;
  v_total_doc  integer;
  v_total_tro  integer;
  v_total_pue  integer;
  v_ve_doc     integer;
  v_ve_tro     integer;
  v_ve_pue     integer;
BEGIN
  -- (a) LA DIRECCIÓN NEGATIVA, que ya estaba: `anon` sigue sin nada.
  --     Abrir lectura a un rol es exactamente cuando hay que volver a
  --     comprobar al otro.
  SELECT count(*) INTO v_anon FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'corpus\_%' AND grantee = 'anon';
  IF v_anon <> 0 THEN
    RAISE EXCEPTION '0032 ABORTA: anon gano % privilegio(s) sobre corpus_*', v_anon;
  END IF;

  -- (b) `authenticated` NO puede escribir. Se concedio SELECT y nada mas.
  SELECT count(*) INTO v_escritura FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name LIKE 'corpus\_%' AND grantee = 'authenticated'
      AND privilege_type <> 'SELECT';
  IF v_escritura <> 0 THEN
    RAISE EXCEPTION '0032 ABORTA: authenticated tiene % privilegio(s) de escritura sobre corpus_*', v_escritura;
  END IF;

  -- (c) EL CONTROL POSITIVO. No se cuentan privilegios: SE LEE.
  --     Contar habria vuelto a demostrar la ausencia de dano sin demostrar la
  --     presencia de funcion, que es justo lo que dejo el chat roto.
  SELECT count(*) INTO v_total_doc FROM public.corpus_documentos;
  SELECT count(*) INTO v_total_tro FROM public.corpus_trozos;
  SELECT count(*) INTO v_total_pue FROM public.corpus_familia_ficha;

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_ve_doc FROM public.corpus_documentos;
  SELECT count(*) INTO v_ve_tro FROM public.corpus_trozos;
  SELECT count(*) INTO v_ve_pue FROM public.corpus_familia_ficha;
  EXECUTE 'RESET ROLE';

  -- Se compara contra lo que HAY, no contra cero: asi la guarda caza tanto
  -- «no hay GRANT» (habria lanzado antes de llegar aqui) como «la policy
  -- filtra todo» (contaria 0 con filas existiendo).
  IF v_ve_doc <> v_total_doc OR v_ve_tro <> v_total_tro OR v_ve_pue <> v_total_pue THEN
    RAISE EXCEPTION '0032 ABORTA: authenticated ve %/% documentos, %/% trozos, %/% puentes',
      v_ve_doc, v_total_doc, v_ve_tro, v_total_tro, v_ve_pue, v_total_pue;
  END IF;

  -- Y si no hay filas, el control positivo NO se ejercio. Un cero que coincide
  -- con otro cero no prueba nada, y decirlo es la diferencia entre una
  -- medicion y una hipotesis.
  IF v_total_tro = 0 THEN
    RAISE NOTICE '0032 · AVISO: el corpus esta VACIO, asi que el control positivo no se ejercio. Los dos conteos coinciden en 0 y eso no prueba que se pueda leer. Volver a correr la guarda con datos.';
  ELSE
    RAISE NOTICE '0032 · CONTROL POSITIVO OK: como authenticated se leyeron % documentos, % trozos y % puentes — los mismos que hay.', v_ve_doc, v_ve_tro, v_ve_pue;
  END IF;

  RAISE NOTICE '0032 · grants a authenticated sobre corpus_*: antes=% ahora=3 (SELECT y nada mas). anon sigue en 0. corpus_sync_intentos NO se abrio: es telemetria, y su lectura es decision de O7.', v_antes;
  RAISE NOTICE '0032 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI: que el chat use el cliente de SESION y no el de servicio. Con el de servicio esto habria funcionado igual y sin RLS de por medio, asi que un GRANT correcto no prueba que el camino sea el correcto. Se prueba desde la aplicacion.';
END
$guarda$;
