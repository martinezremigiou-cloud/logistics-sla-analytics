// ============================================================
// Bloque 5 · /api/usuarios — Admin API de cuentas (gestión de usuarios).
// GET (lista) y POST (alta): ambas protegidas por `requireAdminSession`
// vía el cliente de SESIÓN — RLS + `perfiles.rol` deciden si el actor
// puede administrar cuentas. El cliente `service_role`
// (`createSupabaseServerClient`) SOLO se construye DESPUÉS de pasar
// ese gate, y únicamente para operar la GoTrue Admin API (bypassa RLS
// por diseño: gestionar `auth.users` no tiene equivalente en RLS).
// Cero lógica de dominio aquí: valida y delega en `usuarios.service`.
//
// Ambos clientes + el gate + la validación + el service, TODO dentro
// de un único try/catch por handler (FIX H6, auditoría B7A):
// `createSupabaseSessionClient`/`createSupabaseServerClient` pueden
// lanzar (p.ej. env faltante, fallo de red en `getUser()`); fuera del
// try ese throw escaparía como un 500 sin `NextResponse.json` (cuerpo
// no-JSON), rompiendo el contrato de errores (mismo patrón que ya
// usan `usuarios/[id]` y `/api/snapshots`; lección FIX-RESET).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { altaUsuarioSchema } from '@/schemas/usuarios.schema';
import { listarUsuarios, crearUsuario } from '@/services/usuarios.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireAdminSession(db);
    if (gate instanceof NextResponse) return gate;

    const admin = createSupabaseServerClient();
    const items = await listarUsuarios(admin);
    return NextResponse.json({ items }, { status: 200 });
  } catch (e) {
    return internalError('api/usuarios', e);
  }
}

export async function POST(req: Request) {
  const originGate = requireSameOrigin(req);
  if (originGate) return originGate;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireAdminSession(db);
    if (gate instanceof NextResponse) return gate;

    if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
      return apiError('payload_too_large');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = altaUsuarioSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const admin = createSupabaseServerClient();
    const result = await crearUsuario(admin, parsed.data);
    if (!result.ok) {
      return apiError('usuario_duplicado', { message: 'Ya existe un usuario con ese correo.' });
    }
    return NextResponse.json(
      { usuario: result.usuario, password_temporal: result.password_temporal },
      { status: 201 },
    );
  } catch (e) {
    return internalError('api/usuarios', e);
  }
}
