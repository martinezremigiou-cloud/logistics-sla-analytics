-- ============================================================
-- 0027 · [INV-B9.1] El correo: un interruptor, un apagador y un registro.
--
-- QUÉ AGREGA. Dos booleanos a tablas que ya existen y una tabla nueva de
-- registro. Nada de esto decide QUÉ avisar: eso sigue siendo `derivarAvisos()`,
-- que no se toca. El correo es el SEGUNDO consumidor de esa función.
--
-- ────────────────────────────────────────────────────────────
-- (1) `seguimientos.av_correo` — el segundo nivel de criticidad.
--
-- El invariante pedido —**ningún SKU puede tener aviso por correo sin
-- tener aviso en campana**— queda satisfecho POR CONSTRUCCIÓN y no por un
-- CHECK nuevo: `av_correo` vive en una fila de `seguimientos`, y esa fila ya
-- está obligada por `seguimientos_al_menos_un_aviso` a tener al menos un aviso
-- encendido. No hay forma de escribir un correo sin campana porque no hay
-- dónde escribirlo.
--
-- Y NO lleva su propia lista de tipos. Lo que se manda por correo es lo que el
-- usuario ya eligió para la campana; la ventana pregunta *qué* una vez, el
-- interruptor decide *si además te busca*. Duplicar los cuatro booleanos aquí
-- habría creado dos verdades sobre la misma pregunta.
--
-- (2) `preferencias_notificacion.boletin_correo` — el apagador.
--
-- Nace en `true`: el boletín semanal le llega a todos, que es como se
-- diseñó. Quien lo sienta ruidoso lo apaga. Es un booleano, no una pantalla.
--
-- ────────────────────────────────────────────────────────────
-- (3) `envios_aviso` — el registro, y POR QUÉ NO VA EN `preferencias`.
--
-- La razón no es de gusto: **`preferencias_notificacion` es escribible por su
-- dueño.** La policy `preferencias_update_own` (0026) deja al usuario
-- actualizar CUALQUIER columna vía PostgREST directo. Un testigo de envío ahí
-- sería falsificable: cualquiera podría silenciar su propio correo o forzar un
-- reenvío. El schema de zod guarda la puerta de la aplicación; la RLS guarda la
-- otra, y la RLS es la que manda.
--
-- Por eso esta tabla **no tiene ni una policy para `authenticated`**, y encima
-- se le revocan los privilegios: solo la toca el portal con la llave de
-- servicio. Es la primera tabla del repo cerrada así, y es deliberado —
-- registrar lo que el sistema hizo no es dato del usuario.
--
-- `enviado_hasta` NO EXISTE COMO COLUMNA. Es `max(hasta) WHERE estado='enviado'`.
-- Una verdad consultada no se puede desincronizar de sí misma; una copia sí.
--
-- ────────────────────────────────────────────────────────────
-- AGNÓSTICA A LA CADENCIA — condición explícita, y es lo que decide la
-- forma de esta tabla.
--
-- El correo por evento entre semana no entra en este bloque, pero SÍ condiciona
-- el diseño: si «semanal» se hornea aquí, ese correo será un rediseño; si la
-- cadencia es un parámetro, será un segundo workflow y cero cambios en la base.
--
--   `clave_intento`  CADENA OPACA que suministra el llamador. El portal no la
--                    construye, no la parsea y no asume que diga «semanal».
--                    Hoy `semanal-AAAA-Wnn`; mañana `evento-<sku>-<snapshot>`.
--   `desde`/`hasta`  Una VENTANA, no una semana. El portal no tiene calendario:
--                    el calendario es de n8n (reparto de responsabilidades).
--
-- LA IDEMPOTENCIA ES DEL ÍNDICE, no del código: `UNIQUE (perfil_id,
-- clave_intento)`. Es la misma lección de la PK compuesta de la 0026 — un
-- índice no se puede olvidar de aplicarse.
--
-- LO QUE ESTA TABLA NO GUARDA, y se dice: los envíos que NO ocurrieron. Si una
-- ventana no traía nada, no hay fila. La ausencia es derivable y registrar
-- no-eventos sería el fan-out en miniatura.
--
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Dos `ADD COLUMN … DEFAULT` sobre tablas ya pobladas, y un
--      `CREATE TABLE` que nace VACÍA. Cero DELETE, cero UPDATE de datos
--      existentes. Revertir es `DROP TABLE public.envios_aviso;` y dos
--      `DROP COLUMN`, y no pierde ninguna configuración de nadie: las dos
--      columnas nacen con su valor por omisión.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** No toca ninguna fila existente: los `DEFAULT` de PG 11+ no
--      reescriben la tabla. La guarda cuenta las columnas y las tablas antes y
--      después y aborta si el delta no es exactamente el esperado.
--
--   3. ¿Qué NO puede comprobar este archivo desde SQL?
--      Que `envios_aviso` sea de verdad inalcanzable para un usuario
--      autenticado. Una guarda que lee `pg_policies` ve que no hay policies;
--      no ejecuta una sesión real contra la tabla. Eso lo mide
--      `scripts/correo-negativas.mjs` con un JWT de KAM y otro de admin.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (0) FOTO DEL ANTES — control anti-vacuidad.
-- ------------------------------------------------------------
DO $antes0027$
DECLARE
  v_cols   integer;
  v_tablas integer;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'seguimientos' AND column_name = 'av_correo')
       OR (table_name = 'preferencias_notificacion' AND column_name = 'boletin_correo'));

  SELECT count(*) INTO v_tablas
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'envios_aviso';

  PERFORM set_config('inv_b91.cols_antes', v_cols::text, true);
  PERFORM set_config('inv_b91.tablas_antes', v_tablas::text, true);
END $antes0027$;

-- ------------------------------------------------------------
-- (1) EL INTERRUPTOR DE CORREO, POR SKU.
-- ------------------------------------------------------------
ALTER TABLE public.seguimientos
  ADD COLUMN IF NOT EXISTS av_correo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.seguimientos.av_correo IS
  '[INV-B9.1] Segundo nivel de criticidad: además de la campana, búscame por correo. Nace APAGADO — el correo se pide, no se impone. NO lleva su propia lista de tipos: lo que se manda es lo que el usuario ya eligió para la campana en esta misma fila. El invariante "ningún SKU con correo sin campana" se cumple por construcción: esta fila ya está obligada a tener al menos un aviso encendido.';

-- ------------------------------------------------------------
-- (2) EL APAGADOR DEL BOLETÍN.
-- ------------------------------------------------------------
ALTER TABLE public.preferencias_notificacion
  ADD COLUMN IF NOT EXISTS boletin_correo boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.preferencias_notificacion.boletin_correo IS
  '[INV-B9.1] Si el correo periódico incluye el bloque GENERAL (el pulso), que le llega a todos por diseño. Nace ENCENDIDO; quien lo sienta ruidoso lo apaga. No afecta al bloque personal: los SKU con av_correo siguen avisando aunque esto esté en false.';

-- ------------------------------------------------------------
-- (3) EL REGISTRO DE ENVÍOS.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.envios_aviso (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SIN `DEFAULT auth.uid()`, al revés que en la 0026 y por una razón medida:
  -- esta tabla la escribe el portal con la llave de servicio, donde
  -- `auth.uid()` es NULL. Un default aquí no sería una defensa, sería un NULL
  -- silencioso.
  perfil_id     uuid NOT NULL REFERENCES public.perfiles(id) ON DELETE CASCADE,

  -- OPACA. El portal no la construye ni la interpreta. Ver la cabecera.
  clave_intento text NOT NULL CHECK (length(btrim(clave_intento)) BETWEEN 1 AND 120),

  -- Una VENTANA, no una semana.
  desde         timestamptz NOT NULL,
  hasta         timestamptz NOT NULL,
  CONSTRAINT envios_ventana_valida CHECK (hasta > desde),

  -- `preparado` = el portal armó el contenido y lo entregó al llamador.
  -- `enviado`   = el llamador confirmó que salió.
  -- No hay tercer estado: una ventana sin nada que decir NO crea fila.
  estado        text NOT NULL DEFAULT 'preparado'
                CHECK (estado IN ('preparado', 'enviado')),

  /** Cuántos avisos llevaba. Es el registro, no una entrada de ningún cálculo. */
  avisos        integer NOT NULL DEFAULT 0 CHECK (avisos >= 0),

  creado_en     timestamptz NOT NULL DEFAULT now(),
  confirmado_en timestamptz,

  -- LA IDEMPOTENCIA, y vive en el índice para que no se pueda olvidar.
  CONSTRAINT envios_aviso_intento_unico UNIQUE (perfil_id, clave_intento)
);

-- La consulta natural del registro es «qué se le envió a esta persona, lo más
-- reciente primero» — y de ahí sale también `max(hasta)`, que es el
-- `enviado_hasta` que NO se guarda como columna.
CREATE INDEX IF NOT EXISTS idx_envios_aviso_perfil_hasta
  ON public.envios_aviso(perfil_id, hasta DESC);

COMMENT ON TABLE public.envios_aviso IS
  '[INV-B9.1] Registro de lo que el sistema envió por correo: a quién, qué ventana cubría y si se confirmó. NO es dato del usuario y por eso NO tiene ninguna policy para authenticated — solo la toca el portal con la llave de servicio. Vive aparte de preferencias_notificacion porque esa tabla SÍ es escribible por su dueño, y un testigo de envío ahí sería falsificable. `enviado_hasta` no es columna: es max(hasta) WHERE estado=enviado. Agnóstica a la cadencia: clave_intento es opaca y la ventana es un parámetro, para que el correo por evento sea otro workflow y no otro esquema.';

-- ------------------------------------------------------------
-- (4) EL CIERRE DE `envios_aviso`.
--
--     RLS activa y CERO policies = nadie autenticado alcanza ni una fila. Los
--     REVOKE son la segunda vuelta de llave: si algún día alguien crea una
--     policy por error, sin privilegio de tabla sigue sin poder leerla.
-- ------------------------------------------------------------
ALTER TABLE public.envios_aviso ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.envios_aviso FROM anon, authenticated;

-- ------------------------------------------------------------
-- (5) GUARDA — por efecto donde se puede, y declarando lo que no.
-- ------------------------------------------------------------
DO $guarda0027$
DECLARE
  v_cols_antes   integer := coalesce(nullif(current_setting('inv_b91.cols_antes', true), ''), '0')::integer;
  v_tablas_antes integer := coalesce(nullif(current_setting('inv_b91.tablas_antes', true), ''), '0')::integer;
  v_cols         integer;
  v_tabla        integer;
  v_rls          boolean;
  v_policies     integer;
  v_priv         integer;
  v_unico        integer;
  v_def_correo   text;
  v_def_boletin  text;
BEGIN
  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'seguimientos' AND column_name = 'av_correo')
       OR (table_name = 'preferencias_notificacion' AND column_name = 'boletin_correo'));

  IF v_cols <> 2 THEN
    RAISE EXCEPTION '0027: se esperaban las 2 columnas nuevas y hay % (antes habia %). Abortando.', v_cols, v_cols_antes;
  END IF;

  -- Los DEFAULT no son cosmética: uno decide que el correo se pida y el otro
  -- que el boletín llegue. Invertidos, el bloque hace lo contrario de lo
  -- acordado sin que nada falle.
  SELECT column_default INTO v_def_correo
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'seguimientos' AND column_name = 'av_correo';

  SELECT column_default INTO v_def_boletin
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'preferencias_notificacion' AND column_name = 'boletin_correo';

  IF position('false' in coalesce(v_def_correo, '')) = 0 THEN
    RAISE EXCEPTION '0027: av_correo no nace APAGADO (default=%). El correo se pide, no se impone. Abortando.', coalesce(v_def_correo, 'NULL');
  END IF;

  IF position('true' in coalesce(v_def_boletin, '')) = 0 THEN
    RAISE EXCEPTION '0027: boletin_correo no nace ENCENDIDO (default=%). El boletin le llega a todos por diseno. Abortando.', coalesce(v_def_boletin, 'NULL');
  END IF;

  SELECT count(*) INTO v_tabla
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'envios_aviso';

  IF v_tabla <> 1 THEN
    RAISE EXCEPTION '0027: envios_aviso no quedo creada (encontradas %, antes habia %). Abortando.', v_tabla, v_tablas_antes;
  END IF;

  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'envios_aviso';

  IF NOT coalesce(v_rls, false) THEN
    RAISE EXCEPTION '0027: envios_aviso quedo SIN RLS. Abortando.';
  END IF;

  -- LA COMPROBACION QUE DEFINE ESTA TABLA, por AUSENCIA: cero policies. Con RLS
  -- activa y ninguna policy, ninguna sesion autenticada alcanza una fila.
  SELECT count(*) INTO v_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'envios_aviso';

  IF v_policies <> 0 THEN
    RAISE EXCEPTION '0027: envios_aviso tiene % policy(s). Es un registro del SISTEMA, no dato de usuario: no debe alcanzarla ninguna sesion. Abortando.', v_policies;
  END IF;

  -- Y la segunda vuelta de llave: ni un privilegio para los roles publicos.
  SELECT count(*) INTO v_priv
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'envios_aviso'
     AND grantee IN ('anon', 'authenticated');

  IF v_priv <> 0 THEN
    RAISE EXCEPTION '0027: envios_aviso conserva % privilegio(s) para anon/authenticated. Abortando.', v_priv;
  END IF;

  SELECT count(*) INTO v_unico
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'envios_aviso'
     AND con.contype = 'u' AND con.conname = 'envios_aviso_intento_unico';

  IF v_unico <> 1 THEN
    RAISE EXCEPTION '0027: falta el UNIQUE (perfil_id, clave_intento). SIN EL, LA IDEMPOTENCIA DEL ENVIO DEPENDE DEL CODIGO, que es exactamente lo que este bloque no quiere. Abortando.';
  END IF;

  RAISE NOTICE '0027 · 2 columnas nuevas con sus defaults verificados (av_correo APAGADO, boletin_correo ENCENDIDO), envios_aviso creada VACIA con RLS activa, 0 policies, 0 privilegios para anon/authenticated y el UNIQUE de idempotencia en su sitio.';

  RAISE NOTICE '0027 · NO COMPROBADO AQUI: que envios_aviso sea de verdad inalcanzable desde una sesion. Esta guarda lee el catalogo; no ejecuta una consulta con un JWT. Lo mide scripts/correo-negativas.mjs con un KAM y un admin reales.';

  RAISE NOTICE '0027 · LIMITE CONOCIDO, declarado: la idempotencia es por CLAVE, no por ventana. Dos llamadas con claves distintas y ventanas que se traslapan producirian dos correos con el mismo aviso. El portal no lo puede impedir sin prohibir el correo por evento (que por diseno traslapa con el boletin); es responsabilidad del llamador derivar la clave de la cadencia. Queda como deuda con disparador.';
END $guarda0027$;

COMMIT;
