// ============================================================
// Bloque 5 · /api/inventory — catálogo paginado (O1).
// Lectura protegida por sesión (`requireSession`, cualquier rol
// autenticado). Cero lógica de dominio aquí: valida query string y
// delega en `listInventory`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { inventoryQuerySchema } from '@/schemas/inventory.schema';
import { listInventory } from '@/services/inventory.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { searchParamsToObject } from '@/lib/api/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] A4 (auditoría de seguridad) · maxDuration=30s. MEDIDO por la
// propia auditoría: 0.57–1.76 s por petición aislada (catálogo
// completo armado en memoria vía 5 `fetchAllRows` sin cota,
// `inventory.service.ts:347-385`) y 2.05 s de pared con 10 peticiones
// concurrentes. Es la ruta MÁS pesada del dominio de lectura (la propia
// auditoría lo señala así) — 30s da ~17× de holgura sobre el peor tramo
// medido en request aislada (1.76 s) y ~15× sobre el peor de pared
// concurrente (2.05 s). Mismo tramo que /api/dashboard (medido 1.03 s):
// se prefiere igualar al resto de las lecturas en vez de subir a los 60s
// de /api/refresh, reservados para rutas con un tramo de ESCRITURA sin
// medir (aquí no hay escritura: es 100% lectura).
export const maxDuration = 30;

export async function GET(req: Request) {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  const raw = searchParamsToObject(req);

  const parsed = inventoryQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_query', { issues: parsed.error.issues });
  }

  try {
    const result = await listInventory(db, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/inventory', e);
  }
}
