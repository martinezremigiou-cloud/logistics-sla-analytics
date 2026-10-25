// ============================================================
// Bloque 6 · F2 · /api/pendientes — Bandeja de pendientes de datos
// (lista). Escritura/lectura ADMIN-only (`requireAdminSession`, igual
// que /api/usuarios): la RLS de `pendientes_datos` (0009) ya restringe
// el SELECT a admin, pero el gate explícito responde 401/403 sin
// depender solo de RLS (defensa en profundidad, mismo criterio que el
// resto de B5/B6). El conteo del dashboard (`kpis.pendientes`) NO pasa
// por aquí — usa la RPC `contar_pendientes` directo, abierta a
// cualquier autenticado (ver /api/dashboard). Cero lógica de dominio
// aquí: delega en `pendientes.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { listPendientes } from '@/services/pendientes.service';
import { internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] A4 (auditoría de seguridad) · maxDuration=30s. Sin medición
// propia de ESTA ruta — por analogía a /api/dashboard (medido: 1.03 s):
// `pendientes.service.ts` corre 3 llamadas en paralelo — un
// `fetchAllRows` sobre `pendientes_datos` (tabla chica por diseño: son
// pendientes por RESOLVER, no un histórico que crece sin límite), una
// RPC de conteo (`contar_pendientes`), y `fetchDescuadresVigentes`, la
// MISMA query que ya corre dentro de `/api/dashboard` — es un
// subconjunto estricto del trabajo que ya se midió ahí. Mismo tramo de
// 30s que su análogo medido.
export const maxDuration = 30;

export async function GET() {
  const db = createSupabaseSessionClient();
  const gate = await requireAdminSession(db);
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await listPendientes(db);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/pendientes', e);
  }
}
