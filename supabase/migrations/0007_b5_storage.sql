-- ============================================================
-- Bloque 5 · 0007_b5_storage.sql
-- Bucket 'producto-imagenes' público-LECTURA + policies admin.
-- DEPENDE de 0006 (GRANT is_admin → authenticated). IDEMPOTENTE.
-- ============================================================
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('producto-imagenes','producto-imagenes', true, 2097152,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS producto_imagenes_read ON storage.objects;
CREATE POLICY producto_imagenes_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'producto-imagenes');

DROP POLICY IF EXISTS producto_imagenes_admin_insert ON storage.objects;
CREATE POLICY producto_imagenes_admin_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'producto-imagenes' AND public.is_admin());

DROP POLICY IF EXISTS producto_imagenes_admin_update ON storage.objects;
CREATE POLICY producto_imagenes_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'producto-imagenes' AND public.is_admin())
  WITH CHECK (bucket_id = 'producto-imagenes' AND public.is_admin());

DROP POLICY IF EXISTS producto_imagenes_admin_delete ON storage.objects;
CREATE POLICY producto_imagenes_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'producto-imagenes' AND public.is_admin());

COMMIT;
