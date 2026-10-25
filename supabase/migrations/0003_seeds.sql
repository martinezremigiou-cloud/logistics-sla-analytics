-- ============================================================
-- Bloque 1 · Demo Inventory · 0003_seeds.sql
-- Seed idempotente de catálogos base.
-- Orden de ejecución: 3 de 3 (después de 0001_schema y 0002_rls).
-- IDEMPOTENTE: ON CONFLICT DO NOTHING en la mayoría de INSERT
-- (ver marca_alias que usa DO UPDATE para mantener referencia correcta).
-- PG 15. Sin actualización a DB — script declarativo.
-- ============================================================


-- ============================================================
-- almacenes (6 claves canónicas)
-- ============================================================
INSERT INTO public.almacenes (clave, nombre, activo) VALUES
    ('NORTH',   'Almacén North',   true),
    ('SOUTH', 'Almacén SOUTH', true),
    ('EAST', 'Almacén EAST', true),
    ('TRAN',   'Almacén TRAN',   true),
    ('BO',     'Almacén BO',     true),
    ('WEST',  'Almacén WEST',  true)
ON CONFLICT (clave) DO NOTHING;

-- ============================================================
-- estatus_catalogo (9 estados del pipeline de aduana)
-- Orden y nombres exactos aprobados por el arquitecto.
-- ============================================================
INSERT INTO public.estatus_catalogo (orden, nombre) VALUES
    (1, 'Solicitado'),
    (2, 'En Preparación'),
    (3, 'En Recolección'),
    (4, 'En Almacén FW'),
    (5, 'En Tránsito Aéreo'),
    (6, 'En Aduana'),
    (7, 'En Tránsito Terrestre'),
    (8, 'En Almacén North'),
    (9, 'Producto Disponible')
ON CONFLICT (orden) DO NOTHING;

-- ============================================================
-- kams (7 ejecutivos de cuenta)
-- ============================================================
INSERT INTO public.kams (nombre) VALUES
    ('Hugo'),
    ('Julio'),
    ('Elena'),
    ('Sergio'),
    ('Lucas'),
    ('Laura'),
    ('Diego')
ON CONFLICT (nombre) DO NOTHING;

-- ============================================================
-- marcas (canónicas, MAYÚSCULAS — 7 confirmadas)
-- NOTA: el ETL de Bloque 2 dará de alta cualquier marca
-- adicional que aparezca en la data cruda y no esté aquí;
-- este seed sólo fija las conocidas y validadas.
-- ============================================================
INSERT INTO public.marcas (nombre, activo) VALUES
    ('BRAND1',       true),
    ('BRAND6',      true),
    ('VERTICAL',    true),
    ('EAS',         true),
    ('CARGADOR',    true),
    ('SERIES5',  true),
    ('NACIONAL',    true)
ON CONFLICT (nombre) DO NOTHING;

-- ============================================================
-- marca_alias (alias de normalización del ETL)
-- Subconsulta garantiza coherencia aunque el id de marca varíe.
-- WEST NO es marca (es almacén): no se incluye.
-- ON CONFLICT DO UPDATE para mantener datos de referencia correctos.
-- TODO B2: agregar aliases adicionales (minúsculas/variantes) de
-- VERTICAL, EAS, CARGADOR, SERIES5, NACIONAL tras revisar la
-- data cruda del .ods
-- ============================================================
INSERT INTO public.marca_alias (alias, marca_id)
    SELECT 'brand1', id FROM public.marcas WHERE nombre = 'BRAND1'
ON CONFLICT (alias) DO UPDATE SET marca_id = EXCLUDED.marca_id;

INSERT INTO public.marca_alias (alias, marca_id)
    SELECT 'BRAND 6', id FROM public.marcas WHERE nombre = 'BRAND6'
ON CONFLICT (alias) DO UPDATE SET marca_id = EXCLUDED.marca_id;
