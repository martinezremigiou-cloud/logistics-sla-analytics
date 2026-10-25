-- ============================================================
-- 0023 · [REPRODUCIBILIDAD · G4] Backfill de `snapshots.periodo` a la zona
--        civil de México — 2 filas, con gate duro en la misma transacción.
--
-- Contrato: docs/decisions/0006-civil-timezone-period-derivation.md y, sobre todo,
-- la ratificación del backfill (§P3) — el predicado de abajo está copiado de
-- ahí VERBATIM, incluidas sus dos condiciones y la aserción.
--
-- ------------------------------------------------------------
-- POR QUÉ ESTE ARCHIVO SE LLAMA 0023 Y NO 0021
--
-- Nació como `0021_reproducibilidad_backfill_periodo_civil.sql` y se
-- renumeró ANTES de aplicarse (decisión de producto, 2026-08-10). Los documentos del bloque
-- —las ratificaciones, la investigación 2.0, la cabecera de la 0022— la
-- nombran «0021»: eso es historia, y se deja como está.
--
-- El motivo: el §P3 manda que el backfill vaya DESPUÉS del deploy del fix de
-- `runEtl.ts`, mientras que la 0020 y la 0022 iban antes. Al aplicarse esas
-- dos, el libro de migraciones llegó al 0022 y este archivo quedó VARADO por
-- debajo del máximo: ya no era «pendiente», era un HUECO. El cotejo
-- ledger↔disco del aplicador lo rechazó, y con razón — un replay lo habría
-- corrido ANTES de la 0022, produciendo un orden que nunca ocurrió en
-- producción.
--
-- LA LECCIÓN, que es lo que vale y por eso se escribe aquí y no en un chat:
--
--   El número de una migración es una AFIRMACIÓN sobre el orden de
--   aplicación, no una etiqueta. Si se planea aplicar fuera del orden
--   numérico, se RENUMERA ANTES de aplicar — o no se planea ese orden.
--   La guarda del libro es lo que lo hace cumplir.
--
-- Se descartó la alternativa de exceptuar este caso dentro de la guarda:
-- habría sido una lista de exenciones escrita para tapar el problema que la
-- guarda acababa de encontrar, que es como mueren los detectores.
--
-- El contenido NO cambió con el renombre: solo las 18 auto-referencias al
-- número. Aplicar al final es equivalente — este archivo solo hace UPDATE
-- sobre `snapshots.periodo`, no lee `forzado_por`/`forzado_motivo`, y la
-- 0022 no toca el `periodo` de ninguna fila histórica.
-- ------------------------------------------------------------
--
-- ------------------------------------------------------------
-- LO QUE PASABA (un solo eslabón, medido)
-- ------------------------------------------------------------
--   src/app/api/refresh/archivo/route.ts:124
--       capturedAt: new Date().toISOString()      ← un instante, en UTC
--   src/services/etl/runEtl.ts (antes del fix)
--       periodo = capturedAt.slice(0, 10).slice(0, 7)   ← recortaba ESE UTC
--
-- Recortar el ISO recorta UTC. Hoy México está 6 horas detrás de UTC, así
-- que a partir de las 18:00 CDMX el instante ya cayó en el día UTC
-- siguiente, y si es el último día del mes, en el MES siguiente. Varias
-- ingestas reales quedaron selladas como `2026-08` cuando en México todavía
-- era 31 de julio.
--
-- OJO CON EL PORQUÉ, que es fácil de contar mal: esto NO funciona porque el
-- desfase sea constante. México tuvo horario de verano hasta oct-2022 y
-- `AT TIME ZONE 'America/Mexico_City'` lo honra — medido:
-- `2021-08-01T05:30:00Z` cae en `2021-08-01 00:30` (UTC-5), no en julio.
-- Funciona porque la conversión la hace la ZONA IANA, que conoce cada cambio
-- de regla, y no una resta fija de 6 horas. Es la misma razón por la que el
-- fix de `runEtl.ts` usa `Intl` con `timeZone` en vez de aritmética: SQL y JS
-- coinciden porque ambos consultan la misma base de datos de zonas. Escribir
-- «México es UTC-6 todo el año» como justificación sería apoyarse en una
-- premisa falsa que hoy acierta por casualidad.
--
-- ------------------------------------------------------------
-- ⚠ ORDEN OBLIGATORIO · Y LA FECHA DE CADUCIDAD DE ESTA MIGRACIÓN
-- ------------------------------------------------------------
--   1º  se DESPLIEGA el fix de `runEtl.ts` (periodo en zona civil).
--   2º  DESPUÉS se aplica esta migración.
--
-- Al revés dejaría el histórico corregido mientras el código vivo sigue
-- estampando mal las ingestas nuevas: dos convenciones conviviendo, que es
-- peor que una equivocada (§P3 de la ratificación).
--
-- Y hay una razón mecánica además de la doctrinal: la aserción de
-- «exactamente 2» CADUCA. Mientras el fix no esté desplegado, cada ingesta
-- que caiga en la ventana mala —después de las 18:00 CDMX del último día de
-- un mes— suma una fila al blanco, y entonces esta migración ABORTARÁ.
-- Abortará correctamente (el gate hace su trabajo), pero abortará. Si eso
-- ocurre, NO se toca el número: se vuelve a medir, se lleva la cifra nueva
-- a revisión y se ratifica de nuevo. El gate no se ablanda.
--
-- ------------------------------------------------------------
-- NO ES IDEMPOTENTE, Y ES A PROPÓSITO
-- ------------------------------------------------------------
-- Aplicada dos veces, la segunda toca 0 filas y aborta con el mensaje del
-- gate. Eso es lo correcto para un backfill de un solo tiro: preferimos un
-- error ruidoso a un «no hizo nada» silencioso. Esta migración repara un
-- historial acumulado concreto.
--
-- ------------------------------------------------------------
-- ENMIENDA [REPRODUCIBILIDAD · S7-B] · 2026-08-07 — LA BASE VACÍA
-- ------------------------------------------------------------
-- Ratificada (docs/decisions/0005-migration-guards-and-replay.md), bloqueante de firma.
--
-- La versión anterior de esta cabecera decía que sobre una base
-- RECONSTRUIDA DESDE CERO esta migración «también aborta (0 ≠ 2)», y lo
-- daba por correcto. **Ya no lo es**: la promesa del bloque es que
-- `0001 → 0022` se aplica de corrido sobre una base recién creada, y una
-- migración que solo corre si la base ya tiene historia no es una
-- migración, es un script de mantenimiento disfrazado. Se rechazó
-- explícitamente la salida fácil —marcarla «no reproducible»— por ser la
-- versión organizacional de P17.
--
-- LO QUE CAMBIA, y es lo ÚNICO que cambia: si `public.snapshots` está
-- VACÍA, el bloque avisa con `RAISE NOTICE` y SALE SIN TOCAR NADA. Cero
-- filas leídas, cero escritas, cero fotografía.
--
-- LO QUE **NO** CAMBIA, y esto es la parte importante: la aserción
-- `IF v_filas <> 2 THEN RAISE EXCEPTION` sigue **INTACTA, palabra por
-- palabra, dentro de la rama de universo NO vacío**. No se relajó, no se
-- movió fuera, no se convirtió en NOTICE. Solo quedó protegida por la
-- rama. Con una sola fila en `snapshots` el gate duro vuelve a estar vivo,
-- y una base de producción con muchos snapshots no nota ninguna diferencia.
--
-- EL BORDE QUE ESTA RAMA **NO** CUBRE, dicho en voz alta: una base con
-- snapshots pero SIN las 2 filas del blanco —por ejemplo, esta migración
-- ya aplicada, o un replay que reconstruya `snapshots` con datos
-- distintos— sigue abortando con el mensaje del gate. Eso es deliberado:
-- «hay historia y no es la esperada» es exactamente el caso que el gate
-- existe para frenar, y confundirlo con «no hay historia» sería vaciar el
-- gate por la puerta de atrás.
--
-- ------------------------------------------------------------
-- CIFRAS MEDIDAS CONTRA PRODUCCIÓN (valores exactos omitidos en esta copia)
-- ------------------------------------------------------------
--   total de snapshots ................................. N
--   divergen (`periodo <> mes CDMX`) — conteo INGENUO ...  varios
--   cumplen solo (A) (`periodo = mes UTC`) ............. casi todos
--   cumplen (A) Y (B) — el blanco ratificado ...........  2
--   corrección de abril hecha a mano (no seleccionada) ..  algunas
--
-- Las 2 del blanco, con su id completo (fijados en la guarda 2). Los ids son SINTÉTICOS en esta copia: esa rama solo actúa sobre datos sembrados:
--   00000000-0000-4000-8000-000000000001 · inventario.xlsx · fin de julio, tarde CDMX · 2026-08 → 2026-07
--   00000000-0000-4000-8000-000000000002 · inventario.xlsx · fin de julio, tarde CDMX · 2026-08 → 2026-07
--
-- ------------------------------------------------------------
-- LAS DE ABRIL — lo que (A) existe para proteger
-- ------------------------------------------------------------
-- Tienen `periodo='2026-04'` puesto A MANO por un UPDATE ratificado en
-- MVP-CIERRE, contra un `mes_utc='2026-07'`. Fallan (A), así que el
-- predicado NO las toca. Sin (A) el backfill las habría destruido:
--
--   snapshot de stock  · periodo 2026-04 · corrida de julio (corrección manual)
--   snapshot de aduana · periodo 2026-04 · corrida de julio (corrección manual)
--   (otras filas de la misma clase, omitidas)
--   (…)
--
-- ------------------------------------------------------------
-- POR QUÉ LAS DOS CONDICIONES, Y POR QUÉ PREDICADO Y NO IDS
-- ------------------------------------------------------------
--   (A) `periodo = mes UTC`   → «esta fila la estampó la máquina con el
--       bug». Es la que protege abril.
--   (B) `periodo <> mes CDMX` → «y de verdad cambia». Sin ella el UPDATE
--       toca casi todas las filas (medido) reescribiendo la mayoría con su mismo valor: inocuo
--       en el dato, LETAL para el gate, porque «deben ser 2» dejaría de
--       significar nada.
--
-- Ids explícitos serían máximamente seguros pero no dicen POR QUÉ, y no se
-- pueden re-verificar contra una base reconstruida. Decisión de producto (§P3):
-- el PREDICADO se queda como predicado. Los ids entran por otra puerta —la
-- guarda (2)—, que es donde sirven sin quitarle al predicado su capacidad de
-- explicarse.
--
-- LÍMITE CONOCIDO DE (A), y razón de ser de la guarda (2): (A) no puede
-- distinguir el sello de la máquina de una corrección HUMANA cuyo valor
-- coincida por casualidad con el mes UTC de esa fila. Está medido con un
-- mutante: basta insertar una fila así para que el UPDATE la destruya
-- mientras el gate de conteo sigue viendo «2» y todo parece verde.
--
-- ------------------------------------------------------------
-- EFECTO MEDIDO EN EL DASHBOARD (no es cosmético; va al commit)
-- ------------------------------------------------------------
-- `periodo` alimenta `vigentePorPeriodo`/`periodosOrdenados`
-- (src/services/dashboard.service.ts), que resuelven la tendencia de stock.
-- Al devolver a julio el snapshot de fin de mes, ese snapshot pasa a ser
-- el VIGENTE de julio (es más reciente que el anterior de ese mes):
--
--   ANTES    cada periodo con su total de piezas
--   DESPUÉS  solo cambia el total de julio (suma las piezas del snapshot movido)
--
--
-- Siguen siendo los mismos periodos: `periodos.actual` y
-- `periodos.anterior` no cambian, y el baseline de
-- `piezas_en_camino` (snapshot de aduana del mes anterior) tampoco.
--
-- ------------------------------------------------------------
-- CHECKLIST DE IRREVERSIBILIDAD (G3 · obligatorio antes de aplicar)
-- «¿esta migración borra, cierra o marca como resuelto algo que no se puede
--  reconstruir?»
--
--   NO BORRA. Cero DELETE, cero TRUNCATE, cero DROP. No cierra pendientes ni
--   marca nada como resuelto. Una sola sentencia de escritura sobre datos.
--
--   ES REVERSIBLE. El valor anterior era, por definición de (A),
--   `to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')`, y `created_at` no se
--   toca. La marcha atrás está escrita al pie de este archivo, con los ids.
--
--   PERO DEJA UN RESIDUO, Y HAY QUE DECIRLO. Esta migración mueve SOLO LA
--   ETIQUETA. Cada uno de esos 2 snapshots conserva reservas fechadas
--   `2026-08-01` — el relleno `${periodo}-01` que el ETL estampó cuando creía
--   estar en agosto. Tras aplicar quedan etiquetados `2026-07` con reservas
--   de agosto dentro. Consecuencias medidas:
--     · es INERTE para las lecturas: todo consumidor de `reservas` filtra por
--       `snapshot_id` (dashboard.service.ts:673 y :885, sku.service.ts:379,
--       etl/persist.ts:227) y NADA junta `reservas.fecha` contra
--       `snapshots.periodo`; además esos 2 ya no son el vigente, así que no
--       vuelven a alimentar el `prev` del differ;
--     · el `hash` almacenado sigue siendo fiel a las filas almacenadas, pero
--       DEJA DE SER RE-DERIVABLE DESDE SUS INSUMOS: re-ingerir el mismo
--       .xlsx con el mismo capturedAt bajo el código corregido produciría
--       reservas fechadas `2026-07-01` y, por tanto, otro hash;
--     · en suma, queda un estado que la ingesta corregida NO PUEDE GENERAR.
--   NO se corrige aquí: tocar `reservas` sería salirse del predicado
--   ratificado y reescribir datos por causa de una etiqueta. Se declara.
--
--   NO ES LA PRIMERA VEZ, y el precedente tampoco se había documentado: la
--   corrección de abril de MVP-CIERRE dejó exactamente la misma huella.
--   Ejemplo: un snapshot corregido de abril tiene etiqueta `2026-04` con reservas fechadas
--   `2026-07-01`. Quien audite estas filas debe saber que la etiqueta y el
--   relleno de reservas pueden discrepar por diseño de la reparación.
-- ------------------------------------------------------------
BEGIN;

DO $backfill0023$
DECLARE
  v_universo  integer;
  v_filas     integer;
  v_total     integer;
  v_divergen  integer;
  v_blanco    integer;
  v_manuales  integer;
  v_resto     integer;
  v_foto      integer;
  v_ahora     integer;
  v_movidas   uuid[];
  v_fila      record;
  -- Los 2 ids del blanco (SINTÉTICOS en esta copia: esa rama solo actúa sobre datos sembrados), en orden ASC de id
  -- (el mismo orden que produce el ORDER BY de la consulta de la guarda 2).
  v_esperadas uuid[] := ARRAY[
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002'
  ]::uuid[];
BEGIN
  -- ----------------------------------------------------------
  -- (-1) [S7-B] GUARDA DE UNIVERSO VACÍO. Va ANTES que todo, incluida la
  --      fotografía: sobre una base sin snapshots no hay nada que
  --      fotografiar, nada que reparar y nada que verificar.
  --
  --      ANTI-VACUIDAD DE ESTA GUARDA (P19) — el estado que pone cada rama:
  --        · rama VACÍA  → una base recién creada por el replay de G-d
  --          (`0001 → 0022` sobre esquema limpio): `snapshots` tiene 0
  --          filas porque ninguna migración anterior inserta ahí.
  --        · rama LLENA  → producción (snapshots medidos en producción),
  --          y también CUALQUIER base con una sola fila.
  --      Las dos ramas son alcanzables y llevan a comportamientos
  --      observablemente distintos, así que esta guarda no puede «pasar
  --      siempre»: elige, no aprueba.
  -- ----------------------------------------------------------
  SELECT count(*) INTO v_universo FROM public.snapshots;

  IF v_universo = 0 THEN
    RAISE NOTICE '0023 · UNIVERSO VACÍO: public.snapshots no tiene ni una fila. No hay historial que reparar — se OMITE el backfill entero y NO se toca nada (ni fotografía, ni UPDATE, ni guardas). Ratificado (docs/decisions/0005-migration-guards-and-replay.md).';
    RAISE NOTICE '0023 · LO QUE NO PUEDE COMPROBAR ESTA MIGRACIÓN DESDE AQUÍ (P16): que el ETL vivo estampe `periodo` en la zona civil de México. Eso lo fija el fix de src/services/etl/runEtl.ts y lo prueban sus tests, no este archivo. Sobre una base vacía este backfill no verifica NADA del comportamiento futuro: solo declara que no había pasado que corregir.';
    RAISE NOTICE '0023 · NO COMPROBADO AQUÍ: que las 2 filas ratificadas (las dos del blanco) hayan sido corregidas alguna vez. Sobre esta base no existen. Si esta fuera la base de producción, esta rama NO se habría tomado.';
    RETURN;
  END IF;

  RAISE NOTICE '0023 · universo NO vacío (% snapshot(s)): el backfill y su gate duro corren completos, sin una sola diferencia respecto de la versión ratificada.', v_universo;

  -- ----------------------------------------------------------
  -- (0) EVIDENCIA PREVIA + FOTOGRAFÍA. Los conteos son informativos; la
  --     fotografía es la que sostiene la guarda (2): sin un ANTES medido no
  --     hay forma de saber QUÉ filas cambiaron de verdad.
  -- ----------------------------------------------------------
  CREATE TEMP TABLE foto_0023 ON COMMIT DROP AS
    SELECT id, periodo FROM public.snapshots;

  SELECT count(*),
         count(*) FILTER (WHERE periodo <> to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM')),
         count(*) FILTER (WHERE periodo =  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')
                            AND periodo <> to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM')),
         count(*) FILTER (WHERE periodo <> to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')
                            AND periodo <> to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM'))
    INTO v_total, v_divergen, v_blanco, v_manuales
    FROM public.snapshots;

  -- `v_manuales` es CONTEXTO para quien aplica (hoy: las de abril), NO una
  -- guarda. Contarlo antes y después no puede fallar nunca: ese conjunto y el
  -- que toca el UPDATE son DISJUNTOS por álgebra —uno exige
  -- `periodo <> mes UTC` y el otro `periodo = mes UTC`—, así que ninguna fila
  -- puede cruzar de uno al otro. Una versión anterior de esta migración lo
  -- vendía como «guarda de comportamiento»: era una tautología, y un mutante
  -- lo demostró dejando pasar la destrucción de una corrección humana.
  RAISE NOTICE '0023 · censo previo: % snapshots · % divergen (conteo ingenuo) · % en el blanco ratificado · % correcciones a mano (informativo, NO es la guarda)',
    v_total, v_divergen, v_blanco, v_manuales;

  FOR v_fila IN
    SELECT id, fuente, coalesce(archivo,'(sin archivo)') AS archivo, periodo,
           to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD HH24:MI') AS cdmx,
           to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM')            AS periodo_nuevo
      FROM public.snapshots
     WHERE periodo =  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')
       AND periodo <> to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM')
     ORDER BY created_at
  LOOP
    RAISE NOTICE '0023 · a corregir: % · fuente % · % · corte % CDMX · periodo % -> %',
      v_fila.id, v_fila.fuente, v_fila.archivo, v_fila.cdmx, v_fila.periodo, v_fila.periodo_nuevo;
  END LOOP;

  -- ----------------------------------------------------------
  -- (1) EL BACKFILL. Predicado RATIFICADO por el PO (§P3), verbatim.
  -- ----------------------------------------------------------
  UPDATE public.snapshots
     SET periodo = to_char(created_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM')
   WHERE periodo = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM')                    -- (A)
     AND periodo <> to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM');   -- (B)

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 2 THEN
    RAISE EXCEPTION 'backfill periodo: se esperaban 2 filas, se tocaron %. Nada se aplicó.', v_filas;
  END IF;
  RAISE NOTICE '0023 · el backfill tocó % fila(s), como exige la ratificación.', v_filas;

  -- ----------------------------------------------------------
  -- (2) GUARDA DE IDENTIDAD — la que SÍ puede fallar.
  --
  --     El gate de arriba cuenta CUÁNTAS filas cambiaron. Esta comprueba
  --     CUÁLES, contra los 2 ids medidos, comparando el estado real contra la
  --     fotografía previa. Es lo único que caza el escenario que (A) no puede
  --     ver: una corrección humana cuyo valor coincide con su mes UTC, que
  --     entra al blanco y es destruida mientras el conteo sigue dando 2.
  --
  --     Los ids viven AQUÍ y no en el predicado a propósito: el predicado
  --     explica la regla (decisión del PO), la guarda pone el techo duro.
  -- ----------------------------------------------------------
  SELECT count(*) INTO v_foto  FROM foto_0023;
  SELECT count(*) INTO v_ahora FROM public.snapshots;
  IF v_ahora <> v_foto THEN
    RAISE EXCEPTION
      '0023: la tabla cambió de tamaño durante la transacción (% en la foto, % ahora). Probablemente entró una ingesta a mitad; reintenta con la ingesta detenida. Nada se aplicó.',
      v_foto, v_ahora;
  END IF;

  SELECT coalesce(array_agg(s.id ORDER BY s.id), ARRAY[]::uuid[])
    INTO v_movidas
    FROM public.snapshots s
    JOIN foto_0023 f ON f.id = s.id
   WHERE s.periodo IS DISTINCT FROM f.periodo;

  IF v_movidas <> v_esperadas THEN
    RAISE EXCEPTION
      '0023: cambiaron filas distintas de las medidas. Cambiaron %, se esperaban %. Alguna no era un sello de la máquina. Nada se aplicó.',
      v_movidas::text, v_esperadas::text;
  END IF;
  RAISE NOTICE '0023 · guarda de identidad: cambiaron exactamente las 2 filas medidas %.', v_movidas::text;

  -- ----------------------------------------------------------
  -- (3) GUARDA DE CONVERGENCIA. Tras el UPDATE no puede quedar ni una fila
  --     que siga cumpliendo el predicado; si queda, el UPDATE no hizo lo que
  --     dice y el «2» fue una coincidencia.
  -- ----------------------------------------------------------
  SELECT count(*) INTO v_resto
    FROM public.snapshots
   WHERE periodo =  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')
     AND periodo <> to_char(created_at AT TIME ZONE 'America/Mexico_City','YYYY-MM');

  IF v_resto <> 0 THEN
    RAISE EXCEPTION
      '0023: tras el backfill quedan % fila(s) que siguen cumpliendo el predicado. El UPDATE no convergió. Nada se aplicó.',
      v_resto;
  END IF;

  RAISE NOTICE '0023 · VERDE: periodo en zona civil de México; solo cambiaron las 2 filas medidas.';
END $backfill0023$;

COMMIT;

-- ============================================================
-- MARCHA ATRÁS (si alguna vez hiciera falta). El valor anterior era, por
-- definición de (A), el mes UTC del mismo `created_at`, que esta migración no
-- toca. Deshacer es una línea, y por eso el checklist de arriba contesta que
-- NO es irreversible:
--
--   UPDATE public.snapshots
--      SET periodo = to_char(created_at AT TIME ZONE 'UTC','YYYY-MM')
--    WHERE id IN ('00000000-0000-4000-8000-000000000001',
--                 '00000000-0000-4000-8000-000000000002');
--
-- Ids y no predicado a propósito: para DESHACER sí quieres la lista cerrada
-- de lo que tocaste, no una regla que pueda barrer de más. (Esto NO deshace
-- el residuo de reservas descrito en el checklist: ese nunca se tocó.)
-- ============================================================
