// ============================================================
// Bloque 5 · /api/usuarios/[id] — Admin API de cuentas (mutación).
// PATCH: rol · suspender · reactivar · reset_password (unión
// discriminada por `accion`, ver `usuarios.schema.ts`). Protegida por
// `requireAdminSession` vía el cliente de SESIÓN; el cliente
// `service_role` se construye SOLO después de ese gate. Guardarraíl
// propio de esta ruta (no vive en el service): un admin no puede
// modificar su PROPIA cuenta por aquí (evita que se auto-suspenda o se
// autodegrade a kam y quede fuera del sistema sin otro admin activo).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { patchUsuarioSchema } from '@/schemas/usuarios.schema';
import { actualizarUsuario } from '@/services/usuarios.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const originGate = requireSameOrigin(req);
  if (originGate) return originGate;

  // Ambos clientes DENTRO del try/catch (FIX6): `createSupabaseSessionClient`/
  // `createSupabaseServerClient` pueden lanzar (p.ej. `getServerEnv` si falta
  // configuración) — fuera de aquí, ese throw escaparía como un 500 sin
  // `NextResponse.json` (cuerpo no-JSON), rompiendo el contrato O7.
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireAdminSession(db);
    if (gate instanceof NextResponse) return gate;

    if (params.id === gate.user.id) {
      return apiError('forbidden', { message: 'No puedes modificar tu propia cuenta desde aquí.' });
    }

    if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
      return apiError('payload_too_large');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = patchUsuarioSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const admin = createSupabaseServerClient();
    const result = await actualizarUsuario(admin, params.id, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/usuarios/[id]', e);
  }
}
