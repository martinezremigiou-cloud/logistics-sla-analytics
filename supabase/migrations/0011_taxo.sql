-- ============================================================
-- Bloque [INV-TAXO] · 0011_taxo.sql
--
-- QUÉ HACE (6 partes, cada una idempotente y re-ejecutable):
--   P1 · Amplía el CHECK de `pendientes_datos.tipo` con 'marca_ambigua'
--        y 'familia_atomo_dudoso' (conserva los 4 de 0009), con guarda
--        anti-silencio que PRUEBA que el CHECK acepta los dos nuevos y
--        que sigue RECHAZANDO un valor basura.
--   P2 · `resolver_pendiente` extendido: al confirmar un
--        'marca_ambigua' ahora SÍ escribe la marca elegida (alta
--        idempotente en `marcas` + upsert de `clasificacion_v2.marca_v2`),
--        fail-closed si la marca viene vacía.
--   P3 · Cierra EN SU SITIO las 3 colisiones de familia de B-PARCHE
--        (obsoletas con el modelo n2), conservando su clave vieja.
--   P4 · Encola la colisión real que produce la normalización por
--        '/': 'QZ8 / H5980' (con espacios) vs 'QZ8/H5980' (sin).
--        NO las fusiona: decide un humano.
--   P5 · Encola los 2 valores que la compuerta anti-átomo-fantasma de
--        `src/lib/familias.ts` se niega a atomizar ('ZV680G/K' y
--        'Z1900 / 6693'), uno por familia.
--   P6 · Alta de la tecnología 'VERTICAL' + su aplicación a los SKUs
--        cuya marca en la FUENTE VIGENTE es VERTICAL, con tope de radio
--        de impacto, y encolado de los SKUs en disputa marca-fuente
--        vs marca-v2 como 'marca_ambigua'.
--
-- QUÉ **NO** HACE (alcance ratificado — "derivar al leer, sin
-- materializar"; principio rector: "las familias sirven para ENCONTRAR,
-- no para SUMAR"):
--   · NO reescribe `familias` ni `clasificacion_v2.familia_v2`.
--   · NO crea tablas de familias atómicas ni ninguna materialización de
--     la atomización por '/'. Eso vive en la capa de lectura
--     (`src/lib/familias.ts`), no en la BD.
--   · NO auto-fusiona colisiones (van a la bandeja).
--   · NO separa por '&' ni por '-' (son nombres propios: 'CLIPS 5 & 9',
--     'P-LOCK', 'CLIP MINI-B'…). Separador ÚNICO: '/'.
--   · NO borra NADA. Sin DROP de objetos ni de datos de usuario (los
--     únicos DROP son de tablas TEMPORALES de trabajo, ON COMMIT DROP).
--   · NO contiene listas literales de SKUs/marcas/familias: todo lo que
--     inserta se DERIVA con SQL del snapshot vigente y de los catálogos.
--     Los únicos literales de dominio son 'VERTICAL' (la tecnología que
--     se mandó dar de alta) y '/' (el separador) — ámbito, no lista.
--
-- ORDEN DE APLICACIÓN: después de 0010_b7a_rol_visitante.sql.
-- Requiere 0008 (clasificacion_v2, tecnologias) y 0009
-- (pendientes_datos, resolver_pendiente) ya aplicadas. PG 15.
-- La aplica el operador por MCP; este archivo solo la declara.
--
-- VERIFICACIONES CONTRA LA BD VIVA (PostgREST read-only,
-- service_role; snapshot vigente de stock del momento. Las cifras
-- exactas de la operación se omiten en esta copia; lo que queda es la
-- forma del argumento. Cada afirmación de abajo tiene su SELECT
-- de contraste en el bloque VERIFICACIÓN del final (patrón P2 de
-- docs/engineering/failure-patterns.md (P2): una cifra sin query es un rumor):
--   · tipos del CHECK hoy: 4 · filas en pendientes_datos: (omitido)
--   · colisiones B-PARCHE abiertas: 3 (SERIES 2 26/38, CLIP 3.0/CLIP
--     MODULAR, CLIP 3.0/CLIPS MODULAR ALTA SEGURIDAD)
--   · grupos de colisión bajo la normalización n2: 1 (QZ8 / H5980)
--       - 'QZ8 / H5980' → varios SKUs (familia efectiva, vía v2)
--       - 'QZ8/H5980'   → menos SKUs (capa fuente v1; SUBCONJUNTO de los anteriores)
--   · átomos dudosos: 2 → 'ZV680G/K' (varios SKUs, fantasma "K") y
--     'Z1900 / 6693' (un SKU, fantasma "6693")
--   · VERTICAL en la fuente vigente: SKUs en tres grupos: con marca_v2 ya
--     VERTICAL + SIN fila en clasificacion_v2 + uno clasificado
--     SERIES5 en abril (01654365/3225). Se escriben todos (menos el
--     disputado). Ninguno tiene tecnología hoy.
--   · disputas marca-fuente vs marca-v2 en el ámbito VERTICAL →
--     bandeja: 01654365/3225 (fuente VERTICAL / v2 SERIES5) y
--     QS1PQRMXDWR13K (fuente CABLE tras julio / v2 VERTICAL).
--
-- ============================================================
-- ENMIENDA [REPRODUCIBILIDAD · S7-B] · 2026-08-07
-- Ratificada (ver docs/decisions/0005-migration-guards-and-replay.md) como bloqueante de firma.
-- NO se toca ni una línea del CUERPO de la migración: solo DOS guardas.
--
-- POR QUÉ. La promesa del bloque de reproducibilidad es que
-- `0001 → 0022` se aplica de corrido sobre una base RECIÉN CREADA. Este
-- archivo abortaba ahí por dos guardas que exigen HISTORIAL, no por su
-- contenido: el cuerpo sí es replayable. La decisión de producto fue explícita
-- —«marcar la migración como no reproducible redefine la
-- reproducibilidad para que la compuerta pase»— así que se degrada la
-- GUARDA, nunca el archivo.
--
--   (1) `(0)` exigía un snapshot vigente de `stock`. Ahora: si el universo
--       está vacío lo DICE con NOTICE, deja una bandera local a la
--       transacción (`demo.mig0011_universo_vacio`) y sigue. El único
--       bloque que dependía de ese universo para ABORTAR —la banda
--       [50,80] de P6— lee la bandera y se omite. Con universo NO vacío
--       todo se comporta EXACTAMENTE igual que antes.
--
--   (2) `P6` topaba en 5 los pendientes `marca_ambigua`. Ese número fue un
--       HECHO DE JULIO (pocos verificados), no un invariante: medido contra
--       producción más tarde son bastantes más (abiertas y una descartada),
--       porque la 0012 encoló más por la regla O3 — es decir, el tope
--       lo rebasó el trabajo legítimo de la migración SIGUIENTE. Se
--       ordenó NO SUBIRLO («NO LO SUBAS»): se degrada a NOTICE que imprime
--       el número CONTADO EN TIEMPO DE EJECUCIÓN, con su desglose por
--       estado. La señal no se pierde; deja de abortar.
--
--   LO QUE ESTA ENMIENDA NO PUEDE COMPROBAR DESDE AQUÍ (P16): que el
--   replay completo `0001 → 0022` termine en verde. Este archivo solo
--   sabe de sí mismo. La compuerta G-d es quien lo mide.
--
--   LA 0011 YA CUMPLIÓ SU FUNCIÓN EN PRODUCCIÓN (ya aplicada).
--   En un replay sobre base limpia sus topes de radio de impacto no
--   significan nada: no hay fuente que medir. Los topes siguen ahí para la
--   base que SÍ tiene datos, que es la única donde protegen algo.
-- ============================================================
BEGIN;


-- ============================================================
-- (0) DERIVACIONES COMPARTIDAS — tablas TEMPORALES de trabajo
-- (ON COMMIT DROP: no sobreviven a la transacción, no tocan el
-- esquema público). Existen para que la normalización n2 y la
-- "familia efectiva" se escriban UNA sola vez y P4/P5 consuman
-- exactamente la misma definición (evita el drift entre la guarda
-- y el INSERT que protege).
--
-- SUPUESTO EXPLÍCITO (patrón P5, docs/engineering/failure-patterns.md): estas
-- tablas viven en UNA sola sesión/transacción, la del BEGIN de arriba.
-- Evidencia: 0008, 0009 y 0010 usan el mismo BEGIN;…COMMIT; y el operador
-- las aplicó por MCP sin partirlas. Si aun así aparece un error tipo
-- `relation "_taxo_..." does not exist`, NO es un bug del SQL: significa
-- que las sentencias no corrieron en la misma sesión — re-aplicar el
-- archivo COMPLETO de una sola vez (todo es idempotente).
-- ============================================================

-- Snapshot VIGENTE de stock. Definición idéntica a la de la app
-- (`src/services/vigente.service.ts`): fuente='stock' maximizando
-- (created_at, id) — el desempate por id es obligatorio, dos ingestas
-- pueden compartir el mismo tick.
DROP TABLE IF EXISTS pg_temp._taxo_vig;
CREATE TEMP TABLE _taxo_vig ON COMMIT DROP AS
SELECT s.id
  FROM public.snapshots s
 WHERE s.fuente = 'stock'
 ORDER BY s.created_at DESC, s.id DESC
 LIMIT 1;

-- [S7-B] GUARDA DE UNIVERSO, DEGRADADA. Antes abortaba; ahora informa y
-- deja constancia. La bandera viaja en un GUC **local a la transacción**
-- (`is_local := true`, mismo mecanismo que la foto del ANTES de la 0020):
-- muere con el COMMIT o el ROLLBACK y no ensucia la sesión.
--
-- ANTI-VACUIDAD DE ESTA GUARDA (P19): el estado que la pone en la rama
-- «vacía» es una base recién creada (0 snapshots de `stock`) — el replay
-- de G-d. El estado que la pone en la rama «llena» es producción. Las dos
-- ramas son alcanzables y las dos imprimen algo distinto: no hay camino
-- por el que este bloque se calle.
DO $g0$
DECLARE
    v_vacio boolean;
    v_snaps integer;
BEGIN
    SELECT count(*) INTO v_snaps FROM public.snapshots WHERE fuente = 'stock';
    v_vacio := NOT EXISTS (SELECT 1 FROM _taxo_vig);
    PERFORM set_config('demo.mig0011_universo_vacio', v_vacio::text, true);

    IF v_vacio THEN
        RAISE NOTICE '0011_taxo (0): NO existe snapshot vigente de fuente ''stock'' (snapshots de stock en la base: %). UNIVERSO VACÍO: se OMITE la banda de radio de impacto de P6 y se continúa, en vez de abortar. Ratificado (docs/decisions/0005-migration-guards-and-replay.md).', v_snaps;
        RAISE NOTICE '0011_taxo (0) · LO QUE NO PUEDE COMPROBAR ESTA GUARDA DESDE AQUÍ (P16): con el universo vacío, TODO lo que esta migración deriva de la fuente (familia efectiva, colisiones n2, átomos dudosos, SKUs de marca VERTICAL) sale en CERO. Los INSERT de P4, P5 y P6 escribirán 0 filas y sus topes pasarán por no llegar a ellos, NO por haber sido medidos. Este archivo NO puede distinguir «no hay nada que encolar» de «la derivación se rompió»: en una base con datos, esa distinción la hacen los topes; aquí no la hace nadie. El verde de esta corrida significa «no contradicho», no «probado».';
    ELSE
        RAISE NOTICE '0011_taxo (0): universo NO vacío (% snapshot(s) de stock). Las guardas de radio de impacto corren completas, como antes de la enmienda S7-B.', v_snaps;
    END IF;
END $g0$;

-- Override de familia ACTIVO más reciente por SKU (capa manual).
DROP TABLE IF EXISTS pg_temp._taxo_ov;
CREATE TEMP TABLE _taxo_ov ON COMMIT DROP AS
SELECT DISTINCT ON (o.sku) o.sku, o.valor_editado
  FROM public.productos_override o
 WHERE o.campo = 'familia' AND o.activo
 ORDER BY o.sku, o.editado_en DESC;

-- FAMILIA EFECTIVA de cada producto vigente, con la precedencia de
-- capas del proyecto: manual (override) > v2 (clasificacion_v2) >
-- fuente (productos.familia_id → familias.nombre).
DROP TABLE IF EXISTS pg_temp._taxo_efectiva;
CREATE TEMP TABLE _taxo_efectiva ON COMMIT DROP AS
SELECT p.sku,
       coalesce(ov.valor_editado, c.familia_v2, f.nombre) AS familia
  FROM public.productos p
  JOIN _taxo_vig v                  ON v.id = p.snapshot_id
  LEFT JOIN _taxo_ov ov             ON ov.sku = p.sku
  LEFT JOIN public.clasificacion_v2 c ON c.sku = p.sku
  LEFT JOIN public.familias f       ON f.id = p.familia_id;

-- UNIVERSO de valores de familia observados (catálogo + v2 + override
-- + efectiva). No se altera ninguno: solo se leen para detectar
-- colisiones y átomos dudosos.
DROP TABLE IF EXISTS pg_temp._taxo_universo;
CREATE TEMP TABLE _taxo_universo ON COMMIT DROP AS
SELECT DISTINCT u.valor
  FROM (
        SELECT f.nombre        AS valor FROM public.familias f
        UNION SELECT c.familia_v2       FROM public.clasificacion_v2 c WHERE c.familia_v2 IS NOT NULL
        UNION SELECT ov.valor_editado   FROM _taxo_ov ov
        UNION SELECT e.familia          FROM _taxo_efectiva e WHERE e.familia IS NOT NULL
       ) u
 WHERE btrim(coalesce(u.valor, '')) <> '';

-- CLAVE n2 de un valor de familia = separadores '/' normalizados a
-- ' / ', espacios internos colapsados, trim, MAYÚSCULAS. Es el espejo
-- SQL de `separarFamilias` (src/lib/familias.ts) para el ÚNICO uso que
-- necesita esta migración: detectar dos escrituras del MISMO concepto.
-- Contrastado contra el espejo JS exacto de familias.ts:
-- ambos producen el mismo y único grupo de colisión (QZ8 / H5980).
DROP TABLE IF EXISTS pg_temp._taxo_grupos;
CREATE TEMP TABLE _taxo_grupos ON COMMIT DROP AS
SELECT upper(btrim(regexp_replace(regexp_replace(u.valor, '\s*/\s*', ' / ', 'g'), '\s+', ' ', 'g'))) AS clave,
       array_agg(u.valor ORDER BY u.valor) AS variantes,
       count(*) AS n_variantes
  FROM _taxo_universo u
 GROUP BY 1
HAVING count(*) > 1;

-- ÁTOMOS DUDOSOS: valores que SÍ tienen 2+ átomos por '/', pero donde
-- al menos uno sería una familia fantasma según la compuerta
-- anti-átomo-fantasma del código (largo <= 2 o puramente numérico,
-- `esAtomoSospechoso` en src/lib/familias.ts). El código NO los
-- atomiza; esta migración tampoco decide: los manda a la bandeja.
DROP TABLE IF EXISTS pg_temp._taxo_dudosos;
CREATE TEMP TABLE _taxo_dudosos ON COMMIT DROP AS
SELECT u.valor,
       array_agg(a.atomo ORDER BY a.ord) AS atomos,
       array_agg(a.atomo ORDER BY a.ord)
         FILTER (WHERE length(a.atomo) <= 2 OR a.atomo ~ '^[0-9]+$') AS sospechosos
  FROM _taxo_universo u
  CROSS JOIN LATERAL (
       SELECT btrim(regexp_replace(t.x, '\s+', ' ', 'g')) AS atomo, t.ord
         FROM unnest(string_to_array(u.valor, '/')) WITH ORDINALITY AS t(x, ord)
       ) a
 WHERE a.atomo <> ''
 GROUP BY u.valor
HAVING count(*) > 1
   AND bool_or(length(a.atomo) <= 2 OR a.atomo ~ '^[0-9]+$');


-- ============================================================
-- (P1) TIPOS NUEVOS DE PENDIENTE
-- Superconjunto ESTRICTO de los 4 tipos de 0009:29-30
-- ('kam_desconocido','marca_west','colision_familia','cuarentena_etl')
-- + 'marca_ambigua' + 'familia_atomo_dudoso'. Un CHECK no es
-- referenciable (sin vistas/FK/índices que dependan de él): DROP+ADD es
-- seguro, y al ser superconjunto ninguna fila viva puede violarlo.
-- ============================================================

-- Guarda PREVIA: si hubiera en la tabla algún `tipo` fuera del conjunto
-- nuevo, el ADD CONSTRAINT fallaría con un error críptico de Postgres.
-- Aquí falla con el dato exacto que lo causó.
DO $p1a$
DECLARE
    v_intrusos text;
BEGIN
    SELECT string_agg(DISTINCT tipo, ', ')
      INTO v_intrusos
      FROM public.pendientes_datos
     WHERE tipo NOT IN ('kam_desconocido','marca_west','colision_familia',
                        'cuarentena_etl','marca_ambigua','familia_atomo_dudoso');

    IF v_intrusos IS NOT NULL THEN
        RAISE EXCEPTION '0011_taxo (P1): existen filas con tipo(s) fuera del conjunto nuevo (%). El CHECK las dejaría inconsistentes o abortaría de forma críptica. Abortando.', v_intrusos;
    END IF;
END $p1a$;

ALTER TABLE public.pendientes_datos DROP CONSTRAINT IF EXISTS pendientes_datos_tipo_check;
ALTER TABLE public.pendientes_datos ADD CONSTRAINT pendientes_datos_tipo_check
    CHECK (tipo IN ('kam_desconocido','marca_west','colision_familia',
                    'cuarentena_etl','marca_ambigua','familia_atomo_dudoso'));

COMMENT ON COLUMN public.pendientes_datos.tipo IS
    'kam_desconocido | marca_west | colision_familia | cuarentena_etl | '
    'marca_ambigua | familia_atomo_dudoso. Los dos últimos los agrega '
    '[INV-TAXO] (0011): marca_ambigua = la marca de la fuente vigente y la '
    'de clasificacion_v2 se contradicen (payload: sku, campo, marca_actual, '
    'marca_fuente, candidatas[]); familia_atomo_dudoso = la compuerta '
    'anti-átomo-fantasma de src/lib/familias.ts se niega a atomizar el valor '
    '(payload: campo, canonico, atomos[], atomos_fantasma[], skus[]).';

-- GUARDA ANTI-SILENCIO (patrón 0010:60-94). Un CHECK homónimo/huérfano
-- de una aplicación anterior vetaría los tipos nuevos EN SILENCIO: la
-- migración "aplicaría" y la bandeja simplemente nunca podría encolar.
-- Se prueba el comportamiento REAL, no la definición: (a) el CHECK
-- acepta los dos tipos nuevos; (b) sigue rechazando un valor basura.
-- Las filas de prueba se borran en el mismo bloque (si el INSERT falla,
-- la subtransacción del EXCEPTION las revierte sola). El DELETE previo
-- solo limpia residuo de una corrida abortada de ESTA misma guarda:
-- jamás toca un pendiente real (clave_natural reservada).
DO $p1b$
DECLARE
    v_clave   text := '__probe_0011_taxo__';
    v_acepta  boolean := false;
    v_rechaza boolean := false;
    v_def     text;
    v_otros   integer;
BEGIN
    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    BEGIN
        INSERT INTO public.pendientes_datos (tipo, clave_natural, detectado_por)
        VALUES ('marca_ambigua', v_clave, '0011_taxo'),
               ('familia_atomo_dudoso', v_clave, '0011_taxo');
        v_acepta := true;
    EXCEPTION WHEN check_violation THEN
        v_acepta := false;
    END;

    IF NOT v_acepta THEN
        RAISE EXCEPTION '0011_taxo (P1): el CHECK vigente sobre pendientes_datos.tipo RECHAZA los tipos nuevos justo después del ADD CONSTRAINT — hay otro CHECK vetándolos en silencio. Abortando.';
    END IF;

    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    BEGIN
        INSERT INTO public.pendientes_datos (tipo, clave_natural, detectado_por)
        VALUES ('__basura_0011__', v_clave, '0011_taxo');
    EXCEPTION WHEN check_violation THEN
        v_rechaza := true;
    END;

    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    IF NOT v_rechaza THEN
        RAISE EXCEPTION '0011_taxo (P1): el CHECK ACEPTÓ un tipo basura — la columna quedó sin restricción efectiva. Abortando.';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO v_def
      FROM pg_constraint
     WHERE conrelid = 'public.pendientes_datos'::regclass
       AND conname = 'pendientes_datos_tipo_check';

    IF v_def IS NULL OR v_def NOT LIKE '%marca_ambigua%' OR v_def NOT LIKE '%familia_atomo_dudoso%' THEN
        RAISE EXCEPTION '0011_taxo (P1): pendientes_datos_tipo_check no quedó con los tipos nuevos (def=%). Abortando.', coalesce(v_def, '(inexistente)');
    END IF;

    SELECT count(*) INTO v_otros
      FROM pg_constraint
     WHERE conrelid = 'public.pendientes_datos'::regclass
       AND contype = 'c'
       AND conname <> 'pendientes_datos_tipo_check'
       AND pg_get_constraintdef(oid) LIKE '%tipo%';

    IF v_otros > 0 THEN
        RAISE EXCEPTION '0011_taxo (P1): existen % CHECK adicional(es) sobre `tipo` distintos de pendientes_datos_tipo_check. Abortando.', v_otros;
    END IF;
END $p1b$;


-- ============================================================
-- (P2) resolver_pendiente EXTENDIDO PARA 'marca_ambigua'
-- Cuerpo COMPLETO de 0009:50-100 + la rama nueva. La firma NO cambia
-- (uuid, text, text, text): `p_valor` ya era el canal genérico de
-- "valor elegido por el admin" (ver src/schemas/pendientes.schema.ts) y
-- el contrato HTTP no necesita tocarse.
--
-- Qué agrega, al confirmar un 'marca_ambigua':
--   1. Alta IDEMPOTENTE en `marcas`. `marcas` tiene UNIQUE(nombre)
--      case-SENSIBLE y —a diferencia de `familias`/`tecnologias`— NO
--      tiene índice único sobre lower(nombre) (0001:55-62, 0006:73-74).
--      Un ON CONFLICT DO NOTHING dejaría entrar 'Vertical' junto a
--      'VERTICAL'. Por eso se busca case-insensitive ANTES de insertar
--      (mismo patrón que la rama kam_desconocido) y se inserta
--      NORMALIZADA a MAYÚSCULAS, que es la convención declarada del
--      catálogo (0001:51-53) y la que cumplen las marcas vivas
--      (verificado).
--   2. Upsert de `clasificacion_v2.marca_v2` con el nombre CANÓNICO
--      recién resuelto (nunca con el texto crudo del admin), de modo que
--      marca_v2 siempre apunte a una fila real de `marcas`.
--      Sobrescribe a propósito: es una decisión HUMANA, la capa de
--      mayor precedencia. Y por eso el UPDATE **SÍ** fija
--      `fuente_version = 'pendiente:marca_ambigua'` — igual que el INSERT,
--      que ya usaba ese mismo prefijo: ambos caminos quedan consistentes,
--      dé o no dé conflicto la fila.
--
--      POR QUÉ IMPORTA (ratificado): la Ficha necesita
--      distinguir un valor v2 que DECIDIÓ UNA PERSONA en la bandeja de uno
--      que vino del Excel. Medido contra la BD viva: todas las
--      filas de clasificacion_v2 traen `fuente_version` = un timestamp y
--      `updated_by` = un correo humano (una persona aplicó la carga), así que
--      `updated_by` NO distingue nada; y los SKUs en disputa YA TIENEN
--      fila v2, o sea que caen SIEMPRE en el ON CONFLICT DO UPDATE. Si el
--      UPDATE no tocara `fuente_version`, el marcador `LIKE 'pendiente:%'`
--      no se dispararía jamás para los únicos casos que lo motivan: sería
--      un mecanismo muerto (fail-open silencioso, patrón P4).
--
--      COSTO DECLARADO (patrón P5): `fuente_version` es un valor de FILA,
--      no de campo. Al escribirlo, esa fila DEJA DE REGISTRAR qué corrida
--      produjo sus OTROS campos v2 (familia_v2, clase_v2, tecnología…).
--      Se asume a cambio de no MENTIR sobre el origen de la marca, que es
--      el dato que un humano decidió. Lo que hace tolerable el intercambio
--      es que el string NOMBRA EL CAMPO decidido
--      ('pendiente:marca_ambigua'), así que la UI pinta la insignia
--      únicamente en Marca y deja familia/clase/tecnología con su insignia
--      v2 normal. Si algún día se necesita procedencia por campo, esto se
--      reemplaza por columnas propias, no por más prefijos.
--      CONTRATO CON EL LECTOR (verificado en el código): el
--      consumidor ya existe y es `decididoEnBandejaMarca`
--      (src/services/sku.service.ts:110-125), que exige el prefijo
--      'pendiente:' Y que el tipo nombrado sea EXACTAMENTE 'marca_ambigua'
--      — con `familia_atomo_dudoso` devuelve false a propósito. El valor
--      que escribe esta rama, 'pendiente:marca_ambigua', es justo ese: si
--      alguien cambia uno de los dos lados, la insignia de la Ficha deja
--      de encenderse (o se enciende de más). Alimenta
--      `decidido_en_bandeja.marca` de src/types/api.ts:235.
--      Sus 23 caracteres caben en el max(40) declarado en
--      src/schemas/clasificacion.schema.ts:19.
--      La trazabilidad de QUIÉN y CUÁNDO sigue viviendo en
--      `updated_by`/`updated_at` (columnas de auditoría reales de
--      0008:56-58) y en `resolucion` del pendiente.
--   3. FAIL-CLOSED (patrón P4 de docs/engineering/failure-patterns.md): si la marca
--      elegida llega vacía/nula, o el payload no trae `sku`, o el SKU no
--      existe en `productos`, se lanza EXCEPTION. Jamás se marca
--      "resuelto" un pendiente cuya resolución no se pudo escribir.
--   4. TRANSACCIONAL por construcción: el cuerpo de una función plpgsql
--      corre dentro de UNA transacción; cualquier RAISE revierte también
--      el UPDATE del pendiente. Todo o nada.
--
-- 'familia_atomo_dudoso' NO recibe rama propia: confirmarlo RATIFICA EL
-- STATU QUO ("es UNA sola familia") y por eso no escribe nada — con el
-- modelo ratificado (derivar al leer) el valor ya se lee sin atomizar.
-- El payload de esos pendientes lleva `opcion_confirmar`/`opcion_descartar`
-- para que la bandeja diga eso con todas sus letras y no prometa una
-- acción inexistente (patrón P4). El caso contrario ("son DOS familias")
-- se aplica con `aplicar_override` (0006) desde la ficha/config, que es
-- donde vive la capa manual de familia, y queda fuera del alcance de
-- 0011. Supuesto escrito a propósito (patrón P5).
-- ============================================================
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
    -- `fuente_version` se fija en AMBOS caminos (INSERT y DO UPDATE) para
    -- que la Ficha pueda distinguir "lo decidió una persona en la bandeja"
    -- de "vino del Excel". Los SKUs que motivan esto YA tienen fila v2:
    -- sin el UPDATE, el marcador nunca se dispararía. Ver cabecera de P2
    -- (punto 2) para el costo declarado de escribir un valor de FILA.
    INSERT INTO public.clasificacion_v2 AS c
           (sku, marca_v2, fuente_version, updated_by, updated_at)
    VALUES (v_sku, v_canon, 'pendiente:marca_ambigua', v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      marca_v2       = EXCLUDED.marca_v2,
      fuente_version = EXCLUDED.fuente_version,
      updated_by     = EXCLUDED.updated_by,
      updated_at     = EXCLUDED.updated_at;

    v_ref := jsonb_build_object('marca_id', v_marca_id, 'marca', v_canon, 'sku', v_sku);

  -- 'familia_atomo_dudoso' NO tiene rama, A PROPÓSITO: confirmarlo
  -- significa "sí, es UNA sola familia — la compuerta anti-átomo-fantasma
  -- acertó", es decir RATIFICAR EL STATU QUO. Con el modelo ratificado
  -- (derivar al leer, sin materializar) eso no tiene efecto de escritura:
  -- el valor ya se lee sin atomizar. No es un no-op olvidado; el payload
  -- del pendiente lleva `opcion_confirmar`/`opcion_descartar` con esa
  -- semántica exacta para que la bandeja no prometa una acción que no
  -- ocurre (patrón P4). El caso contrario —"son DOS familias"— exige
  -- cambio de datos o de código y queda fuera del alcance de 0011.
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


-- ============================================================
-- (P3) CIERRE EN SITIO DE LAS 3 COLISIONES DE B-PARCHE
-- Verificado contra la base de entonces: son las 3 listadas aqui, todas `abierto`, todas con
-- detectado_por='clasificacion_v2' y clave sin versionar. Sus variantes
-- ('SERIES 2 26  / SERIES 2 38' con doble espacio vs. la de espacio
-- simple, etc.) YA NO EXISTEN en ninguna capa de la BD, y bajo la
-- normalización n2 tampoco serían colisión: colapsan al MISMO valor.
-- Dejaron de aplicar.
--
-- SE CIERRAN EN SU SITIO, CONSERVANDO SU CLAVE VIEJA, y NO se crea
-- ninguna lápida con clave 'n2:'. El porqué, con la medición que lo
-- decide (sobre los valores crudos
-- distintos de las 3 capas —catálogo ∪ v2 ∪ fuente— normalizados con la
-- clave n2 y agrupados):
--   (a) Conservar la clave vieja SÍ defiende: si se le renombrara a
--       'n2:…', la clave vieja quedaría LIBRE y el SEED de 0009 —que se
--       declara idempotente y es re-ejecutable— volvería a abrir las 3.
--   (b) Una lápida 'n2:<clave vieja>' NO defiende de nada: bajo n2
--       colisiona un solo grupo ('qz8/h5980') y cada uno de estos
--       conceptos tenia entonces 1 sola variante viva ('SERIES 2 26 / SERIES
--       2 38', 'CLIP 3.0 / CLIP MODULAR', 'CLIP 3.0 / CLIPS MODULAR
--       ALTA SEGURIDAD'). Sin 2 variantes no hay colisión que detectar:
--       ningún productor n2 puede re-encolarlos.
--   (c) Y tendría un costo real en la dirección contraria: si una
--       ingesta futura reintrodujera la variante de doble espacio, eso
--       sería una colisión NUEVA Y LEGÍTIMA que un humano debe ver — y
--       la lápida se la tragaría en silencio vía ON CONFLICT DO NOTHING
--       (patrón P4, fail-open), además de dejar 3 filas `resuelto` que
--       ningún humano resolvió ensuciando el historial de la bandeja.
-- No se borra nada. Solo se tocan estas 3: el WHERE es exactamente el
-- conjunto verificado.
-- ============================================================
DO $p3$
DECLARE
    v_viejas  integer;
    v_cerradas integer;
BEGIN
    SELECT count(*) INTO v_viejas
      FROM public.pendientes_datos
     WHERE tipo = 'colision_familia' AND clave_natural NOT LIKE 'n2:%';

    IF v_viejas <> 3 THEN
        RAISE EXCEPTION '0011_taxo (P3): se esperaban exactamente 3 colisiones de familia de la generación vieja y hay % — el conjunto a cerrar no es el verificado. Abortando.', v_viejas;
    END IF;

    -- Solo las ABIERTAS: si un admin ya descartó/resolvió alguna a mano,
    -- su decisión manda y esta migración no la pisa.
    UPDATE public.pendientes_datos
       SET estado       = 'resuelto',
           resuelto_por = '0011_taxo',
           resuelto_en  = now(),
           resolucion   = jsonb_build_object(
               'accion','confirmar',
               'motivo','Obsoleta con el modelo n2: las variantes solo diferían en espacios alrededor de "/" y la normalización n2 las colapsa al mismo valor; además ya no existen en ninguna capa de la BD. Cerrada por la migración 0011_taxo [INV-TAXO], sin fusionar nada.',
               'generacion','n2',
               'cerrado_por','0011_taxo')
     WHERE tipo = 'colision_familia'
       AND clave_natural NOT LIKE 'n2:%'
       AND estado = 'abierto';

    GET DIAGNOSTICS v_cerradas = ROW_COUNT;
    IF v_cerradas > 3 THEN
        RAISE EXCEPTION '0011_taxo (P3): el UPDATE cerró % pendientes, máximo esperado 3. Abortando.', v_cerradas;
    END IF;
    RAISE NOTICE '0011_taxo (P3): colisiones viejas cerradas en esta corrida: % (0 = ya estaban cerradas).', v_cerradas;
END $p3$;

-- (Sin lápidas 'n2:' — ver (b) y (c) de la cabecera de P3. La única
-- clave 'n2:%' que existe tras esta migración es la de P4.)


-- ============================================================
-- (P4) ENCOLADO DE LA COLISIÓN NUEVA — 'QZ8 / H5980' vs 'QZ8/H5980'
-- Derivada, NO escrita a mano: `_taxo_grupos` agrupa TODO el universo
-- de valores de familia por su clave n2 y se queda con los grupos de
-- 2+ escrituras distintas. Verificado: hay un solo
-- grupo, y es este.
--   · 'QZ8 / H5980' (con espacios) → varios SKUs por familia efectiva
--     (viene de clasificacion_v2, pasada de abril)
--   · 'QZ8/H5980'   (sin espacios) → menos SKUs en la capa FUENTE del
--     snapshot vigente (julio); son un SUBCONJUNTO de los anteriores, por eso
--     su conteo por familia efectiva es 0 (la capa v2 los tapa).
-- NO se fusionan. El campo `canonico` del payload es la ETIQUETA
-- normalizada del grupo, no un veredicto: la fusión la decide un humano.
-- ============================================================
DO $p4a$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM _taxo_grupos;
    IF v_n > 2 THEN
        RAISE EXCEPTION '0011_taxo (P4): la normalización n2 detecta % grupos de colisión, verificado 1 (tope 2). Un dato inesperado cambió el catálogo: re-medir antes de encolar. Abortando.', v_n;
    END IF;
    IF v_n <> 1 THEN
        RAISE NOTICE '0011_taxo (P4): grupos de colisión detectados = % (verificado el 2026-07-28: 1).', v_n;
    END IF;
END $p4a$;

INSERT INTO public.pendientes_datos
    (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
SELECT 'colision_familia',
       'n2:' || lower(g.clave),
       'abierto',
       '0011_taxo',
       (SELECT id FROM _taxo_vig),
       jsonb_build_object(
         'campo','familia',
         'canonico', g.clave,
         'variantes', to_jsonb(g.variantes),
         'generacion','n2',
         'skus', (SELECT coalesce(jsonb_agg(DISTINCT e.sku ORDER BY e.sku), '[]'::jsonb)
                    FROM _taxo_efectiva e WHERE e.familia = ANY (g.variantes)),
         'detalle', (SELECT jsonb_agg(jsonb_build_object(
                        'variante', t.v,
                        'n_efectiva',    (SELECT count(*) FROM _taxo_efectiva e WHERE e.familia = t.v),
                        'n_fuente_vigente', (SELECT count(*) FROM public.productos p
                                               JOIN public.familias f ON f.id = p.familia_id
                                              WHERE p.snapshot_id = (SELECT id FROM _taxo_vig)
                                                AND f.nombre = t.v),
                        'n_v2',          (SELECT count(*) FROM public.clasificacion_v2 c WHERE c.familia_v2 = t.v),
                        'en_catalogo',   EXISTS (SELECT 1 FROM public.familias f WHERE f.nombre = t.v),
                        'skus_efectiva', (SELECT coalesce(jsonb_agg(e.sku ORDER BY e.sku), '[]'::jsonb)
                                            FROM _taxo_efectiva e WHERE e.familia = t.v)
                      ) ORDER BY t.v)
                     FROM unnest(g.variantes) AS t(v)),
         'nota','`canonico` es la ETIQUETA normalizada del grupo, NO una decisión de fusión. Las dos escrituras conviven a propósito hasta que un humano dictamine.',
         'evidencia','Ambas escrituras colapsan al mismo concepto al normalizar el separador "/" (regla 2 de separarFamilias, src/lib/familias.ts). Detectadas por la migración 0011_taxo [INV-TAXO] recorriendo TODO el universo de valores de familia (catálogo + clasificacion_v2 + overrides + familia efectiva del snapshot vigente).')
  FROM _taxo_grupos g
ON CONFLICT (tipo, clave_natural) DO NOTHING;


-- ============================================================
-- (P5) ENCOLADO DE LOS ÁTOMOS DUDOSOS (uno por familia)
-- Derivados, NO escritos a mano: `_taxo_dudosos`. Verificado:
-- exactamente 2, y son los que documenta `esAtomoSospechoso`
-- (src/lib/familias.ts:33-35):
--   · 'ZV680G/K'     → atomizar inventaría la familia fantasma "K"  (varios SKUs)
--   · 'Z1900 / 6693' → atomizar inventaría la familia fantasma "6693" (un SKU)
-- El código NO los atomiza (compuerta anti-átomo-fantasma, regla 7):
-- el SKU conserva el string completo como su única familia, así que no
-- se pierde nada mientras se decide si son una familia o dos.
-- Dato de contexto que va en el payload: 'ZV680M' YA existe como fila
-- propia del catálogo (pocos SKUs) — evidencia de que "H" es un sufijo de
-- modelo, no una familia.
-- ============================================================
DO $p5a$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM _taxo_dudosos;
    IF v_n > 4 THEN
        RAISE EXCEPTION '0011_taxo (P5): se detectan % valores con átomo dudoso, verificados 2 (tope 4). Re-medir antes de encolar. Abortando.', v_n;
    END IF;
    IF v_n <> 2 THEN
        RAISE NOTICE '0011_taxo (P5): valores con átomo dudoso = % (verificado el 2026-07-28: 2).', v_n;
    END IF;
END $p5a$;

INSERT INTO public.pendientes_datos
    (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
SELECT 'familia_atomo_dudoso',
       lower(btrim(regexp_replace(d.valor, '\s+', ' ', 'g'))),
       'abierto',
       '0011_taxo',
       (SELECT id FROM _taxo_vig),
       jsonb_build_object(
         'campo','familia',
         'canonico', d.valor,
         'atomos', to_jsonb(d.atomos),
         'atomos_fantasma', to_jsonb(d.sospechosos),
         'generacion','n2',
         'skus', (SELECT coalesce(jsonb_agg(e.sku ORDER BY e.sku), '[]'::jsonb)
                    FROM _taxo_efectiva e WHERE e.familia = d.valor),
         'n_skus', (SELECT count(*) FROM _taxo_efectiva e WHERE e.familia = d.valor),
         'atomos_que_ya_son_familia', (
             SELECT coalesce(jsonb_agg(f.nombre ORDER BY f.nombre), '[]'::jsonb)
               FROM public.familias f
              WHERE upper(btrim(f.nombre)) IN (
                    SELECT upper(t.atomo) FROM unnest(d.atomos) AS t(atomo))),
         'pregunta','¿Es UNA familia con ese nombre completo, o son DOS familias distintas? Atomizarla crearía las familias fantasma listadas en `atomos_fantasma`.',
         'opcion_confirmar','CONFIRMAR = "sí, es UNA sola familia: la compuerta anti-átomo-fantasma acertó". Ratifica el statu quo y NO cambia ningún dato — el valor ya se lee sin atomizar. Es el cierre esperado de este pendiente.',
         'opcion_descartar','DESCARTAR = "no, son DOS familias distintas". Eso SÍ exige cambio de datos o de código (renombrar el valor de familia o ajustar la compuerta) y queda FUERA del alcance de 0011: descartar aquí solo registra el veredicto, no lo aplica.',
         'evidencia','La compuerta anti-átomo-fantasma de separarFamilias (src/lib/familias.ts, regla 7) NO atomiza este valor porque al menos un átomo resultante tiene largo <= 2 o es puramente numérico. Mientras tanto el SKU conserva el string completo como su única familia: no se pierde ningún SKU. Detectado por la migración 0011_taxo [INV-TAXO].')
  FROM _taxo_dudosos d
ON CONFLICT (tipo, clave_natural) DO NOTHING;


-- ============================================================
-- (P6) TECNOLOGÍA 'VERTICAL'
--
-- REGLA RATIFICADA: "todos los de la fuente vigente" — el ancla
-- es la MARCA DE LA FUENTE (productos.marca_id → marcas.nombre) del
-- snapshot 'stock' vigente, no la clasificación de abril. Verificado
-- En esa fecha: el total exacto (los que ya tenían marca_v2 VERTICAL + los sin fila
-- en clasificacion_v2 + 1 clasificado SERIES5 en abril). Ninguno
-- tiene tecnología hoy.
--
-- LOS SKUs EN DISPUTA (derivados, no listados a mano): aquellos donde
-- la marca de la fuente vigente y `clasificacion_v2.marca_v2` se
-- CONTRADICEN y alguna de las dos es VERTICAL.
--   · 01654365/3225  → fuente VERTICAL (julio) / v2 SERIES5 (abril)
--   · QS1PQRMXDWR13K → fuente CABLE (cambió en julio) / v2 VERTICAL
--
-- DECISIÓN sobre el SKU clasificado SERIES5 en abril: (a) SE RESPETA
-- y se encola como 'marca_ambigua'. Justificación con la REGLA DE
-- PRECEDENCIA DE CAPAS del proyecto —manual > v2 > fuente— que es la que
-- implementa la lectura efectiva de la app (`coalesce(override, v2,
-- fuente)`): la capa v2 está POR ENCIMA de la fuente, así que un dato
-- derivado de la FUENTE no puede sobrescribir en silencio una
-- clasificación v2. Hacerlo invertiría la jerarquía y cambiaría la marca
-- efectiva del SKU (SERIES5 → VERTICAL) sin que nadie lo decidiera:
-- exactamente el "silencio ante el fallo" del patrón P4. Consecuencia
-- coherente: ese SKU tampoco recibe la tecnología (VERTICAL es
-- consecuencia de la marca; si la marca está en disputa, la tecnología
-- también lo está). Por eso se escriben todos menos uno — ese uno está en la
-- bandeja, no perdido. Simétricamente, QS1PQRMXDWR13K (excepción
-- explícita) tampoco se toca con VERTICAL y se encola igual.
--
-- La exclusión NO es una lista de SKUs: el conjunto a escribir es
-- "VERTICAL en la fuente vigente" EXCEPT "SKUs con pendiente
-- marca_ambigua". La bandeja misma es la lista de exclusión, y por eso
-- sigue siendo correcta cuando se agreguen disputas futuras.
--
-- LA EXCLUSIÓN NO FILTRA POR `estado`, Y ESO ES DELIBERADO (supuesto
-- declarado, patrón P5): dura MIENTRAS EXISTA la fila del pendiente, no
-- mientras esté `abierto`. Filtrar por `estado='abierto'` sería un BUG
-- silencioso: si un humano resuelve 01654365/3225 a SERIES5, ese SKU
-- SIGUE estando en `vert` —su marca de FUENTE sigue siendo VERTICAL, la
-- resolución solo tocó la capa v2— y una re-corrida de esta migración le
-- pegaría tecnología VERTICAL a un SKU cuya marca efectiva es
-- SERIES5, deshaciendo en silencio la decisión humana. Un pendiente
-- que ya existió es la marca permanente de "aquí hubo una disputa que la
-- automatización no puede resolver sola".
--
-- LÍMITE CONOCIDO, ESCRITO A PROPÓSITO (patrón P5): resolver un
-- 'marca_ambigua' escribe la MARCA (P2), no la tecnología. Si se
-- dictamina VERTICAL para alguno de los 2 disputados, la tecnología de
-- ese SKU se asigna aparte (a mano o en el bloque siguiente): esta
-- migración no la deduce por él. Se prefiere ese hueco visible —1 SKU
-- sin tecnología, con su pendiente resuelto al lado— antes que una
-- regla implícita "marca VERTICAL ⇒ tecnología VERTICAL" que nadie
-- ratificó para el camino de resolución manual.
-- ============================================================

-- (a) Alta idempotente de la tecnología. `tecnologias` tiene UNIQUE
-- (nombre) y ADEMÁS un índice único sobre lower(nombre) (0008:34-38):
-- un ON CONFLICT (nombre) DO NOTHING NO cubre el segundo y reventaría
-- ante un 'Vertical' preexistente. El NOT EXISTS case-insensitive sí.
INSERT INTO public.tecnologias (nombre)
SELECT 'VERTICAL'
 WHERE NOT EXISTS (SELECT 1 FROM public.tecnologias WHERE lower(nombre) = 'vertical');

-- (b) Encolado de las disputas ANTES de escribir: la bandeja es la
-- lista de exclusión del paso (c).
INSERT INTO public.pendientes_datos
    (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
SELECT 'marca_ambigua',
       p.sku,
       'abierto',
       '0011_taxo',
       (SELECT id FROM _taxo_vig),
       jsonb_build_object(
         'sku', p.sku,
         'campo','marca',
         'marca_actual', btrim(c.marca_v2),
         'marca_fuente', btrim(m.nombre),
         'candidatas', jsonb_build_array(btrim(c.marca_v2), btrim(m.nombre)),
         'generacion','n2',
         'descr_origen', p.descr_origen,
         'evidencia','La marca de la FUENTE VIGENTE ('||btrim(m.nombre)||') contradice la marca de la capa v2 ('||btrim(c.marca_v2)||'). La lectura efectiva de la app (manual > v2 > fuente) hoy muestra '||btrim(c.marca_v2)||'. La migración 0011_taxo [INV-TAXO] NO decide: por la regla de precedencia de capas, un dato de la fuente no puede sobrescribir la capa v2 en silencio. Mientras EXISTA este pendiente —en cualquier estado, también resuelto o descartado— el SKU queda FUERA de la asignación automática de tecnología: la decisión sobre su marca es de un humano, y la tecnología se asigna aparte.',
         'pregunta','¿Cuál es la marca correcta de este SKU? Al confirmar, el valor elegido se da de alta en `marcas` (si falta) y se escribe en clasificacion_v2.marca_v2.')
  FROM public.productos p
  JOIN _taxo_vig v                    ON v.id = p.snapshot_id
  JOIN public.marcas m                ON m.id = p.marca_id
  JOIN public.clasificacion_v2 c      ON c.sku = p.sku
 WHERE c.marca_v2 IS NOT NULL
   AND btrim(c.marca_v2) <> ''
   AND upper(btrim(c.marca_v2)) <> upper(btrim(m.nombre))
   AND (upper(btrim(m.nombre)) = 'VERTICAL' OR upper(btrim(c.marca_v2)) = 'VERTICAL')
ON CONFLICT (tipo, clave_natural) DO NOTHING;

-- (c) Aplicación de la tecnología + TOPE DE RADIO DE IMPACTO.
--
-- [S7-B · 2026-08-07] DOS ENMIENDAS, ninguna sobre el cuerpo:
--   · la banda [50,80] se OMITE si el universo está vacío (bandera del
--     bloque (0)); con datos corre idéntica;
--   · el tope de `marca_ambigua` YA NO ABORTA: informa con el número
--     contado en tiempo de ejecución. NO se subió. Ver la cabecera.
-- El tope de ESCRITURAS (> 80, abajo) NO se tocó: es el único que
-- protege lo que esta parte de verdad escribe.
--
-- Topes (estilo 0010:110-124): el objetivo medido fue de unas decenas y las
-- escrituras medidas, una menos. Se aborta si el objetivo se sale de [50, 80] o
-- si las escrituras superan 80. El margen absorbe una ingesta mensual
-- normal; un salto mayor significa que la fuente cambió de forma
-- estructural y alguien tiene que RE-MEDIR antes de escribir. Escribir
-- de más aquí no es un error visible: es una tecnología equivocada
-- pegada a decenas de SKUs, que nadie nota hasta que filtra por ella.
DO $p6$
DECLARE
    v_objetivo  integer;
    v_disputa   integer;
    v_disp_ab   integer;
    v_disp_otro integer;
    v_escritas  integer;
    v_tec       text;
    v_vacio     boolean;
BEGIN
    -- [S7-B] La bandera la fija el bloque (0). Si NO llegó hasta aquí, este
    -- archivo no corrió completo y no hay forma de saber si el universo
    -- estaba vacío: se aborta (fail-closed). Mismo mecanismo y misma razón
    -- que la «foto del ANTES» de la 0020.
    --
    -- ANTI-VACUIDAD (P19): esta comprobación se pone ROJA ejecutando este
    -- bloque P6 sin el bloque (0) de arriba — por ejemplo, aplicando
    -- el archivo por trozos o en sesiones distintas, que es exactamente el
    -- modo de fallo que la cabecera de la sección (0) ya advierte para las
    -- tablas TEMP. No es hipotética: el `nullif(...,'')` está ahí porque
    -- tras un ROLLBACK previo en la MISMA sesión el GUC vuelve como cadena
    -- vacía y no como NULL (medido en la 0020).
    v_vacio := nullif(current_setting('demo.mig0011_universo_vacio', true), '')::boolean;
    IF v_vacio IS NULL THEN
        RAISE EXCEPTION '0011_taxo (P6): la bandera de universo del bloque (0) no llegó a P6 — el archivo no corrió como una sola transacción. Sin ella no se puede decidir si la banda de radio de impacto aplica. Abortando.';
    END IF;

    SELECT nombre INTO v_tec FROM public.tecnologias WHERE lower(nombre) = 'vertical';
    IF v_tec IS NULL THEN
        RAISE EXCEPTION '0011_taxo (P6): la tecnología VERTICAL no quedó en el catálogo tras el alta idempotente. Abortando.';
    END IF;

    SELECT count(*) INTO v_objetivo
      FROM public.productos p
      JOIN _taxo_vig v     ON v.id = p.snapshot_id
      JOIN public.marcas m ON m.id = p.marca_id
     WHERE upper(btrim(m.nombre)) = 'VERTICAL';

    -- [S7-B] BANDA DE RADIO DE IMPACTO — INTACTA para la base con datos,
    -- OMITIDA para el universo vacío. Sin esta rama, degradar solo el
    -- bloque (0) no habría servido de nada: con 0 productos, `v_objetivo`
    -- vale 0, cae bajo el piso de 50 y la migración abortaba igual, tres
    -- pantallas más abajo. La banda mide una FUENTE; sin fuente no mide.
    IF v_vacio THEN
        RAISE NOTICE '0011_taxo (P6): universo vacío — se OMITE la banda [50,80] (medido ahora: % SKUs de marca VERTICAL). NO COMPROBADO AQUÍ: que la fuente no haya cambiado de forma estructural; no hay fuente contra la cual medirlo.', v_objetivo;
    ELSIF v_objetivo < 50 OR v_objetivo > 80 THEN
        RAISE EXCEPTION '0011_taxo (P6): la fuente vigente trae % SKUs de marca VERTICAL; banda [50,80]. La fuente cambió de forma estructural: re-medir antes de escribir. Abortando.', v_objetivo;
    END IF;

    -- [S7-B] TOPE DE `marca_ambigua`, DEGRADADO A NOTICE. NO SE SUBIÓ — se
    -- retiró como causa de aborto, por orden expresa del PO
    -- (docs/decisions/0005-migration-guards-and-replay.md).
    --
    -- El «tope 5» describía el mundo de julio, cuando había pocos. Hoy
    -- son muchos más, y no por una anomalía: la 0012 (P2/regla O3) encoló más a
    -- propósito y con su propio tope de 40. O sea, el tope de la 0011 lo
    -- rebasó el trabajo legítimo de la migración siguiente. Subirlo
    -- habría sido escribir OTRO hecho fechado con la misma forma de
    -- caducar; por eso informa en vez de abortar.
    --
    -- El número NO está escrito a mano en este SQL: se cuenta aquí, ahora,
    -- y se imprime con su desglose por estado.
    --
    -- ANTI-VACUIDAD (P19): este NOTICE ya no puede ponerse rojo — a
    -- propósito, esa es la decisión. Lo que sí distingue estados: en una
    -- base recién creada imprime 0 (nadie encoló nada todavía) y en
    -- producción imprime la cuenta real con la línea de TOPE REBASADO. Si algún día
    -- imprimiera 0 en producción, eso sería la señal de que el encolado de
    -- arriba dejó de funcionar — y ninguna guarda de este archivo lo
    -- atraparía. Queda declarado, no supuesto.
    SELECT count(*),
           count(*) FILTER (WHERE estado = 'abierto'),
           count(*) FILTER (WHERE estado <> 'abierto')
      INTO v_disputa, v_disp_ab, v_disp_otro
      FROM public.pendientes_datos WHERE tipo = 'marca_ambigua';

    RAISE NOTICE '0011_taxo (P6): pendientes marca_ambigua OBSERVADOS ahora = % (% abierto(s) + % resuelto(s)/descartado(s)).',
        v_disputa, v_disp_ab, v_disp_otro;

    IF v_disputa > 5 THEN
        RAISE NOTICE '0011_taxo (P6): TOPE REBASADO — el tope histórico de 5 (verificados 2 el 2026-07-28) quedó OBSOLETO contra la realidad medida: hoy hay %. No se sube el tope ni se aborta por él: era un hecho fechado, no un invariante, y la 0012 lo rebasa por diseño con su propia regla O3. Se INFORMA para no perder la señal. Si este número creciera sin una migración que lo justifique, alguien tiene que ir a mirar la bandeja.', v_disputa;
    END IF;

    -- EMPTY-NEVER-CLEARS + no pisar decisiones: solo se toca la fila si
    -- `tecnologia` está NULL (el WHERE del DO UPDATE). Una tecnología ya
    -- escrita —por un humano o por una corrida v2— jamás se sobrescribe.
    -- `fuente_version` solo se fija en el INSERT (fila nueva, 100% de
    -- esta migración); en el UPDATE NO se toca, porque los demás campos
    -- de esa fila siguen viniendo de su corrida de origen.
    WITH vert AS (
        SELECT p.sku
          FROM public.productos p
          JOIN _taxo_vig v     ON v.id = p.snapshot_id
          JOIN public.marcas m ON m.id = p.marca_id
         WHERE upper(btrim(m.nombre)) = 'VERTICAL'
    ),
    escribir AS (
        -- SIN filtro por `estado`, a propósito: la exclusión dura
        -- mientras EXISTA el pendiente (ver cabecera de P6 — filtrar por
        -- 'abierto' deshacía en silencio la decisión humana).
        SELECT sku FROM vert
        EXCEPT
        SELECT clave_natural FROM public.pendientes_datos WHERE tipo = 'marca_ambigua'
    )
    INSERT INTO public.clasificacion_v2 AS c
           (sku, tecnologia, fuente_version, updated_by, updated_at)
    SELECT e.sku, v_tec, '0011_taxo/vertical', '0011_taxo', now()
      FROM escribir e
    ON CONFLICT (sku) DO UPDATE SET
        tecnologia = EXCLUDED.tecnologia,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
     WHERE c.tecnologia IS NULL;

    GET DIAGNOSTICS v_escritas = ROW_COUNT;

    IF v_escritas > 80 THEN
        RAISE EXCEPTION '0011_taxo (P6): la asignación de tecnología VERTICAL tocó % filas, tope 80 (verificadas 65). Abortando toda la migración.', v_escritas;
    END IF;

    RAISE NOTICE '0011_taxo (P6): objetivo=% · en disputa (bandeja)=% · filas escritas en esta corrida=% (0 = ya estaban escritas).', v_objetivo, v_disputa, v_escritas;
END $p6$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- Para el operador: SELECTs numerados, fuera de la transacción de arriba
-- (NO se ejecutan como parte de este archivo). Cada uno trae su
-- resultado esperado. Contrastados contra la BD viva (valores medidos omitidos en esta copia).
-- ============================================================
--
-- -- (1) P1 · El CHECK quedó con los 6 tipos:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.pendientes_datos'::regclass
--    AND conname  = 'pendientes_datos_tipo_check';
-- -- esperado: CHECK (tipo = ANY (ARRAY['kam_desconocido'::text,'marca_west'::text,'colision_familia'::text,'cuarentena_etl'::text,'marca_ambigua'::text,'familia_atomo_dudoso'::text]))
--
-- -- (2) P1 · No quedó residuo de la guarda anti-silencio:
-- SELECT count(*) FROM public.pendientes_datos WHERE clave_natural = '__probe_0011_taxo__';
-- -- esperado: 0
--
-- -- (3) P2 · La RPC quedó con la rama de marca_ambigua:
-- SELECT prosrc LIKE '%marca_ambigua%' AS tiene_rama,
--        prosrc LIKE '%marca requerida para resolver marca_ambigua%' AS es_fail_closed
--   FROM pg_proc WHERE proname = 'resolver_pendiente';
-- -- esperado: t | t
--
-- -- (3b) P2 · El DO UPDATE también fija `fuente_version` (si no, el
-- --      marcador de "lo decidió un humano" estaría muerto para los
-- --      SKUs que lo motivan, que YA tienen fila v2 y por eso nunca pasan
-- --      por el INSERT):
-- SELECT prosrc LIKE '%fuente_version = EXCLUDED.fuente_version%' AS update_marca_el_origen
--   FROM pg_proc WHERE proname = 'resolver_pendiente';
-- -- esperado: t
--
-- -- (3c) P2 · NINGUNA fila lleva todavía el marcador: la MIGRACIÓN no
-- --      resuelve pendientes, solo los encola. El valor aparece cuando un
-- --      admin decide en la bandeja. Sirve para que el operador distinga
-- --      "la marca funciona" de "la migración escribió algo que no debía":
-- SELECT count(*) FROM public.clasificacion_v2 WHERE fuente_version LIKE 'pendiente:%';
-- -- esperado: 0   (justo después de aplicar; > 0 SOLO tras resolver un
-- --                marca_ambigua desde la bandeja)
--
-- -- (4) P3 · Las 3 viejas cerradas EN SITIO + la única clave n2 (la de P4):
-- SELECT clave_natural, estado, resuelto_por FROM public.pendientes_datos
--  WHERE tipo = 'colision_familia' ORDER BY clave_natural;
-- -- esperado: una fila por clave —
-- --   'n2:qz8 / h5980'                            | abierto  | (null)
-- --   'series 2 26 / series 2 38'                   | resuelto | 0011_taxo
-- --   'clip 3.0 / clip modular'                   | resuelto | 0011_taxo
-- --   'clip 3.0 / clips modular alta seguridad'   | resuelto | 0011_taxo
--
-- -- (4b) P3 · Contraste explícito de la AUSENCIA de lápidas:
-- SELECT count(*) FILTER (WHERE clave_natural NOT LIKE 'n2:%' AND estado = 'resuelto') AS viejas_cerradas,
--        count(*) FILTER (WHERE clave_natural NOT LIKE 'n2:%' AND estado <> 'resuelto') AS viejas_sin_cerrar,
--        count(*) FILTER (WHERE clave_natural LIKE 'n2:%')                              AS claves_n2
--   FROM public.pendientes_datos WHERE tipo = 'colision_familia';
-- -- esperado: viejas_cerradas > 0 | 0 | 1   (claves_n2 = 1 ⇒ solo la de QZ8; cero lápidas)
-- SELECT count(*) FROM public.pendientes_datos WHERE clave_natural LIKE 'n2:%';
-- -- esperado: 1               (en TODA la tabla, no solo en colision_familia)
--
-- -- (5) P4 · La colisión nueva quedó encolada con sus 2 variantes:
-- SELECT payload -> 'variantes' AS variantes,
--        jsonb_array_length(payload -> 'skus') AS skus_efectiva
--   FROM public.pendientes_datos
--  WHERE tipo = 'colision_familia' AND clave_natural = 'n2:qz8 / h5980';
-- -- esperado: ["QZ8 / H5980", "QZ8/H5980"] | (conteo por familia efectiva)
--
-- -- (6) P4 · Desglose por variante (la evidencia que decide el humano):
-- SELECT d ->> 'variante' AS variante, d ->> 'n_efectiva' AS efectiva,
--        d ->> 'n_fuente_vigente' AS fuente, d ->> 'n_v2' AS v2
--   FROM public.pendientes_datos p,
--        jsonb_array_elements(p.payload -> 'detalle') d
--  WHERE p.clave_natural = 'n2:qz8 / h5980';
-- -- esperado: 'QZ8 / H5980' → efectiva = v2 > 0, fuente 0
-- --           'QZ8/H5980'   → efectiva  0, fuente > 0, v2  0
--
-- -- (7) P5 · Los 2 átomos dudosos, con sus SKUs:
-- SELECT payload ->> 'canonico' AS familia, payload -> 'atomos_fantasma' AS fantasmas,
--        payload ->> 'n_skus' AS skus
--   FROM public.pendientes_datos WHERE tipo = 'familia_atomo_dudoso' ORDER BY 1;
-- -- esperado: 2 filas — 'ZV680G/K' | ["K"] | n   ·   'Z1900 / 6693' | ["6693"] | n
--
-- -- (8) P6 · La tecnología existe una sola vez:
-- SELECT count(*) FROM public.tecnologias WHERE lower(nombre) = 'vertical';
-- -- esperado: 1   (catálogo completo esperado: EAS, BRAND2, BRAND1, VERTICAL = 4)
--
-- -- (9) P6 · SKUs con tecnología VERTICAL:
-- SELECT count(*) FROM public.clasificacion_v2 WHERE tecnologia = 'VERTICAL';
-- -- esperado: el objetivo menos el disputado
--
-- -- (10) P6 · Paridad objetivo = escritos + los de la bandeja (nada perdido):
-- WITH vig AS (SELECT id FROM public.snapshots WHERE fuente='stock'
--               ORDER BY created_at DESC, id DESC LIMIT 1)
-- SELECT count(*) FILTER (WHERE true)                                   AS objetivo_fuente,
--        count(*) FILTER (WHERE c.tecnologia = 'VERTICAL')              AS con_tecnologia,
--        count(*) FILTER (WHERE pd.id IS NOT NULL)                      AS en_bandeja
--   FROM public.productos p
--   JOIN vig v ON v.id = p.snapshot_id
--   JOIN public.marcas m ON m.id = p.marca_id
--   LEFT JOIN public.clasificacion_v2 c ON c.sku = p.sku
--   LEFT JOIN public.pendientes_datos pd ON pd.tipo='marca_ambigua' AND pd.clave_natural = p.sku
--  WHERE upper(btrim(m.nombre)) = 'VERTICAL';
-- -- esperado: objetivo | objetivo − 1 | 1
--
-- -- (11) P6 · Las filas NUEVAS de clasificacion_v2 (solo tecnología):
-- SELECT count(*) FROM public.clasificacion_v2
--  WHERE tecnologia = 'VERTICAL' AND fuente_version = '0011_taxo/vertical';
-- -- esperado: las nuevas (las demás son UPDATE y conservan su fuente_version de abril)
-- -- total de filas en clasificacion_v2 tras la migración: las previas + las nuevas
--
-- -- (12) P6 · Los 2 marca_ambigua encolados, con sus candidatas:
-- SELECT clave_natural, payload ->> 'marca_fuente' AS fuente,
--        payload ->> 'marca_actual' AS v2, estado
--   FROM public.pendientes_datos WHERE tipo = 'marca_ambigua' ORDER BY 1;
-- -- esperado: '01654365/3225'  | VERTICAL | SERIES5 | abierto
-- --           'QS1PQRMXDWR13K' | CABLE    | VERTICAL   | abierto
--
-- -- (13) P6 · Ninguno de los 2 disputados recibió tecnología:
-- SELECT sku, marca_v2, tecnologia FROM public.clasificacion_v2
--  WHERE sku IN (SELECT clave_natural FROM public.pendientes_datos WHERE tipo='marca_ambigua');
-- -- esperado: 01654365/3225 | SERIES5 | (null)   ·   QS1PQRMXDWR13K | VERTICAL | (null)
--
-- -- (14) Estado global de la bandeja:
-- SELECT public.contar_pendientes();
-- -- esperado: {"abiertos": n, "por_tipo": {"marca_west": n, "colision_familia": 1,
-- --            "familia_atomo_dudoso": 2, "marca_ambigua": 2}}
-- -- (antes de 0011: abiertos = marca_west + 3 colision_familia;
-- --  las 3 colision_familia viejas se cierran y entran 1+2+2 nuevos abiertos)
-- SELECT count(*) FROM public.pendientes_datos;
-- -- esperado: las previas + 1 P4 + 2 P5 + 2 P6; SIN lápidas
-- SELECT tipo, estado, count(*) FROM public.pendientes_datos GROUP BY 1,2 ORDER BY 1,2;
-- -- esperado: colision_familia|abierto 1 · colision_familia|resuelto 3 ·
-- --           familia_atomo_dudoso|abierto 2 · kam_desconocido|descartado 1 ·
-- --           kam_desconocido|resuelto 1 · marca_ambigua|abierto 2 ·
-- --           marca_west|abierto n
--
-- -- (15) NADA de familias se tocó (el alcance ratificado se respetó):
-- SELECT count(*) AS familias FROM public.familias;                       -- esperado: sin cambio vs. antes de 0011
-- SELECT count(*) FROM public.clasificacion_v2 WHERE familia_v2 IS NOT NULL; -- esperado: sin cambio vs. antes de 0011
-- ============================================================
