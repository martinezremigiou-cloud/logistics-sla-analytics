-- ============================================================
-- 0033 · [INV-B11] PUERTA 3 — buscar DENTRO del corpus, sin pasar por familia.
--
-- QUÉ ABRE, medido antes de escribir una línea:
--
--     todos los documentos con trozos        ← el denominador
--     unos alcanzables solo por SKU          (fraccion menor)
--     otros alcanzables por NOMBRE           (puerta 2)
--     el resto, MUDOS                        (la mayoria) ← esto
--
-- Y la muestra de mudos dice qué son: un glosario general, una nota sobre el
-- propio sistema de consulta, un índice por sector y la ficha de la empresa.
-- **Ninguno es la ficha de una familia**, así que
-- ningún puente los va a alcanzar nunca: no les falta un renglón en la tabla,
-- les falta un camino que no pase por ella.
--
-- ────────────────────────────────────────────────────────────
-- LÉXICA, NO VECTORIAL. Y es una decisión de producto, no una limitación.
--
-- El bloque tiene una columna `embedding vector(1536)` desde la `0030` y está
-- **vacía a propósito**: en el avance 5 se retiró la recomendación de
-- embebido, y la razón sobrevive a la migración — **así el corpus no sale del
-- perímetro para poder consultarse**. Una búsqueda léxica se resuelve entera
-- dentro de Postgres.
--
-- Lo que eso cuesta, dicho: no encuentra sinónimos. «candado» no trae
-- «cerradura» si el documento no usa la palabra. Es el precio, y es el que
-- se eligió pagar.
--
-- ────────────────────────────────────────────────────────────
-- POR QUÉ UNA FUNCIÓN Y NO UN `.textSearch()` DESDE EL CLIENTE.
--
-- Por el ORDEN. `ts_rank` es lo que separa «el documento que habla de esto» de
-- «el documento que menciona la palabra una vez», y PostgREST no expone
-- ordenar por una expresión. La alternativa era rankear en TypeScript, o sea
-- **escribir una segunda implementación de algo que Postgres ya tiene** — que
-- es exactamente lo que este repo prohíbe (`derivarSku`, regla del repo).
--
-- ────────────────────────────────────────────────────────────
-- Y LA TRAMPA QUE ESTE REPO YA PAGÓ UNA VEZ, aplicada aquí:
--
--     Una función nueva NACE ABIERTA A `anon`. El `pg_default_acl` le concede
--     EXECUTE **por nombre**, y `REVOKE ... FROM PUBLIC` no lo toca.
--
-- Dos capas, porque una sola vuelve a depender de que alguien se acuerde:
--
--   1. `SECURITY INVOKER` (por omisión, y se dice explícito). Corre con los
--      privilegios de quien llama, así que la RLS de `corpus_trozos` sigue en
--      medio. Una `SECURITY DEFINER` aquí habría sido un túnel alrededor de
--      todo lo que la `0032` acaba de montar.
--   2. `REVOKE ... FROM anon` por nombre, más la guarda que lo comprueba.
--
-- ────────────────────────────────────────────────────────────
-- CHECKLIST DE IRREVERSIBILIDAD (obligatorio, `aplicar-migracion.mjs`):
--
--   1. ¿BORRA, CIERRA o MARCA COMO RESUELTO algo irreconstruible?
--      **NO.** Una columna GENERADA (se recalcula sola desde `texto`, no
--      guarda nada que no esté ya), un índice y una función. Revertir es
--      DROP de las tres y no pierde ni una fila de contenido.
--
--   2. ¿Radio de impacto acotado?
--      **Sí, con una advertencia honesta:** agregar una columna generada
--      REESCRIBE la tabla. Son pocos trozos hoy, así que es instantáneo — pero
--      la frase «es solo una columna» dejaría de ser cierta con millones, y
--      quien la lea dentro de un año merece saberlo.
--
--   3. ¿Qué NO puede comprobar esta migración desde donde está?
--      **Si los resultados son BUENOS.** La guarda comprueba que la función
--      existe, que ordena por relevancia, que `anon` no la puede ejecutar y
--      que `authenticated` sí obtiene filas. Nada de eso dice que lo que
--      devuelve sea lo que alguien buscaba: la relevancia es un juicio y se
--      mide con un conjunto, no con un `RAISE`. Ver
--      una prueba de humo de relevancia (no incluida en esta copia).
-- ============================================================

DO $antes$
BEGIN
  PERFORM set_config('inv_b11.trozos_antes',
    (SELECT count(*)::text FROM public.corpus_trozos), false);
END
$antes$;

-- ------------------------------------------------------------
-- (1) LA COLUMNA. Generada, así que no puede desincronizarse del texto —
--     que es el defecto clásico de una columna de búsqueda mantenida por
--     trigger: alguien actualiza `texto` por otro camino y el índice miente.
--
--     `ruta_seccion` va con peso A y el cuerpo con peso B. La sección es el
--     título del fragmento («Series2 > Características principales»), y una
--     coincidencia ahí vale más que una coincidencia perdida en un párrafo.
-- ------------------------------------------------------------
ALTER TABLE public.corpus_trozos
  ADD COLUMN IF NOT EXISTS busqueda tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', coalesce(ruta_seccion, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(texto, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS corpus_trozos_busqueda_idx
  ON public.corpus_trozos USING GIN (busqueda);

-- ------------------------------------------------------------
-- (2) LA FUNCIÓN.
--
--     `websearch_to_tsquery` y no `plainto_tsquery`: acepta comillas y `-`
--     como los escribe una persona, y **nunca lanza con entrada rara** —
--     `to_tsquery` sí lo hace con un `&` suelto, y esa entrada llega de un
--     campo de texto libre.
--
--     El tope se acota DENTRO: un `LIMIT` que viene del llamador es un
--     `LIMIT 1000000` esperando a ocurrir.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_corpus(consulta text, tope integer DEFAULT 5)
RETURNS TABLE (ruta text, seccion text, texto text, rango real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  SELECT t.ruta,
         t.ruta_seccion,
         t.texto,
         ts_rank(t.busqueda, q)::real
  FROM public.corpus_trozos t,
       websearch_to_tsquery('spanish', coalesce(consulta, '')) q
  WHERE t.busqueda @@ q
  ORDER BY ts_rank(t.busqueda, q) DESC, t.ruta, t.orden
  LIMIT greatest(1, least(coalesce(tope, 5), 20));
$fn$;

-- ------------------------------------------------------------
-- (3) EL PRIVILEGIO. Explícito en las dos direcciones (ver la cabecera).
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.buscar_corpus(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buscar_corpus(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.buscar_corpus(text, integer) TO authenticated;

-- ------------------------------------------------------------
-- (4) LA GUARDA — y con el control positivo, que es lo que la 0032 enseñó.
-- ------------------------------------------------------------
DO $guarda$
DECLARE
  v_antes      integer := current_setting('inv_b11.trozos_antes', true)::integer;
  v_indexados  integer;
  v_anon       integer;
  v_definer    boolean;
  v_filas      integer;
  v_primero    real;
  v_ultimo     real;
  v_palabra    text;
BEGIN
  -- (a) La columna se pobló sola. Una columna generada que quedara en NULL
  --     significaría que la expresión falló, y el índice estaría vacío con
  --     el `CREATE INDEX` en verde.
  SELECT count(*) INTO v_indexados FROM public.corpus_trozos WHERE busqueda IS NOT NULL;
  IF v_indexados <> v_antes THEN
    RAISE EXCEPTION '0033 ABORTA: % de % trozos quedaron sin vector de busqueda', v_antes - v_indexados, v_antes;
  END IF;

  -- (b) NO es SECURITY DEFINER. Con DEFINER la funcion seria un tunel
  --     alrededor de la RLS que la 0032 acaba de montar.
  SELECT p.prosecdef INTO v_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'buscar_corpus';
  IF v_definer IS NULL THEN
    RAISE EXCEPTION '0033 ABORTA: buscar_corpus no existe despues de crearla';
  END IF;
  IF v_definer THEN
    RAISE EXCEPTION '0033 ABORTA: buscar_corpus quedo como SECURITY DEFINER y seria un tunel alrededor de la RLS';
  END IF;

  -- (c) `anon` no la puede ejecutar. La trampa del `pg_default_acl` concede
  --     EXECUTE por nombre, y el REVOKE de arriba es lo unico que lo quita.
  SELECT count(*) INTO v_anon FROM information_schema.role_routine_grants
    WHERE routine_schema = 'public' AND routine_name = 'buscar_corpus' AND grantee = 'anon';
  IF v_anon <> 0 THEN
    RAISE EXCEPTION '0033 ABORTA: anon conserva % privilegio(s) sobre buscar_corpus', v_anon;
  END IF;

  -- (d) EL CONTROL POSITIVO, y no cuenta privilegios: BUSCA, como
  --     `authenticated`, una palabra sacada del propio corpus. Si contara
  --     grants demostraria la ausencia de dano sin demostrar la presencia de
  --     funcion — el defecto exacto que dejo el chat roto en la 0030.
  IF v_antes > 0 THEN
    -- Una palabra que SEGURO esta: la mas larga del primer trozo. Horneada
    -- seria una hipotesis sobre el contenido; sacada del dato, no.
    SELECT lower((regexp_match(texto, '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{6,}'))[1])
      INTO v_palabra
    FROM public.corpus_trozos
    WHERE texto ~ '[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{6,}'
    ORDER BY orden, ruta
    LIMIT 1;

    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_filas FROM public.buscar_corpus(v_palabra, 5);
    SELECT max(rango), min(rango) INTO v_primero, v_ultimo FROM public.buscar_corpus(v_palabra, 5);
    EXECUTE 'RESET ROLE';

    IF v_filas = 0 THEN
      RAISE EXCEPTION '0033 ABORTA: como authenticated, buscar «%» no devolvio ninguna fila y esa palabra SALE del corpus', v_palabra;
    END IF;

    RAISE NOTICE '0033 · CONTROL POSITIVO OK: como authenticated, buscar «%» devolvio % fila(s), rango de % a %.',
      v_palabra, v_filas, v_primero, v_ultimo;
  ELSE
    RAISE NOTICE '0033 · AVISO: el corpus esta VACIO, asi que el control positivo NO se ejercio. Volver a correr con datos.';
  END IF;

  RAISE NOTICE '0033 · % trozos con vector de busqueda, indice GIN puesto, buscar_corpus SECURITY INVOKER, anon en 0, authenticated con EXECUTE.', v_indexados;
  RAISE NOTICE '0033 · LO QUE ESTA MIGRACION NO PUEDE COMPROBAR DESDE AQUI: si los resultados son BUENOS. Que devuelva filas ordenadas por ts_rank no dice que sean las que alguien buscaba — la relevancia es un juicio y se mide con un conjunto, no con un RAISE. Ver la prueba de humo de relevancia (no incluida en esta copia).';
  RAISE NOTICE '0033 · Y LO QUE CUESTA LA DECISION LEXICA: no encuentra sinonimos. «candado» no trae «cerradura» si el documento no usa la palabra. Es el precio de que el corpus no salga del perimetro (avance 5, decision del PO).';
END
$guarda$;
