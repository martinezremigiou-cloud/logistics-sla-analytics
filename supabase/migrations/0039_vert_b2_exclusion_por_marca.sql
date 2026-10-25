-- ============================================================================
-- 0039 · VERT-B2 · La exclusión del catálogo, como DATO y no como código
--
-- QUÉ HACE
--   `marcas` gana la decisión de negocio «esta marca no se muestra en el
--   catálogo», con su autoría y su fecha, y una marca de nacimiento que sirve
--   de alarma para las marcas que el ETL da de alta solas.
--
-- POR QUÉ COMO DATO
--   Un `if (marca === 'VERTICAL')` en el código convierte una decisión de
--   negocio en un despliegue. Hoy hay commits sin empujar: la decisión
--   tardaría lo que tarde el push, y apagarla otro tanto. Como dato, se
--   enciende y se apaga con un UPDATE y es reversible por construcción.
--
-- POR QUÉ POR `marca_id` Y NO POR EL NOMBRE
--   Medido contra esta base: «BRAND 6» y «BRAND6» son DOS filas
--   distintas de `marcas`, y «CABLE» y «CABLES» también. Una regla anclada al
--   texto se esquiva con un espacio. El id no.
--
-- POR QUÉ NO SE REUSA `marcas.activo`
--   `activo` dice «esta marca es parte del vocabulario»; esto dice «sus
--   productos no se listan». Son decisiones distintas y hoy `activo` está
--   INERTE (todas en true, y `loadCatalogIndex` ni lo filtra). Sobrecargarlo
--   haría que desactivar una marca del vocabulario la escondiera del catálogo
--   de rebote, y al revés — dos efectos atados sin que nadie lo pidiera.
--
-- ----------------------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (las tres preguntas de la casa)
--
--   1. ¿Destruye datos?
--      NO. Sólo agrega columnas con default. Ninguna fila existente cambia de
--      valor salvo `creada_en`, que se rellena con un centinela explícito.
--
--   2. ¿Se puede deshacer?
--      SÍ, y de dos formas. La decisión se apaga con
--        UPDATE public.marcas SET excluida_del_catalogo = false,
--               excluida_motivo = NULL, excluida_por = NULL, excluida_en = NULL
--         WHERE nombre = 'VERTICAL';
--      y la estructura entera con `ALTER TABLE ... DROP COLUMN` ×5. Ninguna
--      lectura del portal desplegado hoy conoce estas columnas.
--
--   3. ¿Qué pasa si se aplica dos veces?
--      Nada: `ADD COLUMN IF NOT EXISTS` y el UPDATE es idempotente por valor.
--
-- ----------------------------------------------------------------------------
-- ⚠ LO QUE ESTA MIGRACIÓN NO PUEDE COMPROBAR DESDE DONDE ESTÁ — ver el NOTICE
--   final. Resumen: aplicarla SOLA no cambia ni una pantalla. El código que lee
--   estas columnas no está desplegado, así que el catálogo seguirá igual hasta
--   que se despliegue. Eso es deliberado: el dato primero, la lectura después.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- 1 · columnas
ALTER TABLE public.marcas
  ADD COLUMN IF NOT EXISTS excluida_del_catalogo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluida_motivo       text,
  ADD COLUMN IF NOT EXISTS excluida_por          text,
  ADD COLUMN IF NOT EXISTS excluida_en           timestamptz,
  ADD COLUMN IF NOT EXISTS creada_en             timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.marcas.excluida_del_catalogo IS
  'VERT-B2: sus productos NO se listan en el catálogo ni cuentan en el dashboard. '
  'El dato SIGUE entrando completo por la ingesta — esto es un predicado de LECTURA, '
  'nunca de escritura, y por eso es reversible con un UPDATE.';
COMMENT ON COLUMN public.marcas.creada_en IS
  'VERT-B2: alarma de marca nueva. El ETL da de alta marcas SOLO, sin encolar nada '
  '(deuda MARCA-NUEVA-ENTRA-EN-SILENCIO). Una marca con creada_en POSTERIOR a esta '
  'migración y sin decisión registrada es una marca que nadie gobernó.';

-- -------------------------------------------- 2 · la guarda contra la bandera muda
-- Una bandera booleana sin autoría es exactamente lo que `corpus.service.ts`
-- rechazó a propósito al diseñar su exclusión: un campo que puede divergir del
-- hecho sin que nadie se entere. Aquí no se puede excluir sin decir quién y
-- cuándo — y el CHECK lo hace INEXPRESABLE, no sólo desaconsejado.
ALTER TABLE public.marcas
  DROP CONSTRAINT IF EXISTS marcas_exclusion_con_autoria;
ALTER TABLE public.marcas
  ADD CONSTRAINT marcas_exclusion_con_autoria CHECK (
    excluida_del_catalogo = false
    OR (excluida_motivo IS NOT NULL AND excluida_por IS NOT NULL AND excluida_en IS NOT NULL)
  );

-- ------------------------------------------- 3 · centinela para las preexistentes
-- Las marcas de hoy son ANTERIORES a la regla. Sin este centinela, el default
-- `now()` las marcaría a todas como «nacidas hoy» y la alarma del punto 2
-- señalaría todas las marcas como nuevas el primer día: una alarma que suena siempre es una
-- alarma apagada.
UPDATE public.marcas
   SET creada_en = TIMESTAMPTZ '2026-01-01 00:00:00+00'
 WHERE creada_en >= now() - interval '1 hour';

-- ----------------------------------------------- 4 · la decisión de producto, sembrada
DO $$
DECLARE
  v_id uuid;
  v_n  int;
BEGIN
  SELECT id INTO v_id FROM public.marcas WHERE nombre = 'VERTICAL';
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'VERT-B2: no existe la marca VERTICAL. La decisión del PO no se puede sembrar sobre una marca que no está, y sembrarla sobre otra sería peor que no sembrarla.';
  END IF;

  UPDATE public.marcas
     SET excluida_del_catalogo = true,
         excluida_motivo = 'Decisión del PO (VERT-B2, 21-sep-2026): son inventario real —SKU con piezas, cero reservado— pero no se cotizan desde el portal. El dato NO se borra del Excel ni de la base: se excluye de la vista, y se puede volver a encender apagando esta bandera.',
         excluida_por = 'PO · Ivan Ruiz · via VERT-B2',
         excluida_en = now()
   WHERE id = v_id;

  SELECT count(*) INTO v_n
    FROM public.productos p
    JOIN (SELECT id FROM public.snapshots WHERE fuente = 'stock' ORDER BY created_at DESC LIMIT 1) v
      ON p.snapshot_id = v.id
   WHERE p.marca_id = v_id;

  RAISE NOTICE 'VERT-B2: marca VERTICAL (%) excluida. Productos suyos en el snapshot vigente: %', v_id, v_n;
  IF v_n <> 70 THEN
    RAISE NOTICE 'VERT-B2 ⚠ se esperaban 70 y hay %. NO es un error de esta migración — el catálogo se movió — pero toda cifra del bloque (catálogo y piezas) queda por re-medir.', v_n;
  END IF;
END $$;

-- ------------------------------------------------------ 5 · lo que NO puede saber
DO $$
DECLARE
  v_marcas int; v_excl int; v_sin_decidir int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE excluida_del_catalogo)
    INTO v_marcas, v_excl FROM public.marcas;
  SELECT count(*) INTO v_sin_decidir
    FROM public.marcas WHERE creada_en > TIMESTAMPTZ '2026-01-01 00:00:00+00' AND excluida_en IS NULL;

  RAISE NOTICE '--- 0039 · VERT-B2 · lo que esta migración NO puede comprobar desde aquí ---';
  RAISE NOTICE '  marcas: % · excluidas: % · nacidas despues de la regla y sin decision: %', v_marcas, v_excl, v_sin_decidir;
  RAISE NOTICE '  (1) NO comprueba que el portal LEA estas columnas. Hoy NO las lee: el';
  RAISE NOTICE '      codigo que filtra es parte de VERT-B2 y no esta desplegado. Aplicar';
  RAISE NOTICE '      esto SOLO no mueve ni una pantalla — el catalogo sigue igual.';
  RAISE NOTICE '  (2) NO comprueba que las OTRAS superficies respeten la regla. El censo';
  RAISE NOTICE '      un censo del repo encontro mas de 60 que cuentan el universo; B2 cubre cuatro';
  RAISE NOTICE '      (catalogo, dashboard, mapa de calor, ficha) y B3/B4 el resto.';
  RAISE NOTICE '  (3) NO vigila que la alarma de marca nueva se MIRE. El contador de arriba';
  RAISE NOTICE '      existe; que alguien lo lea es de la pantalla de gobierno, no de aqui.';
END $$;

COMMIT;
