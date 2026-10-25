-- ============================================================
-- Bloque 7-A · FASE ROL VISITANTE · 0010_b7a_rol_visitante.sql
-- Tercer rol de SOLO LECTURA, `visitante`, hoy IDÉNTICO a `kam` en
-- permisos (auditoría ratificada: ningún permiso se concede por
-- `rol = 'kam'` — las policies RLS de escritura son SIEMPRE
-- `is_admin()`, es decir `rol = 'admin'`; las de lectura son
-- `USING(true)`). En B8 se le ocultará "Mis proyectos" en la UI.
-- (1) CHECK de rol: superconjunto estricto de {'kam','admin'} — un
--     CHECK no es referenciable (sin vistas/FK/índices que dependan
--     de él), así que DROP+ADD es seguro. Riesgo sobre los 3
--     usuarios reales: CERO (todas las filas ya satisfacen el
--     conjunto nuevo por ser superconjunto).
-- (2) GUARDA: falla ruidosamente si el DROP+ADD de (1) no dejó el
--     CHECK esperado (p.ej. 0001 se aplicó alguna vez con OTRO
--     nombre de constraint sobre `rol`, y ese CHECK viejo seguiría
--     vetando 'visitante' EN SILENCIO).
-- (3) FK perfiles.id → auth.users(id) ON DELETE CASCADE: hoy
--     `perfiles` NO tiene FK (0001:97-105) — borrar una cuenta deja
--     su perfil huérfano para siempre (se acumularon filas
--     basura de QA, ya limpiadas manualmente). DELETE previo
--     (idempotente) de huérfanos remanentes: sin él, el ADD
--     CONSTRAINT fallaría ante cualquier huérfano existente.
--     GUARDA DE RADIO DE IMPACTO (auditoría, hallazgo H1): el
--     DELETE va envuelto en un DO $$ que cuenta las filas borradas
--     y ABORTA toda la transacción si exceden 5 (se espera ninguna).
--     No es una carrera con `handle_new_user` (descartada: el
--     trigger es AFTER INSERT en la misma transacción, así que
--     `auth.users`/`perfiles` se hacen visibles atómicamente); el
--     riesgo es que el NOT EXISTS salga vacío para TODA fila por
--     una razón ajena (p.ej. el rol ejecutor sin visibilidad sobre
--     `auth.users`) y el DELETE vacíe `perfiles` completo antes de
--     hacer COMMIT. Como `perfiles` es la ÚNICA fuente de `rol`,
--     eso dejaría a TODOS los usuarios en 403 degradados a
--     'visitante': un bloqueo administrativo total, recuperable
--     solo con cirugía manual. El tope de 5 no es paranoia: es la
--     diferencia entre "unos cuantos huérfanos reales" y "vació la
--     tabla completa".
-- NO cambia el default de `handle_new_user` (queda en 'kam' — ver
-- 0002:35-54; cambiarlo exigiría arreglar antes `crearUsuario`, que
-- se apoya en ese default. Decisión de producto).
-- Idempotente. La aplica el operador por MCP; este archivo solo la
-- declara. PG 15.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) Ampliar el CHECK de rol a {'kam','admin','visitante'}
-- ------------------------------------------------------------
ALTER TABLE public.perfiles DROP CONSTRAINT IF EXISTS perfiles_rol_check;
ALTER TABLE public.perfiles ADD CONSTRAINT perfiles_rol_check
    CHECK (rol IN ('kam','admin','visitante'));

COMMENT ON COLUMN public.perfiles.rol IS
    'kam | admin | visitante. Los permisos se conceden SOLO vía is_admin() '
    '(rol=''admin''); kam y visitante son hoy equivalentes en RLS y en la '
    'app (visitante pierde acceso a "Mis proyectos" a partir de B8). Nunca '
    'se otorga ni verifica ningún permiso comparando directamente contra '
    'rol=''kam''.';

-- ------------------------------------------------------------
-- (2) GUARDA: aborta ruidosamente si el CHECK no quedó como se
-- espera, en vez de dejar 'visitante' vetado en silencio por un
-- constraint homónimo/huérfano de una aplicación anterior de 0001
-- con otro nombre.
-- ------------------------------------------------------------
DO $$
DECLARE
    v_def   text;
    v_otros integer;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_def
      FROM pg_constraint
     WHERE conrelid = 'public.perfiles'::regclass
       AND conname = 'perfiles_rol_check';

    IF v_def IS NULL THEN
        RAISE EXCEPTION '0010_b7a_rol_visitante: no se encontró la constraint perfiles_rol_check inmediatamente después del ADD CONSTRAINT — abortando.';
    END IF;

    IF v_def NOT LIKE '%visitante%' THEN
        RAISE EXCEPTION '0010_b7a_rol_visitante: perfiles_rol_check existe pero su definición (%) no incluye ''visitante'' — abortando.', v_def;
    END IF;

    SELECT count(*) INTO v_otros
      FROM pg_constraint
     WHERE conrelid = 'public.perfiles'::regclass
       AND contype = 'c'
       AND conname <> 'perfiles_rol_check'
       AND pg_get_constraintdef(oid) LIKE '%rol%';

    IF v_otros > 0 THEN
        RAISE EXCEPTION '0010_b7a_rol_visitante: existen % CHECK adicional(es) sobre la columna rol distintos de perfiles_rol_check — el rol ''visitante'' quedaría vetado en silencio por ellos. Abortando.', v_otros;
    END IF;
END $$;

-- ------------------------------------------------------------
-- (3) FK perfiles.id → auth.users(id) ON DELETE CASCADE.
-- DELETE idempotente de huérfanos remanentes ANTES del ADD
-- CONSTRAINT (si quedara alguno, el ADD fallaría).
-- GUARDA (hallazgo H1 de auditoría): se captura el conteo de filas
-- borradas y se aborta la transacción completa si excede 5 —
-- se espera ninguna (los huérfanos de QA ya se limpiaron a mano).
-- `perfiles` es el ÚNICO lugar donde vive `rol`: un DELETE que por
-- error vaciara la tabla y llegara a COMMIT dejaría a TODOS los
-- usuarios en 403 degradados a 'visitante' (bloqueo administrativo
-- total, recuperable solo con cirugía manual) — ver el comentario
-- de cabecera del archivo para el detalle del riesgo descartado
-- (no es una carrera con `handle_new_user`) y el que sí se cubre.
-- ------------------------------------------------------------
DO $$
DECLARE
    v_borrados integer;
BEGIN
    WITH d AS (
        DELETE FROM public.perfiles p
         WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
        RETURNING 1
    )
    SELECT count(*) INTO v_borrados FROM d;

    IF v_borrados > 5 THEN
        RAISE EXCEPTION '0010_b7a_rol_visitante: el DELETE de huérfanos afectó % filas, esperado ~0 — abortando por seguridad (perfiles es la única fuente de rol; ver comentario de cabecera).', v_borrados;
    END IF;
END $$;

ALTER TABLE public.perfiles DROP CONSTRAINT IF EXISTS perfiles_id_fkey;
ALTER TABLE public.perfiles ADD CONSTRAINT perfiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;

-- ============================================================
-- VERIFICACIÓN POST-APLICACIÓN (para el operador; fuera de la
-- transacción de arriba, no se ejecutan como parte de este archivo):
--
-- -- (a) El CHECK acepta 'visitante' bajo el nombre correcto:
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conrelid = 'public.perfiles'::regclass AND conname = 'perfiles_rol_check';
-- -- esperado: CHECK (rol = ANY (ARRAY['kam'::text,'admin'::text,'visitante'::text]))
--
-- -- (b) Cero perfiles huérfanos (sin auth.users correspondiente):
-- SELECT count(*) FROM public.perfiles p
--  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);
-- -- esperado: 0
--
-- -- (c) La FK quedó activa con ON DELETE CASCADE ('c' = cascade):
-- SELECT confdeltype FROM pg_constraint
--  WHERE conrelid = 'public.perfiles'::regclass AND conname = 'perfiles_id_fkey';
-- -- esperado: c
--
-- -- (d) Los usuarios reales conservan su rol/email intactos:
-- SELECT id, email, rol FROM public.perfiles ORDER BY email;
-- ============================================================
