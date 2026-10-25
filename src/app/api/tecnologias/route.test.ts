// ============================================================
// [FIX-B1] GET /api/tecnologias — mismo molde que
// `app/api/familias/route.test.ts` (GET): sesión requerida, cualquier
// rol; cero lógica de dominio en la ruta, delega en el service.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listTecnologiasSeleccionablesMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'user@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'kam';

/**
 * Fake db de sesión: `auth.getUser()` y el rol de `perfiles` son
 * configurables por test. Default: sesión válida con rol `kam` — a
 * diferencia de `/api/override`, esta ruta es de LECTURA y cualquier rol
 * autenticado la alcanza (mismo criterio que `GET /api/familias`).
 */
const fakeDb = {
  __fakeDb: true,
  auth: {
    getUser: () => Promise.resolve({ data: { user: sessionUser }, error: sessionError }),
  },
  from: (table: string) => {
    if (table !== 'perfiles') throw new Error(`tabla inesperada en el fake db: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: perfilRol ? { rol: perfilRol } : null, error: null }),
        }),
      }),
    };
  },
};

const createSupabaseSessionClientMock = vi.fn(() => fakeDb);

vi.mock('@/services/tecnologias.service', () => ({
  listTecnologiasSeleccionables: (...args: unknown[]) => listTecnologiasSeleccionablesMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

describe('GET /api/tecnologias', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listTecnologiasSeleccionablesMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'kam';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200: regresa { items } tal cual el service, con sesión kam (no exige admin — es lectura)', async () => {
    listTecnologiasSeleccionablesMock.mockResolvedValueOnce(['EAS', 'BRAND2', 'BRAND1']);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ['EAS', 'BRAND2', 'BRAND1'] });
    expect(listTecnologiasSeleccionablesMock).toHaveBeenCalledWith(fakeDb);
  });

  it('lista vacía (migración aún no aplicada) → 200 con items: []', async () => {
    listTecnologiasSeleccionablesMock.mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(listTecnologiasSeleccionablesMock).not.toHaveBeenCalled();
  });

  it('rol visitante también alcanza (solo-lectura, sin gate de admin)', async () => {
    perfilRol = 'visitante';
    listTecnologiasSeleccionablesMock.mockResolvedValueOnce(['EAS']);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ['EAS'] });
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    listTecnologiasSeleccionablesMock.mockRejectedValueOnce(
      new Error('relation "tecnologias_seleccionables" violates constraint boom secreto'),
    );

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
