// ============================================================
// [VERT-B2] GET /api/marcas — el gobierno de la regla de exclusión.
//
// Lectura ADMIN-only, con el gate EXPLÍCITO (`requireAdminSession`) y no sólo
// con RLS. La política de `marcas` es `FOR SELECT TO authenticated USING (true)`
// (0002:210-214), o sea que la base dejaría leer esto a cualquier sesión: el
// 403 lo pone AQUÍ, a propósito, mismo criterio que `/api/pendientes`.
//
// Por qué admin y no todos: esta respuesta no dice «qué hay», dice QUIÉN
// DECIDIÓ QUÉ — motivo, autor y fecha de cada exclusión, más las marcas que
// entraron solas y nadie ha mirado. Es superficie de gobierno, no de catálogo.
//
// Y va con el cliente de SESIÓN, nunca con `service_role`: leer esto no
// necesita saltarse la RLS, y traer la llave maestra a una pantalla de UI sería
// pagar un privilegio que nadie pidió.
//
// SOLO GET. Encender y apagar la regla NO vive aquí — ver la cabecera de
// `marcas.service.ts`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { listarMarcasGobierno } from '@/services/marcas.service';
import { estadoDe } from '@/lib/marcas/gobierno';
import { internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireAdminSession(db);
    if (gate instanceof NextResponse) return gate;

    const marcas = await listarMarcasGobierno(db);
    // El estado se DERIVA en el servidor, con la misma función pura que prueban
    // sin base `gobierno.test.ts`: así el cliente no puede calcular la alarma
    // con un criterio distinto, que es como nacen dos verdades sobre lo mismo.
    return NextResponse.json(estadoDe(marcas), { status: 200 });
  } catch (e) {
    return internalError('api/marcas', e);
  }
}
