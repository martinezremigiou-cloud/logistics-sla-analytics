-- ============================================================
-- 0014 · [MVP-CIERRE] La tecnología se normaliza contra su catálogo
--
-- QUÉ CORRIGE. La 0013 dejó una ASIMETRÍA dentro de `resolver_pendiente`:
--
--   rama                  qué hace con el vocabulario
--   --------------------  ------------------------------------------------
--   marca_ambigua         busca en `marcas` case-insensitive, inserta si no
--                         existe, y escribe el nombre CANÓNICO
--   sku_sin_tecnologia    escribía `clasificacion_v2.tecnologia` como TEXTO
--                         LIBRE — sin consultar `tecnologias`, sin insertar
--
-- Misma función, dos disciplinas. Con decenas de decisiones seguidas basta un
-- `Brand1` en vez de `BRAND1` para partir en dos la rama del árbol y que un
-- KAM deje de encontrar sus productos.
--
-- POR QUÉ NO BASTA ARREGLARLO EN LA UI. El diálogo ya ofrece el catálogo
-- declarado, pero la RPC es alcanzable por cualquier admin con sesión. Una
-- garantía que vive solo en el cliente es P13: la protección en dos lugares
-- y heredada en uno solo — el patrón que este mismo bloque bautizó.
--
-- NO SE REABRE LA 0013, que ya está aplicada y verificada. Va aparte, como
-- se acordó.
--
-- SOLO REEMPLAZA `resolver_pendiente`. El cuerpo es el de la 0013 EXTRAÍDO
-- DEL ARCHIVO (no transcrito a mano) con tres cambios acotados: la variable
-- del nombre canónico, el bloque de normalización, y escribir el canónico
-- en vez del crudo.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.resolver_pendiente(
  p_id uuid, p_accion text, p_motivo text DEFAULT NULL, p_valor text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_actor    text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
  v_p        public.pendientes_datos%ROWTYPE;
  v_nombre   text;
  v_kam_id   uuid;
  v_marca    text;
  v_marca_id uuid;
  v_canon    text;
  v_sku      text;
  v_ref      jsonb := '{}'::jsonb;
  v_json     jsonb;
  v_tec      text;
  v_familia  text;
  v_fam_id   uuid;
  v_tec_canon text;
  v_tec_activa boolean;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden' USING errcode = '42501'; END IF;
  IF p_accion NOT IN ('confirmar','descartar') THEN
    RAISE EXCEPTION 'accion invalida' USING errcode = '22023'; END IF;

  SELECT * INTO v_p FROM public.pendientes_datos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pendiente inexistente' USING errcode = 'P0002'; END IF;
  IF v_p.estado <> 'abierto' THEN
    RAISE EXCEPTION 'pendiente ya resuelto/descartado' USING errcode = '22023'; END IF;

  IF p_accion = 'descartar' THEN
    IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
      RAISE EXCEPTION 'motivo requerido para descartar' USING errcode = '22023'; END IF;
    UPDATE public.pendientes_datos
       SET estado='descartado', resuelto_por=v_actor, resuelto_en=now(),
           resolucion=jsonb_build_object('accion','descartar','motivo',p_motivo)
     WHERE id=p_id;
    RETURN jsonb_build_object('estado','descartado','actor',v_actor);
  END IF;

  IF v_p.tipo = 'kam_desconocido' THEN
    v_nombre := coalesce(nullif(btrim(p_valor),''), v_p.payload ->> 'kam_raw');
    IF v_nombre IS NULL OR btrim(v_nombre) = '' THEN
      RAISE EXCEPTION 'nombre de KAM requerido' USING errcode = '22023'; END IF;
    -- Matching normalizado ANTES de insertar (evita duplicados tipo 'Nadia' vs
    -- 'NADIA' que el ON CONFLICT DO NOTHING + re-SELECT exacto dejaba pasar).
    SELECT id INTO v_kam_id FROM public.kams WHERE lower(btrim(nombre)) = lower(btrim(v_nombre));
    IF v_kam_id IS NULL THEN
      INSERT INTO public.kams (nombre) VALUES (v_nombre) RETURNING id INTO v_kam_id;
    END IF;
    v_ref := jsonb_build_object('kam_id', v_kam_id);

  ELSIF v_p.tipo = 'marca_ambigua' THEN
    -- FAIL-CLOSED (1/3): sin marca elegida no hay resolución posible.
    v_marca := nullif(btrim(p_valor), '');
    IF v_marca IS NULL THEN
      RAISE EXCEPTION 'marca requerida para resolver marca_ambigua' USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (2/3): el pendiente debe saber sobre qué SKU decide.
    v_sku := nullif(btrim(coalesce(v_p.payload ->> 'sku', v_p.clave_natural)), '');
    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'pendiente marca_ambigua sin sku en payload' USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (3/3): clasificacion_v2.sku tiene FK a productos; sin
    -- este chequeo el upsert moriría con un error de FK ilegible.
    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'sku % inexistente en productos', v_sku USING errcode = 'P0002'; END IF;

    -- Alta idempotente en `marcas`, case-insensitive (ver cabecera P2).
    SELECT id, nombre INTO v_marca_id, v_canon
      FROM public.marcas WHERE upper(btrim(nombre)) = upper(v_marca);
    IF v_marca_id IS NULL THEN
      INSERT INTO public.marcas (nombre) VALUES (upper(v_marca))
      RETURNING id, nombre INTO v_marca_id, v_canon;
    END IF;

    -- Upsert de la capa v2 con el nombre CANÓNICO del catálogo.
    INSERT INTO public.clasificacion_v2 AS c
           (sku, marca_v2, fuente_version, updated_by, updated_at)
    VALUES (v_sku, v_canon, 'pendiente:marca_ambigua', v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      marca_v2       = EXCLUDED.marca_v2,
      fuente_version = EXCLUDED.fuente_version,
      updated_by     = EXCLUDED.updated_by,
      updated_at     = EXCLUDED.updated_at;

    v_ref := jsonb_build_object('marca_id', v_marca_id, 'marca', v_canon, 'sku', v_sku);

  ELSIF v_p.tipo = 'sku_sin_tecnologia' THEN
    -- [MVP-CIERRE] F2. `p_valor` llega como JSON con las DOS decisiones.
    -- FAIL-CLOSED (1/4): tiene que ser JSON parseable.
    BEGIN
      v_json := nullif(btrim(coalesce(p_valor,'')),'')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'p_valor debe ser JSON: {"tecnologia":"...","familia":"..."}'
        USING errcode = '22023';
    END;
    IF v_json IS NULL THEN
      RAISE EXCEPTION 'p_valor requerido: {"tecnologia":"...","familia":"..."}'
        USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (2/4): la tecnología es la razón de existir del pendiente.
    v_tec := nullif(btrim(coalesce(v_json ->> 'tecnologia','')), '');
    IF v_tec IS NULL THEN
      RAISE EXCEPTION 'tecnologia requerida para resolver sku_sin_tecnologia'
        USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (3/4): el pendiente debe saber sobre qué SKU decide.
    v_sku := nullif(btrim(coalesce(v_p.payload ->> 'sku', v_p.clave_natural)), '');
    IF v_sku IS NULL THEN
      RAISE EXCEPTION 'pendiente sku_sin_tecnologia sin sku' USING errcode = '22023'; END IF;

    -- FAIL-CLOSED (4/4): FK a productos, igual que marca_ambigua.
    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'sku % inexistente en productos', v_sku USING errcode = 'P0002'; END IF;

    -- La familia es OPCIONAL: solo la mandan los SKU que no la traen de la
    -- fuente. Si viene, se da de alta en el catálogo de familias igual que
    -- las marcas — idempotente y case-insensitive.
    -- [MVP-CIERRE · 0014] NORMALIZACIÓN CONTRA EL CATÁLOGO DECLARADO.
    --
    -- La 0013 escribía `clasificacion_v2.tecnologia` como TEXTO LIBRE, sin
    -- consultar `public.tecnologias`. Dentro de la MISMA función, la rama
    -- `marca_ambigua` sí normaliza contra `marcas` (match case-insensitive,
    -- alta idempotente, escribe el nombre canónico). Dos disciplinas
    -- distintas para el mismo problema, en la misma función.
    --
    -- Por qué importa y no es estética: son decenas de decisiones seguidas y basta
    -- un `Brand1` en vez de `BRAND1` para partir en dos la rama del árbol y
    -- que un KAM deje de encontrar sus productos. Es exactamente lo que ya
    -- costó `'Nadia'` vs `'NADIA'` (0011) y las colisiones de familia.
    --
    -- Y ponerlo SOLO en el diálogo sería P13 —la protección viviendo en dos
    -- lugares y heredada en uno—: la RPC es alcanzable por cualquier admin
    -- con sesión, no solo por la bandeja.
    --
    -- Estado al escribir esto (verificado): 4 tecnologías activas (EAS,
    -- BRAND2, BRAND1, VERTICAL) y CERO valores en `clasificacion_v2` sin
    -- respaldo en el catálogo. Esta normalización CONSERVA esa invariante
    -- en vez de dejarla a la suerte del tecleo.
    -- [auditoría] El alta en `tecnologias` es PERMANENTE: esa tabla no tiene
    -- política de DELETE (0008: "la capa no borra"), así que lo que entre al
    -- vocabulario compartido se queda. Con la 0013 un typo ensuciaba UNA fila
    -- de `clasificacion_v2`, corregible reeditando el SKU; con la
    -- normalización ensucia lo que ve todo el mundo en el árbol. Por eso el
    -- alta se valida ANTES, no después.
    --
    -- (a) Tiene que ser un STRING de JSON. `->>` sobre un objeto devuelve su
    --     texto: `{"tecnologia":{"a":1}}` habría metido `{"A": 1}` al catálogo.
    IF jsonb_typeof(v_json -> 'tecnologia') <> 'string' THEN
      RAISE EXCEPTION 'el campo "tecnologia" debe ser una cadena de texto, no % — no se da de alta basura en el catálogo',
        coalesce(jsonb_typeof(v_json -> 'tecnologia'), 'nada') USING errcode = '22023';
    END IF;

    -- (b) Tope de longitud propio. `valor` ya viene acotado a 500 por zod,
    --     pero eso vive en la app y esta función es alcanzable por cualquier
    --     admin con sesión (P13: la garantía no puede estar en un solo lado).
    --     40 caracteres: la más larga de las 4 vigentes tiene 8.
    IF length(v_tec) > 40 THEN
      RAISE EXCEPTION 'tecnologia demasiado larga (% caracteres, máximo 40)', length(v_tec)
        USING errcode = '22023';
    END IF;

    -- El match NO filtra por `activo`: una tecnología retirada sigue siendo
    -- LA MISMA tecnología, y reusar su nombre canónico es preferible a crear
    -- un duplicado que solo se distinga por el flag. Lo que sí se hace es
    -- decirlo, para que quien resuelva sepa que eligió una que ya no se
    -- ofrece en la bandeja (`fetchTecnologias` filtra `activo=true`).
    SELECT t.nombre, t.activo INTO v_tec_canon, v_tec_activa
      FROM public.tecnologias t
     WHERE upper(btrim(t.nombre)) = upper(v_tec);

    IF v_tec_canon IS NULL THEN
      -- Genuinamente nueva: alta en MAYÚSCULAS, como las 4 que ya existen.
      -- No se rechaza — el negocio puede incorporar una tecnología que el
      -- catálogo todavía no conoce, y bloquearla obligaría a una migración
      -- por cada alta.
      --
      -- `ON CONFLICT` porque dos admins resolviendo pendientes distintos con
      -- la MISMA tecnología nueva al mismo tiempo hacían reventar al segundo
      -- con 23505, y con él TODA su resolución. El `DO UPDATE` no-op sobre
      -- `nombre` es lo que permite el `RETURNING` en ambos caminos.
      INSERT INTO public.tecnologias (nombre) VALUES (upper(v_tec))
      ON CONFLICT (nombre) DO UPDATE SET nombre = public.tecnologias.nombre
      RETURNING nombre, activo INTO v_tec_canon, v_tec_activa;
    END IF;

    v_familia := nullif(btrim(coalesce(v_json ->> 'familia','')), '');
    IF v_familia IS NOT NULL THEN
      SELECT id INTO v_fam_id FROM public.familias WHERE upper(btrim(nombre)) = upper(v_familia);
      IF v_fam_id IS NULL THEN
        INSERT INTO public.familias (nombre) VALUES (upper(v_familia)) RETURNING id INTO v_fam_id;
      END IF;
      SELECT nombre INTO v_familia FROM public.familias WHERE id = v_fam_id;
    END IF;

    -- UN SOLO UPSERT cubre los dos caminos que pidió el puente: INSERT para
    -- las poblaciones A y B (sin ficha v2) y UPDATE para la C (ficha con la
    -- tecnología vacía). `COALESCE` en el DO UPDATE para no borrar una
    -- familia que ya estuviera puesta cuando el admin no manda una nueva.
    INSERT INTO public.clasificacion_v2 AS c
           (sku, tecnologia, familia_v2, fuente_version, updated_by, updated_at)
    VALUES (v_sku, v_tec_canon, v_familia, 'pendiente:sku_sin_tecnologia', v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      tecnologia     = EXCLUDED.tecnologia,
      familia_v2     = coalesce(EXCLUDED.familia_v2, c.familia_v2),
      fuente_version = EXCLUDED.fuente_version,
      updated_by     = EXCLUDED.updated_by,
      updated_at     = EXCLUDED.updated_at;

    v_ref := jsonb_build_object('sku', v_sku, 'tecnologia', v_tec_canon, 'familia', v_familia)
             || CASE WHEN v_tec_activa IS FALSE
                     THEN jsonb_build_object('aviso', 'La tecnología elegida está marcada como NO activa en el catálogo.')
                     ELSE '{}'::jsonb END;

  -- 'familia_atomo_dudoso' NO tiene rama, A PROPÓSITO: confirmarlo
  -- significa RATIFICAR EL STATU QUO y con el modelo vigente (derivar al
  -- leer, sin materializar) eso no tiene efecto de escritura. Ver 0011.
  END IF;

  UPDATE public.pendientes_datos
     SET estado='resuelto', resuelto_por=v_actor, resuelto_en=now(),
         resolucion=jsonb_build_object('accion','confirmar','motivo',p_motivo) || v_ref
   WHERE id=p_id;
  RETURN jsonb_build_object('estado','resuelto','actor',v_actor,'ref',v_ref);
END;
$fn$;
REVOKE ALL   ON FUNCTION public.resolver_pendiente(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_pendiente(uuid,text,text,text) TO authenticated;

-- ------------------------------------------------------------
-- GUARDA DE CIERRE — que muerda, igual que en la 0013.
--   (1) La invariante que esto protege: CERO valores de
--       `clasificacion_v2.tecnologia` sin respaldo en `tecnologias`.
--   (2) El detector con dientes: la comparación es case-insensitive, así
--       que si alguien la volviera sensible a mayúsculas esto lo vería.
-- ------------------------------------------------------------
DO $cierre0014$
DECLARE
    v_huerfanos integer;
    v_activas   integer;
    v_def       text;
BEGIN
    -- (1) PRUEBA DE COMPORTAMIENTO — la que faltaba.
    --
    -- La primera versión de esta guarda solo contaba huérfanos preexistentes.
    -- Con cero huérfanos se quedaba VERDE aunque alguien borrara el bloque de
    -- normalización entero: la guarda de la migración cuyo propósito es esa
    -- normalización no verificaba la normalización. Guarda ciega, señalada
    -- por la auditoría adversarial.
    --
    -- Ahora se lee la definición REALMENTE desplegada y se exige que consulte
    -- el catálogo. No es una prueba de ejecución —`resolver_pendiente` exige
    -- `is_admin()` y aquí no hay sesión— pero sí falla si el cuerpo pierde lo
    -- que esta migración vino a poner.
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'resolver_pendiente'
     LIMIT 1;

    IF v_def IS NULL THEN
        RAISE EXCEPTION '0014: no se encontró public.resolver_pendiente tras el CREATE OR REPLACE. Abortando.';
    END IF;
    IF position('FROM public.tecnologias t' IN v_def) = 0 THEN
        RAISE EXCEPTION '0014: la definición desplegada de resolver_pendiente NO consulta public.tecnologias — la normalización no quedó. Abortando.';
    END IF;
    IF position('INSERT INTO public.tecnologias' IN v_def) = 0 THEN
        RAISE EXCEPTION '0014: la definición desplegada NO da de alta en public.tecnologias — falta el camino de la tecnología nueva. Abortando.';
    END IF;
    IF position('v_tec_canon' IN v_def) = 0 THEN
        RAISE EXCEPTION '0014: la definición desplegada no escribe el nombre CANONICO (v_tec_canon). Abortando.';
    END IF;
    -- Control anti-ceguera del propio detector: si `position` siempre diera
    -- >0, las cuatro comprobaciones de arriba pasarían por inútiles.
    IF position('esta_cadena_no_existe_en_ninguna_funcion' IN v_def) <> 0 THEN
        RAISE EXCEPTION '0014: el detector encuentra cadenas inexistentes — no está comprobando nada. Abortando.';
    END IF;

    -- (2) La invariante sobre los DATOS, que ya estaba.
    SELECT count(DISTINCT v.tecnologia) INTO v_huerfanos
      FROM public.clasificacion_v2 v
      LEFT JOIN public.tecnologias t
             ON upper(btrim(t.nombre)) = upper(btrim(v.tecnologia))
     WHERE v.tecnologia IS NOT NULL
       AND btrim(v.tecnologia) <> ''
       AND t.nombre IS NULL;

    SELECT count(*) INTO v_activas FROM public.tecnologias WHERE activo;

    RAISE NOTICE '0014 · tecnologias activas .................. %', v_activas;
    RAISE NOTICE '0014 · valores sin respaldo en el catalogo .. %', v_huerfanos;

    IF v_huerfanos <> 0 THEN
        RAISE EXCEPTION
          '0014: hay % valor(es) de clasificacion_v2.tecnologia sin respaldo en public.tecnologias. La normalizacion no puede garantizar la invariante sobre datos que ya la violan. Abortando.',
          v_huerfanos;
    END IF;

    RAISE NOTICE '0014 · GUARDA VERDE: la normalizacion esta en la definicion desplegada y los datos estan en sincronia.';
END $cierre0014$;

COMMIT;
