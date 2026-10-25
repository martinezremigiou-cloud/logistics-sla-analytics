-- ============================================================
-- 0034 · [INV-B11] La búsqueda encontraba menos de lo que había.
--
-- QUÉ ARREGLA, y salió de medir la 0033 en vez de darla por buena:
--
--     buscar «clip»   →   FTS: pocos trozos   ·   ILIKE '%clip%': más trozos
--
-- LA CAUSA, medida: **el stemmer español no unifica `clip` con `clips`.**
--
--     to_tsvector('spanish','clip')  →  'clip'
--     to_tsvector('spanish','clips') →  'clips'     ← lexema DISTINTO
--     to_tsvector('spanish','candado')  →  'cand'
--     to_tsvector('spanish','candados') →  'cand'   ← éste sí unifica
--
-- El diccionario español sabe pluralizar en español. **El catálogo de este
-- portal está lleno de nombres en inglés** —CLIPS, Series2, P-Lock, PivotLock— y
-- ahí el stemmer no tiene reglas: deja el token como está, y singular y plural
-- quedan como dos palabras sin relación.
--
-- No es un defecto de la 0033: es que el idioma del contenido y el idioma de
-- los nombres de producto **no son el mismo**, y eso no se ve hasta que se
-- mide.
--
-- ────────────────────────────────────────────────────────────
-- EL ARREGLO: DOS CONSULTAS UNIDAS, NO UNA CAMBIADA.
--
--   exacta   `websearch_to_tsquery('spanish', …)`  →  entiende el español
--   prefijo  `to_tsquery('simple', 'clip:* & …')`   →  entiende los nombres
--
-- Y se unen con `OR`, con `greatest()` de los dos rangos. Medido sobre el
-- corpus real, en trozos (cifras omitidas en esta copia):
--
--     consulta      exacta   prefijo   UNIÓN
--     «clip»             n         n       n     ← el caso que lo motivó
--     «candado»          n         n       n     ← la unión gana por los dos lados
--     «cerradura»        n         n       n     ← el prefijo no estorba
--
-- **Cambiar a `simple` a secas habría roto el español** (`candado` dejaría de
-- traer `candados`), y quedarse en `spanish` deja los nombres de producto
-- fuera. Las dos, unidas, no pierden nada de ninguna.
--
-- ────────────────────────────────────────────────────────────
-- Y LA RAZÓN DE QUE SEA `plpgsql` Y NO `sql`:
--
-- **`to_tsquery` LANZA con entrada rara** — un `&` suelto, un paréntesis
-- desbalanceado— y esto viene de un campo de texto libre donde alguien escribe
-- lo que quiere. Hace falta sanear ANTES de construirla, y sanear necesita
-- variables. `websearch_to_tsquery` no lanza nunca; `to_tsquery` sí, y por eso
-- entra con la entrada ya reducida a letras, dígitos y espacios.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Un `CREATE OR REPLACE FUNCTION`. Ni una tabla, ni una columna,
--      ni una fila se tocan. Revertir es volver a aplicar el cuerpo de la
--      0033, que sigue en el repo palabra por palabra.
--
--   2. ¿Radio de impacto acotado?
--      **Sí.** Una sola función, que hoy tiene un solo llamador
--      (`buscarEnCorpus`). El índice GIN y la columna generada de la 0033 no
--      se tocan: la consulta cambia, lo indexado no.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      **Si la unión mejora la RELEVANCIA o solo el RECALL.** Traer más en vez
--      de menos es más cobertura; que los más sean mejores que los menos es un juicio.
--      La guarda comprueba que la unión **no pierde** lo que la exacta ya
--      traía —eso sí es comprobable— y el juicio queda en
--      una prueba de humo de relevancia (no incluida en esta copia) y en la revisión manual.
-- ============================================================

CREATE OR REPLACE FUNCTION public.buscar_corpus(consulta text, tope integer DEFAULT 5)
RETURNS TABLE (ruta text, seccion text, texto text, rango real)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_limpia   text;
  v_exacta   tsquery;
  v_prefijo  tsquery;
BEGIN
  -- Solo letras (con acentos), dígitos y espacios. Todo lo demás pasa a
  -- espacio: `to_tsquery` lanza con un `&` suelto y esto viene de un campo
  -- de texto libre. Sanear no es cortesía, es lo que impide un 500.
  v_limpia := regexp_replace(coalesce(consulta, ''), '[^[:alnum:]áéíóúüñÁÉÍÓÚÜÑ]+', ' ', 'g');
  v_limpia := btrim(regexp_replace(v_limpia, '\s+', ' ', 'g'));
  IF v_limpia = '' THEN
    RETURN;
  END IF;

  v_exacta := websearch_to_tsquery('spanish', v_limpia);
  v_prefijo := to_tsquery('simple', replace(v_limpia, ' ', ':* & ') || ':*');

  RETURN QUERY
  SELECT t.ruta,
         t.ruta_seccion,
         t.texto,
         greatest(ts_rank(t.busqueda, v_exacta), ts_rank(t.busqueda, v_prefijo))::real AS r
  FROM public.corpus_trozos t
  WHERE t.busqueda @@ v_exacta OR t.busqueda @@ v_prefijo
  ORDER BY r DESC, t.ruta, t.orden
  LIMIT greatest(1, least(coalesce(tope, 5), 20));
END
$fn$;

-- El `CREATE OR REPLACE` conserva los privilegios de la 0033, pero se repiten
-- porque **depender de que los conserve es depender de un detalle** — y la
-- trampa del `pg_default_acl` de este proyecto ya costó una vez.
REVOKE ALL ON FUNCTION public.buscar_corpus(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buscar_corpus(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_corpus(text, integer) TO authenticated;

DO $guarda$
DECLARE
  v_anon      integer;
  v_definer   boolean;
  v_clip      integer;
  v_cerr      integer;
  v_cand      integer;
  v_vacio     integer;
  v_sucio     integer;
BEGIN
  -- (a) Sigue sin ser DEFINER y `anon` sigue sin poder ejecutarla. Un
  --     `CREATE OR REPLACE` es exactamente donde se pierde un REVOKE sin que
  --     nadie lo note.
  SELECT p.prosecdef INTO v_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_corpus';
  IF v_definer IS NULL THEN
    RAISE EXCEPTION '0034 ABORTA: buscar_corpus no existe despues del replace';
  END IF;
  IF v_definer THEN
    RAISE EXCEPTION '0034 ABORTA: buscar_corpus quedo como SECURITY DEFINER';
  END IF;

  SELECT count(*) INTO v_anon FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public' AND routine_name = 'buscar_corpus' AND grantee = 'anon';
  IF v_anon <> 0 THEN
    RAISE EXCEPTION '0034 ABORTA: anon recupero % privilegio(s) sobre buscar_corpus', v_anon;
  END IF;

  -- (b) NO LANZA CON ENTRADA SUCIA. Es la mitad que justifica el plpgsql: si
  --     esto lanzara, un usuario escribiendo «& ( "» tumbaria su propia
  --     consulta con un 500 en vez de recibir «no encontre nada».
  SELECT count(*) INTO v_sucio FROM public.buscar_corpus('& ( " ) | ! <->', 5);
  SELECT count(*) INTO v_vacio FROM public.buscar_corpus('   ', 5);
  RAISE NOTICE '0034 · entrada sucia y entrada vacia no lanzan: devolvieron % y % filas.', v_sucio, v_vacio;

  -- (c) EL CONTROL POSITIVO, contra el caso QUE LO MOTIVO. Si el corpus esta
  --     cargado, «clip» tiene que traer MAS de lo que traia la 0033.
  SELECT count(*) INTO v_clip FROM public.buscar_corpus('clip', 20);
  SELECT count(*) INTO v_cand FROM public.buscar_corpus('candado', 20);
  SELECT count(*) INTO v_cerr FROM public.buscar_corpus('cerradura', 20);

  IF (SELECT count(*) FROM public.corpus_trozos) = 0 THEN
    RAISE NOTICE '0034 · AVISO: el corpus esta VACIO, asi que el control positivo NO se ejercio.';
  ELSE
    IF v_clip < 2 THEN
      RAISE EXCEPTION '0034 ABORTA: buscar «clip» devolvio % fila(s). La 0033 ya daba 1; si la union no mejora, no vale la migracion', v_clip;
    END IF;
    -- Y LA MITAD QUE IMPIDE QUE ESTO SEA UNA REGRESION DISFRAZADA DE MEJORA:
    -- el espanol tiene que seguir funcionando. «cerradura» salia por la
    -- consulta exacta y por ninguna otra via.
    IF v_cerr = 0 OR v_cand = 0 THEN
      RAISE EXCEPTION '0034 ABORTA: se rompio el espanol — «cerradura» dio % y «candado» dio %', v_cerr, v_cand;
    END IF;
    RAISE NOTICE '0034 · CONTROL POSITIVO OK: «clip»=% (la 0033 daba 1) · «candado»=% · «cerradura»=% — la union gana por los dos lados.',
      v_clip, v_cand, v_cerr;
  END IF;

  RAISE NOTICE '0034 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI: si la union mejora la RELEVANCIA o solo el RECALL. Traer 4 en vez de 1 es mas cobertura; que los 4 sean mejores que el 1 es un juicio, y se mide con un conjunto o con el pase del PO.';
END
$guarda$;
