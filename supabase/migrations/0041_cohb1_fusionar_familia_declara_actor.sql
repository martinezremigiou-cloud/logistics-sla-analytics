-- ============================================================================
-- 0041 · COH-B1 · `fusionar_familia` declara `v_actor` — la línea que se perdió
--
-- QUÉ HACE
--   `CREATE OR REPLACE` de `public.fusionar_familia` añadiendo UNA línea a su
--   `DECLARE`. El cuerpo es byte-idéntico al de la `0018` salvo esa línea:
--   se extrajo del archivo a máquina y se cotejó con `diff`, que devuelve
--   exactamente `8a9`. Un `CREATE OR REPLACE` sustituye la función ENTERA, y
--   transcribir 98 líneas a mano es cómo se cuela un segundo defecto mientras
--   se arregla el primero.
--
-- POR QUÉ
--   `fusionar_familia` USA `v_actor` dos veces —en el `INSERT` (el `VALUES`) y
--   en la clave `'actor'` del `jsonb` de retorno— y NO la declara. Su hermana
--   `desfusionar_familia`, en el MISMO archivo, sí la declara. La variable se
--   copió sin su declaración.
--
--   PL/pgSQL compila el cuerpo en la primera llamada pero resuelve los
--   identificadores de cada sentencia SQL AL EJECUTARLA. Por eso la función
--   arranca bien —pasa la guarda de `is_admin()`, las de argumentos, la del
--   destino activo y la doble llave de `p_skus_esperados`— y revienta en el
--   `INSERT`, que es la última sentencia antes de escribir:
--
--       ERROR: 42703: column "v_actor" does not exist
--
--   `familias.service.ts` clasifica el error de la RPC con CUATRO predicados de
--   igualdad exacta de SQLSTATE (PGRST202 · 42501 · P0002 · 22023). Un 42703 no
--   pega con ninguno, así que sale por el `throw` genérico y la ruta responde
--   **500**.
--
-- QUÉ ARRASTRA, y es lo que lo vuelve urgente
--   No es sólo el panel de Familias. `resolver_familia_nueva` (0019) llama
--   directamente a esta función, así que el botón **«Es la misma que…»** de la
--   bandeja de Pendientes está roto por la misma causa — y el 42703 revienta
--   DENTRO de la llamada, con lo que la transacción entera se deshace.
--
-- TRES PRUEBAS DE QUE NUNCA CORRIÓ EN PRODUCCIÓN (medidas)
--   1. `familia_alias` solo tiene residuo del arnés de RLS
--      (`QA-RLS-NEGATIVAS-<id>`, `creado_por = NULL`). La RPC no pudo
--      escribirla: habría fallado antes de llegar al `INSERT`.
--   2. `familias`: todas activas. Una fusión real apaga la absorbida.
--   3. Ningún test ejecuta el cuerpo: el único que la toca simula la RPC y
--      afirma sus ARGUMENTOS. todos los archivos de pruebas en verde con la función rota.
--
-- POR QUÉ `0041` Y NO `0040`
--   La `0040` la tomó y aplicó el carril de CHAT (`1889mgm` la escribió,
--   `kk1279d` la aplicó). El número de una migración afirma un ORDEN DE
--   APLICACIÓN: ésta va detrás y no abre hueco.
--
-- ----------------------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (las tres preguntas de la casa)
--
--   1. ¿Destruye datos?
--      NO. No toca ninguna fila. Sustituye el cuerpo de una función.
--
--   2. ¿Se puede deshacer?
--      SÍ: re-aplicando el cuerpo de la `0018`. Pero deshacerlo devuelve el
--      500, así que el "deshacer" aquí es volver a romperlo.
--
--   3. ¿Qué pasa si se aplica dos veces?
--      Nada: `CREATE OR REPLACE` es idempotente.
--
-- ----------------------------------------------------------------------------
-- ⚠ LO QUE ESTA MIGRACIÓN NO PUEDE COMPROBAR DESDE DONDE ESTÁ — ver el NOTICE
--   final. En corto: que la función ya NO falle sólo se demuestra EJECUTÁNDOLA,
--   y una fusión real escribe en `familia_alias` y apaga una familia. Eso es
--   una decisión de producto, no un paso de esta migración.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fusionar_familia(
  p_alias text, p_destino text, p_skus_esperados integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor      text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
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
-- Los privilegios se re-emiten A PROPÓSITO aunque `CREATE OR REPLACE` sobre una
-- función EXISTENTE conserve su ACL: si por cualquier razón la función no
-- existiera y ésta la creara de cero, nacería con el `EXECUTE` que el
-- `pg_default_acl` de la plataforma concede a `anon` POR NOMBRE — y un
-- `REVOKE ... FROM PUBLIC` no lo quita. Es `SECURITY DEFINER`: ejecutable sin
-- sesión sería ejecutable sin `is_admin()`.
REVOKE ALL   ON FUNCTION public.fusionar_familia(text,text,integer) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.fusionar_familia(text,text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fusionar_familia(text,text,integer) TO authenticated;

-- ------------------------------------------- lo que NO puede comprobar
DO $notice0041$
DECLARE
  v_declarada boolean;
  v_alias_filas int;
  v_inactivas int;
BEGIN
  -- Lo ÚNICO que esta migración sí puede comprobar de sí misma: que el texto
  -- de la función viva ya contiene la declaración. No prueba que funcione
  -- —eso exige ejecutarla— pero sí que el reemplazo entró.
  SELECT prosrc LIKE '%v_actor      text := coalesce(auth.jwt()%'
    INTO v_declarada
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fusionar_familia';

  IF v_declarada IS NOT TRUE THEN
    RAISE EXCEPTION '0041: el reemplazo no dejo la declaracion de v_actor en el cuerpo vivo. Revisar antes de dar esto por aplicado.';
  END IF;

  SELECT count(*) INTO v_alias_filas FROM public.familia_alias;
  SELECT count(*) INTO v_inactivas  FROM public.familias WHERE activo = false;

  RAISE NOTICE '--- 0041 · COH-B1 · lo que esta migracion NO puede comprobar desde aqui ---';
  RAISE NOTICE '  v_actor declarada en el cuerpo vivo: SI (comprobado contra pg_proc.prosrc)';
  RAISE NOTICE '  familia_alias: % filas · familias inactivas: %', v_alias_filas, v_inactivas;
  RAISE NOTICE '  (1) NO comprueba que la funcion YA NO falle. El 42703 se resolvia AL';
  RAISE NOTICE '      EJECUTAR la sentencia, asi que la unica prueba es una fusion real —';
  RAISE NOTICE '      y una fusion real ESCRIBE en familia_alias y APAGA una familia.';
  RAISE NOTICE '      Eso es decision del PO, no un paso de esta migracion.';
  RAISE NOTICE '  (2) NO limpia el residuo de QA de familia_alias. La unica fila de hoy la';
  RAISE NOTICE '      escribio el arnes de RLS negativas el 5-sep con la llave de servicio,';
  RAISE NOTICE '      no esta RPC. Borrarla es otra decision, y tiene dos vias distintas.';
  RAISE NOTICE '  (3) NO arregla la causa de fondo: nada en el arbol comprueba que una';
  RAISE NOTICE '      variable usada en plpgsql este declarada. Eso lo cierra el trinquete';
  RAISE NOTICE '      estatico de este mismo bloque, que corre en `npm run verificar`.';
END $notice0041$;

COMMIT;
