-- ============================================================
-- Bloque 2 · Demo Inventory · 0004_estatus.sql
-- Migración aditiva: pipeline de aduana pasa de 9 a 11 estatus.
-- Nueva tabla data-driven `estatus_alias` (análoga a `marca_alias`)
-- para resolver variantes de texto crudo → orden 1..11 en el ETL.
-- Orden de ejecución: 4 (después de 0001/0002/0003).
-- La aplica el operador por MCP; este archivo solo declara el cambio.
-- IDEMPOTENTE. PG 15.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- (1) Ampliar el CHECK de orden a 1..11
-- ------------------------------------------------------------
ALTER TABLE public.estatus_catalogo DROP CONSTRAINT IF EXISTS estatus_catalogo_orden_check;
ALTER TABLE public.estatus_catalogo ADD CONSTRAINT estatus_catalogo_orden_check CHECK (orden BETWEEN 1 AND 11);

-- ------------------------------------------------------------
-- (2) Reemplazar el catálogo por los 11 estatus canónicos.
-- estatus_catalogo tiene UNIQUE(nombre) → DELETE + INSERT evita
-- colisiones de nombre al re-secuenciar los órdenes.
-- Los FK entrantes (embarques.estatus_id) se re-poblan por el ETL;
-- en una BD ya cargada, migrar embarques ANTES de correr esto.
-- ------------------------------------------------------------
DELETE FROM public.estatus_catalogo;
INSERT INTO public.estatus_catalogo (orden, nombre) VALUES
  (1,'Producto Solicitado'),(2,'En Preparación'),(3,'En Recolección'),(4,'En Almacén FW'),
  (5,'En Tránsito Aéreo'),(6,'En Tránsito Marítimo'),(7,'En Aduana'),(8,'En Tránsito Terrestre'),
  (9,'En Almacén Fiscal'),(10,'En Almacén North'),(11,'Producto Disponible');

-- ------------------------------------------------------------
-- (3) Tabla `estatus_alias` (alias PK, orden FK) — data-driven.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estatus_alias (
  alias text NOT NULL, orden smallint NOT NULL,
  CONSTRAINT estatus_alias_pkey PRIMARY KEY (alias),
  CONSTRAINT estatus_alias_orden_fkey FOREIGN KEY (orden) REFERENCES public.estatus_catalogo(orden));
CREATE INDEX IF NOT EXISTS idx_estatus_alias_orden ON public.estatus_alias(orden);

-- ------------------------------------------------------------
-- (4) RLS: SELECT autenticados · INSERT/UPDATE solo admin.
-- ------------------------------------------------------------
ALTER TABLE public.estatus_alias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS estatus_alias_select_auth ON public.estatus_alias;
CREATE POLICY estatus_alias_select_auth ON public.estatus_alias FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS estatus_alias_admin_insert ON public.estatus_alias;
CREATE POLICY estatus_alias_admin_insert ON public.estatus_alias FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS estatus_alias_admin_update ON public.estatus_alias;
CREATE POLICY estatus_alias_admin_update ON public.estatus_alias FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ------------------------------------------------------------
-- (5) Seed de alias normalizados (lowercase, sin acentos, tolerante
-- a erratas conocidas p.ej. 'trasito'). Clave = normalizeAliasKey.
-- ------------------------------------------------------------
INSERT INTO public.estatus_alias (alias, orden) VALUES
  ('producto solicitado',1),('solicitado',1),('en preparacion',2),('preparacion',2),
  ('en recoleccion',3),('recoleccion',3),('en almacen fw',4),('almacen fw',4),
  ('en transito aereo',5),('transito aereo',5),('en trasito aereo',5),
  ('en transito maritimo',6),('transito maritimo',6),('en aduana',7),('aduana',7),
  ('en transito terrestre',8),('transito terrestre',8),('en almacen fiscal',9),('almacen fiscal',9),
  ('en almacen north',10),('almacen north',10),('producto disponible',11),('disponible',11)
ON CONFLICT (alias) DO UPDATE SET orden = EXCLUDED.orden;

COMMIT;
