-- ============================================================
-- Bloque 1 · Demo Inventory · 0002_rls.sql
-- Funciones auxiliares, trigger de usuario nuevo, ENABLE RLS
-- y todas las policies de acceso en las 15 tablas.
-- Orden de ejecución: 2 de 3 (después de 0001_schema, antes de 0003_seeds).
-- DROP POLICY IF EXISTS + DROP TRIGGER IF EXISTS = re-aplicable (idempotente).
-- PG 15. Sin actualización a DB — script declarativo.
-- ============================================================


-- ============================================================
-- (1) FUNCIÓN is_admin()
-- Devuelve true si el usuario autenticado tiene rol 'admin'.
-- SECURITY DEFINER + SET search_path = public evita inyección
-- de esquema. STABLE: resultado constante dentro de la transacción.
-- Usada en todas las policies de escritura de catálogos/override.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.perfiles
        WHERE id = auth.uid()
          AND rol = 'admin'
    );
$$;


-- ============================================================
-- (2) FUNCIÓN handle_new_user() + TRIGGER on_auth_user_created
-- Trigger function que crea automáticamente el perfil cuando
-- un usuario se registra en auth.users. rol por defecto = 'kam'.
-- ON CONFLICT (id) DO NOTHING = idempotente ante re-disparos.
-- El primer admin debe marcarse manualmente:
--   UPDATE perfiles SET rol='admin' WHERE email='...';
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.perfiles (id, email, rol)
    VALUES (NEW.id, NEW.email, 'kam')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Trigger en auth.users: AFTER INSERT → handle_new_user()
-- DROP IF EXISTS permite re-aplicar sin error.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- (3) ENABLE ROW LEVEL SECURITY en las 15 tablas
-- ============================================================
ALTER TABLE public.almacenes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.familias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marcas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estatus_catalogo    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_por_almacen   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embarques           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_metadata  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos_override  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marca_alias         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cambios             ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- (4) POLICIES
-- ============================================================

-- ------------------------------------------------------------
-- snapshots
-- SELECT: cualquier usuario autenticado.
-- INSERT/UPDATE/DELETE: solo service_role (sin policy = RLS bloquea).
-- Snapshots son inmutables: no hay policy de UPDATE ni DELETE.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS snapshots_select_auth ON public.snapshots;
CREATE POLICY snapshots_select_auth
    ON public.snapshots
    FOR SELECT
    TO authenticated
    USING (true);

-- ------------------------------------------------------------
-- productos
-- SELECT: autenticados. Escritura: service_role únicamente.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS productos_select_auth ON public.productos;
CREATE POLICY productos_select_auth
    ON public.productos
    FOR SELECT
    TO authenticated
    USING (true);

-- ------------------------------------------------------------
-- stock_por_almacen
-- SELECT: autenticados. Escritura: service_role únicamente.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS stock_por_almacen_select_auth ON public.stock_por_almacen;
CREATE POLICY stock_por_almacen_select_auth
    ON public.stock_por_almacen
    FOR SELECT
    TO authenticated
    USING (true);

-- ------------------------------------------------------------
-- reservas
-- SELECT: autenticados. Escritura: service_role únicamente.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS reservas_select_auth ON public.reservas;
CREATE POLICY reservas_select_auth
    ON public.reservas
    FOR SELECT
    TO authenticated
    USING (true);

-- ------------------------------------------------------------
-- embarques
-- SELECT: autenticados. Escritura: service_role únicamente.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS embarques_select_auth ON public.embarques;
CREATE POLICY embarques_select_auth
    ON public.embarques
    FOR SELECT
    TO authenticated
    USING (true);

-- ------------------------------------------------------------
-- almacenes
-- SELECT: autenticados.
-- INSERT: solo admin (WITH CHECK).
-- UPDATE: solo admin (USING + WITH CHECK).
-- Sin DELETE: soft-delete con activo=false.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS almacenes_select_auth ON public.almacenes;
CREATE POLICY almacenes_select_auth
    ON public.almacenes
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS almacenes_admin_insert ON public.almacenes;
CREATE POLICY almacenes_admin_insert
    ON public.almacenes
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS almacenes_admin_update ON public.almacenes;
CREATE POLICY almacenes_admin_update
    ON public.almacenes
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- familias
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin.
-- Sin DELETE: soft-delete.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS familias_select_auth ON public.familias;
CREATE POLICY familias_select_auth
    ON public.familias
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS familias_admin_insert ON public.familias;
CREATE POLICY familias_admin_insert
    ON public.familias
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS familias_admin_update ON public.familias;
CREATE POLICY familias_admin_update
    ON public.familias
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- marcas
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin.
-- Sin DELETE: soft-delete.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS marcas_select_auth ON public.marcas;
CREATE POLICY marcas_select_auth
    ON public.marcas
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS marcas_admin_insert ON public.marcas;
CREATE POLICY marcas_admin_insert
    ON public.marcas
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS marcas_admin_update ON public.marcas;
CREATE POLICY marcas_admin_update
    ON public.marcas
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- marca_alias
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS marca_alias_select_auth ON public.marca_alias;
CREATE POLICY marca_alias_select_auth
    ON public.marca_alias
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS marca_alias_admin_insert ON public.marca_alias;
CREATE POLICY marca_alias_admin_insert
    ON public.marca_alias
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS marca_alias_admin_update ON public.marca_alias;
CREATE POLICY marca_alias_admin_update
    ON public.marca_alias
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- kams
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS kams_select_auth ON public.kams;
CREATE POLICY kams_select_auth
    ON public.kams
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS kams_admin_insert ON public.kams;
CREATE POLICY kams_admin_insert
    ON public.kams
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS kams_admin_update ON public.kams;
CREATE POLICY kams_admin_update
    ON public.kams
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- estatus_catalogo
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin (los 9 estados son fijos, pero se
-- deja la puerta abierta para correcciones de nombre vía admin).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS estatus_catalogo_select_auth ON public.estatus_catalogo;
CREATE POLICY estatus_catalogo_select_auth
    ON public.estatus_catalogo
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS estatus_catalogo_admin_insert ON public.estatus_catalogo;
CREATE POLICY estatus_catalogo_admin_insert
    ON public.estatus_catalogo
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS estatus_catalogo_admin_update ON public.estatus_catalogo;
CREATE POLICY estatus_catalogo_admin_update
    ON public.estatus_catalogo
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- productos_override
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin.
-- Sin DELETE: reversión vía activo=false.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS productos_override_select_auth ON public.productos_override;
CREATE POLICY productos_override_select_auth
    ON public.productos_override
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS productos_override_admin_insert ON public.productos_override;
CREATE POLICY productos_override_admin_insert
    ON public.productos_override
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS productos_override_admin_update ON public.productos_override;
CREATE POLICY productos_override_admin_update
    ON public.productos_override
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- productos_metadata
-- SELECT: autenticados.
-- INSERT/UPDATE: solo admin (gestión de imágenes).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS productos_metadata_select_auth ON public.productos_metadata;
CREATE POLICY productos_metadata_select_auth
    ON public.productos_metadata
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS productos_metadata_admin_insert ON public.productos_metadata;
CREATE POLICY productos_metadata_admin_insert
    ON public.productos_metadata
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS productos_metadata_admin_update ON public.productos_metadata;
CREATE POLICY productos_metadata_admin_update
    ON public.productos_metadata
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- perfiles
-- SELECT: el propio usuario (id = auth.uid()) O cualquier admin.
-- UPDATE: solo admin (puede cambiar rol de otro usuario).
-- INSERT: sin policy de usuario → solo el trigger handle_new_user
--         escribe aquí (SECURITY DEFINER, bypass RLS).
-- Sin DELETE: las cuentas no se borran desde la app.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS perfiles_select_own_or_admin ON public.perfiles;
CREATE POLICY perfiles_select_own_or_admin
    ON public.perfiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS perfiles_admin_update ON public.perfiles;
CREATE POLICY perfiles_admin_update
    ON public.perfiles
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- cambios
-- Tabla append-only de trazabilidad.
-- SELECT: cualquier usuario autenticado.
-- INSERT/UPDATE/DELETE: solo service_role (sin policy = RLS bloquea).
-- No hay policy de UPDATE ni DELETE: append-only por diseño.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS cambios_select_auth ON public.cambios;
CREATE POLICY cambios_select_auth
    ON public.cambios
    FOR SELECT
    TO authenticated
    USING (true);
