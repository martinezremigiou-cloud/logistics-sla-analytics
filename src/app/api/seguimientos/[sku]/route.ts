// ============================================================
// [INV-B9] /api/seguimientos/[sku] — dejar de seguir (DELETE).
//
// DEJAR DE SEGUIR DOS VECES DA EL MISMO RESULTADO QUE HACERLO UNA. Responde
// 200 en los dos casos y dice en el cuerpo si había algo que borrar. No es
// laxitud: el botón es un interruptor y el usuario puede darle dos veces en un
// teléfono lento; un 404 lo haría ver un error rojo por haber conseguido
// exactamente lo que quería.
//
// El `sku` viaja en la ruta y se normaliza con `skuParamSchema` — el MISMO
// criterio (trim + UPPER) con el que el ETL escribe `productos.sku` y con el
// que se guardó el seguimiento. Sin eso, `suj500-f` no borraría `SUJ500-F`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { skuParamSchema } from '@/schemas/sku.schema';
import { dejarDeSeguir } from '@/services/avisos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function DELETE(req: Request, { params }: { params: { sku: string } }) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    const parsed = skuParamSchema.safeParse(decodeURIComponent(params.sku));
    if (!parsed.success) {
      return apiError('invalid_query', { issues: parsed.error.issues });
    }

    const borrado = await dejarDeSeguir(db, parsed.data);
    return NextResponse.json({ ok: true, borrado }, { status: 200 });
  } catch (e) {
    return internalError('api/seguimientos/[sku]', e);
  }
}
