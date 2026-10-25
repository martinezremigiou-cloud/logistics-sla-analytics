// ============================================================
// [INV-B9] /api/campana — todo lo que la campana enseña, en una lectura.
//
// DEVUELVE UN OBJETO, NO UNA LISTA, así que NO va envuelto en `{ items }`: la
// convención de la casa es para endpoints de lista. `contrato-de-lista.test.ts`
// solo exige el envoltorio donde la ruta envuelve de verdad.
//
// EL REPARTO POR ROL ES DE UNA SOLA LÍNEA, y a propósito: `esAdmin` decide
// únicamente si se puebla `calladas`. **Un admin ve exactamente los mismos
// avisos que un KAM — los suyos.** Lo que una persona sigue es su
// configuración, no trabajo supervisable, y la RLS de la 0026 ni siquiera se
// lo enseñaría: no tiene rama `is_admin()` en ningún verbo.
//
// LA HORA SE INYECTA desde aquí y no se lee dentro del servicio para que la
// línea de fuentes calladas sea probable sin depender del día en que corra la
// suite.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { construirCampana } from '@/services/avisos.service';
import { enviadoHasta } from '@/services/correo.service';
import { canalDeCorreoCallado } from '@/lib/correo';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { leerRolPerfil } from '@/lib/api/perfil-rol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Varias lecturas acotadas a la ventana de 14 días y a los SKU seguidos. Se
// iguala al resto del repo en vez de afinar un número sin medirlo.
export const maxDuration = 30;

export async function GET() {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    // Fail-closed: si el rol no se puede leer, se sirve la campana SIN la línea
    // de admin. Degradar hacia "menos información" es lo correcto cuando lo que
    // está en duda es un permiso.
    const { rol } = await leerRolPerfil(db, gate.user.id);

    const ahora = new Date();
    const esAdmin = rol === 'admin';

    // ────────────────────────────────────────────────────────────
    // [INV-B9.1] LA ÚNICA ESCALADA DE PRIVILEGIO DE ESTA RUTA, y vive aquí
    // —pegada a la decisión de rol— en vez de escondida dentro del servicio.
    //
    // `envios_aviso` no tiene NINGUNA policy (0027), así que el cliente de
    // sesión no alcanza ni una fila ni siquiera siendo admin. Para saber si el
    // canal de correo se quedó callado hace falta la llave de servicio.
    //
    // Se acota a lo mínimo que existe: SOLO si quien mira es admin, y de todo
    // el registro se saca UN instante —el envío confirmado más reciente—. No
    // viaja ni un dato por persona.
    //
    // La alternativa era una policy de SELECT para admin sobre `envios_aviso`,
    // y se descartó: expondría el registro ENTERO (quién recibió qué y cuándo)
    // para contestar una pregunta que se responde con un escalar, y rompería
    // la propiedad de «cero policies» que la guarda de la 0027 y el gate de
    // seguridad afirman.
    // ────────────────────────────────────────────────────────────
    let correoCallado = null;
    if (esAdmin) {
      const ultimos = await enviadoHasta(createSupabaseServerClient());
      const masReciente = Array.from(ultimos.values()).sort().pop() ?? null;
      correoCallado = canalDeCorreoCallado(masReciente, ahora);
    }

    const campana = await construirCampana(db, { esAdmin, ahora, correoCallado });
    return NextResponse.json(campana, { status: 200 });
  } catch (e) {
    return internalError('api/campana', e);
  }
}
