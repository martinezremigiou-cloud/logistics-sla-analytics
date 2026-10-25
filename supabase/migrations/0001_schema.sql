-- ============================================================
-- Bloque 1 · Demo Inventory · 0001_schema.sql
-- Esquema completo: extensiones, catálogos, tablas, índices,
-- función de integridad de SKU, invariantes de negocio.
-- Orden de ejecución: 1 de 3 (antes de 0002_rls y 0003_seeds).
-- PG 15. Sin actualización a DB — script declarativo idempotente.
-- ============================================================


-- ============================================================
-- (1) EXTENSIÓN
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- (2) CATÁLOGOS RAÍZ (sin FK externas)
-- ============================================================

-- ------------------------------------------------------------
-- almacenes
-- Catálogo de los almacenes válidos. Extensible, pero la
-- clave está restringida al conjunto conocido vía CHECK.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.almacenes (
    id      uuid        NOT NULL DEFAULT gen_random_uuid(),
    clave   text        NOT NULL,
    nombre  text        NOT NULL,
    activo  boolean     NOT NULL DEFAULT true,

    CONSTRAINT almacenes_pkey PRIMARY KEY (id),
    CONSTRAINT almacenes_clave_unique UNIQUE (clave),
    CONSTRAINT almacenes_clave_check
        CHECK (clave IN ('NORTH','SOUTH','EAST','TRAN','BO','WEST'))
);

-- ------------------------------------------------------------
-- familias
-- Catálogo controlado de familias de producto (extensible por admin).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.familias (
    id      uuid    NOT NULL DEFAULT gen_random_uuid(),
    nombre  text    NOT NULL,
    activo  boolean NOT NULL DEFAULT true,

    CONSTRAINT familias_pkey PRIMARY KEY (id),
    CONSTRAINT familias_nombre_unique UNIQUE (nombre)
);

-- ------------------------------------------------------------
-- marcas
-- Catálogo canónico de marcas (MAYÚSCULAS). El ETL de B2
-- puede dar de alta marcas adicionales que aparezcan en la data.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marcas (
    id      uuid    NOT NULL DEFAULT gen_random_uuid(),
    nombre  text    NOT NULL,
    activo  boolean NOT NULL DEFAULT true,

    CONSTRAINT marcas_pkey PRIMARY KEY (id),
    CONSTRAINT marcas_nombre_unique UNIQUE (nombre)
);

-- ------------------------------------------------------------
-- kams
-- Ejecutivos de cuenta (Key Account Managers).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kams (
    id      uuid    NOT NULL DEFAULT gen_random_uuid(),
    nombre  text    NOT NULL,

    CONSTRAINT kams_pkey PRIMARY KEY (id),
    CONSTRAINT kams_nombre_unique UNIQUE (nombre)
);

-- ------------------------------------------------------------
-- estatus_catalogo
-- Pipeline de aduana: 9 estados fijos (orden 1–9).
-- La PK es el ordinal; inmutable en B1.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estatus_catalogo (
    orden   smallint    NOT NULL,
    nombre  text        NOT NULL,

    CONSTRAINT estatus_catalogo_pkey PRIMARY KEY (orden),
    CONSTRAINT estatus_catalogo_orden_check CHECK (orden BETWEEN 1 AND 9),
    CONSTRAINT estatus_catalogo_nombre_unique UNIQUE (nombre)
);

-- ------------------------------------------------------------
-- perfiles
-- Espejo de auth.users; id = auth.uid(). Sin default en id
-- (lo provee el trigger handle_new_user). Sin FK a auth.users
-- para evitar dependencias de esquema interno de Supabase Auth;
-- la integridad la garantiza el trigger after-insert.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.perfiles (
    id      uuid    NOT NULL,
    email   text    NOT NULL,
    rol     text    NOT NULL DEFAULT 'kam',

    CONSTRAINT perfiles_pkey PRIMARY KEY (id),
    CONSTRAINT perfiles_email_unique UNIQUE (email),
    CONSTRAINT perfiles_rol_check CHECK (rol IN ('kam','admin'))
);


-- ============================================================
-- (3) SNAPSHOTS (inmutable)
-- Cada ingesta produce exactamente 1 snapshot inmutable.
-- hash UNIQUE = idempotencia: re-ejecutar con los mismos datos
-- no genera duplicado. "Vigente" = snapshot con created_at más
-- reciente.
-- Columnas archivo y filas se adelantan a B1 para soportar la
-- ingesta desde el operador (el ETL de B2 las puebla).
-- INMUTABLE: sin UPDATE ni DELETE (RLS + sin policies de escritura).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.snapshots (
    id          uuid        NOT NULL DEFAULT gen_random_uuid(),
    fuente      text        NOT NULL,
    hash        text        NOT NULL,
    periodo     text        NOT NULL,
    archivo     text,
    filas       integer,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  text,

    CONSTRAINT snapshots_pkey PRIMARY KEY (id),
    CONSTRAINT snapshots_hash_unique UNIQUE (hash)
);


-- ============================================================
-- (4) TABLAS CON FK (núcleo transaccional)
-- ============================================================

-- ------------------------------------------------------------
-- productos
-- SKU es la PK de texto, INMUTABLE (protegida por trigger B1).
-- familia_id es nullable: un producto puede ingresarse sin
-- familia asignada hasta que el admin la clasifique vía override.
-- resv = cantidad reservada según la fuente (validada en ETL B2).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos (
    sku             text        NOT NULL,
    marca_id        uuid        NOT NULL,
    familia_id      uuid,
    class           text,
    descr_origen    text,
    cliente         text,
    resv            integer     NOT NULL DEFAULT 0,
    snapshot_id     uuid        NOT NULL,

    CONSTRAINT productos_pkey PRIMARY KEY (sku),
    CONSTRAINT productos_resv_check CHECK (resv >= 0),
    CONSTRAINT productos_marca_id_fkey
        FOREIGN KEY (marca_id) REFERENCES public.marcas(id),
    CONSTRAINT productos_familia_id_fkey
        FOREIGN KEY (familia_id) REFERENCES public.familias(id),
    CONSTRAINT productos_snapshot_id_fkey
        FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(id)
);

-- ------------------------------------------------------------
-- stock_por_almacen
-- D1: un renglón por (sku, almacen, snapshot). WEST es un
-- almacén más; no requiere columnas especiales.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_por_almacen (
    sku         text        NOT NULL,
    almacen_id  uuid        NOT NULL,
    snapshot_id uuid        NOT NULL,
    cantidad    integer     NOT NULL DEFAULT 0,

    CONSTRAINT stock_por_almacen_pkey
        PRIMARY KEY (sku, almacen_id, snapshot_id),
    CONSTRAINT stock_por_almacen_cantidad_check CHECK (cantidad >= 0),
    CONSTRAINT stock_por_almacen_sku_fkey
        FOREIGN KEY (sku) REFERENCES public.productos(sku),
    CONSTRAINT stock_por_almacen_almacen_id_fkey
        FOREIGN KEY (almacen_id) REFERENCES public.almacenes(id),
    CONSTRAINT stock_por_almacen_snapshot_id_fkey
        FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(id)
);

-- ------------------------------------------------------------
-- reservas
-- D2: des-pivoteo de la matriz KAM×cliente. kam_id nullable
-- cuando la reserva se atribuye directamente al cliente.
-- cantidad > 0 (no admite reservas en cero).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservas (
    id          uuid    NOT NULL DEFAULT gen_random_uuid(),
    sku         text    NOT NULL,
    kam_id      uuid,
    cliente     text    NOT NULL,
    cantidad    integer NOT NULL,
    motivo      text,
    fecha       date    NOT NULL,
    snapshot_id uuid    NOT NULL,

    CONSTRAINT reservas_pkey PRIMARY KEY (id),
    CONSTRAINT reservas_cantidad_check CHECK (cantidad > 0),
    CONSTRAINT reservas_sku_fkey
        FOREIGN KEY (sku) REFERENCES public.productos(sku),
    CONSTRAINT reservas_kam_id_fkey
        FOREIGN KEY (kam_id) REFERENCES public.kams(id),
    CONSTRAINT reservas_snapshot_id_fkey
        FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(id)
);

-- ------------------------------------------------------------
-- embarques
-- Seguimiento de aduana: activos (is_historial=false) e
-- históricos (is_historial=true). estatus_id referencia el
-- pipeline de 9 estados. piezas admite NULL (aún no confirmado).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.embarques (
    id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
    sku                     text        NOT NULL,
    oc_po                   text,
    proveedor               text,
    referencia              text,
    factura                 text,
    pais_origen             text,
    piezas                  integer,
    fw                      text,
    tipo_importacion        text,
    fecha_recoleccion       date,
    etd                     date,
    eta                     date,
    fecha_llegada           date,
    fecha_disponibilidad    date,
    estatus_id              smallint    NOT NULL,
    proyecto                text,
    observaciones           text,
    is_historial            boolean     NOT NULL DEFAULT false,
    snapshot_id             uuid        NOT NULL,

    CONSTRAINT embarques_pkey PRIMARY KEY (id),
    CONSTRAINT embarques_piezas_check
        CHECK (piezas IS NULL OR piezas >= 0),
    CONSTRAINT embarques_sku_fkey
        FOREIGN KEY (sku) REFERENCES public.productos(sku),
    CONSTRAINT embarques_estatus_id_fkey
        FOREIGN KEY (estatus_id) REFERENCES public.estatus_catalogo(orden),
    CONSTRAINT embarques_snapshot_id_fkey
        FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(id)
);

-- ------------------------------------------------------------
-- productos_metadata
-- Imagen por SKU (Supabase Storage). PK = sku (1:1 con productos).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos_metadata (
    sku         text        NOT NULL,
    imagen_url  text,
    updated_by  text,
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT productos_metadata_pkey PRIMARY KEY (sku),
    CONSTRAINT productos_metadata_sku_fkey
        FOREIGN KEY (sku) REFERENCES public.productos(sku)
);

-- ------------------------------------------------------------
-- productos_override
-- D3: edición trazable y reversible. Sin valor_original:
-- el valor de origen vive en productos (descr_origen / familia_id).
-- campo restringido a 'familia' | 'descripcion'.
-- activo=false = reversión sin borrado.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.productos_override (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    sku             text        NOT NULL,
    campo           text        NOT NULL,
    valor_editado   text        NOT NULL,
    editado_por     text        NOT NULL,
    activo          boolean     NOT NULL DEFAULT true,
    editado_en      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT productos_override_pkey PRIMARY KEY (id),
    CONSTRAINT productos_override_campo_check
        CHECK (campo IN ('familia','descripcion')),
    CONSTRAINT productos_override_sku_fkey
        FOREIGN KEY (sku) REFERENCES public.productos(sku)
);

-- ------------------------------------------------------------
-- marca_alias
-- Normaliza variantes de nombre de marca que llegan en la data
-- cruda. alias es texto libre (lowercase, con espacios, etc.)
-- que mapea a la marca canónica. WEST NO es marca, no se incluye.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marca_alias (
    alias       text    NOT NULL,
    marca_id    uuid    NOT NULL,

    CONSTRAINT marca_alias_pkey PRIMARY KEY (alias),
    CONSTRAINT marca_alias_marca_id_fkey
        FOREIGN KEY (marca_id) REFERENCES public.marcas(id)
);


-- ============================================================
-- (5) CAMBIOS (feed de trazabilidad — append-only)
-- Tabla append-only: el ETL de B2 la puebla con el diff entre
-- snapshots consecutivos. Incluye campo sku en todos los casos,
-- también en BAJAs (SKUs retirados), por eso sku no lleva FK
-- a productos (permite referencias a SKUs ya eliminados).
-- Escritura exclusiva de service_role; autenticados solo SELECT.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cambios (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    snapshot_id     uuid        NOT NULL,
    entidad         text        NOT NULL,
    clave           text        NOT NULL,
    sku             text,
    campo           text        NOT NULL,
    valor_anterior  text,
    valor_nuevo     text,
    tipo            text        NOT NULL,
    detectado_en    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cambios_pkey PRIMARY KEY (id),
    CONSTRAINT cambios_snapshot_id_fkey
        FOREIGN KEY (snapshot_id) REFERENCES public.snapshots(id),
    CONSTRAINT cambios_entidad_check
        CHECK (entidad IN ('producto','stock','reserva','embarque')),
    CONSTRAINT cambios_tipo_check
        CHECK (tipo IN ('ALTA','BAJA','MODIFICACION'))
);


-- ============================================================
-- (6) ÍNDICES DE RENDIMIENTO
-- ============================================================

-- ------------------------------------------------------------
-- productos
-- ------------------------------------------------------------
-- Filtro frecuente: catálogo por marca
CREATE INDEX IF NOT EXISTS idx_productos_marca_id
    ON public.productos (marca_id);

-- Filtro frecuente: catálogo por familia
CREATE INDEX IF NOT EXISTS idx_productos_familia_id
    ON public.productos (familia_id);

-- Trazabilidad: productos por snapshot
CREATE INDEX IF NOT EXISTS idx_productos_snapshot_id
    ON public.productos (snapshot_id);

-- ------------------------------------------------------------
-- stock_por_almacen
-- ------------------------------------------------------------
-- Desglose de almacén por SKU (ficha de producto)
CREATE INDEX IF NOT EXISTS idx_stock_por_almacen_sku
    ON public.stock_por_almacen (sku);

-- Consulta por snapshot (comparación entre ingestas)
CREATE INDEX IF NOT EXISTS idx_stock_por_almacen_snapshot_id
    ON public.stock_por_almacen (snapshot_id);

-- Resumen por almacén (dashboard)
CREATE INDEX IF NOT EXISTS idx_stock_por_almacen_almacen_id
    ON public.stock_por_almacen (almacen_id);

-- ------------------------------------------------------------
-- reservas
-- ------------------------------------------------------------
-- Reservas por SKU (invariante Σ reservas = resv)
CREATE INDEX IF NOT EXISTS idx_reservas_sku
    ON public.reservas (sku);

-- Reservas por KAM (panel de KAM)
CREATE INDEX IF NOT EXISTS idx_reservas_kam_id
    ON public.reservas (kam_id);

-- Reservas por snapshot
CREATE INDEX IF NOT EXISTS idx_reservas_snapshot_id
    ON public.reservas (snapshot_id);

-- ------------------------------------------------------------
-- embarques
-- ------------------------------------------------------------
-- Embarques por SKU (ficha de producto)
CREATE INDEX IF NOT EXISTS idx_embarques_sku
    ON public.embarques (sku);

-- Filtro por estatus (vista de pipeline)
CREATE INDEX IF NOT EXISTS idx_embarques_estatus_id
    ON public.embarques (estatus_id);

-- Filtro activos vs historial (partial indexes para mayor selectividad)
CREATE INDEX IF NOT EXISTS idx_embarques_activos
    ON public.embarques (sku, snapshot_id) WHERE is_historial = false;

CREATE INDEX IF NOT EXISTS idx_embarques_historial
    ON public.embarques (sku, snapshot_id) WHERE is_historial = true;

-- Embarques por snapshot
CREATE INDEX IF NOT EXISTS idx_embarques_snapshot_id
    ON public.embarques (snapshot_id);

-- Filtro compuesto sku + estatus (DoD del operador)
CREATE INDEX IF NOT EXISTS idx_embarques_sku_estatus
    ON public.embarques (sku, estatus_id);

-- ------------------------------------------------------------
-- productos_override
-- ------------------------------------------------------------
-- Override activo por SKU (valor efectivo)
CREATE INDEX IF NOT EXISTS idx_productos_override_sku_activo
    ON public.productos_override (sku, activo);

-- ------------------------------------------------------------
-- marca_alias
-- ------------------------------------------------------------
-- Búsqueda inversa alias → marca (normalización en ETL)
CREATE INDEX IF NOT EXISTS idx_marca_alias_marca_id
    ON public.marca_alias (marca_id);

-- ------------------------------------------------------------
-- snapshots
-- ------------------------------------------------------------
-- Ordenar por fecha para obtener el snapshot vigente
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at
    ON public.snapshots (created_at);

-- ------------------------------------------------------------
-- cambios
-- ------------------------------------------------------------
-- Historial de cambios por SKU ordenado por fecha de detección
CREATE INDEX IF NOT EXISTS idx_cambios_sku_detectado_en
    ON public.cambios (sku, detectado_en);

-- Cambios por snapshot (trazabilidad de una ingesta)
CREATE INDEX IF NOT EXISTS idx_cambios_snapshot_id
    ON public.cambios (snapshot_id);


-- ============================================================
-- (7) FUNCIÓN protect_sku_immutable() + TRIGGER before_update_sku
-- Invariante de negocio: el SKU es la llave universal y
-- NUNCA puede modificarse tras la ingesta inicial (Principio #2).
-- Se dispara BEFORE UPDATE; lanza EXCEPTION si NEW.sku ≠ OLD.sku.
-- SECURITY DEFINER + SET search_path = public evita inyección
-- de esquema; aplica incluso cuando service_role ejecuta el UPDATE.
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_sku_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.sku <> OLD.sku THEN
        RAISE EXCEPTION
            'SKU inmutable: no se puede modificar el SKU (% -> %)',
            OLD.sku, NEW.sku;
    END IF;
    RETURN NEW;
END;
$$;

-- Trigger en productos: BEFORE UPDATE → protect_sku_immutable()
DROP TRIGGER IF EXISTS before_update_sku ON public.productos;
CREATE TRIGGER before_update_sku
    BEFORE UPDATE ON public.productos
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_sku_immutable();


-- ============================================================
-- (8) INVARIANTES DE NEGOCIO (comentarios de referencia)
-- ============================================================
-- INVARIANTE 1 — Σ stock = total (gate ETL B2):
--   La suma de stock_por_almacen.cantidad para un SKU en un
--   snapshot debe coincidir con el total reportado por la fuente.
--   El ETL de B2 valida y rechaza la ingesta si no se cumple.
--
-- INVARIANTE 2 — Σ reservas = resv (gate ETL B2):
--   La suma de reservas.cantidad para un SKU en un snapshot
--   debe coincidir con productos.resv. El ETL de B2 valida y
--   rechaza la ingesta si no se cumple.
--
-- INVARIANTE 3 — SKU inmutable (trigger):
--   El trigger before_update_sku en productos impide cualquier
--   modificación del campo sku, incluso con service_role.
--
-- INVARIANTE 4 — Snapshots inmutables (RLS):
--   No existen policies de UPDATE ni DELETE sobre snapshots.
--   El UNIQUE (hash) garantiza idempotencia en re-ingestas.
--
-- INVARIANTE 5 — cambios append-only:
--   No existen policies de UPDATE ni DELETE sobre cambios.
--   Solo service_role puede insertar; los autenticados solo leen.
-- ============================================================
