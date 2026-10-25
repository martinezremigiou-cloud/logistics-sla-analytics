-- ============================================================================
-- 0043 · ROL-SOPORTE (paso 2 de 2) · el cuarto rol
--
-- 🔴 ESTE TITULO DECIA «de SOLO LECTURA» y el nombre del archivo lo sigue
--    diciendo. Es FALSO, y el nombre no se cambia porque el numero de una
--    migracion afirma un ORDEN DE APLICACION y renombrarla la volveria otra:
--    se corrige aqui, que es donde se lee. `soporte` ESCRIBE su dato PROPIO.
--
-- QUÉ HACE
--   Amplía `perfiles_rol_check` para admitir `'soporte'`, y reescribe el
--   COMMENT de la columna, que la `0010` dejó enumerando tres roles.
--
-- POR QUÉ VA DESPUÉS DE LA 0042, Y NO AL REVÉS
--   Porque la `0042` cerró la ventana por la que este rol habría entrado con
--   permisos que nadie le dio. Antes de ella, las dos policies de `proyectos`
--   decían `p.rol <> 'visitante'` — una LISTA NEGRA— y `soporte` la pasa.
--   Aplicar ESTA migración primero habría creado, durante el hueco entre las
--   dos, un rol de «sólo lectura» capaz de crear proyectos.
--
--   **Cerrar la condición y después crear el caso.** El orden ES el arreglo.
--
-- QUÉ ES `soporte`
--   **Gemelo de `kam`**, no de `visitante`: lee lo mismo que un `kam` Y escribe
--   lo mismo que un `kam`. Crea sus propios proyectos, cotiza partidas, sigue
--   SKU y recibe avisos. Lo único en que se aparta de `kam` es la INTERFAZ: no
--   ve el vocabulario técnico de la clasificación v2 — y eso es un eje distinto
--   del permiso, por eso `MUESTRA_CLASIFICACION_V2.soporte` sigue en `false`
--   junto con `kam`.
--
--   🔴 DOS CORRECCIONES EN CADENA EL MISMO DÍA, y las dos importan porque ésta
--   es la frase con la que alguien decide si el rol es seguro.
--
--   (1) Decía «no escribe nada». Medido contra `pg_policy`: `public` tiene **12
--       policies de escritura que NO cuelgan de `is_admin()`** — 3 en
--       `proyectos`, 3 en `proyecto_partidas`, 3 en `seguimientos` y 3 en
--       `preferencias_notificacion`. Solo el INSERT de proyectos mira el rol.
--   (2) Se corrigió a «no escribe DATO DE NEGOCIO», y eso **también era falso**.
--       Se firmó el 22-sep: **`soporte` ESCRIBE**, gemelo de `kam`.
--
--   LA VERDAD SON DOS EJES, y confundirlos es lo que produjo las dos versiones
--   equivocadas:
--
--     eje 1 · dato COMPARTIDO — catálogo, clasificación, familias, marcas,
--             usuarios. La regla es `is_admin()`.        soporte SÓLO LEE.
--     eje 2 · dato PROPIO — proyectos, partidas, seguimientos, preferencias.
--             La regla es «es tuyo», no el rol.          soporte ESCRIBE.
--
--   **«Gemelo de `kam`» era literalmente cierto desde el principio.** Lo que
--   estuvo mal fue traducir esa frase a «sólo lectura»: un `kam` escribe sus
--   propios proyectos y seguimientos, así que su gemelo también.
--
--   Y EL DEFECTO DE MÉTODO, dicho para que no se repita: se contaron las 18
--   policies **que MENCIONAN un rol** y se concluyó sobre el universo entero. Las
--   12 sin `is_admin()` —las que de verdad deciden el eje 2— no estaban
--   en la consulta. Es `UN-CERO-SIN-UNIVERSO-NO-ES-UNA-MEDICION`.
--
--   ⚠ NADIE DEBE VOLVER A LEER «soporte es de sólo lectura» EN ESTA CASA.
--
--   Las tres decisiones viven en `src/lib/roles.ts`. Y el matiz que la versión
--   anterior de esta línea se comió: `Record<Rol, X>` obliga a que la CLAVE
--   exista, **no a que su valor sea el decidido** — cambiar
--   `MUESTRA_CLASIFICACION_V2.soporte` a `true` compilaba. El VALOR lo fijan
--   `roles.test.ts` y `nav.test.ts`, que ahora lo asertan y se vieron en rojo.
--
--   NINGUNA cuenta nace `soporte`: el trigger `handle_new_user` clava `'kam'`
--   (0002:42-54). El paso a `soporte` lo hace un admin, y sólo un admin —
--   `perfiles_admin_update` (0002:383-390) exige `is_admin()`, y la ruta PATCH
--   además prohíbe que un admin toque su propia cuenta.
--
-- LO QUE `soporte` SÍ VE, dicho para que nadie lo descubra después
--   22 tablas de `public` tienen `FOR SELECT TO authenticated USING (true)`, así
--   que un `soporte` las lee TODAS igual que un `kam` — incluida
--   `public.cambios`, la bitácora del ETL con el histórico de variaciones de
--   cada SKU. **No es una fuga nueva** (kam y visitante ya la ven) pero es el
--   renglón que hay que enseñar antes de decir «sólo lectura, sin riesgo».
--
-- ----------------------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (las tres preguntas de la casa)
--
--   1. ¿Destruye datos?
--      NO. Amplía un CHECK y reescribe un COMMENT. Ninguna fila cambia.
--
--   2. ¿Se puede deshacer?
--      SÍ, PERO CON UNA CONDICIÓN: volver al CHECK de tres valores exige que
--      NINGUNA fila sea ya `'soporte'`, o el `ADD CONSTRAINT` falla. Deshacerlo
--      después de asignar el rol obliga a reasignar esas cuentas primero.
--
--   3. ¿Qué pasa si se aplica dos veces?
--      Nada: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` es idempotente.
-- ============================================================================

BEGIN;

-- ------------------------------------------------------------ 1 · el CHECK
-- Mismo gesto que la 0010 cuando estrenó `visitante`: se tira y se recrea, no
-- se puede «añadir un valor» a un CHECK. El re-escaneo de la tabla es seguro
-- porque todas las filas vivas ya satisfacen el conjunto MÁS AMPLIO.
ALTER TABLE public.perfiles DROP CONSTRAINT IF EXISTS perfiles_rol_check;
ALTER TABLE public.perfiles
  ADD CONSTRAINT perfiles_rol_check CHECK (rol IN ('kam','admin','visitante','soporte'));

-- -------------------------------------------------- 2 · el COMMENT que envejeció
-- 🔴 La 0010 dejó escrito en el catálogo: «kam | admin | visitante. … kam y
-- visitante son hoy equivalentes en RLS y en la app». Con un cuarto rol esa
-- frase miente en DOS puntos —enumera tres, y afirma una equivalencia de dos—,
-- y lo hace CON la autoridad del catálogo, que es donde nadie va a dudarla.
COMMENT ON COLUMN public.perfiles.rol IS
  'kam | admin | visitante | soporte. El permiso tiene DOS EJES y confundirlos ya produjo dos afirmaciones falsas en el catalogo. EJE 1, dato COMPARTIDO (catalogo, clasificacion, familias, marcas, usuarios): la regla es is_admin(), y kam, visitante y soporte SOLO LEEN. EJE 2, dato PROPIO (proyectos, partidas, seguimientos, preferencias): la regla es "es tuyo", no el rol — medido el 22-sep-2026 hay 12 policies de escritura sin is_admin(), y solo el INSERT de proyectos mira el rol. En el eje 2 escriben admin, kam y soporte; visitante no, y eso lo sostiene la lista BLANCA explicita de la 0042 (kam, admin, soporte) en las dos policies de proyectos. Seguimientos y preferencias_notificacion no miran el rol en absoluto (perfil_id = auth.uid()) y sus rutas usan requireSession, asi que ahi escribe tambien visitante, por decision de producto. soporte es GEMELO DE kam en los dos ejes: NO es un rol de solo lectura. Ninguna cuenta nace soporte: handle_new_user clava kam y solo un admin lo cambia.';

-- ------------------------------------------- 3 · la guarda de lo que sí puede ver
DO $guarda0043$
DECLARE
  v_def text;
  v_checks_sobre_rol int;
  v_por_rol text;
  v_fuera int;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.perfiles'::regclass AND conname = 'perfiles_rol_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '0043: perfiles_rol_check no existe despues del reemplazo.';
  END IF;
  IF v_def NOT LIKE '%soporte%' THEN
    RAISE EXCEPTION '0043: el CHECK vivo NO admite soporte. Definicion actual: %', v_def;
  END IF;

  -- Que no queden DOS checks sobre `rol` contradiciendose: el `DROP IF EXISTS`
  -- solo alcanza al que se llama asi, y un CHECK adicional con otro nombre
  -- seguiria rechazando el valor nuevo desde la sombra.
  SELECT count(*) INTO v_checks_sobre_rol
    FROM pg_constraint
   WHERE conrelid = 'public.perfiles'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%rol%';
  IF v_checks_sobre_rol <> 1 THEN
    RAISE EXCEPTION '0043: hay % CHECK(s) sobre `rol` y deberia haber exactamente 1. Otro podria seguir rechazando soporte.', v_checks_sobre_rol;
  END IF;

  -- Ninguna fila puede haber quedado fuera del conjunto nuevo. Es
  -- estructuralmente imposible (el conjunto solo crecio) y por eso mismo un
  -- numero distinto de 0 significaria que se esta midiendo otra cosa.
  SELECT count(*) INTO v_fuera
    FROM public.perfiles WHERE rol NOT IN ('kam','admin','visitante','soporte');
  IF v_fuera <> 0 THEN
    RAISE EXCEPTION '0043: % fila(s) de perfiles tienen un rol fuera del CHECK nuevo.', v_fuera;
  END IF;

  SELECT string_agg(rol || '=' || n, ' · ' ORDER BY rol) INTO v_por_rol
    FROM (SELECT rol, count(*) AS n FROM public.perfiles GROUP BY rol) t;

  RAISE NOTICE '--- 0043 · ROL-SOPORTE · lo que esta migracion NO puede comprobar ---';
  RAISE NOTICE '  CHECK vivo: %', v_def;
  RAISE NOTICE '  perfiles por rol: %', v_por_rol;
  RAISE NOTICE '  (1) NO asigna el rol a nadie. Crea la POSIBILIDAD; asignarlo es del PO';
  RAISE NOTICE '      desde /config, y ninguna cuenta nace soporte.';
  RAISE NOTICE '  (2) soporte NO es un rol de solo lectura, y esta migracion no puede';
  RAISE NOTICE '      comprobarlo: en el eje del dato PROPIO escribe igual que un kam';
  RAISE NOTICE '      (firma del PO, 22-sep). Lo que lo sostiene del lado de la app vive en';
  RAISE NOTICE '      PUEDE_ESCRIBIR_PROYECTOS y sus pruebas; del lado de la base, en la';
  RAISE NOTICE '      lista BLANCA de la 0042, que YA lo nombra.';
  RAISE NOTICE '  (2-bis) MIENTRAS ESTA MIGRACION NO ESTE APLICADA, la interfaz NO debe';
  RAISE NOTICE '      ofrecer el rol: `ROLES` (lib/roles.ts) alimenta el select del alta Y el';
  RAISE NOTICE '      enum de zod, y ofrecerlo con el CHECK viejo CREA la cuenta en GoTrue y';
  RAISE NOTICE '      luego revienta el UPDATE (23514) — deja un kam vivo y un «No se pudo';
  RAISE NOTICE '      crear el usuario» en pantalla. Por eso soporte vive hoy en';
  RAISE NOTICE '      ROLES_SIN_CARRIL_EN_LA_BASE. Aplicar esto es su disparador para mudarse.';
  RAISE NOTICE '  (3) NO añade soporte a la bateria de RLS negativas: su matriz es una';
  RAISE NOTICE '      copia literal de 3 roles y no deriva del tipo. Queda como hueco de';
  RAISE NOTICE '      cobertura con nombre — soporte sera el unico rol que ninguna bateria';
  RAISE NOTICE '      negativa EN VIVO ejercita.';
END $guarda0043$;

COMMIT;
