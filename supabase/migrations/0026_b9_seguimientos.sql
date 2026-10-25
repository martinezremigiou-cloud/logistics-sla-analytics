-- ============================================================
-- 0026 · [INV-B9] Seguir un SKU: el tercer carril de dato originado.
--
-- QUÉ ES. Dos tablas diminutas: qué SKU sigue cada persona y qué quiere saber
-- de cada uno. Es dato del USUARIO — la ingesta no lo toca jamás, ni lo lee.
--
-- POR QUÉ UNA TABLA Y NO `localStorage`, que es lo que hizo INV-B8.2 con la
-- Selección. La Selección era un BORRADOR de trabajo: perderla no perdía nada
-- y por eso vivía en el navegador. Esto es distinto en el renglón que decide:
-- **el bloque de correo tiene que leer quién sigue qué desde el SERVIDOR**, y
-- `localStorage` no se lo puede decir. Si viviera en el navegador, el correo
-- sería imposible sin rehacerlo.
--
-- ────────────────────────────────────────────────────────────
-- TRES DECISIONES DE FORMA, Y LAS TRES SON RESPUESTA A ALGO QUE YA PASÓ:
--
-- 1. LLAVE PRIMARIA COMPUESTA `(perfil_id, sku)`, no `id` + UNIQUE.
--    «Seguir» queda IDEMPOTENTE POR CONSTRUCCIÓN: seguir dos veces el mismo
--    SKU no puede crear dos filas. Es el mismo problema que INV-B8.2 resolvió
--    en código (`agregar` idempotente en la Selección, y el compare-and-set
--    del volcado); aquí lo resuelve el índice, que no se puede olvidar de
--    aplicarlo.
--
-- 2. `ON DELETE CASCADE` sobre el perfil, **no `SET NULL`** — y es la
--    diferencia deliberada con la 0024. Allí, borrar una cuenta dejaba sus
--    proyectos huérfanos: VISIBLES para el admin y editables por NADIE
--    (`NULL = auth.uid()` nunca es TRUE), un estado terminal que costó la
--    migración 0025 entera. Aquí no se repite, y no por copiar el arreglo sino
--    porque el dato es otro: **un proyecto huérfano tiene valor y hay que
--    rescatarlo; un seguimiento sin dueño no significa nada.** Se va con su
--    dueño y no deja estado que nadie pueda alcanzar.
--
-- 3. CUATRO BOOLEANOS CON `CHECK`, no un arreglo ni un enum.
--    «Todo» no es un quinto valor: son los cuatro en TRUE. Un quinto valor
--    sería un estado que significa dos cosas, y el `CHECK` de «al menos uno»
--    impide la otra forma de fila sin sentido — seguir un SKU sin querer saber
--    nada de él.
-- ────────────────────────────────────────────────────────────
--
-- LA RLS ES MÁS ESTRICTA QUE LA DE `proyectos`, A PROPÓSITO. Aquí NO hay rama
-- `is_admin()` en ningún verbo, ni siquiera en SELECT. Un admin ve los
-- proyectos ajenos porque supervisar el trabajo es parte de su función; **qué
-- SKU sigue una persona no es trabajo, es su configuración**, y se pidió
-- sin excepción. La guarda de abajo lo verifica leyendo `pg_policies`, y
-- `scripts/seguimientos-negativas.mjs` lo prueba con un JWT de admin real.
--
-- `perfil_id` LLEVA `DEFAULT auth.uid()` por el mismo motivo que `propietario`
-- en la 0024: si el cliente pudiera proponerlo, existiría un camino de código
-- donde alguien dice de quién es la fila y la única defensa sería que la policy
-- lo rechace. Es más barato que ese campo no viaje.
--
-- `visto_hasta` ES UNA MARCA DE AGUA, y ahí está la decisión de «leído».
-- Las tres formas, medidas en la investigación 2.0 §R4-24:
--
--   fan-out (usuario × evento)  cientos de miles de filas de golpe  → rompe
--   global (`leido` en el evento)  0 filas, pero el primero que
--                                  abre la bandeja la apaga para todos
--   MARCA DE AGUA (1 fila/usuario) pocas filas, constantes         ← ésta
--
-- Y un hecho del esquema la vuelve exacta en vez de aproximada:
-- **`cambios.detectado_en` es IDÉNTICO en todas las filas de un snapshot**,
-- así que la marca salta de snapshot completo y no puede dejar medio snapshot
-- leído. Lo que se pierde es «marcar este aviso»; con pocas cuentas y pocos avisos por
-- carga, se acepta.
--
-- LA FILA DE PREFERENCIAS NACE PEREZOSA. No hay trigger sobre el alta de
-- perfil: quien no la tenga, lee los valores por omisión de esta tabla. Un
-- trigger nuevo sobre `handle_new_user` sería superficie privilegiada para
-- ahorrar un `coalesce`.
--
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Dos `CREATE TABLE` que nacen VACÍAS, sus policies y sus grants.
--      Cero DELETE, cero UPDATE, cero DDL sobre tablas existentes. Revertir es
--      `DROP TABLE public.seguimientos, public.preferencias_notificacion;` y
--      no pierde ni una fila de nadie, porque no había ninguna.
--
--   2. ¿Radio de impacto acotado?
--      **Sí, por construcción**: no toca ninguna tabla existente. Las FK
--      apuntan HACIA `perfiles` y `productos` sin modificarlas. La guarda
--      cuenta las tablas antes y después y aborta si el delta no es
--      exactamente 2.
--
--   3. ¿Qué NO puede comprobar este archivo desde SQL?
--      Que la RLS NIEGUE de verdad con dos JWT distintos — incluido uno de
--      admin. Una guarda que lee `pg_policies` ve el TEXTO de la policy, no su
--      efecto. Eso lo mide `scripts/seguimientos-negativas.mjs` con cuentas
--      efímeras y salida literal.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (0) FOTO DEL ANTES — control anti-vacuidad.
-- ------------------------------------------------------------
DO $antes0026$
DECLARE
  v_tablas_antes integer;
BEGIN
  SELECT count(*) INTO v_tablas_antes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('seguimientos', 'preferencias_notificacion');

  PERFORM set_config('inv_b9.tablas_antes', v_tablas_antes::text, true);
END $antes0026$;

-- ------------------------------------------------------------
-- (1) QUÉ SIGUE CADA QUIEN.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seguimientos (
  perfil_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES public.perfiles(id) ON DELETE CASCADE,

  -- FK a la LLAVE INMUTABLE, igual que `proyecto_partidas`. `productos.sku` no
  -- se borra nunca y el trigger `before_update_sku` impide renombrarlo, así
  -- que esta FK no puede quedar colgando. Que un SKU deje de venir en el Excel
  -- NO lo borra: sigue en la tabla y se vuelve invisible en las lecturas
  -- pinneadas. Ya pasó. Seguir uno de ésos es legal y no rompe nada —
  -- es un problema de VISIBILIDAD y se resuelve en lectura, con el mismo
  -- patrón «fuera del vigente» de INV-B8.1.
  sku           text NOT NULL REFERENCES public.productos(sku),

  av_estatus    boolean NOT NULL DEFAULT false,
  av_disponible boolean NOT NULL DEFAULT false,
  av_reservado  boolean NOT NULL DEFAULT false,

  -- El default del producto: «ya llegó». Medido sobre un historial corto, es
  -- el evento MÁS RARO (pocas ocurrencias; pocos avisos al mes para quien sigue decenas de
  -- SKU) y por eso el correcto para que la campana signifique algo cuando
  -- suena. «Todo» habría dado muchos al mes y entrenado a ignorarla.
  av_llegada    boolean NOT NULL DEFAULT true,

  creado_en     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (perfil_id, sku),

  -- Seguir un SKU sin querer saber NADA de él es una fila sin sentido, y una
  -- fila sin sentido acaba siendo un aviso que nadie sabe explicar.
  CONSTRAINT seguimientos_al_menos_un_aviso
    CHECK (av_estatus OR av_disponible OR av_reservado OR av_llegada)
);

-- Postgres NO indexa las FK solo, y la PK empieza por `perfil_id`, así que no
-- sirve para la consulta INVERSA. La necesita el bloque de correo — «quién
-- sigue este SKU» — y también el chequeo de integridad referencial.
CREATE INDEX IF NOT EXISTS idx_seguimientos_sku ON public.seguimientos(sku);

-- ------------------------------------------------------------
-- (2) LAS PREFERENCIAS Y LA MARCA DE AGUA.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.preferencias_notificacion (
  perfil_id     uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES public.perfiles(id) ON DELETE CASCADE,

  -- Lo que se aplica a un SKU nuevo cuando no se pregunta. Espejo de los
  -- defaults de `seguimientos`.
  av_estatus    boolean NOT NULL DEFAULT false,
  av_disponible boolean NOT NULL DEFAULT false,
  av_reservado  boolean NOT NULL DEFAULT false,
  av_llegada    boolean NOT NULL DEFAULT true,

  -- `false` = «usar esto para los siguientes», que es lo marcado por omisión.
  -- Es el arreglo al riesgo identificado: seguir decenas de SKU no puede ser
  -- responder decenas de veces la misma pregunta.
  preguntar_por_sku boolean NOT NULL DEFAULT false,

  -- LA MARCA DE AGUA. Se compara contra `cambios.detectado_en`. `NULL` = nunca
  -- ha abierto la campana: todo lo que exista cuenta como nuevo.
  visto_hasta    timestamptz,

  actualizado_en timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT preferencias_al_menos_un_aviso
    CHECK (av_estatus OR av_disponible OR av_reservado OR av_llegada)
);

-- ------------------------------------------------------------
-- (3) RLS — SOLO EL DUEÑO, EN LOS CUATRO VERBOS, SIN RAMA DE ADMIN.
--
--     `(SELECT auth.uid())` y no `auth.uid()` a secas: el subselect lo evalúa
--     el planner UNA vez (InitPlan) en vez de por fila. Mismo criterio que
--     0024 y 0012.
-- ------------------------------------------------------------
ALTER TABLE public.seguimientos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.preferencias_notificacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seguimientos_select_own ON public.seguimientos;
CREATE POLICY seguimientos_select_own ON public.seguimientos
  FOR SELECT TO authenticated
  USING (perfil_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS seguimientos_insert_own ON public.seguimientos;
CREATE POLICY seguimientos_insert_own ON public.seguimientos
  FOR INSERT TO authenticated
  WITH CHECK (perfil_id = (SELECT auth.uid()));

-- UPDATE necesita las DOS mitades. Con `USING` y sin `WITH CHECK`, alguien
-- podría tomar una fila suya y dejarla a nombre de otro.
DROP POLICY IF EXISTS seguimientos_update_own ON public.seguimientos;
CREATE POLICY seguimientos_update_own ON public.seguimientos
  FOR UPDATE TO authenticated
  USING (perfil_id = (SELECT auth.uid()))
  WITH CHECK (perfil_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS seguimientos_delete_own ON public.seguimientos;
CREATE POLICY seguimientos_delete_own ON public.seguimientos
  FOR DELETE TO authenticated
  USING (perfil_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS preferencias_select_own ON public.preferencias_notificacion;
CREATE POLICY preferencias_select_own ON public.preferencias_notificacion
  FOR SELECT TO authenticated
  USING (perfil_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS preferencias_insert_own ON public.preferencias_notificacion;
CREATE POLICY preferencias_insert_own ON public.preferencias_notificacion
  FOR INSERT TO authenticated
  WITH CHECK (perfil_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS preferencias_update_own ON public.preferencias_notificacion;
CREATE POLICY preferencias_update_own ON public.preferencias_notificacion
  FOR UPDATE TO authenticated
  USING (perfil_id = (SELECT auth.uid()))
  WITH CHECK (perfil_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS preferencias_delete_own ON public.preferencias_notificacion;
CREATE POLICY preferencias_delete_own ON public.preferencias_notificacion
  FOR DELETE TO authenticated
  USING (perfil_id = (SELECT auth.uid()));

-- ------------------------------------------------------------
-- (4) GRANTS. La RLS no sirve de nada sin el privilegio de tabla, y el
--     privilegio de tabla sin RLS lo abre todo: van juntos y explícitos.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seguimientos              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preferencias_notificacion TO authenticated;

REVOKE TRUNCATE ON public.seguimientos, public.preferencias_notificacion FROM anon, authenticated;
REVOKE ALL      ON public.seguimientos, public.preferencias_notificacion FROM anon;

COMMENT ON TABLE public.seguimientos IS
  '[INV-B9] Qué SKU sigue cada persona y qué quiere saber de cada uno. Dato originado del usuario: la ingesta no lo escribe ni lo lee. PK compuesta (perfil_id, sku) para que seguir sea idempotente por construcción. ON DELETE CASCADE sobre el perfil — a diferencia de proyectos, un seguimiento sin dueño no significa nada y no debe sobrevivir. RLS: SOLO el dueño, sin rama de admin, en los cuatro verbos.';

COMMENT ON TABLE public.preferencias_notificacion IS
  '[INV-B9] Una fila por perfil: los avisos por omisión para un SKU nuevo, si volver a preguntar por cada SKU, y `visto_hasta` — la MARCA DE AGUA que sustituye a un estado de leído por aviso. Nace perezosa: quien no tenga fila lee los valores DEFAULT. La marca se compara contra cambios.detectado_en, que es idéntico en todas las filas de un snapshot, así que salta de snapshot completo y no puede dejar medio snapshot leído.';

-- ------------------------------------------------------------
-- (5) GUARDA — por efecto donde se puede, y declarando lo que no.
-- ------------------------------------------------------------
DO $guarda0026$
DECLARE
  v_antes     integer := coalesce(nullif(current_setting('inv_b9.tablas_antes', true), ''), '0')::integer;
  v_ahora     integer;
  v_policies  integer;
  v_rls       integer;
  v_admin     integer;
  v_cascade   integer;
  v_checks    integer;
BEGIN
  SELECT count(*) INTO v_ahora
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND c.relname IN ('seguimientos', 'preferencias_notificacion');

  IF v_ahora <> 2 THEN
    RAISE EXCEPTION '0026: se esperaban las 2 tablas del bloque y hay % (antes habia %). Abortando.', v_ahora, v_antes;
  END IF;

  -- RLS activa en las dos. Sin esto, los GRANT de arriba abririan las tablas
  -- enteras a cualquier autenticado.
  SELECT count(*) INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('seguimientos', 'preferencias_notificacion')
     AND c.relrowsecurity;

  IF v_rls <> 2 THEN
    RAISE EXCEPTION '0026: RLS activa en % de 2 tablas. Con GRANT y sin RLS la tabla queda abierta a cualquier autenticado. Abortando.', v_rls;
  END IF;

  -- 4 verbos x 2 tablas.
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('seguimientos', 'preferencias_notificacion');

  IF v_policies <> 8 THEN
    RAISE EXCEPTION '0026: se esperaban 8 policies (4 verbos x 2 tablas) y hay %. Abortando.', v_policies;
  END IF;

  -- EL INVARIANTE QUE PIDIO EL PO, comprobado por AUSENCIA: ninguna policy de
  -- estas tablas puede mencionar is_admin(). Se busca la subcadena en el texto
  -- de la policy; no es un contrato con el formateador del catalogo, es una
  -- comprobacion de que cierta rama NO existe.
  SELECT count(*) INTO v_admin
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('seguimientos', 'preferencias_notificacion')
     AND (position('is_admin' in coalesce(qual, '')) > 0
          OR position('is_admin' in coalesce(with_check, '')) > 0);

  IF v_admin <> 0 THEN
    RAISE EXCEPTION '0026: % policy(s) de seguimiento mencionan is_admin(). Lo que una persona sigue es su configuracion, no trabajo supervisable: el admin tampoco lo ve. Abortando.', v_admin;
  END IF;

  -- El CASCADE es la decision que evita repetir el estado terminal de la 0024.
  SELECT count(*) INTO v_cascade
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('seguimientos', 'preferencias_notificacion')
     AND con.contype = 'f'
     AND con.confdeltype = 'c';

  IF v_cascade <> 2 THEN
    RAISE EXCEPTION '0026: se esperaban 2 FK con ON DELETE CASCADE hacia perfiles y hay %. Sin CASCADE, borrar una cuenta dejaria seguimientos que nadie puede alcanzar — el estado terminal que costo la 0025. Abortando.', v_cascade;
  END IF;

  SELECT count(*) INTO v_checks
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('seguimientos', 'preferencias_notificacion')
     AND con.contype = 'c'
     AND con.conname LIKE '%al_menos_un_aviso';

  IF v_checks <> 2 THEN
    RAISE EXCEPTION '0026: falta el CHECK de "al menos un aviso" en alguna tabla (hay %). Abortando.', v_checks;
  END IF;

  RAISE NOTICE '0026 · 2 tablas creadas VACIAS, RLS activa en ambas, 8 policies (4 verbos x 2), 0 menciones de is_admin(), 2 FK con ON DELETE CASCADE y 2 CHECK de al menos un aviso. No se toco ninguna tabla existente.';

  RAISE NOTICE '0026 · NO COMPROBADO AQUI: que la RLS NIEGUE de verdad. Esta guarda lee el TEXTO de pg_policies; no ejecuta las policies con dos sesiones. Que un KAM no vea el seguimiento de otro, y que UN ADMIN TAMPOCO, lo mide scripts/seguimientos-negativas.mjs con cuentas efimeras y salida literal.';

  RAISE NOTICE '0026 · LIMITE CONOCIDO, declarado: la fila de preferencias nace PEREZOSA (no hay trigger sobre el alta de perfil). Quien no la tenga lee los DEFAULT de la tabla, asi que la lectura tiene que tolerar su ausencia — si algun dia se asume que existe, fallara solo para las cuentas que nunca abrieron la campana.';
END $guarda0026$;

COMMIT;
