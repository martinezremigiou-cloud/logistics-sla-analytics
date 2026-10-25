// ============================================================
// Bloque 5 · API · auth.ts  (gates de sesión)
// Protección real de las rutas /api/* vía sesión Supabase (cookies,
// `createSupabaseSessionClient`). Reemplaza el header/secreto interino
// de escrituras admin de B3, retirado por completo en B5.
//
// `requireSession`: exige un usuario autenticado — lo usan las 5
// rutas de LECTURA y como primer paso de las de ESCRITURA.
// `requireAdminSession`: además exige rol='admin' en `perfiles` — solo
// las rutas de ESCRITURA (POST /api/familias, PUT /api/override).
// ============================================================
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { apiError, internalError } from './errors';
import { leerRolPerfil } from './perfil-rol';
import { PUEDE_ESCRIBIR_PROYECTOS } from '@/lib/roles';

/**
 * Gate de sesión: exige un usuario autenticado. `{ user }` si la
 * sesión es válida; si no, la respuesta 401 `unauthorized` ya armada —
 * el caller solo debe propagarla:
 * `const gate = await requireSession(db); if (gate instanceof NextResponse) return gate;`
 */
export async function requireSession(db: SupabaseClient): Promise<{ user: User } | NextResponse> {
  const {
    data: { user },
    error,
  } = await db.auth.getUser();

  if (error || !user) {
    return apiError('unauthorized');
  }

  return { user };
}

/**
 * [INV-B8] Gate de escrituras de PROYECTOS: exige sesión y rol distinto de
 * `visitante`. Es el TERCER gate del repo, y estrena el segundo eje de
 * permiso — hasta hoy solo existían "cualquier autenticado" y "admin".
 *
 * POR QUÉ HACE FALTA SI LA RLS YA LO IMPIDE. La policy
 * `proyectos_insert_own_no_visitante` (0024) ya rechaza el INSERT de un
 * visitante, pero lo hace con 42501, que sin traducir sale como **500**. Un
 * permiso denegado no es un error del servidor: es un 403, y el usuario
 * merece leerlo. La RLS sigue siendo la defensa real —esto es la que da la
 * semántica correcta— y por eso el gate NO sustituye a la policy: si alguien
 * borrara este gate, seguiría sin poder crear proyectos.
 *
 * Fail-closed igual que `requireAdminSession`: perfil ausente (carrera con
 * el trigger `handle_new_user`) se trata como sin permiso. Un fallo REAL de
 * lectura se propaga como 500, porque devolver 403 a un KAM legítimo por una
 * falla ajena a su rol sería mentirle sobre sus permisos.
 */
export async function requireSessionNoVisitante(db: SupabaseClient): Promise<{ user: User } | NextResponse> {
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const { rol, error } = await leerRolPerfil(db, user.id);
  if (error) {
    return internalError('lib/api/auth.requireSessionNoVisitante', error);
  }

  // [ROL-SOPORTE] LISTA BLANCA, no lista negra. Antes decía
  // `rol === 'visitante'`, que es «todos menos visitante»: cualquier rol
  // NUEVO pasaba este gate y obtenía escritura sin que nada se pusiera rojo.
  // Ahora se pregunta por el permiso, no por la identidad, y el rol que no
  // esté en el Record no compila. Para los tres roles de hoy el resultado es
  // idéntico.
  if (rol === null || !PUEDE_ESCRIBIR_PROYECTOS[rol]) {
    return apiError('forbidden', { message: 'Tu rol no permite crear ni editar proyectos.' });
  }

  return { user };
}

/**
 * Gate de escrituras admin: exige sesión Y rol='admin' en `perfiles`.
 * RLS de `perfiles` permite la propia lectura (own-read), así que el
 * select siempre resuelve para el usuario ya autenticado. Perfil
 * ausente (carrera con el trigger `handle_new_user`) se trata como
 * no-admin (fail-closed).
 *
 * Un fallo REAL de lectura (p.ej. PostgREST caído/timeout transitorio)
 * es distinto de "no es admin": descartarlo devolvería 403 a un admin
 * legítimo por una falla ajena a su rol. Ese caso se propaga como
 * `internal_error` (500) — el fail-closed sigue aplicando SOLO cuando
 * el perfil de verdad no existe o no es admin.
 *
 * La consulta misma vive en `leerRolPerfil` (`./perfil-rol`, compartida
 * con `middleware.ts`) — este gate solo decide QUÉ responder ante cada
 * resultado, no cómo se arma la query.
 */
export async function requireAdminSession(db: SupabaseClient): Promise<{ user: User } | NextResponse> {
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const { rol, error } = await leerRolPerfil(db, user.id);
  if (error) {
    return internalError('lib/api/auth.requireAdminSession', error);
  }

  if (rol !== 'admin') {
    return apiError('forbidden', { message: 'Tu rol no permite esta acción.' });
  }

  return { user };
}
