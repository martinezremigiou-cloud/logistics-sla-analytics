-- ============================================================
-- 0017 · [MVP-2] A · `productos_metadata` deja de recibir escrituras
--                     DIRECTAS de sesión.
--
-- ESCRITA, **NO APLICADA**. Se aplica a mano.
--
-- ------------------------------------------------------------
-- EL BUG, REPRODUCIDO (no razonado)
-- ------------------------------------------------------------
-- `0012_b7b_hardening` (P3, TAXO-10) convirtió 3 tablas en LISTA BLANCA:
-- les quitó el SELECT de TABLA a `authenticated` y le devolvió el SELECT
-- de cada columna MENOS la de autoría. Medido hoy:
--
--     clasificacion_v2      9 columnas · 8 con GRANT · SELECT de tabla = false
--     productos_metadata    5 columnas · 4 con GRANT · SELECT de tabla = false
--     productos_override    7 columnas · 6 con GRANT · SELECT de tabla = false
--
-- De las tres, `productos_metadata` era la ÚNICA que todavía recibía
-- escrituras directas desde una sesión de usuario:
--
--     src/services/color.service.ts:32-34     .upsert({… updated_by …})
--     src/services/imagenes.service.ts:65-67  .upsert({… updated_by …})
--
-- Las otras dos ya se escribían solo por RPC `SECURITY DEFINER`
-- (`aplicar_override`, `aplicar_clasificacion_v2`, `resolver_pendiente`),
-- que corren como el dueño y no ven el REVOKE.
--
-- Por qué fallaban esos upserts, siendo que INSERT y UPDATE sobre
-- `updated_by` SÍ están concedidos (verificado: ins=true, upd=true):
-- **el `*` lo genera PostgREST**, que construye el upsert con
-- `RETURNING *` se encadene `.select()` en el cliente o no. Ese `*` se
-- expande y el chequeo de privilegios cae en TABLA:
--
--     SET LOCAL ROLE authenticated;
--     SELECT * FROM productos_metadata LIMIT 1;        → 42501 permission
--                                                        denied for TABLE
--     SELECT sku,color,imagen_url,updated_at FROM …    → devuelve la fila
--     UPDATE … RETURNING *                              → 42501
--     UPDATE … RETURNING sku, color                     → funciona
--
-- Cero filas tocadas en las cuatro. Lo único que cambia entre las dos
-- últimas es el `*`.
--
-- Y por eso el log NO permitía identificar la causa: Postgres reporta
-- `permission denied for TABLE`, sin nombrar la columna, porque el `*` ya
-- se expandió cuando se evalúa el privilegio.
--
-- ------------------------------------------------------------
-- POR QUÉ ESTO Y NO EL `GRANT` DE REVERSIÓN
-- ------------------------------------------------------------
-- `0012:574-582` dejó escrita su propia reversión (`GRANT SELECT ON TABLE
-- … TO authenticated`), que desatasca las dos rutas en una sentencia.
-- **DESCARTADA**: reabre TAXO-10 — vuelve a exponer el correo de
-- quien tocó la fila a cualquier sesión, que es exactamente la fuga que
-- `0012` cerró. Se arregla por el carril bueno de una vez.
--
-- ------------------------------------------------------------
-- EL INVARIANTE QUE RESTAURA
-- ------------------------------------------------------------
--     Ninguna sesión de usuario escribe DIRECTO sobre una tabla de lista
--     blanca.
--
-- Se cumplía en 2 de 3 tablas; esta migración lo cierra en la tercera.
-- Y queda VERIFICABLE, no declarado: `scripts/guarda-lista-blanca.mjs`
-- deriva la lista de tablas de la BASE (no la escribe a mano) y falla si
-- aparece una escritura directa nueva.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) La RPC. Misma forma exacta que `aplicar_override`
--     (0006_b5_dominio.sql): `SECURITY DEFINER`, `search_path` fijo,
--     guarda `is_admin()` propia, y el actor sale del JWT — NUNCA viaja
--     desde el cliente.
--
--     `p_campo` en vez de dos funciones: es el mismo molde que
--     `aplicar_override(p_sku, p_campo, p_valor)`, sobre la misma tabla y
--     con la misma disciplina. Dos funciones gemelas serían dos sitios
--     donde corregir la próxima vez.
--
--     La PALETA de color NO se re-valida aquí a propósito: ya vive en
--     `productos_metadata_color_check` (0006), que es la BASE y aplica a
--     todo el mundo. Repetir la lista de 8 valores en plpgsql crearía un
--     segundo lugar donde mantenerla y un tercero donde olvidarla — un
--     color inválido revienta con 23514, que es ruidoso y correcto.
--
--     `updated_at` SÍ se escribe explícitamente. Su DEFAULT `now()` solo
--     dispara en el INSERT y la tabla no tiene trigger (verificado), así
--     que hasta hoy una ACTUALIZACIÓN dejaba `updated_by` nuevo junto a un
--     `updated_at` viejo: la pareja mentía sobre cuándo. Es un cambio de
--     comportamiento deliberado y acotado a la escritura que esta
--     migración ya estaba reescribiendo.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_metadata(
  p_sku text, p_campo text, p_valor text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_campo NOT IN ('color','imagen_url') THEN
    RAISE EXCEPTION 'campo invalido' USING errcode = '22023';
  END IF;

  -- Restricción de DOMINIO en `imagen_url` (hallazgo A2 de la auditoría).
  -- `next.config.mjs` limita `images.remotePatterns` al Storage público del
  -- proyecto, y los dos consumidores usan `next/image`
  -- (`catalogo-grid.tsx:39`, `ficha-imagen.tsx:24-30`). Una URL fuera de ese
  -- patrón hace que `next/image` LANCE EN RENDER — y en el grid eso no rompe
  -- una tarjeta: rompe la página del catálogo para todos.
  --
  -- Hoy el valor siempre lo produce `getPublicUrl` del lado del servidor,
  -- pero esta RPC es alcanzable por `/rest/v1/rpc/` para cualquier admin con
  -- sesión, sin pasar por la ruta. Es P13 si la única defensa vive en el
  -- servicio. Se valida la FORMA (host de Supabase + ruta pública del bucket)
  -- y no el proyecto literal, para que no se rompa al clonar el entorno.
  IF p_campo = 'imagen_url' AND p_valor IS NOT NULL
     AND p_valor NOT LIKE 'https://%.supabase.co/storage/v1/object/public/producto-imagenes/%' THEN
    RAISE EXCEPTION 'imagen_url fuera del Storage publico del proyecto: %', left(p_valor, 80)
      USING errcode = '22023';
  END IF;

  -- `p_valor` NULL es un valor LEGÍTIMO en los dos campos: es "quitar el
  -- color" (la reversión que ya usa la ficha con `color:null`). No se
  -- confunde con "no mandes nada" porque cada rama toca UNA sola columna
  -- y deja la otra intacta — mismo criterio que tenían los dos upserts.
  IF p_campo = 'color' THEN
    INSERT INTO public.productos_metadata (sku, color, updated_by, updated_at)
    VALUES (p_sku, p_valor, v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      color      = EXCLUDED.color,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  ELSE
    INSERT INTO public.productos_metadata (sku, imagen_url, updated_by, updated_at)
    VALUES (p_sku, p_valor, v_actor, now())
    ON CONFLICT (sku) DO UPDATE SET
      imagen_url = EXCLUDED.imagen_url,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  END IF;
END;
$$;

-- Mismo cierre de privilegios que `aplicar_override` (0006:68-70):
-- `anon` jamás, `authenticated` sí (la guarda `is_admin()` de adentro es
-- el enforcement real, igual que en las otras 4 RPC de escritura).
REVOKE ALL   ON FUNCTION public.aplicar_metadata(text,text,text) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.aplicar_metadata(text,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.aplicar_metadata(text,text,text) TO authenticated;

-- ------------------------------------------------------------
-- (2) GUARDA DEL EFECTO REAL.
--
--     Lección de este mismo bloque, y por eso está escrita así: la guarda
--     de `0012` (P3) comprobó la matriz de privilegios con rigor y
--     ASUMIÓ el efecto en la app, en el mismo archivo donde declaraba que
--     no se supone nada. Ninguna guarda en SQL puede probar qué SQL genera
--     PostgREST.
--
--     Así que esta guarda comprueba SOLO lo que sí es comprobable desde
--     aquí —que la función existe con la firma esperada, que corre como
--     DEFINER, y que los privilegios quedaron donde deben— y DECLARA
--     explícitamente lo que NO puede ver.
--
--     Lo que no puede ver lo cubre un smoke manual contra el server, que hace
--     la petición HTTP real con sesión real y verificó ROJO contra el
--     estado previo a esta migración (varias comprobaciones en 500).
-- ------------------------------------------------------------
DO $guarda0017$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'aplicar_metadata'
     AND pg_get_function_identity_arguments(p.oid) = 'p_sku text, p_campo text, p_valor text';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION '0017: aplicar_metadata(text,text,text) no quedó creada. Abortando.';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '0017: aplicar_metadata NO es SECURITY DEFINER — correría como el usuario y volvería a chocar con el REVOKE de 0012. Abortando.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0017: anon puede EJECUTAR aplicar_metadata. Abortando.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '0017: authenticated NO puede ejecutar aplicar_metadata — las dos rutas seguirían rotas. Abortando.';
  END IF;

  -- Control anti-vacuidad: si `authenticated` recuperara el SELECT de
  -- tabla, esta migración habría "funcionado" sobre un problema que ya no
  -- existía — y sería señal de que alguien aplicó el GRANT de reversión
  -- que el PO descartó.
  IF has_table_privilege('authenticated', 'public.productos_metadata', 'SELECT') THEN
    RAISE NOTICE '0017 · AVISO: authenticated TIENE SELECT de tabla sobre productos_metadata. La fuga de TAXO-10 está abierta: alguien corrió el GRANT de reversión de 0012:574-582, que el PO descartó.';
  END IF;

  RAISE NOTICE '0017 · GUARDA VERDE: aplicar_metadata existe, es DEFINER, anon no la ejecuta y authenticated sí.';
  RAISE NOTICE '0017 · NO COMPROBADO AQUÍ (no se puede desde SQL): que las rutas /api/color y /api/imagenes ya no fallen. Eso lo mide un smoke manual contra el server corriendo.';
END $guarda0017$;

COMMIT;
