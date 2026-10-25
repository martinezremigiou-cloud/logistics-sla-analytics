-- ============================================================
-- 0025 · [INV-B8] El proyecto huérfano dejaba de ser reparable. Se le abre la
--        única salida que necesita: que un admin lo REASIGNE.
--
-- QUÉ PASÓ, Y ES EL MISMO BUG CORRIDO UN PASO. La 0024 arregló que una cuenta
-- con proyectos no se pudiera borrar (`ON DELETE SET NULL`). El estado que eso
-- produce, leído en las policies:
--
--   SELECT  USING (propietario = uid() OR is_admin())  → con NULL: admin SÍ ve
--   UPDATE  USING (propietario = uid())                → con NULL: NADIE
--   DELETE  USING (propietario = uid())                → con NULL: NADIE
--
-- `NULL = auth.uid()` no es TRUE nunca: es NULL, y una policy exige TRUE. Así
-- que al borrar una cuenta sus proyectos quedaban VISIBLES para el admin,
-- editables por nadie y borrables por nadie, **de forma permanente**, y solo
-- se rescataban con SQL directo contra la base. Se encontró leyendo el
-- estado resultante, no el código — y el gate de seguridad de la 0024 no podía
-- verlo, porque prueba caminos felices y denegaciones, no ESTADOS TERMINALES.
--
-- EL INVARIANTE QUE ESTA MIGRACIÓN SOSTIENE, y que conviene escribir entero
-- porque es más grande que su caso: **ningún proyecto puede quedar en un
-- estado del que nadie pueda sacarlo desde la aplicación.** Una fila que solo
-- se arregla con `psql` es una fila que, en la práctica, no se arregla.
--
-- ALCANCE, DECIDIDO (2026-08-12): el admin **reasigna el dueño** —
-- ésa es la vía de recuperación — y el admin **NO borra proyectos ajenos**.
-- Con reasignar basta: una vez que el proyecto tiene dueño otra vez, ese dueño
-- puede editarlo y borrarlo con las policies que ya existen. La recuperación
-- se completa sin darle al admin ni un permiso más de los necesarios.
--
-- POR QUÉ UNA POLICY ESTRECHA Y NO `OR is_admin()` EN LA DE UPDATE. Ampliar la
-- policy existente le habría dado al admin la edición COMPLETA de cualquier
-- proyecto vivo — título, notas, partidas — y eso contradice lo que la 0024
-- escribió como decisión deliberada: *"El admin NO entra en las de escritura
-- […] puede LEER cualquier proyecto (supervisión) pero no editar el trabajo de
-- un KAM sin que quede rastro de quién lo hizo. Esta tabla no tiene columna de
-- autoría por fila; dársela al admin sería permitir una edición anónima."*
-- Esa razón sigue en pie. La policy de abajo solo alcanza filas **ya
-- huérfanas** y solo permite dejarlas **con dueño**: es literalmente la
-- adopción, y ninguna otra cosa.
--
-- POR QUÉ TAMPOCO UNA RPC `SECURITY DEFINER`. Sería la otra forma de acotar el
-- permiso, y añade superficie privilegiada nueva — justo lo que la 0024 evitó
-- al descartar `es_visitante()` (la investigación §R4 midió una fuga viva
-- causada por una `SECURITY DEFINER` sin guarda). Una policy expresa la misma
-- regla, se lee en `pg_policies` y no puede llamarse desde ningún otro sitio.
--
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Una sola sentencia `CREATE POLICY`. Cero DELETE, cero UPDATE,
--      cero DDL sobre columnas. Revertir es `DROP POLICY
--      proyectos_update_huerfano_admin ON public.proyectos;`.
--
--   2. ¿Radio de impacto acotado?
--      **Sí, por construcción**: la policy es ADITIVA (permisiva) y su `USING`
--      exige `propietario IS NULL`, así que no puede alcanzar ni una fila con
--      dueño. Se espera que no haya filas huérfanas: nace sin efecto sobre
--      ningún dato existente, y la guarda lo verifica.
--
--   3. ¿Qué NO puede comprobar este archivo desde SQL?
--      Que la adopción FUNCIONE con un JWT real de admin y que siga negada
--      para un KAM. Eso lo mide `scripts/rls-negativas-proyectos.mjs`, que
--      estrena para esto una prueba del ESTADO HUÉRFANO — la clase de prueba
--      que faltaba y que dejó pasar este bug.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (0) FOTO DEL ANTES — control anti-vacuidad.
-- ------------------------------------------------------------
DO $antes0025$
DECLARE
  v_policies_antes integer;
  v_huerfanos      integer;
BEGIN
  SELECT count(*) INTO v_policies_antes
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'proyectos';

  SELECT count(*) INTO v_huerfanos FROM public.proyectos WHERE propietario IS NULL;

  PERFORM set_config('inv_b8.policies_antes', v_policies_antes::text, true);
  PERFORM set_config('inv_b8.huerfanos', v_huerfanos::text, true);
END $antes0025$;

-- ------------------------------------------------------------
-- (1) LA ADOPCIÓN.
--
--     `USING` mira la fila ANTES: solo huérfanas, solo admin.
--     `WITH CHECK` mira la fila DESPUÉS: obliga a que quede CON dueño. Sin esa
--     mitad, un admin podría "editar" un huérfano y dejarlo huérfano — es
--     decir, el estado congelado seguiría siendo alcanzable, ahora a mano.
--
--     El `EXISTS` sobre `perfiles` impide adoptar hacia un visitante. No es
--     celo: `proyectos_insert_own_no_visitante` establece que un visitante no
--     posee proyectos, y una adopción sin esta condición sería la puerta
--     trasera para que sí los tuviera — con la regla escrita a diez líneas de
--     distancia diciendo lo contrario.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS proyectos_update_huerfano_admin ON public.proyectos;
CREATE POLICY proyectos_update_huerfano_admin ON public.proyectos
  FOR UPDATE TO authenticated
  USING (propietario IS NULL AND public.is_admin())
  WITH CHECK (
    propietario IS NOT NULL
    AND public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.perfiles p
       WHERE p.id = propietario AND p.rol <> 'visitante'
    )
  );

COMMENT ON POLICY proyectos_update_huerfano_admin ON public.proyectos IS
  '[INV-B8] Vía ÚNICA de rescate de un proyecto huérfano (propietario NULL tras ON DELETE SET NULL): un admin lo reasigna a una cuenta viva no-visitante. No alcanza filas con dueño (el USING lo impide), así que NO le da al admin la edición de proyectos ajenos; y el WITH CHECK impide dejarlo huérfano otra vez. Sin esta policy, un huérfano era visible para el admin pero no editable ni borrable por NADIE, permanentemente.';

-- ------------------------------------------------------------
-- (2) GUARDA — por efecto donde se puede, y declarando lo que no.
-- ------------------------------------------------------------
DO $guarda0025$
DECLARE
  v_antes      integer := coalesce(nullif(current_setting('inv_b8.policies_antes', true), ''), '0')::integer;
  v_huerfanos  integer := coalesce(nullif(current_setting('inv_b8.huerfanos', true), ''), '0')::integer;
  v_ahora      integer;
  v_using      text;
  v_check      text;
BEGIN
  SELECT count(*) INTO v_ahora
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'proyectos';

  IF v_ahora <> v_antes + 1 THEN
    RAISE EXCEPTION '0025: se esperaba UNA policy nueva sobre proyectos (antes %, ahora %). Abortando.', v_antes, v_ahora;
  END IF;

  SELECT qual, with_check INTO v_using, v_check
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'proyectos'
     AND policyname = 'proyectos_update_huerfano_admin';

  -- Las dos mitades tienen que estar. Un UPDATE con USING y sin WITH CHECK
  -- dejaría re-huerfanizar la fila; con WITH CHECK y sin USING alcanzaría
  -- filas con dueño. Cada mitad sola es un agujero distinto.
  IF v_using IS NULL OR v_check IS NULL THEN
    RAISE EXCEPTION '0025: la policy de rescate quedó sin USING o sin WITH CHECK. Abortando.';
  END IF;

  IF position('propietario IS NULL' in v_using) = 0 THEN
    RAISE EXCEPTION '0025: el USING de la policy de rescate NO exige propietario IS NULL — alcanzaría proyectos CON dueño y le daría al admin la edición de trabajo ajeno. Abortando.';
  END IF;

  IF position('propietario IS NOT NULL' in v_check) = 0 THEN
    RAISE EXCEPTION '0025: el WITH CHECK NO exige propietario IS NOT NULL — se podría "adoptar" dejando la fila huérfana otra vez. Abortando.';
  END IF;

  -- Control anti-vacuidad honesto: hoy no hay huérfanos, así que esta
  -- migración NO cambia el estado de ninguna fila existente. Se dice, para que
  -- su verde no se lea como "se rescataron N proyectos".
  RAISE NOTICE '0025 · Policy de rescate creada, con USING y WITH CHECK verificados en pg_policies. Proyectos huérfanos en este momento: % (la migración no toca ninguna fila; solo abre la vía).', v_huerfanos;

  RAISE NOTICE '0025 · NO COMPROBADO AQUÍ: que la adopción funcione con un JWT real de admin, que siga negada para un KAM, y que un huérfano recupere editor tras ser adoptado. Esta guarda lee `pg_policies`, no ejecuta las policies con dos sesiones. Lo mide scripts/rls-negativas-proyectos.mjs, que estrena para esto la prueba del ESTADO HUÉRFANO — la clase de prueba que faltaba y que dejó pasar este bug en la 0024.';

  RAISE NOTICE '0025 · LÍMITE CONOCIDO, declarado: una policy no puede comparar la fila vieja contra la nueva, así que un admin que adopta PODRÍA cambiar además el título o las notas en la misma sentencia. Se acepta: la adopción es un acto deliberado y raro, y cerrarlo exigiría un trigger. Lo que NO puede hacer es tocar un proyecto que ya tiene dueño.';
END $guarda0025$;

COMMIT;
