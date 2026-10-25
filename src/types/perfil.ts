import type { Rol, CampoOverride, SkuId } from './enums';

/** id = auth.uid(). Determina RLS. */
export interface Perfil {
  readonly id: string;
  email: string;
  rol: Rol;
}

/** D3 — edición trazable y reversible. SKU se conserva; solo familia/descripcion editables. */
export interface ProductoOverride {
  readonly id: string;
  sku: SkuId;
  campo: CampoOverride;
  valor_editado: string;
  editado_por: string;
  editado_en: string;
  activo: boolean;
}

export interface ProductoMetadata {
  readonly sku: SkuId;
  imagen_url: string | null;
  updated_by: string | null;
  updated_at: string;
}
