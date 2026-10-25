-- ============================================================
-- 0018 · [MVP-2] C · `familia_alias` — la fusión que sobrevive al espejo.
--
-- ESCRITA, **NO APLICADA**. Se aplica a mano.
--
-- ------------------------------------------------------------
-- EL PROBLEMA, CON LA LÍNEA EXACTA
-- ------------------------------------------------------------
-- El portal no manda sobre la familia: el Excel sí. Cada ingesta corre
-- esto (`0013_mvp_cierre_bandeja_ingesta.sql:317-331`):
--
--     INSERT INTO public.familias (nombre)
--     SELECT f FROM jsonb_array_elements_text(payload->'familiasNuevas') AS f
--     ON CONFLICT (nombre) DO NOTHING;
--
--     INSERT INTO public.productos (… familia_id …)
--     SELECT …, (SELECT id FROM public.familias WHERE nombre = p->>'familia'), …
--     ON CONFLICT (sku) DO UPDATE SET familia_id = EXCLUDED.familia_id, …;
--
-- O sea: `familia_id` se resuelve por NOMBRE EXACTO en cada corrida y se
-- reescribe. Una fusión hecha repuntando `familia_id` a mano se deshace
-- sola el mes siguiente: el nombre malo sigue en el Excel, la fila mala
-- sigue existiendo (el `DO NOTHING` nunca borra) y el `DO UPDATE` la
-- vuelve a apuntar.
--
-- Una fusión no puede ser una acción de una sola vez. Tiene que ser una
-- REGLA. Que es exactamente lo que `marca_alias` hace para marcas desde
-- B1, y `estatus_alias` para estatus desde B2.
--
-- ------------------------------------------------------------
-- CÓMO SE CONSUME (y por qué intercepta ANTES del descubrimiento)
-- ------------------------------------------------------------
-- `resolveMarca` (src/services/etl/catalogs.ts:21-24) consulta el alias
-- ANTES que el nombre canónico:
--
--     const aliasHit = idx.marcaAlias.get(normalizeAliasKey(raw));
--     if (aliasHit) return { marca_id: aliasHit };
--
-- Ese orden es el diseño entero: el nombre malo NUNCA llega a
-- `marcasNuevas`, así que la fila mala NUNCA se crea. No es una corrección
-- posterior; es que el mal nombre deja de existir. `resolveFamilia` gana
-- el mismo paso en este bloque.
--
-- NO HAY CADENAS: un alias apunta a un `familia_id`, nunca a otro alias.
-- Así no existe `A→B→C` ni ciclos, y la resolución es de un solo salto.
--
-- ------------------------------------------------------------
-- LO QUE ESTE MECANISMO **NO** CUBRE — medido, no estimado
-- ------------------------------------------------------------
-- La clave es la CELDA COMPLETA, porque `resolveFamilia` busca la celda
-- completa (no parte por '/'): `separarFamilias` (src/lib/familias.ts)
-- NUNCA se invoca en el ETL. Consecuencia medida:
--
--     familias totales ................... (varias centenas)
--     con '/' en el nombre (compuestas) ...  (unas decenas)
--
-- Un alias `SERIES2 → SERIES 2` arregla la celda `SERIES2`, pero NO la celda
-- `SERIES2 26 / SERIES2 38`, que es otra fila del catálogo y necesita su
-- propio alias. De los pares de errata vivos, algunos son compuestos:
--
--     PIVOT LOCK                        || PIVOTLOCK
--     MINI PIVOT LOCK                   || MINI PIVOTLOCK
--     SERIES 2                           || SERIES2
--     SERIES 2 26 / SERIES 2 38           || SERIES2 26 / SERIES2 38      ← compuesto
--     QZ8 / H5980                       || QZ8/H5980
--     CLIP 3.0 / CLIP DOBLE MICRO RESORTE  || CLIP 3.0 / CLIP DOBLE MICRORESORTE  ← compuesto
--
-- Aplicar el alias POR ÁTOMO lo resolvería en general, pero obligaría al
-- ETL a atomizar y eso convierte `familias` de "una fila por celda" a "una
-- fila por átomo": es rediseñar el modelo de familias, **fuera de alcance
-- de este bloque por decisión de producto**.
--
-- Por eso la interfaz de fusión DECLARA su alcance antes de confirmar (los
-- compuestos que contienen el átomo, con su conteo de SKU). Un mecanismo
-- que cubre el 90 % y no avisa del 10 % es peor que uno que lo dice.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) La tabla. Gemela EXACTA de `marca_alias` (0001_schema.sql):
--     `alias` PK de texto, FK al catálogo, dos columnas y nada más.
-- ------------------------------------------------------------
-- `creado_por` / `creado_en` NO están en `marca_alias`, y aquí sí, por una
-- diferencia que la auditoría señaló y es correcta: `marca_alias` nunca tuvo
-- un escritor de USUARIO (se siembra en `0003_seeds.sql` y `0008`).
-- `fusionar_familia` es el PRIMER escritor de sesión de una tabla de alias, y
-- una fusión es una regla GLOBAL y PERMANENTE sobre cómo el ETL clasifica el
-- catálogo entero. Todo lo demás que un admin puede cambiar en este proyecto
-- deja autor y fecha (`productos_override.editado_por`,
-- `clasificacion_v2.updated_by`, `pendientes_datos.resuelto_por`) — y el
-- frente A de este mismo bloque existe justamente para que `updated_by` no
-- viaje desde el cliente. Dejar esto sin autor habría sido incoherente.
CREATE TABLE IF NOT EXISTS public.familia_alias (
  alias      text NOT NULL,
  familia_id uuid NOT NULL,
  creado_por text,
  creado_en  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT familia_alias_pkey PRIMARY KEY (alias),
  CONSTRAINT familia_alias_familia_id_fkey
    FOREIGN KEY (familia_id) REFERENCES public.familias(id)
);

CREATE INDEX IF NOT EXISTS idx_familia_alias_familia_id
  ON public.familia_alias(familia_id);

-- UNIQUE case-insensitive desde el día uno. `marca_alias` NO lo tiene y
-- `familias` lo ganó tarde (`familias_nombre_lower_uidx`, 0006, que cerró
-- B3-5): sin esto, 'SERIES2' y 'series2' serían dos alias distintos y el
-- lookup del ETL —que normaliza a minúsculas— tomaría uno cualquiera.
CREATE UNIQUE INDEX IF NOT EXISTS familia_alias_lower_uidx
  ON public.familia_alias (lower(alias));

-- ------------------------------------------------------------
-- (2) RLS — copiada al pie de la letra de `marca_alias` (verificado en
--     vivo): lectura para cualquier sesión (el ETL y la UI
--     la necesitan), escritura solo admin. SIN policy de DELETE: misma
--     doctrina que el resto del proyecto ("la capa no borra").
-- ------------------------------------------------------------
ALTER TABLE public.familia_alias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS familia_alias_select_auth ON public.familia_alias;
CREATE POLICY familia_alias_select_auth ON public.familia_alias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS familia_alias_admin_insert ON public.familia_alias;
CREATE POLICY familia_alias_admin_insert ON public.familia_alias
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS familia_alias_admin_update ON public.familia_alias;
CREATE POLICY familia_alias_admin_update ON public.familia_alias
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- (3) La RPC de fusión. Dos escrituras que tienen que ir JUNTAS o no ir:
--     el alias (para que la próxima ingesta resuelva al bueno) y el
--     `activo=false` de la absorbida (para que deje de ofrecerse).
--
--     `familias.activo` existe desde `0001_schema.sql` y no tuvo escritor
--     durante 18 migraciones: todas sus filas activas. Este bloque le da DOS,
--     y hay que decirlo junto: esta RPC lo APAGA al fusionar, y `createFamilia`
--     (frente D) lo ENCIENDE al reactivar un nombre ocupado. La auditoría
--     señaló que se pueden deshacer mutuamente, y tiene razón — por eso
--     `createFamilia` avisa si el nombre que reactiva tiene un alias vivo:
--     reactivar sin quitar el alias deja una familia ofrecida en el `<Select>`
--     a la que el ETL nunca asignará nada. Y lo que apaga es lo correcto
--     —medido—:
--     la absorbida desaparece del `<Select>` de la ficha
--     (`ficha-atributos.tsx` → `/api/familias`) y del card de /config,
--     pero NO del árbol ni de las facetas, porque ésas se cuentan en
--     memoria sobre los productos (`inventory.service.ts:222-237`) y no
--     leen esta tabla. El árbol se limpia solo cuando la próxima ingesta
--     mueve los SKU al nombre bueno. Es el orden correcto: primero deja
--     de ofrecerse, después deja de verse.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fusionar_familia(
  p_alias text, p_destino text, p_skus_esperados integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_alias      text := btrim(coalesce(p_alias, ''));
  v_destino    text := btrim(coalesce(p_destino, ''));
  v_destino_id uuid;
  v_absorbida  public.familias%ROWTYPE;
  v_skus       integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_alias = '' OR v_destino = '' THEN
    RAISE EXCEPTION 'alias y destino son obligatorios' USING errcode = '22023';
  END IF;
  IF lower(v_alias) = lower(v_destino) THEN
    RAISE EXCEPTION 'el alias y el destino son el mismo nombre: la fusion no haria nada'
      USING errcode = '22023';
  END IF;

  SELECT id INTO v_destino_id FROM public.familias WHERE lower(nombre) = lower(v_destino);
  IF v_destino_id IS NULL THEN
    RAISE EXCEPTION 'la familia destino "%" no existe en el catalogo', v_destino
      USING errcode = 'P0002';
  END IF;

  -- El destino NO puede estar inactivo: fusionar hacia algo retirado
  -- dejaría a los SKU apuntando a una familia que nadie puede elegir.
  IF NOT (SELECT activo FROM public.familias WHERE id = v_destino_id) THEN
    RAISE EXCEPTION 'la familia destino "%" esta inactiva', v_destino USING errcode = '22023';
  END IF;

  -- La absorbida puede NO existir como fila: un alias es legítimo para un
  -- nombre que solo aparece en el Excel y que aún no se creó.
  SELECT * INTO v_absorbida FROM public.familias WHERE lower(nombre) = lower(v_alias);

  IF v_absorbida.id IS NOT NULL THEN
    SELECT count(*) INTO v_skus FROM public.productos WHERE familia_id = v_absorbida.id;

    -- CONFIRMACIÓN DE DOBLE LLAVE (hallazgo B4 de la auditoría). Antes el
    -- conteo se calculaba y solo se REPORTABA: un admin podía llamar
    -- `/rest/v1/rpc/fusionar_familia` directo —sin pasar por la pantalla, que
    -- es la única que declaraba el alcance— y apagar la familia con más SKU
    -- del catálogo. Eso era P13: la protección viviendo solo en el cliente.
    -- `p_skus_esperados` obliga a que quien llama haya MIRADO el número.
    -- `NULL` se sigue aceptando solo cuando no hay SKU en juego.
    IF p_skus_esperados IS DISTINCT FROM v_skus THEN
      RAISE EXCEPTION
        'confirmacion no coincide: la familia "%" tiene % SKU y se esperaban %. Vuelve a mirar el alcance antes de fusionar.',
        v_absorbida.nombre, v_skus, coalesce(p_skus_esperados::text, 'ninguno')
        USING errcode = '22023';
    END IF;

    -- CADENA POR DESACTIVACIÓN (hallazgo B4-ter). No hay cadenas alias→alias
    -- por construcción, pero sí se forman por el otro lado: si la absorbida
    -- ya es DESTINO de aliases vivos, apagarla deja a esos aliases apuntando
    -- a una familia que nadie puede elegir, y los SKU con esos nombres
    -- terminan en un callejón. Se prohíbe.
    IF EXISTS (SELECT 1 FROM public.familia_alias WHERE familia_id = v_absorbida.id) THEN
      RAISE EXCEPTION
        'la familia "%" ya es destino de otros alias: fusionarla los dejaria apuntando a una familia inactiva. Fusiona primero esos alias hacia "%".',
        v_absorbida.nombre, v_destino
        USING errcode = '22023';
    END IF;
  ELSIF p_skus_esperados IS NOT NULL AND p_skus_esperados <> 0 THEN
    RAISE EXCEPTION 'confirmacion no coincide: "%" no existe como familia (0 SKU) y se esperaban %.',
      v_alias, p_skus_esperados USING errcode = '22023';
  END IF;

  INSERT INTO public.familia_alias (alias, familia_id, creado_por, creado_en)
  VALUES (v_alias, v_destino_id, v_actor, now())
  -- Cubre AMBOS índices: la PK `(alias)` y el funcional `lower(alias)`. Con
  -- solo `ON CONFLICT (alias)`, un `fusionar_familia('series2', …)` existiendo
  -- ya `'SERIES2'` violaba `familia_alias_lower_uidx` con un 23505 sin manejar
  -- que acababa en 500 (hallazgo B6, matiz 3).
  ON CONFLICT ON CONSTRAINT familia_alias_pkey
    DO UPDATE SET familia_id = EXCLUDED.familia_id,
                  creado_por = EXCLUDED.creado_por,
                  creado_en  = EXCLUDED.creado_en;

  IF v_absorbida.id IS NOT NULL THEN
    UPDATE public.familias SET activo = false WHERE id = v_absorbida.id;
  END IF;

  RETURN jsonb_build_object(
    'alias', v_alias,
    'destino', (SELECT nombre FROM public.familias WHERE id = v_destino_id),
    'absorbida_existia', v_absorbida.id IS NOT NULL,
    'skus_que_migraran', v_skus,
    'actor', v_actor
  );
END;
$$;

REVOKE ALL   ON FUNCTION public.fusionar_familia(text,text,integer) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.fusionar_familia(text,text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fusionar_familia(text,text,integer) TO authenticated;

-- ------------------------------------------------------------
-- (3-bis) DESHACER. Hallazgo B4 de la auditoría: sin esto, una fusión
--     equivocada solo se arreglaba en el panel de Supabase — y
--     `createFamilia` reactivando la familia SIN quitar el alias daba una
--     falsa sensación de arreglo, porque el ETL seguía redirigiendo.
--
--     Es la ÚNICA operación del proyecto que borra una fila, y por eso no
--     se hace con una policy de DELETE (la doctrina "la capa no borra" se
--     mantiene: `familia_alias` sigue sin policy de DELETE) sino dentro de
--     esta RPC, que exige admin y deja el motivo en el log.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desfusionar_familia(p_alias text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor  text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_fila   public.familia_alias%ROWTYPE;
  v_react  boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO v_fila FROM public.familia_alias WHERE lower(alias) = lower(btrim(p_alias));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no existe un alias "%"', p_alias USING errcode = 'P0002';
  END IF;

  DELETE FROM public.familia_alias WHERE alias = v_fila.alias;

  -- Reactiva la familia absorbida si sigue existiendo e inactiva: deshacer
  -- la fusión sin reactivarla dejaría el nombre fuera del `<Select>` sin
  -- ninguna razón visible.
  UPDATE public.familias SET activo = true
   WHERE lower(nombre) = lower(v_fila.alias) AND NOT activo;
  GET DIAGNOSTICS v_react = ROW_COUNT;

  RAISE NOTICE 'desfusionar_familia · % deshizo el alias "%" (creado por % el %). Familia reactivada: %',
    v_actor, v_fila.alias, coalesce(v_fila.creado_por,'?'), v_fila.creado_en, v_react;

  RETURN jsonb_build_object('alias', v_fila.alias, 'familia_reactivada', v_react, 'actor', v_actor);
END;
$$;

REVOKE ALL   ON FUNCTION public.desfusionar_familia(text) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.desfusionar_familia(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.desfusionar_familia(text) TO authenticated;

-- El `TRUNCATE` por default privileges de Supabase (ver `0016`, MVP2-6) nace
-- otra vez en toda tabla NUEVA, y `0016` itera sobre las tablas existentes en
-- el momento en que corre. Se revoca aquí para que `familia_alias` no dependa
-- del orden de aplicación (hallazgo B6, matiz 1).
REVOKE TRUNCATE ON TABLE public.familia_alias FROM anon, authenticated;

-- ------------------------------------------------------------
-- (4) GUARDA DEL EFECTO REAL — y, como en la 0017, DECLARA lo que no
--     puede ver desde aquí.
-- ------------------------------------------------------------
DO $guarda0018$
DECLARE
  v_oid oid;
  v_n   integer;
BEGIN
  IF to_regclass('public.familia_alias') IS NULL THEN
    RAISE EXCEPTION '0018: familia_alias no quedó creada. Abortando.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.familia_alias'::regclass) THEN
    RAISE EXCEPTION '0018: familia_alias quedó SIN RLS. Abortando.';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'familia_alias';
  IF v_n <> 3 THEN
    RAISE EXCEPTION '0018: familia_alias tiene % policies, se esperaban 3 (select/insert/update). Abortando.', v_n;
  END IF;

  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fusionar_familia';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0018: fusionar_familia no quedó creada. Abortando.';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '0018: fusionar_familia NO es SECURITY DEFINER. Abortando.';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0018: anon puede EJECUTAR fusionar_familia. Abortando.';
  END IF;

  -- Control anti-vacuidad: si ya hubiera alias, esta migración no está
  -- estrenando la tabla y alguien la creó por otro camino.
  SELECT count(*) INTO v_n FROM public.familia_alias;
  IF v_n > 0 THEN
    RAISE NOTICE '0018 · AVISO: familia_alias ya traía % fila(s) — la tabla no es nueva.', v_n;
  END IF;

  RAISE NOTICE '0018 · GUARDA VERDE: familia_alias con RLS y 3 policies, fusionar_familia DEFINER y fuera del alcance de anon.';
  RAISE NOTICE '0018 · NO COMPROBADO AQUÍ: que el ETL consulte el alias. Eso vive en src/services/etl/catalogs.ts y lo cubren sus tests.';
END $guarda0018$;

COMMIT;
