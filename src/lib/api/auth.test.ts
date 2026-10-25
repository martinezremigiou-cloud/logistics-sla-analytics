import { describe, it, expect, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { requireSession, requireAdminSession, requireSessionNoVisitante } from './auth';
import { ROLES_TODOS, PUEDE_ESCRIBIR_PROYECTOS } from '@/lib/roles';
import type { Rol } from '@/types/enums';

const fakeUser = { id: 'user-1', email: 'kam@example.com' } as User;

/** Fake db mínimo: `auth.getUser()` configurable + `from('perfiles')...maybeSingle()` configurable. */
function makeFakeDb(params: {
  user?: User | null;
  getUserError?: { message: string } | null;
  perfilRow?: { rol: Rol } | null;
  perfilError?: { message: string } | null;
}): SupabaseClient {
  const { user = null, getUserError = null, perfilRow = null, perfilError = null } = params;

  const maybeSingle = vi.fn().mockResolvedValue({ data: perfilRow, error: perfilError });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: getUserError }) },
    from,
  } as unknown as SupabaseClient;
}

async function json(res: NextResponse) {
  return res.json();
}

describe('requireSession', () => {
  it('usuario autenticado → { user }', async () => {
    const db = makeFakeDb({ user: fakeUser });

    const result = await requireSession(db);

    expect(result).toEqual({ user: fakeUser });
  });

  it('anon (sin user) → 401 unauthorized (shape uniforme)', async () => {
    const db = makeFakeDb({ user: null });

    const result = await requireSession(db);

    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'unauthorized' });
  });

  it('error de getUser() → 401 unauthorized', async () => {
    const db = makeFakeDb({ user: null, getUserError: { message: 'jwt expired' } });

    const result = await requireSession(db);

    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'unauthorized' });
  });
});

describe('requireAdminSession', () => {
  it('rol admin → { user }', async () => {
    const db = makeFakeDb({ user: fakeUser, perfilRow: { rol: 'admin' } });

    const result = await requireAdminSession(db);

    expect(result).toEqual({ user: fakeUser });
  });

  it('rol kam → 403 forbidden con mensaje es-MX', async () => {
    const db = makeFakeDb({ user: fakeUser, perfilRow: { rol: 'kam' } });

    const result = await requireAdminSession(db);

    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
  });

  it('anon → 401 unauthorized, no llega a consultar perfiles', async () => {
    const db = makeFakeDb({ user: null });

    const result = await requireAdminSession(db);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('perfil inexistente (carrera con el trigger) → 403 forbidden, fail-closed', async () => {
    const db = makeFakeDb({ user: fakeUser, perfilRow: null });

    const result = await requireAdminSession(db);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('error REAL de lectura en perfiles (p.ej. PostgREST caído) → 500 internal_error, NO 403: un admin legítimo no debe quedar bloqueado por una falla transitoria ajena a su rol', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeFakeDb({ user: fakeUser, perfilError: { message: 'conexión a perfiles caída (secreto)' } });

    const result = await requireAdminSession(db);

    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('secreto');
    consoleErrorSpy.mockRestore();
  });
});

// ============================================================
// [ROL-SOPORTE] requireSessionNoVisitante · el gate que NO TENÍA PRUEBAS.
//
// 🔴 ESTE PÁRRAFO DECÍA «OCHO rutas de producción (los cinco endpoints de
// /api/proyectos, el chat y /api/seguimientos)». **Las tres cosas eran falsas**,
// y la corrección importa porque alguien puede decidir si un rol de sólo lectura
// es seguro leyendo justo esta frase. Re-medido con `grep` sobre `src/app` y
// `src/lib`, excluyendo pruebas:
//
//     6 llamadas en 5 archivos, TODAS bajo `/api/proyectos`
//       route.ts:70 · [id]/route.ts:59 · [id]/partidas/route.ts:35
//       [id]/partidas/volcado/route.ts:55 · [id]/partidas/[partidaId]/route.ts:57 y :94
//
// `/api/chat` y `/api/seguimientos` usan **`requireSession`**, y cada uno lo
// declara en su propia cabecera: el chat dice «un visitante **ya lee** la
// ficha», y seguimientos, «decisión de producto: un visitante SÍ puede seguir». O
// sea que este gate **no los cubre**, y un rol de sólo lectura sí puede llamar
// al chat —que gasta la llave del modelo desde fuera del portal— y sí puede
// escribir en `seguimientos`. Eso no es un defecto de este gate: es el
// perímetro real, y está dicho aquí para que nadie lo deduzca al revés.
//
// Lo que sí era cierto y motivó estas pruebas: su única aparición en todo el
// árbol era un mock — `requireSessionNoVisitante: () => Promise.resolve(null)`
// en `proyectos/route.test.ts:44`, o sea «pasa siempre». Ninguna lo ejercitaba.
//
// Y es justo el gate cuyo predicado cambió en este bloque: era una LISTA NEGRA
// (`rol === 'visitante'`) y ahora pregunta por el permiso. Cambiar un gate sin
// pruebas y dejarlo sin pruebas sería confesar la condición en vez de cerrarla.
//
// Las pruebas van SOBRE `ROLES_TODOS` —los roles que EXISTEN— y no sobre
// `ROLES`, que es sólo lo que la interfaz OFRECE. La diferencia no es cosmética:
// `soporte` existe en el tipo y hoy NO se ofrece (la `0043` no está aplicada),
// así que iterar `ROLES` lo dejaría fuera justo del gate que tiene que cerrarle
// la puerta. Un rol nuevo entra aquí solo.
// ============================================================
describe('requireSessionNoVisitante', () => {
  it.each(ROLES_TODOS.filter((r) => PUEDE_ESCRIBIR_PROYECTOS[r]))('rol %s (SÍ escribe) → { user }', async (rol) => {
    const db = makeFakeDb({ user: fakeUser, perfilRow: { rol } });

    const result = await requireSessionNoVisitante(db);

    expect(result).toEqual({ user: fakeUser });
  });

  it.each(ROLES_TODOS.filter((r) => !PUEDE_ESCRIBIR_PROYECTOS[r]))('rol %s (NO escribe) → 403 forbidden', async (rol) => {
    const db = makeFakeDb({ user: fakeUser, perfilRow: { rol } });

    const result = await requireSessionNoVisitante(db);

    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({
      error: 'forbidden',
      message: 'Tu rol no permite crear ni editar proyectos.',
    });
  });

  // ANTI-VACUIDAD: los dos `it.each` de arriba serían vacuos si uno de los dos
  // conjuntos estuviera vacío — y un `it.each([])` NO falla, simplemente no
  // corre. Esto exige que haya roles de los dos lados.
  it('el reparto de ROLES_TODOS tiene roles a AMBOS lados (si no, los dos it.each son vacuos)', () => {
    expect(ROLES_TODOS.filter((r) => PUEDE_ESCRIBIR_PROYECTOS[r]).length).toBeGreaterThan(0);
    expect(ROLES_TODOS.filter((r) => !PUEDE_ESCRIBIR_PROYECTOS[r]).length).toBeGreaterThan(0);
  });

  // FAIL-CLOSED: perfil ausente (carrera con el trigger `handle_new_user`) NO
  // es permiso. Mismo criterio que `requireAdminSession`.
  it('sin fila en perfiles → 403, no se asume un rol por omisión', async () => {
    const db = makeFakeDb({ user: fakeUser, perfilRow: null });

    const result = await requireSessionNoVisitante(db);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  // ⚠ Y LA DISTINCIÓN QUE SOSTIENE AL GATE: un fallo REAL de lectura NO puede
  // salir como 403. Devolverle «tu rol no permite» a un KAM legítimo por una
  // falla ajena a su rol sería mentirle sobre sus permisos — lo dice el propio
  // doc-comment de la función, y hasta hoy nada lo comprobaba.
  it('error de lectura de perfiles → 500, NUNCA 403 (no se le miente al usuario sobre su rol)', async () => {
    const db = makeFakeDb({ user: fakeUser, perfilError: { message: 'boom' } });

    const result = await requireSessionNoVisitante(db);

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(500);
  });
});
