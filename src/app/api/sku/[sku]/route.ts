// ============================================================
// Bloque 5 · /api/sku/[sku] — ficha de producto (O2).
// Lectura protegida por sesión (`requireSession`, cualquier rol
// autenticado). Cero lógica de dominio aquí: normaliza/valida el
// param y delega en `getSkuDetalle`. 404 solo cuando el sku no existe
// en `productos` (una ficha en BAJA SÍ se sirve, con
// `snapshot.stock.vigente=false`).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { skuParamSchema } from '@/schemas/sku.schema';
import { getSkuDetalle } from '@/services/sku.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { sku: string } }) {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  const parsed = skuParamSchema.safeParse(params.sku);
  if (!parsed.success) {
    return apiError('invalid_query', { issues: parsed.error.issues });
  }

  try {
    const result = await getSkuDetalle(db, parsed.data);
    if (!result) {
      return apiError('sku_no_encontrado', { message: 'SKU no encontrado en el catálogo' });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/sku', e);
  }
}
