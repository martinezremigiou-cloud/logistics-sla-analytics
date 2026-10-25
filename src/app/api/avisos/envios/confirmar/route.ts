// ============================================================
// [INV-B9.1] /api/avisos/envios/confirmar — «este ya salió».
//
// ES LO ÚNICO QUE MUEVE LA AGUJA. Mientras no se confirme, la ventana sigue
// contando como no enviada y un intento posterior la vuelve a entregar. Esa
// asimetría es deliberada: **es preferible mandar un correo dos veces que
// perderlo**, y la marca no puede avanzar por una entrega que quizá no ocurrió.
//
// CONFIRMAR DOS VECES DA EL MISMO RESULTADO QUE CONFIRMAR UNA. Responde 200 en
// los dos casos y dice en el cuerpo si había algo que confirmar. Un 404 en la
// segunda haría que n8n marcara como fallida una entrega que sí ocurrió.
//
// Mismo gate que su hermana: solo `x-avisos-secret`, sin respaldo por sesión.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAvisosSecret } from '@/lib/env';
import { secretoDeCabeceraAutorizado } from '@/lib/api/ingest-auth';
import { apiError, internalError } from '@/lib/api/errors';
import { confirmarEnvio } from '@/services/correo.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const cuerpoSchema = z.object({
  perfil_id: z.string().uuid(),
  clave_intento: z.string().trim().min(1).max(120),
});

export async function POST(req: Request) {
  try {
    const secreto = getAvisosSecret();
    if (!secreto) {
      return apiError('config_error', { message: 'AVISOS_SECRET no está configurado en el servidor.' });
    }

    if (!secretoDeCabeceraAutorizado(req, 'x-avisos-secret', secreto.AVISOS_SECRET)) {
      return apiError('unauthorized');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = cuerpoSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const db = createSupabaseServerClient();
    const confirmado = await confirmarEnvio(db, parsed.data.perfil_id, parsed.data.clave_intento, new Date());

    // `confirmado:false` no es un error: o ya estaba confirmado, o esa clave no
    // se preparó nunca. Las dos cosas dejan el sistema en el estado correcto.
    return NextResponse.json({ ok: true, confirmado }, { status: 200 });
  } catch (e) {
    return internalError('api/avisos/envios/confirmar', e);
  }
}
