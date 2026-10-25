-- ============================================================================
-- 0042 · ROL-SOPORTE (paso 1 de 2) · las dos policies de proyectos dejan de ser
--        LISTA NEGRA
--
-- QUÉ HACE
--   Reescribe `proyectos_insert_own_no_visitante` (0024) y
--   `proyectos_update_huerfano_admin` (0025) cambiando su predicado de
--   `p.rol <> 'visitante'` a `p.rol IN ('kam','admin','soporte')`.
--
--   ⚠ NO cambia ni un permiso vigente, y tampoco cambia el del rol que viene.
--   Las dos formas dan EXACTAMENTE el mismo resultado para los CUATRO:
--
--       rol         <> 'visitante'   IN ('kam','admin','soporte')
--       admin            pasa                 pasa
--       kam              pasa                 pasa
--       soporte          pasa                 pasa      <- firmado, 22-sep
--       visitante        NO                   NO
--
--   Lo que cambia es el rol NUMERO CINCO.
--
-- POR QUÉ, Y POR QUÉ ANTES Y NO DESPUÉS
--   🔴 EL ARGUMENTO DE ESTA SECCIÓN CAMBIÓ EL MISMO DÍA, y dejarlo como
--   estaba habría sido una justificación hueca. Decía: «el cuarto rol es de SOLO
--   LECTURA y con la lista negra habría nacido pudiendo crear proyectos». Se
--   firmó el 22-sep-2026 que **`soporte` ESCRIBE**, gemelo de `kam` en el eje del
--   dato PROPIO. Así que el rol que motivó este cambio **sí debe pasar**, y por
--   eso está NOMBRADO en la lista blanca.
--
--   O SEA QUE ESTA MIGRACIÓN NO VALE POR LO QUE DECIDE HOY. Vale por la FORMA:
--
--     lista NEGRA  (`rol <> 'visitante'`) -> el rol siguiente hereda el permiso
--                                            por NO ESTAR NOMBRADO. Falla ABIERTO.
--     lista BLANCA (`rol IN (…)`)          -> el rol siguiente no lo tiene hasta
--                                            que alguien lo escriba. Falla CERRADO.
--
--   ⚠ Y AQUÍ ESTÁ LA TRAMPA QUE HAY QUE NOMBRAR: con `soporte` escribiendo, la
--   lista negra vieja daría HOY el mismo resultado que ésta, así que parece que la
--   migración ya no hace falta. Es **P25 en su forma pura — el resultado correcto
--   por la razón equivocada**. Lo que se pierde al volver a la negra no se ve en
--   ninguna consulta de hoy: se ve el día que exista un quinto rol.
--
--   Y el mismo defecto estaba copiado en CUATRO sitios de la aplicación
--   (`lib/api/auth.ts`, `proyectos-view.tsx`, `proyecto-detalle-view.tsx`,
--   `reasignar-huerfano-dialog.tsx`), así que **las dos capas fallaban igual y
--   ninguna tapaba a la otra**. Del lado de TypeScript se cerró con un
--   `Record<Rol, boolean>` —`PUEDE_ESCRIBIR_PROYECTOS`, en `lib/roles.ts`— que
--   no compila si aparece un rol sin decidir. Esta migración es su gemela en la
--   base.
--
--   Va ANTES de la migración que amplía el CHECK a propósito: cerrar la
--   condición primero y crear el caso después es la única forma de que el rol
--   nuevo no pueda colarse por una ventana abierta.
--
-- ⚠ LO QUE ESTE CAMBIO **NO** ES
--   No es un endurecimiento ni una relajación: es un cambio de FORMA del mismo
--   predicado. Quien lo audite tiene que poder comprobar que el conjunto de
--   roles que pasa es idéntico — por eso la guarda final lo verifica fila por
--   fila contra los roles que existen hoy.
--
-- ----------------------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (las tres preguntas de la casa)
--
--   1. ¿Destruye datos?
--      NO. No toca ninguna fila. Reescribe dos policies.
--
--   2. ¿Se puede deshacer?
--      SÍ: re-aplicando el cuerpo de 0024/0025. Pero deshacerlo devuelve la
--      lista negra, o sea el agujero.
--
--   3. ¿Qué pasa si se aplica dos veces?
--      Nada: `DROP POLICY IF EXISTS` + `CREATE POLICY` es idempotente.
-- ============================================================================

BEGIN;

-- ------------------------------------------------ 1 · el INSERT (era 0024)
DROP POLICY IF EXISTS proyectos_insert_own_no_visitante ON public.proyectos;
CREATE POLICY proyectos_insert_own_no_visitante ON public.proyectos
  FOR INSERT TO authenticated
  WITH CHECK (
    propietario = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.perfiles p
       WHERE p.id = (SELECT auth.uid()) AND p.rol IN ('kam','admin','soporte')
    )
  );

COMMENT ON POLICY proyectos_insert_own_no_visitante ON public.proyectos IS
  '[ROL-SOPORTE] Un usuario solo crea proyectos PROPIOS, y solo si su rol esta en la lista BLANCA de escritura (kam, admin, soporte: los tres que pueden POSEER dato propio; visitante no). El nombre de la policy conserva "no_visitante" por su historia (0024) aunque el predicado ya no nombre a visitante: renombrarla obligaria a tocar cualquier guarda que la cite por nombre, y el nombre de una policy no es su contrato.';

-- ------------------------------------------- 2 · el rescate de huérfanos (0025)
DROP POLICY IF EXISTS proyectos_update_huerfano_admin ON public.proyectos;
CREATE POLICY proyectos_update_huerfano_admin ON public.proyectos
  FOR UPDATE TO authenticated
  USING (propietario IS NULL AND public.is_admin())
  WITH CHECK (
    propietario IS NOT NULL
    AND public.is_admin()
    AND EXISTS (
      SELECT 1 FROM public.perfiles p
       WHERE p.id = propietario AND p.rol IN ('kam','admin','soporte')
    )
  );

COMMENT ON POLICY proyectos_update_huerfano_admin ON public.proyectos IS
  '[INV-B8 · ROL-SOPORTE] Via UNICA de rescate de un proyecto huerfano (propietario NULL tras ON DELETE SET NULL): un admin lo reasigna a una cuenta viva cuyo rol pueda POSEER un proyecto — lista BLANCA (kam, admin, soporte), no "cualquiera menos visitante": la diferencia no se ve con los roles de hoy, se ve con el quinto. No alcanza filas con dueño (el USING lo impide) y el WITH CHECK impide dejarlo huerfano otra vez.';

-- --------------------------------------- 3 · la guarda: mismo conjunto, otra forma
DO $guarda0042$
DECLARE
  v_insert text;
  v_update text;
  v_roles_hoy text;
  v_divergen int;
BEGIN
  SELECT pg_get_expr(polwithcheck, polrelid) INTO v_insert
    FROM pg_policy WHERE polname = 'proyectos_insert_own_no_visitante';
  SELECT pg_get_expr(polwithcheck, polrelid) INTO v_update
    FROM pg_policy WHERE polname = 'proyectos_update_huerfano_admin';

  IF v_insert IS NULL OR v_update IS NULL THEN
    RAISE EXCEPTION '0042: alguna de las dos policies no existe despues del reemplazo.';
  END IF;

  -- Ninguna de las dos puede seguir nombrando a `visitante`: si lo hace, el
  -- reemplazo no entro y la lista negra sigue viva.
  IF v_insert LIKE '%visitante%' OR v_update LIKE '%visitante%' THEN
    RAISE EXCEPTION '0042: una policy sigue nombrando a visitante. La lista negra no se volteo.';
  END IF;

  -- 🔴 ESTA GUARDA ERA VACUA, y la version anterior vivio lo justo para
  -- ensenarlo. Decia:
  --
  --     SELECT count(DISTINCT rol) FROM public.perfiles
  --      WHERE (rol <> 'visitante') IS DISTINCT FROM (rol IN ('kam','admin'));
  --
  -- Cuando esta migracion corre, el CHECK vivo de `perfiles.rol` todavia admite
  -- SOLO `kam|admin|visitante` —la 0043 va despues, a proposito— y para esos
  -- tres valores las dos formas coinciden SIEMPRE: kam (t,t), admin (t,t),
  -- visitante (f,f). `rol` es NOT NULL, asi que `v_divergen` valia 0 con
  -- CUALQUIER contenido de la tabla. **Era vacua por construccion, no por
  -- datos** (P19): una guarda que no puede ponerse roja no es una guarda, y
  -- ademas su verde se leia como «la equivalencia esta comprobada».
  --
  -- Lo que hace ahora, y por que son DOS aserciones y no una: se evalua sobre
  -- un conjunto de candidatos ESCRITO AQUI —que incluye el rol que todavia no
  -- existe— en vez de sobre las filas que hay.
  --
  --   (a) EQUIVALENCIA: para los tres roles de hoy las dos formas dan lo mismo.
  --       Es la afirmacion que esta migracion hace en su cabecera.
  --   (b) ANTI-VACUIDAD: para `soporte` las dos formas tienen que DIFERIR. Esa
  --       diferencia ES el motivo del cambio; si algun dia no difiere, o bien
  --       alguien devolvio la lista negra, o bien la blanca creció sola — y en
  --       los dos casos esta guarda debe reventar en vez de felicitarse.
  WITH candidatos(rol) AS (VALUES ('kam'),('admin'),('visitante'),('soporte'))
  SELECT count(*) INTO v_divergen
    FROM candidatos
   WHERE (rol <> 'visitante') IS DISTINCT FROM (rol IN ('kam','admin','soporte'));

  SELECT string_agg(DISTINCT rol, ', ' ORDER BY rol) INTO v_roles_hoy FROM public.perfiles;

  IF v_divergen > 0 THEN
    RAISE EXCEPTION '0042: (a) el cambio de forma NO es equivalente para los cuatro roles decididos (% divergen). Roles vivos en la tabla: %.', v_divergen, v_roles_hoy;
  END IF;

  -- (b) ANTI-VACUIDAD, y el testigo CAMBIO el 22-sep porque el anterior habria
  -- mentido. Antes esto exigia que `soporte` separase las dos formas: cierto
  -- mientras `soporte` no estaba en la lista blanca, y FALSO desde que el PO
  -- firmo que escribe. Una guarda cuyo testigo es un rol CONCRETO caduca en
  -- cuanto ese rol cambia de lado.
  --
  -- El testigo correcto es un rol que NADIE NOMBRO, porque la propiedad que esta
  -- migracion compra no es <<soporte difiere>>: es <<lo que no esta escrito NO
  -- PASA>>. Ese testigo no caduca, porque por construccion no puede entrar en
  -- ninguna lista blanca.
  IF NOT (('rol_que_nadie_nombro' <> 'visitante') IS DISTINCT FROM ('rol_que_nadie_nombro' IN ('kam','admin','soporte'))) THEN
    RAISE EXCEPTION '0042: ANTI-VACUIDAD ROTA. Un rol SIN NOMBRAR pasa las dos formas igual, o sea que la lista blanca no esta cerrando nada. O volvio la lista negra, o se colo un comodin.';
  END IF;

  -- (c) LA UNICA QUE MIDE DATOS, y ademas vigila el ORDEN: esta migracion va
  -- ANTES de la 0043, asi que el CHECK vivo todavia no admite `soporte` y NINGUNA
  -- fila puede tenerlo. Si alguna lo tiene, la 0043 se aplico primero.
  IF EXISTS (SELECT 1 FROM public.perfiles WHERE rol NOT IN ('kam','admin','visitante')) THEN
    RAISE EXCEPTION '0042: hay filas de perfiles con un rol fuera de kam/admin/visitante (roles vivos: %). Si alguna es soporte, la 0043 se aplico ANTES que esta: revisar el orden en supabase_migrations.schema_migrations.', v_roles_hoy;
  END IF;

  RAISE NOTICE '--- 0042 · ROL-SOPORTE · lo que esta migracion NO puede comprobar ---';
  RAISE NOTICE '  roles vivos en perfiles: %  · divergencias con la forma vieja: 0', v_roles_hoy;
  RAISE NOTICE '  (1) NO cierra el agujero del lado de la APLICACION. Los cuatro sitios';
  RAISE NOTICE '      de TypeScript se voltearon en el mismo bloque, pero esta migracion';
  RAISE NOTICE '      no puede verlos: son dos capas y cada una se arregla en su sitio.';
  RAISE NOTICE '  (2) NO amplia el CHECK de perfiles.rol. El rol `soporte` todavia NO';
  RAISE NOTICE '      existe: eso es la 0043, y va DESPUES a proposito. Esta policy YA lo';
  RAISE NOTICE '      nombra, y eso es correcto: nombrar a un rol que aun no existe es';
  RAISE NOTICE '      inerte, mientras que NO nombrarlo le habria dado permiso en silencio.';
  RAISE NOTICE '  (3) La equivalencia (a) se comprueba sobre un conjunto ESCRITO en la';
  RAISE NOTICE '      guarda, no sobre las filas: mide la FORMA del predicado, no el';
  RAISE NOTICE '      estado de la tabla. Lo que si mide datos es la tercera asercion.';
END $guarda0042$;

COMMIT;
