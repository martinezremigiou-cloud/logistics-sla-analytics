-- Bloque 1 · Demo Inventory · Pruebas negativas RLS (N1–N8)
-- ============================================================
-- INSTRUCCIONES PARA QUIEN LOS EJECUTA (SQL Editor / psql)
--
-- * Cada bloque BEGIN…ROLLBACK es INDEPENDIENTE y auto-contenido.
--   Ejecútalos uno a la vez en el SQL Editor o con psql.
-- * postgres / service_role bypasea RLS para la siembra de fixtures;
--   luego SET LOCAL ROLE cambia el rol DENTRO de la transacción para
--   que las policies sí se evalúen en el DML de prueba.
-- * ÉXITO = obtener exactamente el error/resultado indicado en
--   "RESULTADO ESPERADO" de cada prueba.
-- * Al final de cada transacción se ejecuta ROLLBACK: ningún fixture
--   ni cambio queda en la base de datos.
-- * N1, N4, N8: deben lanzar ERROR 42501 (new row violates row-level security).
-- * N2, N7: deben devolver 0 filas actualizadas (UPDATE silencioso).
-- * N3, N5: deben devolver 0 filas en el SELECT.
-- * N6:     debe lanzar EXCEPTION del trigger protect_sku_immutable.
-- ============================================================


-- ============================================================
-- N1: KAM no puede hacer INSERT en productos_override
-- RESULTADO ESPERADO: ERROR 42501 — new row violates row-level security policy
-- ============================================================
BEGIN;

    -- Fixtures: snapshot, marca, familia, producto y perfil KAM de prueba
    INSERT INTO public.snapshots (id, fuente, hash, periodo)
    VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'hash-test-n1', '2026-06')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.marcas (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000010', 'MARCA-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.familias (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000020', 'FAM-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.productos (sku, marca_id, familia_id, snapshot_id)
    VALUES ('SKU-TEST-N1',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000020',
            '00000000-0000-0000-0000-000000000001')
    ON CONFLICT (sku) DO NOTHING;

    -- Perfil KAM de prueba (UUID fijo conocido)
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'kam-test-n1@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Simular sesión KAM
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
        true);

    -- DML prohibido: KAM intenta INSERT en productos_override (solo admin)
    -- RESULTADO ESPERADO: ERROR 42501 new row violates row-level security policy
    INSERT INTO public.productos_override (sku, campo, valor_editado, editado_por, activo)
    VALUES ('SKU-TEST-N1', 'descripcion', 'Valor ilegal', 'kam-test-n1@example.test', true);

ROLLBACK;


-- ============================================================
-- N2: KAM no puede hacer UPDATE en productos_metadata
-- RESULTADO ESPERADO: 0 filas actualizadas (RLS USING bloquea sin error explícito)
-- ============================================================
BEGIN;

    -- Fixtures
    INSERT INTO public.snapshots (id, fuente, hash, periodo)
    VALUES ('00000000-0000-0000-0000-000000000002', 'test', 'hash-test-n2', '2026-06')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.marcas (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000010', 'MARCA-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.familias (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000020', 'FAM-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.productos (sku, marca_id, familia_id, snapshot_id)
    VALUES ('SKU-TEST-N2',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000020',
            '00000000-0000-0000-0000-000000000002')
    ON CONFLICT (sku) DO NOTHING;

    INSERT INTO public.productos_metadata (sku, imagen_url)
    VALUES ('SKU-TEST-N2', 'https://original.example.com/img.png')
    ON CONFLICT (sku) DO NOTHING;

    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'kam-test-n2@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Simular sesión KAM
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
        true);

    -- DML prohibido: KAM intenta UPDATE en productos_metadata (solo admin)
    -- RESULTADO ESPERADO: 0 filas actualizadas
    UPDATE public.productos_metadata
    SET imagen_url = 'https://evil.example.com/hack.png'
    WHERE sku = 'SKU-TEST-N2';

ROLLBACK;


-- ============================================================
-- N3: KAM no puede ver el perfil de otro usuario
-- RESULTADO ESPERADO: 0 filas (RLS filtra; solo ve su propio perfil)
-- ============================================================
BEGIN;

    -- Perfil KAM atacante
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'kam-test-n3@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Perfil víctima (otro usuario distinto)
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000bb', 'victima-n3@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Simular sesión del KAM atacante
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
        true);

    -- DML prohibido: KAM intenta ver perfil ajeno
    -- RESULTADO ESPERADO: 0 filas
    SELECT * FROM public.perfiles
    WHERE email = 'victima-n3@example.test';

ROLLBACK;


-- ============================================================
-- N4: KAM no puede hacer INSERT en familias
-- RESULTADO ESPERADO: ERROR 42501 — new row violates row-level security policy
-- ============================================================
BEGIN;

    -- Perfil KAM de prueba
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'kam-test-n4@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Simular sesión KAM
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
        true);

    -- DML prohibido: KAM intenta INSERT en familias (solo admin)
    -- RESULTADO ESPERADO: ERROR 42501 new row violates row-level security policy
    INSERT INTO public.familias (nombre, activo)
    VALUES ('FamiliaIlegal', true);

ROLLBACK;


-- ============================================================
-- N5: Usuario anónimo no puede SELECT en productos
-- RESULTADO ESPERADO: 0 filas (RLS bloquea a anon; no existe policy SELECT para anon)
-- ============================================================
BEGIN;

    -- Fixture: un producto para que la tabla no esté vacía
    INSERT INTO public.snapshots (id, fuente, hash, periodo)
    VALUES ('00000000-0000-0000-0000-000000000005', 'test', 'hash-test-n5', '2026-06')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.marcas (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000010', 'MARCA-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.familias (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000020', 'FAM-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.productos (sku, marca_id, familia_id, snapshot_id)
    VALUES ('SKU-TEST-N5',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000020',
            '00000000-0000-0000-0000-000000000005')
    ON CONFLICT (sku) DO NOTHING;

    -- Simular sesión anónima (sin JWT válido)
    SET LOCAL ROLE anon;
    SELECT set_config('request.jwt.claims', '{}', true);

    -- DML prohibido: anon intenta SELECT en productos
    -- RESULTADO ESPERADO: 0 filas (no hay policy SELECT TO anon en productos)
    SELECT * FROM public.productos LIMIT 1;

ROLLBACK;


-- ============================================================
-- N6: Nadie puede cambiar el SKU de un producto (trigger inmutable)
-- RESULTADO ESPERADO: EXCEPTION 'SKU inmutable: no se puede modificar el SKU (...)'
-- Nota: service_role bypasea RLS pero el trigger BEFORE UPDATE aún dispara.
-- ============================================================
BEGIN;

    -- Fixtures como postgres (service_role / bypass RLS)
    INSERT INTO public.snapshots (id, fuente, hash, periodo)
    VALUES ('00000000-0000-0000-0000-000000000006', 'test', 'hash-test-n6', '2026-06')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.marcas (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000010', 'MARCA-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.familias (id, nombre, activo)
    VALUES ('00000000-0000-0000-0000-000000000020', 'FAM-TEST', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.productos (sku, marca_id, familia_id, snapshot_id)
    VALUES ('SKU-ORIGINAL-N6',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000020',
            '00000000-0000-0000-0000-000000000006')
    ON CONFLICT (sku) DO NOTHING;

    -- El trigger dispara independientemente del rol; no hace falta cambiar rol.
    -- DML prohibido: intento de modificar el SKU
    -- RESULTADO ESPERADO: RAISE EXCEPTION 'SKU inmutable: no se puede modificar el SKU (SKU-ORIGINAL-N6 -> SKU-CAMBIADO-N6)'
    UPDATE public.productos
    SET sku = 'SKU-CAMBIADO-N6'
    WHERE sku = 'SKU-ORIGINAL-N6';

ROLLBACK;


-- ============================================================
-- N7: KAM no puede actualizar el rol de otro usuario en perfiles
-- RESULTADO ESPERADO: 0 filas actualizadas (policy perfiles_admin_update requiere is_admin())
-- ============================================================
BEGIN;

    -- Perfil KAM atacante
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'kam-test-n7@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Perfil víctima
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000bb', 'victima-n7@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Simular sesión KAM atacante
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
        true);

    -- DML prohibido: KAM intenta escalar privilegios de otro usuario
    -- RESULTADO ESPERADO: 0 filas actualizadas
    UPDATE public.perfiles
    SET rol = 'admin'
    WHERE email = 'victima-n7@example.test';

ROLLBACK;


-- ============================================================
-- N8: KAM no puede hacer INSERT en cambios
-- RESULTADO ESPERADO: ERROR 42501 — new row violates row-level security policy
-- Cambios es append-only: solo service_role puede insertar.
-- ============================================================
BEGIN;

    -- Fixture: snapshot mínimo como postgres (bypass RLS)
    INSERT INTO public.snapshots (id, fuente, hash, periodo)
    VALUES ('00000000-0000-0000-0000-000000000008', 'test', 'hash-test-n8', '2026-06')
    ON CONFLICT (id) DO NOTHING;

    -- Perfil KAM de prueba
    INSERT INTO public.perfiles (id, email, rol)
    VALUES ('00000000-0000-0000-0000-0000000000aa', 'kam-test-n8@example.test', 'kam')
    ON CONFLICT (id) DO NOTHING;

    -- Simular sesión KAM
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',
        '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}',
        true);

    -- DML prohibido: KAM intenta INSERT en cambios (solo service_role)
    -- RESULTADO ESPERADO: ERROR 42501 new row violates row-level security policy
    INSERT INTO public.cambios
        (snapshot_id, entidad, clave, sku, campo, valor_anterior, valor_nuevo, tipo)
    VALUES
        ('00000000-0000-0000-0000-000000000008',
         'producto', 'SKU-TEST-N8', 'SKU-TEST-N8',
         'descr_origen', NULL, 'Descripción ilegal', 'ALTA');

ROLLBACK;
