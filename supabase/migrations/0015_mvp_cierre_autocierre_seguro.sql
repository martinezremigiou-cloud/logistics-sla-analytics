-- ============================================================
-- 0015 · [MVP-CIERRE] El auto-cierre por baja deja de ser irreversible
--
-- HALLAZGO ALTA de la auditoría adversarial, verificado de forma
-- independiente contra producción antes de escribir esto.
--
-- LO QUE PASABA. `sincronizar_pendientes_tecnologia` cierra como "salió del
-- catálogo" todo pendiente cuyo SKU no esté en el snapshot evaluado. Ese
-- cierre era IRREVERSIBLE: el encolado usa `ON CONFLICT DO NOTHING`, así que
-- un pendiente ya resuelto NUNCA volvía a abrirse aunque el SKU reapareciera.
-- Y `pendientes_datos` tiene UNA sola política de RLS (SELECT): ni un admin
-- puede reabrirlo desde el producto.
--
-- CÓMO SE DISPARABA — y esto es lo grave: no hace falta un atacante. Un
-- `.xlsx` de stock con las tres pestañas BIEN NOMBRADAS pero SOLO
-- ENCABEZADO (sin filas de datos) pasa la validación de entrada. Medido:
--
--   zod RefreshBody con hojas solo-encabezado ....... success = TRUE
--   zod RefreshBody con arreglos vacíos ............. success = false
--
-- El `.min(1)` que INV-B8 puso para atrapar el dataset vacío corta `[]`,
-- pero no corta `[[encabezado]]`. Con 0 productos en el snapshot resultante:
--
--   pendientes que se cerrarían, snapshot VIGENTE (control) ....  0
--   pendientes que se cerrarían, snapshot sin productos ........ todos  (de todos)
--   pendientes que se cerrarían, v_snap NULL ................... todos
--
-- Y la bandeja quedaba en 0 mientras el Dashboard seguía diciendo N — la
-- misma divergencia de "contar una cosa y mostrar otra" que la 0013 decía
-- venir a cerrar. La guarda de cierre de la 0013 tampoco lo habría visto:
-- cuenta la cobertura sin filtrar por estado, así que todas las filas mal cerradas
-- seguían contando como "cubiertas".
--
-- ES P14 OTRA VEZ ("la petición degradada que pasa por válida",
-- docs/engineering/failure-patterns.md), en el bloque que bautizó ese patrón y escrito
-- por quien lo bautizó. La ausencia llegó con la forma correcta.
--
-- NO SE REABRE LA 0013, que ya está aplicada. Va aparte.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) `sincronizar_pendientes_tecnologia`, con dos correcciones.
--     Cuerpo de la 0013 + la guarda de universo vacío + el reabrir.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sincronizar_pendientes_tecnologia(p_snapshot uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_snap      uuid;
  v_productos integer := 0;
  v_encolados integer := 0;
  v_reabiertos integer := 0;
  v_cerrados  integer := 0;
  v_baja      integer := 0;
BEGIN
  v_snap := coalesce(
    p_snapshot,
    (SELECT s.id FROM public.snapshots s
      WHERE s.fuente = 'stock' ORDER BY s.created_at DESC, s.id DESC LIMIT 1)
  );

  -- [0015] GUARDA DE UNIVERSO. Cuántos productos tiene REALMENTE el snapshot
  -- que se va a evaluar. Con `v_snap` NULL o con un snapshot sin productos,
  -- el `NOT EXISTS` del auto-cierre por baja es verdadero para TODOS: cerraba
  -- la bandeja entera. Un catálogo vacío no es "todos los SKU se dieron de
  -- baja" — es una ingesta degenerada, y ante la duda no se toca nada.
  SELECT count(*) INTO v_productos
    FROM public.productos p WHERE p.snapshot_id = v_snap;

  IF v_snap IS NULL OR v_productos = 0 THEN
    RETURN jsonb_build_object(
      'snapshot',          v_snap,
      'productos',         v_productos,
      'encolados',         0,
      'reabiertos',        0,
      'cerrados_con_tec',  0,
      'cerrados_por_baja', 0,
      'omitido',           'universo vacío: el snapshot no tiene productos, no se evalúa nada'
    );
  END IF;

  -- ---------- ENCOLADO (+ REAPERTURA) ----------
  WITH sin_tecnologia AS (
    SELECT
      p.sku,
      (p.familia_id IS NULL)                                   AS sin_familia,
      (v.sku IS NOT NULL)                                      AS tiene_ficha,
      EXISTS (
        SELECT 1 FROM public.cambios c
         WHERE c.snapshot_id = v_snap
           AND c.entidad = 'producto'
           AND c.tipo = 'ALTA'
           AND c.sku = p.sku
      )                                                        AS alta_reciente,
      m.nombre                                                 AS marca_origen,
      f.nombre                                                 AS familia_origen,
      p.descr_origen
    FROM public.productos p
    LEFT JOIN public.clasificacion_v2 v ON v.sku = p.sku
    LEFT JOIN public.marcas   m ON m.id = p.marca_id
    LEFT JOIN public.familias f ON f.id = p.familia_id
    WHERE p.snapshot_id = v_snap
      AND (v.sku IS NULL
        OR v.tecnologia IS NULL
        OR btrim(v.tecnologia) = '')
  )
  INSERT INTO public.pendientes_datos
        (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
  SELECT
    'sku_sin_tecnologia', t.sku, 'abierto', 'etl', v_snap,
    jsonb_build_object(
      'sku',            t.sku,
      'campo',          CASE WHEN t.sin_familia THEN 'tecnologia+familia' ELSE 'tecnologia' END,
      'pregunta',       CASE WHEN t.sin_familia
                             THEN '¿Qué tecnología y qué familia le corresponden a este SKU?'
                             ELSE '¿Qué tecnología le corresponde a este SKU?' END,
      'poblacion',      CASE WHEN NOT t.tiene_ficha AND t.alta_reciente THEN 'alta_reciente'
                             WHEN NOT t.tiene_ficha                      THEN 'preexistente_sin_ficha'
                             ELSE 'ficha_sin_tecnologia' END,
      'evidencia',      (CASE WHEN NOT t.tiene_ficha AND t.alta_reciente
                                THEN 'Entró como ALTA en el snapshot ' || coalesce(v_snap::text,'(sin snapshot)') || ' y no tiene ficha en clasificacion_v2'
                              WHEN NOT t.tiene_ficha
                                THEN 'Ya estaba en el catálogo y nunca tuvo ficha en clasificacion_v2'
                              ELSE 'Tiene ficha en clasificacion_v2 pero con la tecnología vacía' END)
                        || CASE WHEN t.sin_familia THEN '. Además NO tiene familia asignada.' ELSE '.' END,
      'sin_familia',    t.sin_familia,
      'marca_origen',   t.marca_origen,
      'familia_origen', t.familia_origen,
      'descr_origen',   t.descr_origen
    )
  FROM sin_tecnologia t
  -- [0015] REAPERTURA ACOTADA. Antes era `DO NOTHING` puro: un pendiente
  -- cerrado por error nunca volvía. Ahora se reabre SOLO si lo cerró la
  -- propia ingesta por "salió del catálogo" y el SKU volvió a aparecer.
  --
  -- Lo que NO se reabre, a propósito:
  --   · lo que resolvió o descartó un HUMANO — su decisión manda, y
  --     reabrirla sería el "pendiente zombi" que el UNIQUE de 0009 existe
  --     para impedir;
  --   · lo cerrado por "ya tiene tecnología" — si vuelve a faltarle, el
  --     SKU no está en este universo y no llega hasta aquí.
  ON CONFLICT (tipo, clave_natural) DO UPDATE SET
    estado        = 'abierto',
    payload       = EXCLUDED.payload,
    snapshot_id   = EXCLUDED.snapshot_id,
    detectado_por = EXCLUDED.detectado_por,
    detectado_en  = now(),
    resolucion    = NULL,
    resuelto_por  = NULL,
    resuelto_en   = NULL
  WHERE pendientes_datos.estado = 'resuelto'
    AND pendientes_datos.resuelto_por = 'auto:ingesta'
    AND pendientes_datos.resolucion ->> 'motivo' LIKE 'El SKU salió del catálogo%';
  GET DIAGNOSTICS v_encolados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (1/2): ya tiene tecnología ----------
  UPDATE public.pendientes_datos pd
     SET estado       = 'resuelto',
         resuelto_por = 'auto:ingesta',
         resuelto_en  = now(),
         resolucion   = jsonb_build_object(
           'accion',     'auto_cierre',
           'motivo',     'El SKU ya tiene tecnología asignada: el pendiente dejó de aplicar.',
           'tecnologia', v.tecnologia,
           'snapshot',   v_snap
         )
    FROM public.clasificacion_v2 v
   WHERE pd.tipo = 'sku_sin_tecnologia'
     AND pd.estado = 'abierto'
     AND v.sku = pd.clave_natural
     AND v.tecnologia IS NOT NULL
     AND btrim(v.tecnologia) <> '';
  GET DIAGNOSTICS v_cerrados = ROW_COUNT;

  -- ---------- AUTO-CIERRE (2/2): salió del catálogo ----------
  -- Ya solo puede correr con un universo NO vacío (guarda de arriba).
  UPDATE public.pendientes_datos pd
     SET estado       = 'resuelto',
         resuelto_por = 'auto:ingesta',
         resuelto_en  = now(),
         resolucion   = jsonb_build_object(
           'accion',   'auto_cierre',
           'motivo',   'El SKU salió del catálogo: el pendiente dejó de aplicar.',
           'snapshot', v_snap
         )
   WHERE pd.tipo = 'sku_sin_tecnologia'
     AND pd.estado = 'abierto'
     AND NOT EXISTS (
       SELECT 1 FROM public.productos p
        WHERE p.sku = pd.clave_natural
          AND p.snapshot_id = v_snap
     );
  GET DIAGNOSTICS v_baja = ROW_COUNT;

  RETURN jsonb_build_object(
    'snapshot',           v_snap,
    'productos',          v_productos,
    'encolados',          v_encolados,
    'cerrados_con_tec',   v_cerrados,
    'cerrados_por_baja',  v_baja
  );
END;
$fn$;
REVOKE ALL    ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sincronizar_pendientes_tecnologia(uuid) TO service_role;

-- ------------------------------------------------------------
-- (2) GUARDA DE CIERRE — de COMPORTAMIENTO, no un conteo.
--     Prueba que la guarda de universo vacío existe DE VERDAD, invocando
--     la función con un snapshot inexistente y exigiendo que no toque nada.
--     Es el control que la 0013 no tenía y por eso su brecha pasó verde.
-- ------------------------------------------------------------
DO $cierre0015$
DECLARE
    v_fake      uuid := '00000000-0000-0000-0000-000000000000';
    v_antes     integer;
    v_despues   integer;
    v_resultado jsonb;
BEGIN
    SELECT count(*) INTO v_antes
      FROM public.pendientes_datos
     WHERE tipo = 'sku_sin_tecnologia' AND estado = 'abierto';

    -- Con la 0013 esto habría cerrado TODOS los abiertos.
    v_resultado := public.sincronizar_pendientes_tecnologia(v_fake);

    SELECT count(*) INTO v_despues
      FROM public.pendientes_datos
     WHERE tipo = 'sku_sin_tecnologia' AND estado = 'abierto';

    RAISE NOTICE '0015 · abiertos antes/despues de un snapshot inexistente: % / %', v_antes, v_despues;
    RAISE NOTICE '0015 · la funcion respondio: %', v_resultado;

    IF v_despues <> v_antes THEN
        RAISE EXCEPTION
          '0015: un snapshot SIN PRODUCTOS movio la bandeja (% -> %). La guarda de universo vacio no esta funcionando. Abortando.',
          v_antes, v_despues;
    END IF;

    IF v_resultado ->> 'omitido' IS NULL THEN
        RAISE EXCEPTION
          '0015: la funcion no declaro haber OMITIDO el universo vacio — devolvio %. Se esperaba la clave "omitido". Abortando.',
          v_resultado;
    END IF;

    RAISE NOTICE '0015 · GUARDA VERDE: un snapshot sin productos ya no toca la bandeja.';
END $cierre0015$;

COMMIT;
