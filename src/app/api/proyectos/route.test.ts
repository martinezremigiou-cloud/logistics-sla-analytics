// ============================================================
// [2.0.1-B · S-1] /api/proyectos GET — el sobre lleva la VIGENCIA.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ESTA PRUEBA EXISTE: la mitad de servidor de una función entera.
//
// «inventario del …» pasa por cuatro sitios: esta ruta lo resuelve, el tipo lo
// declara, la vista lo pasa y la tarjeta lo pinta. Cada uno se puede probar solo
// y quedar VERDE mientras la cadena está cortada — es P24, la media función, que
// se ve igual que la completa. Las pruebas de componente cubren de la vista para
// abajo pasando el dato a mano; ésta cubre que el dato SALGA, que es el eslabón
// que ninguna de aquéllas puede ver.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProyectoResumen, ProyectosResponse } from '@/types/proyectos';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listarProyectosMock = vi.fn();
const crearProyectoMock = vi.fn();
const resolveVigenteMock = vi.fn();

const fakeDb = { __fakeDb: true };

vi.mock('@/services/proyectos.service', () => ({
  listarProyectos: (...args: unknown[]) => listarProyectosMock(...args),
  crearProyecto: (...args: unknown[]) => crearProyectoMock(...args),
}));

vi.mock('@/services/vigente.service', () => ({
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => fakeDb,
}));

// El gate de sesión tiene sus propias pruebas; aquí siempre pasa, para que lo
// que se mida sea la forma de la respuesta y no el permiso.
vi.mock('@/lib/api/auth', () => ({
  requireSession: () => Promise.resolve(null),
  requireSessionNoVisitante: () => Promise.resolve(null),
}));

const PROYECTO: ProyectoResumen = {
  id: '11111111-1111-1111-1111-111111111111',
  folio: 'PRJ-001',
  titulo: 'Rollout Retailer9 Series2 Q2',
  descripcion: null,
  notas: null,
  fecha: '2026-04-30',
  tipo: 'Rollout',
  intencion: 'Cotización',
  responsable: 'kam@example.com',
  creado_en: '2026-04-01T12:00:00.000Z',
  skus: 3,
  piezas: 400,
};

beforeEach(() => {
  listarProyectosMock.mockReset().mockResolvedValue([PROYECTO]);
  resolveVigenteMock.mockReset().mockResolvedValue({
    id: 'snap-9',
    created_at: '2026-08-20T17:02:00.000Z',
    filas: 870,
    archivo: 'stock.xlsx',
  });
});

describe('[2.0.1-B · S-1] GET /api/proyectos', () => {
  it('devuelve los ítems Y la vigencia del snapshot de STOCK', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as ProyectosResponse;
    expect(body.items).toHaveLength(1);
    expect(body.vigencia).toEqual({ snapshot_id: 'snap-9', tomado_en: '2026-08-20T17:02:00.000Z' });

    // La fuente importa: `aduana` daría otra fecha, y la que la tarjeta promete
    // es la del inventario con el que se leería el stock.
    expect(resolveVigenteMock).toHaveBeenCalledWith(fakeDb, 'stock');
  });

  it('sin snapshot: la vigencia va en `null`, NO se omite ni se inventa', async () => {
    // Que el campo exista en `null` es lo que le permite a la tarjeta decidir no
    // pintar la línea. Si la ruta lo omitiera, «no hay snapshot» y «esta versión
    // del servidor no manda el dato» serían indistinguibles para el cliente.
    resolveVigenteMock.mockResolvedValue(null);
    const { GET } = await import('./route');
    const body = (await (await GET()).json()) as ProyectosResponse;
    expect(body.vigencia).toEqual({ snapshot_id: null, tomado_en: null });
  });

  it('control positivo · la ruta RELAYA el servicio, no fabrica el sobre', async () => {
    // Sin esto, una ruta que devolviera `{ items: [], vigencia: … }` fijo
    // pondría verdes a las dos de arriba en cuanto el mock coincidiera por
    // casualidad. Se cambia el dato de origen y se exige que salga por el otro
    // lado — y que el servicio se llame con el cliente de SESIÓN, que es lo que
    // hace que la RLS decida qué ve cada quien.
    listarProyectosMock.mockResolvedValue([{ ...PROYECTO, folio: 'PRJ-777' }, { ...PROYECTO, folio: 'PRJ-778' }]);
    const { GET } = await import('./route');
    const body = (await (await GET()).json()) as ProyectosResponse;
    expect(body.items.map((p) => p.folio)).toEqual(['PRJ-777', 'PRJ-778']);
    expect(listarProyectosMock).toHaveBeenCalledWith(fakeDb);
  });
});
