-- ============================================================
-- Bloque [INV-B7B] · carril G · 0012_b7b_hardening.sql
--
-- QUÉ HACE (4 partes, cada una idempotente y re-ejecutable):
--   P1 · GUARDAS de la regla O3 (tecnología-categoría): deriva por SQL el
--        conjunto de tecnologías que se comportan como CATEGORÍA y aborta
--        si ese conjunto queda VACÍO (la regla dejó de detectar =
--        fail-open mudo, patrón P4) o si trae MÁS DE 2 (lo normal es 1). Más la
--        sonda de clave reservada que PRUEBA que el CHECK de
--        `pendientes_datos.tipo` sigue aceptando 'marca_ambigua'.
--   P2 · ENCOLA como 'marca_ambigua' los SKUs cuya marca efectiva ES el
--        nombre de una tecnología-categoría (p. ej. los SKUs de "EAS"), con
--        tope de radio de impacto (>40 aborta) y NOTICE si el número no
--        es el verificado. `clave_natural = sku` (convención de 0011-P6b).
--   P3 · CIERRA LA FUGA DE IDENTIDAD (O5 / TAXO-10): REVOKE de columna
--        sobre `clasificacion_v2.updated_by`, `productos_override.
--        editado_por` y `productos_metadata.updated_by` para el rol
--        `authenticated`. NO toca `service_role` ni `postgres`.
--   P4 · ADVISOR de rendimiento: la policy `perfiles_select_own_or_admin`
--        re-evalúa `auth.uid()` por fila; se envuelve en
--        `(SELECT auth.uid())` para que el planner la resuelva UNA vez
--        (InitPlan). Sin cambio de semántica — ver la justificación en P4.
--
-- QUÉ **NO** HACE:
--   · NO escribe en `clasificacion_v2`. 0012 SOLO ENCOLA. La escritura de
--     la marca la hace `resolver_pendiente` (0011-P2) cuando un humano
--     decide en la bandeja. Ni un UPDATE, ni un INSERT, ni un upsert.
--   · NO contiene listas negras de marcas ni de SKUs: el conjunto se
--     DERIVA con SQL del snapshot vigente y de la capa v2. El único
--     literal de dominio es el UMBRAL (3 marcas / 2 SKUs), que es la
--     regla, no una lista.
--   · NO toca los 5 WARN de `authenticated_security_definer_function_
--     executable` (`is_admin`, `contar_pendientes`, `aplicar_override`,
--     `aplicar_clasificacion_v2`, `resolver_pendiente`): la app las llama
--     con la SESIÓN del usuario, revocarles EXECUTE la rompería. Su
--     control es la guarda `is_admin()` interna. Tampoco el bucket
--     `producto-imagenes` ni los índices sin usar: van por separado.
--   · NO borra NADA. Los únicos DROP son de tablas TEMPORALES de trabajo
--     (ON COMMIT DROP) y el DROP POLICY + CREATE POLICY de P4, que es un
--     reemplazo en la misma transacción.
--
-- ORDEN DE APLICACIÓN: después de 0011_taxo.sql. Requiere 0008
-- (clasificacion_v2, tecnologias), 0009 (pendientes_datos,
-- resolver_pendiente) y 0011 (tipo 'marca_ambigua' en el CHECK). PG 15.
-- La aplica el operador por MCP; este archivo solo la declara.
--
-- SUPUESTO EXPLÍCITO (patrón P5, docs/engineering/failure-patterns.md): las tablas
-- TEMP viven en UNA sola sesión/transacción, la del BEGIN de abajo.
-- Evidencia: 0008…0011 usan el mismo BEGIN;…COMMIT; y el operador las
-- aplicó por MCP sin partirlas. Si aparece `relation "_b7b_..." does not
-- exist`, NO es un bug del SQL: las sentencias no corrieron en la misma
-- sesión — re-aplicar el archivo COMPLETO (todo es idempotente).
--
-- ------------------------------------------------------------
-- VERIFICACIONES CONTRA LA BD VIVA (PostgREST read-only,
-- service_role; snapshot vigente de stock del momento. Las cifras
-- exactas de la operación se omiten en esta copia. Cada afirmación
-- tiene su SELECT de contraste en el bloque VERIFICACIÓN del final
-- (patrón P2: una cifra sin query es un rumor):
--   · productos del snapshot vigente: casi todas las filas de `productos` (el
--     resto son remanentes de snapshots anteriores, por eso el JOIN
--     con `_b7b_vig` es load-bearing y no decorativo).
--   · clasificacion_v2: TODAS sus filas son de SKUs del snapshot vigente.
--   · pendientes_datos: la mayoría abiertas · marca_ambigua = pocas.
--   · agrupando por TECNOLOGÍA y marca EFECTIVA (= coalesce(marca_v2,
--     marca de la fuente vigente); no hay override de marca — el CHECK
--     `productos_override_campo_check` solo admite familia|descripcion):
--       tec      | SKUs | marcas | marcas c/>=2 SKUs | califica | encola
--       EAS      |  n    |  varias |   varias (>=3)   |    SI    |  varios
--       BRAND2   |  n    |   1    |        1          |    no    |    0
--       BRAND1   |  n    |   1    |        1          |    no    |    0
--       VERTICAL |  n    |   1    |        1          |    no    |    0
--     (el desglose de EAS por marca se omite en esta copia)
--
--   · intersección {a encolar} × {marca_west abiertos} = 0.
--   · intersección {a encolar} × {marca_ambigua de 0011}  = 0.
--   · fuga de identidad: `updated_by` / `editado_por` valen hoy
--     el correo de un administrador en las 3 tablas.
--   · `anon` recibe 200 [] en las 3 tablas (RLS: ninguna policy lo
--     nombra), así que el REVOKE a `authenticated` cierra el hueco
--     completo — no hace falta tocar `anon`.
--
-- POR QUÉ EL UMBRAL ES ">= 3 marcas, cada una con >= 2 SKUs" Y NO "> 1"
-- (medido y perturbado contra la BD real, ratificado): con
-- "> 1", UN SOLO typo en la marca de UN SKU de BRAND1 haría que BRAND1
-- calificara y encolara todos sus SKUs más los restantes. Con el
-- umbral ratificado, EAS califica con el DOBLE del mínimo de marcas e
-- BRAND1/BRAND2/VERTICAL se quedan en 1 (un TERCIO del mínimo): margen
-- simétrico que aguanta 2 filas sucias en cualquiera de los dos sentidos.
--
-- REGLA COMPLEMENTARIA EVALUADA Y **DESCARTADA** (se pidió decidir):
-- "encolar también todo SKU con marca_v2 <> marca_fuente". Medida en su momento
-- contra la BD viva: produce un puñado de SKUs — el par VERTICAL
-- que 0011-P6b YA encoló (01654365/3225, QS1PQRMXDWR13K) y los demás
-- son un SUBCONJUNTO ESTRICTO de los de O3 (Producto Demo I, WZ1053,
-- DD8309-G, KM6696, XS7090, Producto Demo J; todos NACIONAL→EAS).
-- Aporte neto: CERO SKUs nuevos. Y no es inocua: sería un SEGUNDO
-- productor del mismo tipo de pendiente con un payload MÁS POBRE (sin
-- `tecnologia`, sin `candidatas` derivadas de la tecnología), y como
-- `ON CONFLICT DO NOTHING` es sensible al orden, el payload que gane
-- depende de qué INSERT corra primero — un empeoramiento silencioso del
-- dato que ve el humano. Se deja fuera.
--
-- COSTO DECLARADO DE P2 (patrón P5): `pendiente-copy.ts:15-19` documenta
-- que en un 'marca_ambigua' `marca_actual` y `marca_fuente` "SIEMPRE se
-- contradicen". Con O3 eso deja de ser cierto: la mayoría tiene
-- fuente = v2 = 'EAS' (los demás son NACIONAL→EAS), así que
-- `DetallePendiente` (pendiente-fila.tsx:92-105) pintará "v2 EAS vs
-- fuente EAS". No es un fallo: la fila sigue siendo legible y el diálogo
-- —que es donde el humano decide— muestra `pregunta`, que explica el
-- problema real con todas sus letras. Se asume a cambio de no inventar
-- valores falsos en `marca_actual`/`marca_fuente`. Ajustar ese copy es
-- trabajo de UI, NO de esta migración (0012 no toca `src/`).
--
-- CONTRATO CON EL LECTOR DEL PAYLOAD (verificado en el código,
-- al escribir esto): `arregloPayload` (pendiente-copy.ts:44-47) FILTRA por
-- `typeof x === 'string'`, así que `candidatas` DEBE ser un arreglo JSON
-- de STRINGS — un arreglo de objetos se vaciaría en silencio y el
-- diálogo "Elegir marca correcta" quedaría sin opciones (el botón
-- Confirmar nunca se habilita: fail-open, patrón P4). Por eso los
-- conteos viajan aparte, en `candidatas_detalle`. Y `origenDe`
-- (pendiente-acciones.tsx:233-237) compara por igualdad EXACTA de
-- string: `marca_actual`, `marca_fuente` y `candidatas` se escriben con
-- la MISMA normalización (upper+btrim) a propósito, para que la etiqueta
-- de origen no se quede en blanco por una deriva de mayúsculas.
-- Verificado: las marcas del catálogo y los valores distintos de
-- `marca_v2` YA cumplen `nombre = upper(btrim(nombre))`, así que la
-- normalización no cambia ningún valor visible hoy. `upper()` también es
-- lo que espera `resolver_pendiente` (0011-P2), que da de alta la marca
-- elegida en MAYÚSCULAS.
--
-- ============================================================
-- ENMIENDA [REPRODUCIBILIDAD · S7-B] · 2026-08-07
-- Ratificada (docs/decisions/0005-migration-guards-and-replay.md), bloqueante de firma.
-- NO se toca ni una línea del CUERPO: solo DOS guardas, y solo en su rama
-- de universo vacío.
--
-- POR QUÉ. `0001 → 0022` tiene que aplicarse de corrido sobre una base
-- recién creada. Este archivo abortaba ahí por guardas que exigen
-- HISTORIAL, no por su contenido. Se rechazó explícitamente sacarlo
-- del replay: se degrada la GUARDA, nunca el archivo.
--
--   (1) `(0)` exigía snapshot vigente de `stock`. Ahora: NOTICE + bandera
--       local a la transacción (`demo.mig0012_universo_vacio`).
--   (2) `P1a` abortaba cuando la regla de tecnología-categoría no detecta
--       NINGUNA. Ese aborto es correcto y se CONSERVA con datos: un
--       conjunto vacío ahí significa «la regla dejó de medir lo que
--       medía». Pero sobre una base sin productos el conjunto es vacío por
--       AUSENCIA DE FUENTE, no por regla rota, y distinguir esos dos casos
--       es justo lo que la bandera permite. Con universo NO vacío, el
--       `RAISE EXCEPTION` sigue exactamente donde estaba.
--
--   ATENCIÓN AL ORDEN DE LOS DOS ARREGLOS: degradar solo el bloque (0)
--   NO habría bastado. La migración habría seguido abortando en P1a,
--   ~155 líneas más abajo, con un mensaje que acusa a la regla de estar
--   rota cuando lo que falta es la base. Es el mismo error de diagnóstico
--   que la 0011 tenía con su banda [50,80].
--
--   LO QUE ESTA ENMIENDA NO PUEDE COMPROBAR DESDE AQUÍ (P16): que el
--   replay completo termine en verde. Este archivo solo sabe de sí mismo;
--   lo mide la compuerta G-d.
-- ============================================================
BEGIN;


-- ============================================================
-- (0) DERIVACIONES COMPARTIDAS — tablas TEMPORALES de trabajo
-- (ON COMMIT DROP: no sobreviven a la transacción, no tocan el esquema
-- público). Existen para que la definición de "marca efectiva" y la de
-- "tecnología-categoría" se escriban UNA sola vez y la guarda de P1 y el
-- INSERT de P2 consuman EXACTAMENTE la misma definición: sin esto, la
-- guarda protegería a un conjunto distinto del que se escribe (drift).
-- ============================================================

-- Snapshot VIGENTE de stock. Definición idéntica a la de la app
-- (`src/services/vigente.service.ts`) y a la de 0011: fuente='stock'
-- maximizando (created_at, id) — el desempate por id es obligatorio,
-- dos ingestas pueden compartir el mismo tick.
DROP TABLE IF EXISTS pg_temp._b7b_vig;
CREATE TEMP TABLE _b7b_vig ON COMMIT DROP AS
SELECT s.id
  FROM public.snapshots s
 WHERE s.fuente = 'stock'
 ORDER BY s.created_at DESC, s.id DESC
 LIMIT 1;

-- [S7-B] GUARDA DE UNIVERSO, DEGRADADA. La bandera viaja en un GUC LOCAL a
-- la transacción (`is_local := true`): muere con el COMMIT o el ROLLBACK.
--
-- ANTI-VACUIDAD DE ESTA GUARDA (P19): la rama «vacía» la alcanza una base
-- recién creada (0 snapshots de `stock`); la rama «llena», producción. Las
-- dos son alcanzables y las dos imprimen algo distinto.
DO $g0$
DECLARE
    v_vacio boolean;
    v_snaps integer;
BEGIN
    SELECT count(*) INTO v_snaps FROM public.snapshots WHERE fuente = 'stock';
    v_vacio := NOT EXISTS (SELECT 1 FROM _b7b_vig);
    PERFORM set_config('demo.mig0012_universo_vacio', v_vacio::text, true);

    IF v_vacio THEN
        RAISE NOTICE '0012_b7b (0): NO existe snapshot vigente de fuente ''stock'' (snapshots de stock en la base: %). UNIVERSO VACÍO: se continúa y P1a omitirá su guarda anti-silencio, en vez de abortar. Ratificado (docs/decisions/0005-migration-guards-and-replay.md).', v_snaps;
        RAISE NOTICE '0012_b7b (0) · LO QUE NO PUEDE COMPROBAR ESTA GUARDA DESDE AQUÍ (P16): con el universo vacío, la regla O3 no encola NADA y ninguno de sus topes llega a medirse. Esta migración NO puede distinguir «no hay nada que encolar» de «la regla O3 se rompió» — esa distinción es EXACTAMENTE lo que hacía el aborto de P1a, y aquí queda suspendida. El verde de esta corrida significa «no contradicho», no «probado».';
    ELSE
        RAISE NOTICE '0012_b7b (0): universo NO vacío (% snapshot(s) de stock). La guarda anti-silencio de P1a corre completa, como antes de la enmienda S7-B.', v_snaps;
    END IF;

    -- La "marca efectiva" de abajo es coalesce(marca_v2, marca_fuente):
    -- NO consulta `productos_override` porque el CHECK
    -- `productos_override_campo_check` (0001:283-284) solo admite
    -- 'familia' y 'descripcion'. Si alguna migración futura ampliara ese
    -- CHECK, esta definición se volvería silenciosamente incorrecta
    -- (fail-open, patrón P4) — por eso se comprueba en vez de suponerse.
    IF EXISTS (SELECT 1 FROM public.productos_override WHERE campo = 'marca') THEN
        RAISE EXCEPTION '0012_b7b (0): existen overrides con campo=''marca''. La marca efectiva de esta migración es coalesce(marca_v2, fuente) y NO contempla la capa manual: el conjunto derivado sería incorrecto. Abortando.';
    END IF;
END $g0$;

-- BASE: un renglón por SKU del snapshot vigente que YA tiene tecnología
-- asignada en la capa v2. `productos.marca_id` es NOT NULL con FK
-- (0001:146,156-157), así que el JOIN con `marcas` es total: ningún SKU
-- se pierde por él.
DROP TABLE IF EXISTS pg_temp._b7b_base;
CREATE TEMP TABLE _b7b_base ON COMMIT DROP AS
SELECT p.sku,
       p.descr_origen,
       upper(btrim(c.tecnologia))                                      AS tec,
       upper(btrim(m.nombre))                                          AS marca_fuente,
       nullif(upper(btrim(coalesce(c.marca_v2, ''))), '')              AS marca_v2,
       upper(btrim(coalesce(nullif(btrim(c.marca_v2), ''), m.nombre))) AS marca_ef
  FROM public.productos p
  JOIN _b7b_vig v                ON v.id = p.snapshot_id
  JOIN public.marcas m           ON m.id = p.marca_id
  JOIN public.clasificacion_v2 c ON c.sku = p.sku
 WHERE nullif(btrim(c.tecnologia), '') IS NOT NULL;

-- UNIVERSO de marcas por tecnología. Se cuentan las DOS capas por
-- separado y a propósito:
--   · `n_skus`        = SKUs cuya marca EFECTIVA es esa marca. Es el
--                       conteo que decide el umbral (la marca efectiva
--                       es la que ve el usuario en la app).
--   · `n_skus_fuente` = SKUs cuya marca de FUENTE es esa marca. No
--                       decide nada; entra al universo para GARANTIZAR
--                       que la `marca_fuente` de cualquier SKU a encolar
--                       esté SIEMPRE entre las `candidatas` (si no, el
--                       humano no podría elegir la marca que el Excel ya
--                       traía: una opción real ausente del diálogo).
DROP TABLE IF EXISTS pg_temp._b7b_tec_marca;
CREATE TEMP TABLE _b7b_tec_marca ON COMMIT DROP AS
SELECT x.tec,
       x.marca,
       (count(*) FILTER (WHERE x.capa = 'efectiva'))::int AS n_skus,
       (count(*) FILTER (WHERE x.capa = 'fuente'))::int   AS n_skus_fuente
  FROM (
        SELECT b.tec, b.marca_ef     AS marca, 'efectiva'::text AS capa FROM _b7b_base b
        UNION ALL
        SELECT b.tec, b.marca_fuente AS marca, 'fuente'::text   AS capa FROM _b7b_base b
       ) x
 WHERE nullif(btrim(coalesce(x.marca, '')), '') IS NOT NULL
 GROUP BY x.tec, x.marca;

-- TECNOLOGÍAS-CATEGORÍA: las que se reparten entre >= 3 marcas
-- distintas, cada una con >= 2 SKUs (umbral ratificado; ver la
-- cabecera para la perturbación que lo justifica). Una tecnología usada
-- como marca solo es sospechosa cuando es una CATEGORÍA de producto; un
-- sistema PROPIETARIO (BRAND1, BRAND2, VERTICAL: una sola marca) es una
-- marca legítima y no se toca.
DROP TABLE IF EXISTS pg_temp._b7b_categoria;
CREATE TEMP TABLE _b7b_categoria ON COMMIT DROP AS
SELECT tm.tec,
       (count(*))::int                                 AS n_marcas,
       (count(*) FILTER (WHERE tm.n_skus >= 2))::int   AS n_marcas_2plus,
       (sum(tm.n_skus))::int                           AS n_skus_tec
  FROM _b7b_tec_marca tm
 GROUP BY tm.tec
HAVING count(*) FILTER (WHERE tm.n_skus >= 2) >= 3;

-- CANDIDATAS por tecnología-categoría: las marcas REALES observadas bajo
-- esa tecnología, ordenadas por número de SKUs (desc) y desempatadas
-- alfabéticamente para que el orden sea determinista entre corridas.
-- `candidatas` es un arreglo de STRINGS (contrato de `arregloPayload`,
-- ver cabecera); los conteos viajan en `candidatas_detalle`.
DROP TABLE IF EXISTS pg_temp._b7b_candidatas;
CREATE TEMP TABLE _b7b_candidatas ON COMMIT DROP AS
SELECT tm.tec,
       jsonb_agg(tm.marca ORDER BY tm.n_skus DESC, tm.marca)             AS candidatas,
       jsonb_agg(jsonb_build_object('marca', tm.marca,
                                    'n_skus', tm.n_skus,
                                    'n_skus_fuente', tm.n_skus_fuente)
                 ORDER BY tm.n_skus DESC, tm.marca)                      AS candidatas_detalle,
       string_agg(tm.marca || ' ' || tm.n_skus::text, ', '
                  ORDER BY tm.n_skus DESC, tm.marca)                     AS resumen
  FROM _b7b_tec_marca tm
  JOIN _b7b_categoria cat ON cat.tec = tm.tec
 GROUP BY tm.tec;

-- CONJUNTO A ENCOLAR: los SKUs cuya MARCA EFECTIVA es, literalmente, el
-- nombre de una tecnología-categoría. Derivado, sin una sola lista.
DROP TABLE IF EXISTS pg_temp._b7b_encolar;
CREATE TEMP TABLE _b7b_encolar ON COMMIT DROP AS
SELECT b.sku,
       b.descr_origen,
       b.tec,
       b.marca_fuente,
       b.marca_v2,
       b.marca_ef,
       cat.n_marcas,
       cat.n_marcas_2plus,
       cat.n_skus_tec
  FROM _b7b_base b
  JOIN _b7b_categoria cat ON cat.tec = b.tec
 WHERE b.marca_ef = b.tec;


-- ============================================================
-- (P1) GUARDAS DE LA REGLA O3
-- (a) ANTI-SILENCIO sobre el conjunto de tecnologías-categoría.
--     El riesgo NO es que encole de más (eso lo cubre el tope de P2):
--     es que la regla deje de detectar y la migración "aplique" en verde
--     sin encolar nada — fail-open mudo, patrón P4. Un conjunto VACÍO
--     aborta. Un conjunto de MÁS DE 2 también: lo normal es 1, y un salto a 3+
--     significa que la fuente cambió de forma estructural y alguien
--     tiene que RE-MEDIR antes de encolar.
-- (b) ANTI-SILENCIO sobre el CHECK de `pendientes_datos.tipo`. Si 0011
--     se hubiera re-aplicado mal (o un CHECK homónimo/huérfano vetara
--     'marca_ambigua'), el INSERT de P2 sería un no-op silencioso.
--     Se prueba el comportamiento REAL con una sonda de clave RESERVADA
--     que se borra en el mismo bloque — jamás toca un pendiente real
--     (mismo patrón que 0011-P1b).
-- ============================================================
DO $p1a$
DECLARE
    r      record;
    v_n    integer;
    v_tecs text;
    v_vacio boolean;
BEGIN
    -- [S7-B] La bandera la fija el bloque (0). Si no llegó, el archivo no
    -- corrió como una sola transacción: fail-closed.
    --
    -- ANTI-VACUIDAD (P19): se pone ROJA ejecutando este bloque sin el (0)
    -- (aplicación por trozos o en sesiones distintas). El `nullif(...,'')`
    -- cubre el caso del GUC revertido por un ROLLBACK previo en la misma
    -- sesión, que vuelve como cadena vacía y no como NULL (medido en 0020).
    v_vacio := nullif(current_setting('demo.mig0012_universo_vacio', true), '')::boolean;
    IF v_vacio IS NULL THEN
        RAISE EXCEPTION '0012_b7b (P1a): la bandera de universo del bloque (0) no llegó a P1a — el archivo no corrió como una sola transacción. Sin ella no se puede distinguir «regla rota» de «base sin datos». Abortando.';
    END IF;

    -- Evidencia en el log de aplicación: TODAS las tecnologías con sus
    -- cifras vivas, califiquen o no. Sin esto, "aplicó en verde" no
    -- dice nada sobre qué midió la regla.
    FOR r IN
        SELECT tm.tec,
               (sum(tm.n_skus))::int                                AS n_skus,
               (count(*))::int                                      AS n_marcas,
               (count(*) FILTER (WHERE tm.n_skus >= 2))::int        AS n_2plus
          FROM _b7b_tec_marca tm
         GROUP BY tm.tec
         ORDER BY tm.tec
    LOOP
        RAISE NOTICE '0012_b7b (P1a): tecnología % · SKUs % · marcas distintas % · marcas con 2+ SKUs % · califica %',
            r.tec, r.n_skus, r.n_marcas, r.n_2plus,
            CASE WHEN r.n_2plus >= 3 THEN 'SI' ELSE 'no' END;
    END LOOP;

    SELECT count(*), string_agg(cat.tec, ', ' ORDER BY cat.tec)
      INTO v_n, v_tecs
      FROM _b7b_categoria cat;

    -- [S7-B] GUARDA ANTI-SILENCIO — INTACTA con datos, OMITIDA con el
    -- universo vacío. La diferencia no es cosmética: con una fuente viva,
    -- «0 tecnologías-categoría» significa que la regla se rompió y hay que
    -- abortar; sobre una base recién creada significa que no hay fuente, y
    -- abortar ahí sería exigirle historial a una migración.
    IF v_vacio THEN
        RAISE NOTICE '0012_b7b (P1a): universo vacío — se OMITE la guarda anti-silencio (medido ahora: % tecnología(s)-categoría). NO COMPROBADO AQUÍ: que la regla O3 siga detectando; sin fuente no hay nada que detectar, y este 0 no la acusa ni la absuelve.', v_n;
    ELSIF v_n = 0 THEN
        RAISE EXCEPTION '0012_b7b (P1a): la regla de tecnología-categoría (>= 3 marcas distintas, cada una con >= 2 SKUs) NO detecta NINGUNA tecnología; verificada 1 (EAS). Un conjunto vacío significa que la regla dejó de medir lo que medía: la migración aplicaría en verde sin encolar nada (fail-open mudo). Abortando.';
    END IF;

    IF v_n > 2 THEN
        RAISE EXCEPTION '0012_b7b (P1a): la regla detecta % tecnologías-categoría (%), verificada 1 y tope 2. La fuente cambió de forma estructural: re-medir antes de encolar. Abortando.', v_n, v_tecs;
    END IF;

    IF v_n <> 1 OR v_tecs IS DISTINCT FROM 'EAS' THEN
        RAISE NOTICE '0012_b7b (P1a): tecnologías-categoría detectadas = % (%) — verificado el 2026-07-28: 1 (EAS).', v_n, coalesce(v_tecs, '(ninguna)');
    END IF;
END $p1a$;

DO $p1b$
DECLARE
    v_clave  text := '__probe_0012_b7b__';
    v_acepta boolean := false;
    v_def    text;
    v_otros  integer;
BEGIN
    -- Limpieza previa: solo puede haber residuo de una corrida abortada
    -- de ESTA misma guarda (la clave es reservada y no la usa nadie más).
    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    BEGIN
        INSERT INTO public.pendientes_datos (tipo, clave_natural, detectado_por)
        VALUES ('marca_ambigua', v_clave, '0012_b7b');
        v_acepta := true;
    EXCEPTION WHEN check_violation THEN
        v_acepta := false;
    END;

    DELETE FROM public.pendientes_datos WHERE clave_natural = v_clave;

    IF NOT v_acepta THEN
        RAISE EXCEPTION '0012_b7b (P1b): el CHECK vigente sobre pendientes_datos.tipo RECHAZA ''marca_ambigua''. 0011_taxo no quedó aplicada (o hay otro CHECK vetándolo en silencio): el encolado de P2 sería un no-op mudo. Abortando.';
    END IF;

    SELECT pg_get_constraintdef(oid) INTO v_def
      FROM pg_constraint
     WHERE conrelid = 'public.pendientes_datos'::regclass
       AND conname  = 'pendientes_datos_tipo_check';

    IF v_def IS NULL OR v_def NOT LIKE '%marca_ambigua%' THEN
        RAISE EXCEPTION '0012_b7b (P1b): pendientes_datos_tipo_check no contiene ''marca_ambigua'' (def=%). Abortando.', coalesce(v_def, '(inexistente)');
    END IF;

    SELECT count(*) INTO v_otros
      FROM pg_constraint
     WHERE conrelid = 'public.pendientes_datos'::regclass
       AND contype  = 'c'
       AND conname <> 'pendientes_datos_tipo_check'
       AND pg_get_constraintdef(oid) LIKE '%tipo%';

    IF v_otros > 0 THEN
        RAISE EXCEPTION '0012_b7b (P1b): existen % CHECK adicional(es) sobre `tipo` distintos de pendientes_datos_tipo_check. Abortando.', v_otros;
    END IF;

    -- La convención de clave de 0011-P6b (clave_natural = sku) es la que
    -- usa P2. `pendientes_datos_uniq UNIQUE (tipo, clave_natural)`
    -- (0009:28) es lo que hace idempotente el ON CONFLICT: sin ese índice
    -- una re-aplicación duplicaría los encolados.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.pendientes_datos'::regclass
           AND conname  = 'pendientes_datos_uniq'
           AND contype  = 'u'
    ) THEN
        RAISE EXCEPTION '0012_b7b (P1b): falta la constraint UNIQUE pendientes_datos_uniq (tipo, clave_natural) — el ON CONFLICT de P2 no sería idempotente y una re-aplicación duplicaría los pendientes. Abortando.';
    END IF;
END $p1b$;


-- ============================================================
-- (P2) ENCOLADO DE LAS MARCAS QUE SON CATEGORÍAS
--
-- Qué se encola: los SKUs cuya MARCA EFECTIVA coincide literalmente con
-- el nombre de una tecnología-categoría. Hoy: los de "EAS". No es una
-- contradicción entre capas (la mayoría tiene fuente = v2 = 'EAS'):
-- es que el valor guardado como marca NO NOMBRA A UN FABRICANTE, y por
-- eso la regla de 0011 —que solo mira `marca_v2 <> marca_fuente`— no los
-- veía. Ese hueco es justo lo que O3 cierra.
--
-- TOPE DE RADIO DE IMPACTO: se aborta si el conjunto derivado excede 40,
-- y se vuelve a comprobar sobre el ROW_COUNT REAL del INSERT (una cosa
-- es lo que la regla derivó y otra lo que la tabla aceptó). 40 = algo
-- más del doble de los verificados: absorbe una ingesta mensual
-- normal y frena un cambio estructural. Encolar de más aquí no es un
-- error visible: es una bandeja inundada de preguntas falsas que nadie
-- puede procesar, y con `UNIQUE (tipo, clave_natural)` cada fila basura
-- BLOQUEA la pregunta legítima que pudiera venir después para ese SKU.
--
-- AVISO DE COLISIÓN CON `marca_west`: `UNIQUE (tipo, clave_natural)` es
-- POR TIPO, así que un mismo SKU puede acabar con DOS preguntas abiertas
-- distintas sobre su marca (una 'marca_west' y una 'marca_ambigua') y
-- resolverlas en distinto sentido. La intersección verificada es vacía,
-- pero hay pares vecinos que lo hacen plausible: 'HV3602' (marca_west
-- abierto) vs 'DD8309-G' (a encolar), y 'Producto Demo F' (marca_west
-- abierto) vs 'Producto Demo K' (a encolar). Por eso se AVISA con NOTICE
-- en vez de abortar: no es un error, es un aviso al humano de que ese
-- SKU necesita una sola decisión, no dos.
--
-- ON CONFLICT (tipo, clave_natural) DO NOTHING: re-aplicar no duplica ni
-- pisa un pendiente que un admin ya haya resuelto o descartado.
-- ============================================================
DO $p2$
DECLARE
    v_derivados integer;
    v_escritos  integer;
    v_ninter    integer;
    v_inter     text;
    v_ya        integer;
BEGIN
    SELECT count(*) INTO v_derivados FROM _b7b_encolar;

    IF v_derivados > 40 THEN
        RAISE EXCEPTION '0012_b7b (P2): la regla produce % SKUs a encolar, tope 40 (verificados 18). Abortando toda la migración antes de tocar la bandeja.', v_derivados;
    END IF;

    IF v_derivados <> 18 THEN
        RAISE NOTICE '0012_b7b (P2): SKUs derivados a encolar = % (verificado el 2026-07-28: 18).', v_derivados;
    END IF;

    -- Aviso (no aborto) por doble pregunta sobre la marca del mismo SKU.
    SELECT count(*), string_agg(e.sku, ', ' ORDER BY e.sku)
      INTO v_ninter, v_inter
      FROM _b7b_encolar e
      JOIN public.pendientes_datos pd
        ON pd.tipo = 'marca_west'
       AND pd.estado = 'abierto'
       AND pd.clave_natural = e.sku;

    IF v_ninter > 0 THEN
        RAISE NOTICE '0012_b7b (P2): % SKU(s) quedarán con DOS pendientes abiertos sobre su marca (marca_west + marca_ambigua): %. UNIQUE(tipo, clave_natural) es por tipo y no lo impide — revisar a mano para no resolverlos en sentidos opuestos. (Verificado el 2026-07-28: 0.)',
            v_ninter, v_inter;
    END IF;

    -- Cuántos de los derivados YA tenían un 'marca_ambigua' (de 0011 o de
    -- una corrida previa de 0012): esos caen en el DO NOTHING.
    SELECT count(*) INTO v_ya
      FROM _b7b_encolar e
      JOIN public.pendientes_datos pd
        ON pd.tipo = 'marca_ambigua' AND pd.clave_natural = e.sku;

    INSERT INTO public.pendientes_datos
        (tipo, clave_natural, estado, detectado_por, snapshot_id, payload)
    SELECT 'marca_ambigua',
           e.sku,
           'abierto',
           '0012_b7b',
           (SELECT id FROM _b7b_vig),
           jsonb_build_object(
             'sku',                        e.sku,
             'campo',                      'marca',
             'marca_actual',               e.marca_ef,
             'marca_fuente',               e.marca_fuente,
             'marca_v2',                   e.marca_v2,
             'tecnologia',                 e.tec,
             'candidatas',                 cd.candidatas,
             'candidatas_detalle',         cd.candidatas_detalle,
             'n_marcas_de_la_tecnologia',  e.n_marcas,
             'n_marcas_con_2_o_mas_skus',  e.n_marcas_2plus,
             'n_skus_de_la_tecnologia',    e.n_skus_tec,
             'descr_origen',               e.descr_origen,
             'generacion',                 'b7b',
             'regla',                      'tecnologia_categoria',
             'umbral',                     'Una tecnología se considera CATEGORÍA (y no marca propietaria) cuando se reparte entre 3 o más marcas distintas, cada una con 2 o más SKUs.',
             'evidencia',
               'La marca efectiva de este SKU es «' || e.marca_ef ||
               '», que es el nombre de su TECNOLOGÍA y no el de un fabricante. En el snapshot vigente la tecnología ' || e.tec ||
               ' agrupa ' || e.n_skus_tec::text || ' SKUs repartidos en ' || e.n_marcas::text ||
               ' marcas distintas, ' || e.n_marcas_2plus::text ||
               ' de ellas con 2 o más SKUs, así que ' || e.tec ||
               ' se comporta como una CATEGORÍA de producto y no como un sistema propietario de una sola marca (BRAND1, BRAND2 y VERTICAL tienen 1 sola marca cada una y por eso NO se encolan). Marcas reales observadas bajo esta tecnología, por número de SKUs: ' ||
               cd.resumen ||
               '. La marca de este SKU en la capa fuente es ' || e.marca_fuente ||
               '. Detectado por la migración 0012_b7b_hardening [INV-B7B/O3]; umbral ratificado por el PO.',
             'pregunta',
               '¿Cuál es la MARCA (el fabricante) de este SKU? Hoy su marca dice «' || e.marca_ef ||
               '», que es el nombre de su TECNOLOGÍA: en el catálogo vigente esa tecnología se reparte entre ' ||
               e.n_marcas::text || ' marcas distintas, así que es una CATEGORÍA de producto y no identifica a ningún fabricante. Elige la marca real entre las candidatas (van ordenadas por cuántos SKUs tiene cada una dentro de esta misma tecnología). Si de verdad el fabricante se llama así, confírmala tal cual. Al confirmar, el valor elegido se da de alta en `marcas` (si falta) y se escribe en clasificacion_v2.marca_v2.')
      FROM _b7b_encolar e
      JOIN _b7b_candidatas cd ON cd.tec = e.tec
    ON CONFLICT (tipo, clave_natural) DO NOTHING;

    GET DIAGNOSTICS v_escritos = ROW_COUNT;

    -- El tope, otra vez, sobre lo REALMENTE escrito.
    IF v_escritos > 40 THEN
        RAISE EXCEPTION '0012_b7b (P2): el INSERT encoló % pendientes, tope 40 (verificados 18). Abortando toda la migración.', v_escritos;
    END IF;

    RAISE NOTICE '0012_b7b (P2): derivados=% · ya existentes (DO NOTHING)=% · encolados en esta corrida=% (0 = ya estaban encolados).',
        v_derivados, v_ya, v_escritos;
END $p2$;


-- ============================================================
-- (P3) O5 / TAXO-10 — CIERRE DE LA FUGA DE IDENTIDAD
--
-- EL PROBLEMA (verificado): `clasificacion_v2.updated_by`,
-- `productos_override.editado_por` y `productos_metadata.updated_by`
-- guardan el CORREO de quien tocó la fila, y las 3 tablas tienen policy
-- de SELECT `USING (true) TO authenticated`: cualquier usuario con
-- sesión —un `kam`, un `visitante`— puede pedir esas columnas por
-- PostgREST y leer ese correo. La bandeja SÍ está protegida
-- (`pendientes_datos` exige `is_admin()` y devuelve 200 []); estas tres
-- no.
--
-- EL MECANISMO (ratificado): REVOKE de columna para el rol
-- `authenticated`. Se eligió porque el costo en la app es CERO —
-- verificado con grep:
--   · clasificacion_v2 — 5 rutas de lectura, todas piden la MISMA lista
--     cerrada: `sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2`
--     (cruce.service.ts:202, dashboard.service.ts:655,
--     embarques.service.ts:354, inventory.service.ts:373) y
--     `+,fuente_version` en sku.service.ts:354. Ninguna pide updated_by.
--   · productos_override — 5 lecturas, todas
--     `id,sku,campo,valor_editado,editado_en,activo` (cruce:252,
--     dashboard:650, embarques:346, inventory:358, sku:385). Ninguna
--     pide editado_por, y la ficha NO muestra "editado por".
--   · productos_metadata — 2 lecturas: `sku,color,imagen_url`
--     (inventory:364) e `imagen_url,color` (sku:388).
--   · SÍ existe un `select('*')` en `src/`: `persist.ts:169`
--     (`.select('*, estatus_catalogo(nombre)')` sobre `embarques`, en
--     `loadPrevState`, ETL). Inocuo para ESTE REVOKE por partida doble:
--     corre con `service_role` (P3 solo toca `authenticated`) y
--     `embarques` no es ninguna de las 3 tablas que P3 toca — no tiene
--     columna de autoría revocada que este `select('*')` pudiera
--     exponer. (Esta línea decía "NO existe ni un solo select('*')…
--     0 resultados"; era falso — el grep sí lo trae. Corregido,
--     verificado contra `src/`.)
--   · Los ÚNICOS escritores de esas columnas desde una SESIÓN de usuario
--     son los upserts de `productos_metadata` en color.service.ts:32-35
--     e imagenes.service.ts:65-68. El resto de escrituras
--     (aplicar_override, aplicar_clasificacion_v2, resolver_pendiente)
--     son SECURITY DEFINER: corren como el dueño y no ven este REVOKE.
--     ESOS DOS SÍ SE ROMPIERON (reproducido en la base — la frase de
--     abajo era falsa, corregida): "escribir NO requiere
--     SELECT: INSERT/UPDATE son privilegios distintos, y supabase-js v2
--     no pide representación si no se encadena `.select()`. La guarda
--     de abajo lo COMPRUEBA en vez de suponerlo." Falso — y "la guarda
--     lo COMPRUEBA" era ELLA MISMA la suposición: la guarda (P3, más
--     abajo) comprueba la MATRIZ DE PRIVILEGIOS (los GRANT/REVOKE
--     resultantes), y ninguna guarda escrita en SQL puede probar qué
--     SQL genera PostgREST — eso exige una petición HTTP real con
--     sesión. Lo real: PostgREST arma TODO upsert con `RETURNING *`, se
--     encadene `.select()` o no — el `*` lo genera PostgREST, no
--     supabase-js. Reproducido con `SET LOCAL ROLE authenticated`:
--       SELECT * FROM productos_metadata LIMIT 1;            → 42501
--       SELECT sku,color,imagen_url,updated_at FROM …        → OK
--       UPDATE … RETURNING *                                 → 42501
--       UPDATE … RETURNING sku, color                        → OK
--     El error dice "permission denied for table" (nunca nombra la
--     columna: el `*` se expande y el chequeo cae en la tabla), por eso
--     el log no dejaba identificar la causa. Consecuencia real: `PUT
--     /api/color` y `POST /api/imagenes` SÍ fallaban. ARREGLO REAL: las
--     escrituras de color/imagen se mueven a una RPC SECURITY DEFINER
--     (frente A de [MVP-2]), igual que aplicar_override /
--     aplicar_clasificacion_v2 / resolver_pendiente arriba — no ven
--     este REVOKE porque corren como el dueño, no como `authenticated`.
--
-- POR QUÉ NO BASTA UN `REVOKE SELECT (col)`: en PostgreSQL, revocar un
-- privilegio de COLUMNA cuando el rol lo tiene a nivel TABLA es un NO-OP
-- (solo emite un WARNING "no privileges could be revoked"). `authenticated`
-- tiene SELECT de tabla por los default privileges de Supabase, así que
-- el único patrón que funciona es: REVOKE del privilegio de TABLA y
-- GRANT de columna sobre TODAS las demás columnas. Escribirlo al revés
-- habría "aplicado" en verde sin cerrar nada: fail-open, patrón P4.
--
-- LA LISTA DE COLUMNAS SE DERIVA de `pg_attribute`, no se escribe a mano.
-- CONSECUENCIA DECLARADA (patrón P5): una columna AÑADIDA A FUTURO a
-- cualquiera de estas 3 tablas NO quedará legible por `authenticated`
-- hasta que se vuelva a correr este bloque (o se le dé su GRANT). Eso es
-- fail-CLOSED y es la mitad barata del trato: falla con un 42501
-- ruidoso, no con datos filtrados en silencio. Queda escrito aquí para
-- que el siguiente bloque no lo descubra a la mala.
--
-- COMPORTAMIENTO ESPERADO TRAS APLICAR: un `select=*` de PostgREST con
-- rol `authenticated` devolverá **42501 permission denied** (403). Eso
-- NO es un fallo: es exactamente el resultado buscado — la petición que
-- pedía leerlo todo se entera de que ya no puede, en vez de recibir la
-- columna en silencio. Las 12 lecturas reales de la app piden columnas
-- explícitas y siguen en 200.
--
-- ÁMBITO: solo `authenticated`. `service_role` y `postgres` conservan
-- TODO (el ETL y los route handlers con service-role deben seguir
-- leyendo todo) — hay guarda que lo comprueba. `anon` no necesita
-- tocarse: ninguna policy de estas 3 tablas lo nombra, así que RLS ya le
-- devuelve 200 [] (verificado).
--
-- REVERSIÓN (una sentencia por tabla, sin más):
--     GRANT SELECT ON TABLE public.clasificacion_v2   TO authenticated;
--     GRANT SELECT ON TABLE public.productos_override TO authenticated;
--     GRANT SELECT ON TABLE public.productos_metadata TO authenticated;
-- El GRANT de TABLA vuelve a cubrir TODAS las columnas de golpe; los
-- GRANT de columna que deja esta migración quedan como redundancia
-- inofensiva (si se quisieran limpiar:
--     REVOKE SELECT (<columnas>) ON TABLE public.<tabla> FROM authenticated;
-- después del GRANT de tabla).
--
-- ESTO NO ES EL ARREGLO de `PUT /api/color` / `POST /api/imagenes` (ver
-- el bullet de arriba): se evaluó usar esta REVERSIÓN como parche
-- —devolverle a `authenticated` el SELECT de tabla completo para que el
-- `RETURNING *` del upsert deje de chocar— y SE DESCARTÓ: reabre
-- exactamente la fuga de O5/TAXO-10 que P3 existe para cerrar. El
-- arreglo real mueve esas dos escrituras a una RPC SECURITY DEFINER
-- (frente A de [MVP-2]); esta REVERSIÓN queda documentada solo para
-- deshacer P3 por completo, si algún día hiciera falta.
-- ============================================================
DO $p3$
DECLARE
    r        record;
    v_cols   text;
    v_faltan integer;
    v_n      integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        RAISE EXCEPTION '0012_b7b (P3): no existe el rol `authenticated`. Este no es un proyecto Supabase estándar: el REVOKE no aplicaría a nadie. Abortando.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        RAISE EXCEPTION '0012_b7b (P3): no existe el rol `service_role`. Sin él no se puede comprobar que el ETL conserva la lectura. Abortando.';
    END IF;

    FOR r IN
        SELECT * FROM (VALUES
            ('clasificacion_v2',   'updated_by'),
            ('productos_override', 'editado_por'),
            ('productos_metadata', 'updated_by')
        ) AS t(tabla, col)
    LOOP
        -- (1) La tabla y la columna sensible deben existir: si alguien
        -- renombró la columna, el REVOKE de abajo protegería a un
        -- fantasma y la fuga seguiría abierta en silencio.
        IF to_regclass('public.' || quote_ident(r.tabla)) IS NULL THEN
            RAISE EXCEPTION '0012_b7b (P3): la tabla public.% no existe. Abortando.', r.tabla;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = ('public.' || quote_ident(r.tabla))::regclass
               AND a.attname::text = r.col
               AND a.attnum > 0
               AND NOT a.attisdropped
        ) THEN
            RAISE EXCEPTION '0012_b7b (P3): la columna de autoría %.% no existe (¿renombrada?). El REVOKE protegería a un fantasma y la fuga seguiría abierta. Abortando.', r.tabla, r.col;
        END IF;

        -- (2) Lista DERIVADA de todas las demás columnas.
        SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
          INTO v_cols
          FROM pg_attribute a
         WHERE a.attrelid = ('public.' || quote_ident(r.tabla))::regclass
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND a.attname::text <> r.col;

        IF v_cols IS NULL OR btrim(v_cols) = '' THEN
            RAISE EXCEPTION '0012_b7b (P3): no se pudo derivar ninguna columna legible de public.% (aparte de %). Un GRANT vacío dejaría la tabla ILEGIBLE para toda la app. Abortando.', r.tabla, r.col;
        END IF;

        -- (3) REVOKE de TABLA + GRANT de COLUMNA. Ambos idempotentes.
        EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM authenticated', r.tabla);
        EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO authenticated', v_cols, r.tabla);

        -- (4) GUARDA DEL EFECTO REAL — se comprueba el privilegio
        -- resultante, no la sentencia emitida (patrón P4: una sentencia
        -- que "corrió" no es una fuga cerrada).
        IF has_column_privilege('authenticated'::name,
                                ('public.' || quote_ident(r.tabla))::text,
                                r.col::text, 'SELECT'::text) THEN
            RAISE EXCEPTION '0012_b7b (P3): tras el REVOKE, el rol authenticated SIGUE pudiendo leer %.%. La fuga NO se cerró. Abortando.', r.tabla, r.col;
        END IF;

        -- (5) …y que NO se llevó por delante ninguna otra columna.
        SELECT count(*) INTO v_faltan
          FROM pg_attribute a
         WHERE a.attrelid = ('public.' || quote_ident(r.tabla))::regclass
           AND a.attnum > 0
           AND NOT a.attisdropped
           AND a.attname::text <> r.col
           AND NOT has_column_privilege('authenticated'::name,
                                        ('public.' || quote_ident(r.tabla))::text,
                                        a.attname::text, 'SELECT'::text);

        IF v_faltan > 0 THEN
            RAISE EXCEPTION '0012_b7b (P3): tras el GRANT quedan % columna(s) de public.% ILEGIBLES para authenticated (además de la de autoría). Las lecturas de la app romperían con 42501. Abortando.', v_faltan, r.tabla;
        END IF;

        -- (6) service_role y postgres NO se tocan: el ETL y los route
        -- handlers con service-role deben seguir leyendo TODO.
        IF NOT has_column_privilege('service_role'::name,
                                    ('public.' || quote_ident(r.tabla))::text,
                                    r.col::text, 'SELECT'::text) THEN
            RAISE EXCEPTION '0012_b7b (P3): service_role perdió la lectura de %.%. El ETL y los handlers con service-role dejarían de ver la trazabilidad. Abortando.', r.tabla, r.col;
        END IF;

        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
           AND NOT has_column_privilege('postgres'::name,
                                        ('public.' || quote_ident(r.tabla))::text,
                                        r.col::text, 'SELECT'::text) THEN
            RAISE EXCEPTION '0012_b7b (P3): el rol postgres perdió la lectura de %.%. Abortando.', r.tabla, r.col;
        END IF;

        RAISE NOTICE '0012_b7b (P3): public.% · authenticated ya NO lee % · conserva SELECT sobre: %', r.tabla, r.col, v_cols;
    END LOOP;

    -- (7) GUARDA DEL CAMINO DE ESCRITURA (la única que corre con la
    -- SESIÓN del usuario): `setColor` (color.service.ts:32-35) y
    -- `subirImagen` (imagenes.service.ts:65-68) hacen upsert de
    -- productos_metadata con `updated_by` usando el cliente de sesión del
    -- admin, NO service_role. Revocarles INSERT/UPDATE rompería el color
    -- y la subida de imágenes. El REVOKE de arriba es solo de SELECT,
    -- pero eso se COMPRUEBA, no se supone.
    IF NOT has_column_privilege('authenticated'::name, 'public.productos_metadata'::text,
                                'updated_by'::text, 'INSERT'::text) THEN
        RAISE EXCEPTION '0012_b7b (P3): authenticated perdió INSERT sobre productos_metadata.updated_by — el upsert de color/imagen corre con la SESIÓN del admin y dejaría de funcionar. Abortando.';
    END IF;
    IF NOT has_column_privilege('authenticated'::name, 'public.productos_metadata'::text,
                                'updated_by'::text, 'UPDATE'::text) THEN
        RAISE EXCEPTION '0012_b7b (P3): authenticated perdió UPDATE sobre productos_metadata.updated_by — el upsert de color/imagen (ON CONFLICT DO UPDATE) dejaría de funcionar. Abortando.';
    END IF;

    -- (8) GUARDA DE SUPERFICIE: si alguien expusiera una VISTA sobre
    -- estas tablas, el REVOKE de columna no la cubriría (una vista
    -- SECURITY INVOKER sí, pero una normal corre con los permisos de su
    -- dueño y volvería a filtrar la columna). Hoy el esquema `public` no
    -- tiene NINGUNA vista (verificado contra el OpenAPI de
    -- PostgREST: todas las rutas eran tablas base).
    SELECT count(*) INTO v_n
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('v', 'm');

    IF v_n > 0 THEN
        RAISE NOTICE '0012_b7b (P3): el esquema public tiene % vista(s)/vista(s) materializada(s) — verificado el 2026-07-28: 0. Si alguna selecciona updated_by/editado_por, el REVOKE de columna NO la cubre: revisar a mano.', v_n;
    END IF;
END $p3$;

COMMENT ON COLUMN public.clasificacion_v2.updated_by IS
    'Correo (o uid) del último actor que escribió esta fila. DATO DE AUDITORÍA: '
    'ILEGIBLE para el rol `authenticated` desde 0012_b7b_hardening (REVOKE de '
    'columna). Un select=* devuelve 42501 a propósito. Solo service_role, '
    'postgres y las funciones SECURITY DEFINER la ven. Revertir: '
    'GRANT SELECT ON TABLE public.clasificacion_v2 TO authenticated;';

COMMENT ON COLUMN public.productos_override.editado_por IS
    'Correo (o uid) del admin que hizo el override. DATO DE AUDITORÍA: ILEGIBLE '
    'para el rol `authenticated` desde 0012_b7b_hardening (REVOKE de columna). '
    'Un select=* devuelve 42501 a propósito. La ficha NO muestra "editado por": '
    'las 5 lecturas de la app piden id,sku,campo,valor_editado,editado_en,activo. '
    'Revertir: GRANT SELECT ON TABLE public.productos_override TO authenticated;';

COMMENT ON COLUMN public.productos_metadata.updated_by IS
    'Correo (o uid) del admin que subió la imagen o fijó el color. DATO DE '
    'AUDITORÍA: ILEGIBLE para el rol `authenticated` desde 0012_b7b_hardening '
    '(REVOKE de SELECT de columna). ESCRIBIRLA SÍ se puede: los upserts de '
    'color.service.ts e imagenes.service.ts corren con la SESIÓN del admin y '
    'conservan INSERT/UPDATE. Revertir: '
    'GRANT SELECT ON TABLE public.productos_metadata TO authenticated;';


-- ============================================================
-- (P4) ADVISOR DE RENDIMIENTO — auth_rls_initplan en `perfiles`
--
-- El advisor de Supabase marca `perfiles_select_own_or_admin` porque
-- `auth.uid()` se re-evalúa POR FILA. La corrección es envolverla en un
-- subquery escalar para que el planner la resuelva UNA vez (InitPlan).
--
-- POR QUÉ NO CAMBIA LA SEMÁNTICA (verificado antes de escribirla):
--   · `auth.uid()` está declarada STABLE, no recibe argumentos y NO
--     referencia ninguna columna de `perfiles`: su valor es constante
--     durante toda la sentencia. `(SELECT auth.uid())` es un subquery
--     escalar SIN correlación, así que devuelve exactamente lo mismo;
--     solo cambia DÓNDE se evalúa, no QUÉ devuelve.
--   · El resto de la expresión queda IDÉNTICO: mismo `OR`, mismos dos
--     términos, mismo `FOR SELECT TO authenticated`. No se amplía ni se
--     restringe a nadie.
--   · ÚNICO efecto observable: `public.is_admin()` puede ejecutarse en
--     casos donde antes el `OR` cortocircuitaba. Es STABLE, SECURITY
--     DEFINER y sin efectos secundarios (solo un EXISTS sobre
--     `perfiles`), así que el conjunto de filas devuelto es el mismo.
--   · `public.is_admin()` NO se envuelve, a propósito: no es lo que
--     marca el advisor (el lint detecta `auth.<fn>()` / `current_setting`),
--     dejarla fuera conserva el orden de cortocircuito actual y
--     `perfiles` tiene muy pocas filas — la ganancia sería nula y el cambio,
--     gratuito en riesgo pero no en revisión.
--
-- DROP + CREATE es seguro dentro de esta transacción: si el CREATE
-- fallara, el ROLLBACK devuelve la policy vieja. Y la guarda de abajo
-- comprueba que la expresión resultante conserva los DOS términos y
-- sigue aplicando SOLO a `authenticated` — el modo de fallo que importa
-- aquí no es "quedó lenta", es "quedó permisiva".
-- ============================================================
DROP POLICY IF EXISTS perfiles_select_own_or_admin ON public.perfiles;
CREATE POLICY perfiles_select_own_or_admin
    ON public.perfiles
    FOR SELECT
    TO authenticated
    USING (id = (SELECT auth.uid()) OR public.is_admin());

DO $p4$
DECLARE
    v_qual  text;
    v_roles text;
    v_n     integer;
BEGIN
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.perfiles'::regclass) THEN
        RAISE EXCEPTION '0012_b7b (P4): RLS quedó DESACTIVADA en public.perfiles — las policies no se aplicarían y la tabla sería legible por cualquiera. Abortando.';
    END IF;

    -- `unnest(...) AS t(oid_rol)` con nombre de columna EXPLÍCITO: sin él,
    -- `pg_get_userbyid(u)` dependería de la regla de precedencia entre
    -- alias de tabla y alias de columna homónimos.
    SELECT pg_get_expr(pol.polqual, pol.polrelid),
           (SELECT string_agg(pg_get_userbyid(t.oid_rol), ',' ORDER BY pg_get_userbyid(t.oid_rol))
              FROM unnest(pol.polroles) AS t(oid_rol))
      INTO v_qual, v_roles
      FROM pg_policy pol
     WHERE pol.polrelid = 'public.perfiles'::regclass
       AND pol.polname  = 'perfiles_select_own_or_admin';

    IF v_qual IS NULL THEN
        RAISE EXCEPTION '0012_b7b (P4): la policy perfiles_select_own_or_admin no existe justo después del CREATE POLICY. Abortando.';
    END IF;

    IF v_qual NOT LIKE '%auth.uid()%' OR v_qual NOT LIKE '%is_admin()%' THEN
        RAISE EXCEPTION '0012_b7b (P4): la expresión de la policy quedó como (%) y perdió uno de los dos términos (auth.uid() / is_admin()). Abortando.', v_qual;
    END IF;

    IF v_roles IS DISTINCT FROM 'authenticated' THEN
        RAISE EXCEPTION '0012_b7b (P4): la policy quedó aplicada a los roles (%) en vez de solo `authenticated`. Abortando.', coalesce(v_roles, '(ninguno / PUBLIC)');
    END IF;

    SELECT count(*) INTO v_n
      FROM pg_policy pol
     WHERE pol.polrelid = 'public.perfiles'::regclass
       AND pol.polcmd IN ('r', '*');

    IF v_n <> 1 THEN
        RAISE EXCEPTION '0012_b7b (P4): hay % policy(s) que conceden SELECT sobre public.perfiles, esperada exactamente 1. Una policy extra ampliaría el acceso en silencio. Abortando.', v_n;
    END IF;

    RAISE NOTICE '0012_b7b (P4): policy perfiles_select_own_or_admin = %', v_qual;
END $p4$;

COMMIT;


-- ============================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- Para el operador: SELECTs numerados, FUERA de la transacción de arriba
-- (NO se ejecutan como parte de este archivo). Cada uno trae su
-- resultado esperado, contrastado contra la BD viva.
-- ============================================================
--
-- -- (1) P1 · La regla, re-derivada desde cero (misma definición que la
-- --     migración). Es la evidencia de que el conjunto no se movió:
-- WITH vig AS (
--   SELECT id FROM public.snapshots WHERE fuente = 'stock'
--    ORDER BY created_at DESC, id DESC LIMIT 1),
-- base AS (
--   SELECT p.sku,
--          upper(btrim(c.tecnologia)) AS tec,
--          upper(btrim(m.nombre))     AS marca_fuente,
--          upper(btrim(coalesce(nullif(btrim(c.marca_v2), ''), m.nombre))) AS marca_ef
--     FROM public.productos p
--     JOIN vig v ON v.id = p.snapshot_id
--     JOIN public.marcas m ON m.id = p.marca_id
--     JOIN public.clasificacion_v2 c ON c.sku = p.sku
--    WHERE nullif(btrim(c.tecnologia), '') IS NOT NULL),
-- tm AS (
--   SELECT x.tec, x.marca, (count(*) FILTER (WHERE x.capa = 'efectiva'))::int AS n_skus
--     FROM (SELECT tec, marca_ef     AS marca, 'efectiva'::text AS capa FROM base
--           UNION ALL
--           SELECT tec, marca_fuente AS marca, 'fuente'::text   AS capa FROM base) x
--    GROUP BY x.tec, x.marca)
-- SELECT tm.tec,
--        sum(tm.n_skus)                                AS skus,
--        count(*)                                      AS marcas,
--        count(*) FILTER (WHERE tm.n_skus >= 2)        AS marcas_2plus,
--        count(*) FILTER (WHERE tm.n_skus >= 2) >= 3   AS califica
--   FROM tm GROUP BY tm.tec ORDER BY tm.tec;
-- -- esperado: EAS n | varias | >=3 | t   ·   BRAND2 n | 1 | 1 | f
-- --           BRAND1 n | 1 | 1 | f ·   VERTICAL n | 1 | 1 | f
--
-- -- (2) P2 · Encolado: los nuevos de 0012 + los de 0011:
-- SELECT detectado_por, estado, count(*) FROM public.pendientes_datos
--  WHERE tipo = 'marca_ambigua' GROUP BY 1,2 ORDER BY 1,2;
-- -- esperado: 0011_taxo|abierto n   ·   0012_b7b|abierto n
--
-- -- (3) P2 · Los encolados, con su tecnología y su marca de fuente:
-- SELECT clave_natural,
--        payload ->> 'tecnologia'   AS tec,
--        payload ->> 'marca_actual' AS v2,
--        payload ->> 'marca_fuente' AS fuente,
--        jsonb_array_length(payload -> 'candidatas') AS n_candidatas
--   FROM public.pendientes_datos
--  WHERE tipo = 'marca_ambigua' AND detectado_por = '0012_b7b'
--  ORDER BY clave_natural;
-- -- esperado: TODAS con tec='EAS', v2='EAS' y el mismo n_candidatas.
-- -- la mayoría con fuente='EAS' y algunas con fuente='NACIONAL' (Producto Demo I, WZ1053,
-- -- DD8309-G, KM6696, XS7090, Producto Demo J).
--
-- -- (3b) P2 · `candidatas` es un arreglo de STRINGS (contrato de
-- --      `arregloPayload`; con objetos el diálogo quedaría sin opciones):
-- SELECT count(*) FILTER (WHERE jsonb_typeof(c.value) <> 'string') AS no_strings
--   FROM public.pendientes_datos p,
--        jsonb_array_elements(p.payload -> 'candidatas') c
--  WHERE p.tipo = 'marca_ambigua' AND p.detectado_por = '0012_b7b';
-- -- esperado: 0
--
-- -- (3c) P2 · La marca de fuente y la v2 de cada SKU SIEMPRE están entre
-- --      las candidatas (si no, el humano no podría elegirlas):
-- SELECT count(*) AS sin_su_propia_opcion
--   FROM public.pendientes_datos p
--  WHERE p.tipo = 'marca_ambigua' AND p.detectado_por = '0012_b7b'
--    AND NOT (p.payload -> 'candidatas' @> to_jsonb(p.payload ->> 'marca_fuente')
--         AND p.payload -> 'candidatas' @> to_jsonb(p.payload ->> 'marca_actual'));
-- -- esperado: 0
--
-- -- (4) P2 · Ningún SKU quedó con DOS preguntas abiertas sobre su marca:
-- SELECT count(*) AS doble_pregunta FROM public.pendientes_datos a
--   JOIN public.pendientes_datos b
--     ON b.clave_natural = a.clave_natural AND b.tipo = 'marca_west'
--  WHERE a.tipo = 'marca_ambigua' AND a.estado = 'abierto' AND b.estado = 'abierto';
-- -- esperado: 0   (si sale > 0, la migración lo avisó con NOTICE; no es
-- --                un error, es una revisión manual)
--
-- -- (5) P1b · No quedó residuo de la sonda de clave reservada:
-- SELECT count(*) FROM public.pendientes_datos WHERE clave_natural = '__probe_0012_b7b__';
-- -- esperado: 0
--
-- -- (6) Estado global de la bandeja:
-- SELECT tipo, estado, count(*) FROM public.pendientes_datos GROUP BY 1,2 ORDER BY 1,2;
-- -- esperado: colision_familia|abierto 1 · colision_familia|resuelto 3 ·
-- --           familia_atomo_dudoso|abierto 2 · kam_desconocido|descartado 1 ·
-- --           kam_desconocido|resuelto 1 · marca_ambigua|abierto n ·
-- --           marca_west|abierto n
-- SELECT count(*) FROM public.pendientes_datos;   -- esperado: las previas + las encoladas
-- SELECT public.contar_pendientes();
-- -- esperado: {"abiertos": n, "por_tipo": {"marca_west": n,
-- --            "colision_familia": 1, "familia_atomo_dudoso": 2,
-- --            "marca_ambigua": n}}      (antes de 0012: sin las encoladas por P2)
--
-- -- (7) 0012 NO escribió en clasificacion_v2 (solo encola):
-- SELECT count(*) FROM public.clasificacion_v2;                      -- esperado: sin cambio
-- SELECT count(*) FROM public.clasificacion_v2 WHERE updated_by = '0012_b7b';   -- esperado: 0
-- SELECT count(*) FROM public.clasificacion_v2 WHERE fuente_version LIKE '%0012%'; -- esperado: 0
-- SELECT count(*) FROM public.clasificacion_v2 WHERE marca_v2 = 'EAS';          -- esperado: sin cambio
--
-- -- (8) P3 · La fuga quedó cerrada para `authenticated`:
-- SELECT has_column_privilege('authenticated','public.clasificacion_v2','updated_by','SELECT')   AS fuga_v2,
--        has_column_privilege('authenticated','public.productos_override','editado_por','SELECT') AS fuga_ov,
--        has_column_privilege('authenticated','public.productos_metadata','updated_by','SELECT')  AS fuga_md;
-- -- esperado: f | f | f
--
-- -- (9) P3 · …y NADA más se rompió (todas las columnas que la app lee):
-- SELECT has_column_privilege('authenticated','public.clasificacion_v2','marca_v2','SELECT')       AS v2_marca,
--        has_column_privilege('authenticated','public.clasificacion_v2','fuente_version','SELECT') AS v2_version,
--        has_column_privilege('authenticated','public.productos_override','valor_editado','SELECT') AS ov_valor,
--        has_column_privilege('authenticated','public.productos_override','editado_en','SELECT')    AS ov_fecha,
--        has_column_privilege('authenticated','public.productos_metadata','color','SELECT')         AS md_color,
--        has_column_privilege('authenticated','public.productos_metadata','imagen_url','SELECT')    AS md_img;
-- -- esperado: t | t | t | t | t | t
--
-- -- (10) P3 · El ETL y los handlers con service-role siguen viéndolo todo:
-- SELECT has_column_privilege('service_role','public.clasificacion_v2','updated_by','SELECT')    AS svc_v2,
--        has_column_privilege('service_role','public.productos_override','editado_por','SELECT') AS svc_ov,
--        has_column_privilege('service_role','public.productos_metadata','updated_by','SELECT')  AS svc_md,
--        has_column_privilege('postgres','public.clasificacion_v2','updated_by','SELECT')        AS pg_v2;
-- -- esperado: t | t | t | t
--
-- -- (11) P3 · El camino de ESCRITURA de color/imagen sigue vivo (corre
-- --      con la sesión del admin, no con service_role):
-- SELECT has_column_privilege('authenticated','public.productos_metadata','updated_by','INSERT') AS ins,
--        has_column_privilege('authenticated','public.productos_metadata','updated_by','UPDATE') AS upd;
-- -- esperado: t | t
--
-- -- (12) P3 · Prueba de comportamiento REAL con un JWT de rol `kam`
-- --      (curl/REST, no SQL) — es la única que prueba el camino completo:
-- --   GET /rest/v1/clasificacion_v2?select=sku,updated_by&limit=1   → 403, code 42501
-- --   GET /rest/v1/clasificacion_v2?select=*&limit=1                → 403, code 42501  (deseado)
-- --   GET /rest/v1/clasificacion_v2?select=sku,marca_v2&limit=1     → 200 con datos
-- --   GET /rest/v1/productos_override?select=id,sku,campo,valor_editado,editado_en,activo → 200
-- --   GET /rest/v1/productos_metadata?select=sku,color,imagen_url   → 200
-- -- Y con la app: /catalogo, /catalogo/{sku}, /embarques y el dashboard
-- -- deben seguir cargando (son las 5 rutas que leen estas 3 tablas).
--
-- -- (13) P4 · La policy quedó con el InitPlan y sin ampliar acceso:
-- SELECT pol.polname,
--        pg_get_expr(pol.polqual, pol.polrelid) AS expresion,
--        (SELECT string_agg(pg_get_userbyid(u), ',') FROM unnest(pol.polroles) u) AS roles
--   FROM pg_policy pol
--  WHERE pol.polrelid = 'public.perfiles'::regclass
--  ORDER BY pol.polname;
-- -- esperado (2 filas):
-- --   perfiles_admin_update          | is_admin()                                        | authenticated
-- --   perfiles_select_own_or_admin   | ((id = ( SELECT auth.uid() AS uid)) OR is_admin()) | authenticated
--
-- -- (14) P4 · Los perfiles reales siguen leyéndose igual (paridad):
-- SELECT rol, count(*) FROM public.perfiles GROUP BY 1 ORDER BY 1;
-- -- esperado: la misma distribución por rol que antes de la migración
-- -- Y con sesión real: un `kam` sigue viendo SOLO su propia fila en
-- -- /rest/v1/perfiles (1 fila), un `admin` sigue viendo todas.
-- ============================================================
