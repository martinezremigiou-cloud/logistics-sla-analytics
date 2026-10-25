import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';
import type { MarcaGobierno } from '@/lib/marcas/gobierno';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listarMarcasGobiernoMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'user@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let perfilRol: Rol | null = 'admin';

const fakeDb = {
  __fakeDb: true,
  auth: { getUser: () => Promise.resolve({ data: { user: sessionUser }, error: null }) },
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

vi.mock('@/services/marcas.service', () => ({
  listarMarcasGobierno: (...args: unknown[]) => listarMarcasGobiernoMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function marca(over: Partial<MarcaGobierno> = {}): MarcaGobierno {
  return {
    nombre: 'BRAND1',
    excluida: false,
    motivo: null,
    por: null,
    en: null,
    creadaEn: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

// ============================================================
// [VERT-B2] EL GATE DE /api/marcas.
//
// La política de `marcas` en la base es `FOR SELECT TO authenticated
// USING (true)`: la RLS dejaría leer esto a CUALQUIER sesión. El 403 lo pone
// el handler, a propósito — y por eso hay que probarlo aquí, porque no hay
// ninguna otra capa que lo sostenga.
//
// Y lo que se protege no es «qué hay»: es QUIÉN DECIDIÓ QUÉ.
// ============================================================
describe('GET /api/marcas', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listarMarcasGobiernoMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(listarMarcasGobiernoMock).not.toHaveBeenCalled();
  });

  it.each(['kam', 'visitante', 'soporte'] as const)('rol %s → 403, y NO se llama al service', async (rol) => {
    perfilRol = rol;

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    // Que no se llame al service es la mitad que importa: un 403 que igual
    // consultó la base ya leyó lo que no debía leer.
    expect(listarMarcasGobiernoMock).not.toHaveBeenCalled();
  });

  it('admin → 200 con el estado DERIVADO en el servidor, no con las filas crudas', async () => {
    listarMarcasGobiernoMock.mockResolvedValueOnce([
      marca({ nombre: 'BRAND1' }),
      marca({ nombre: 'VERTICAL', excluida: true, motivo: 'no se cotiza', por: 'PO', en: '2026-09-21T00:00:00.000Z' }),
      marca({ nombre: 'RECIEN', creadaEn: '2026-09-21T10:00:00.000Z' }),
    ]);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    // La alarma la calcula EL SERVIDOR con la función pura. Si el cliente la
    // derivara por su cuenta habría dos criterios para lo mismo.
    expect(body.excluidas.map((m: MarcaGobierno) => m.nombre)).toEqual(['VERTICAL']);
    expect(body.sinDecidir.map((m: MarcaGobierno) => m.nombre)).toEqual(['RECIEN']);
    expect(body.total).toBe(3);
  });

  it('se lee con el cliente de SESIÓN (leer esto no necesita saltarse la RLS)', async () => {
    listarMarcasGobiernoMock.mockResolvedValueOnce([]);

    const { GET } = await import('./route');
    await GET();

    expect(createSupabaseSessionClientMock).toHaveBeenCalled();
    expect(listarMarcasGobiernoMock).toHaveBeenCalledWith(fakeDb);
  });

  it('si el service lanza → 500 y NO se filtra el mensaje interno', async () => {
    listarMarcasGobiernoMock.mockRejectedValueOnce(new Error('marcas: column "x" does not exist'));

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('does not exist');
  });
});
