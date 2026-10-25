// ============================================================
// Bloque VERT-B2 · EL TRINQUETE DE LA REGLA DE EXCLUSIÓN
//
// La regla «esta marca no se lista en el catálogo» vive en un DATO
// (`marcas.excluida_del_catalogo`, migración 0039), y la LEEN dos mitades que
// no comparten código:
//
//   catálogo  -> inventory.service.ts, DENTRO de la función pura `buildCatalogPage`
//   dashboard -> dashboard.service.ts, ARRIBA, en la capa de FETCH
//
// Esa asimetría es deliberada (el dashboard filtra en el origen porque
// `catalogo_total`, el mapa de calor, el radar y los rankings cuelgan todos de
// `input.productos`) y es exactamente la razón por la que NINGÚN test de una
// sola función pura puede cubrir las dos. Por eso este archivo existe aparte:
// es el único sitio del árbol donde las dos mitades se miden CON EL MISMO
// FIXTURE y se obligan a coincidir.
//
// LOS DOS ROJOS QUE VIGILA, y el segundo es el que importa:
//
//   (a) la regla APAGADA en cualquiera de las dos -> vuelven los excluidos.
//   (b) la regla aplicada en el CATÁLOGO pero NO en el DASHBOARD (o al revés)
//       -> rojo que NOMBRA cuál de las dos se cayó.
//
// (b) es el que vigila de verdad: (a) lo caza casi cualquier prueba del
// catálogo, pero (b) —el catálogo con un total y el dashboard con otro, las dos
// pantallas diciendo cosas distintas del mismo corte— es exactamente la razón
// que dio el censo previo para meter al dashboard en APLICA («la tarjeta
// se rotula "SKUs en catálogo"… la contradicción está a un scroll en la misma
// sesión»), y hasta este archivo NADA lo miraba.
//
// ⚠ Y NO es la contradicción `C-1` del censo, aunque lo parezca: `C-1` es el
// KPI «sin tecnología» valiendo una cifra mientras su enlace aterriza en otra
// distinta. Son defectos distintos; citar mal la fila manda a quien
// lea este rojo al renglón equivocado del censo.
//
// LO QUE ESTE TRINQUETE NO PUEDE VER, declarado:
//   · No toca la base. Prueba que el CÓDIGO aplica la regla que le llega en el
//     embed; NO prueba que la 0039 esté aplicada ni qué marca está marcada allá.
//   · Las cifras del bloque (total del catálogo y los excluidos de VERTICAL) NO se teclean aquí.
//     Un trinquete que las escribiera a mano probaría la transcripción de quien
//     las escribió, no el código (P26). Todo lo esperado se DERIVA del fixture.
//   · Un error DENTRO de `embedExcluida` afecta a las dos mitades con el mismo
//     signo, así que este cotejo saldría verde. Eso lo cubren las pruebas
//     unitarias de `src/lib/supabase/embed.test.ts`.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';
import type { InventoryQuery } from '@/schemas/inventory.schema';

const conVigenteStockMock = vi.fn();
const resolveVigenteMock = vi.fn();
vi.mock('./vigente.service', () => ({
  conVigenteStock: (...args: unknown[]) => conVigenteStockMock(...args),
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
}));

import { listInventory } from './inventory.service';
import { getDashboard } from './dashboard.service';

const VIGENTE: SnapshotVigente = { id: 'snap-vert', created_at: '2026-09-21T00:00:00.000Z', filas: 6, archivo: null };

const ESTATUS = [
  { orden: 1, nombre: 'Producto Solicitado' },
  { orden: 2, nombre: 'En Preparación' },
  { orden: 3, nombre: 'En Recolección' },
  { orden: 4, nombre: 'En Almacén FW' },
  { orden: 5, nombre: 'En Tránsito Aéreo' },
  { orden: 6, nombre: 'En Tránsito Marítimo' },
  { orden: 7, nombre: 'En Aduana' },
  { orden: 8, nombre: 'En Tránsito Terrestre' },
  { orden: 9, nombre: 'En Almacén Fiscal' },
  { orden: 10, nombre: 'En Almacén North' },
  { orden: 11, nombre: 'Producto Disponible' },
];

interface FilaFixture {
  sku: string;
  resv: number;
  descr_origen: string;
  cliente: null;
  snapshot_id: string;
  tecnologia: string | null;
  producto: null;
  marcas: { nombre: string; excluida_del_catalogo: boolean };
  familias: { nombre: string };
}

/**
 * EL FIXTURE. Dos marcas, y la excluida NO es un caso de juguete: aporta más
 * de una fila y aporta una TECNOLOGÍA y una FAMILIA propias, para que su
 * desaparición se note también en las facetas —el árbol— y no sólo en el total.
 */
function filas(excluir: boolean): FilaFixture[] {
  const base = (
    sku: string,
    marca: string,
    excluida: boolean,
    tecnologia: string | null,
    familia: string,
  ): FilaFixture => ({
    sku,
    resv: 0,
    descr_origen: 'Descr ' + sku,
    cliente: null,
    snapshot_id: VIGENTE.id,
    tecnologia,
    producto: null,
    marcas: { nombre: marca, excluida_del_catalogo: excluida },
    familias: { nombre: familia },
  });
  return [
    base('VIS-1', 'BRAND1', false, 'BRAND1', 'CANDADOS'),
    base('VIS-2', 'BRAND1', false, 'BRAND1', 'CANDADOS'),
    base('VIS-3', 'EAS', false, 'EAS', 'TAGS'),
    base('VIS-4', 'EAS', false, null, 'TAGS'),
    base('EXC-1', 'VERTICAL', excluir, null, 'ANAQUEL'),
    base('EXC-2', 'VERTICAL', excluir, 'VERT-TEC', 'ANAQUEL'),
  ];
}

/** Cliente falso que sirve A LAS DOS mitades: encadenable, thenable y con rpc. */
function fakeDb(rows: FilaFixture[]): SupabaseClient {
  const datos = (tabla: string): unknown[] => {
    if (tabla === 'productos') return rows;
    if (tabla === 'stock_por_almacen') {
      return rows.map((f) => ({ sku: f.sku, cantidad: 10, almacenes: { clave: 'NORTH' } }));
    }
    if (tabla === 'estatus_catalogo') return ESTATUS;
    return [];
  };
  function chain(tabla: string) {
    const node: Record<string, unknown> = {
      eq: () => node,
      in: () => node,
      order: () => node,
      range: (from: number, to: number) =>
        Promise.resolve({ data: datos(tabla).slice(from, to + 1), error: null }),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve({ data: datos(tabla), error: null }).then(ok, err),
    };
    return node;
  }
  return {
    from: (tabla: string) => ({ select: () => chain(tabla) }),
    rpc: async () => ({ data: { abiertos: 0, por_tipo: {} }, error: null }),
  } as unknown as SupabaseClient;
}

const QUERY: InventoryQuery = { page: 1, pageSize: 50, sinV2: false, divergencia: false };

function armarMocks() {
  conVigenteStockMock.mockImplementation(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
    fetcher(VIGENTE),
  );
  resolveVigenteMock.mockResolvedValue(null);
}

/** Corre LAS DOS mitades sobre EL MISMO fixture. */
async function ambasMitades(rows: FilaFixture[]) {
  armarMocks();
  const catalogo = await listInventory(fakeDb(rows), QUERY);
  armarMocks();
  const dashboard = await getDashboard(fakeDb(rows));
  return { catalogo, dashboard };
}

/** El mensaje NOMBRA cuál se cayó. Un rojo que no lo diga no sirve para arreglar nada. */
function diagnostico(catalogo: number, dashboard: number, esperado: number): string {
  if (catalogo === dashboard) {
    return `las DOS mitades cuentan ${catalogo} y se esperaban ${esperado}: la regla no se aplica en NINGUNA (o cambió el fixture)`;
  }
  const caido =
    catalogo === esperado ? 'el DASHBOARD' : dashboard === esperado ? 'el CATÁLOGO' : 'LAS DOS, y además distinto';
  return `catálogo=${catalogo} · dashboard=${dashboard} · esperado=${esperado} → el que se cayó es ${caido}. La tarjeta del dashboard se rotula «SKUs en catálogo»: con las dos mitades en desacuerdo, la contradicción queda A UN SCROLL en la misma sesión — que es, literalmente, la razón por la que el censo previo mete al dashboard en APLICA.`;
}

describe('VERT-B2 · la regla de exclusión, en las DOS mitades', () => {
  beforeEach(() => {
    conVigenteStockMock.mockReset();
    resolveVigenteMock.mockReset();
  });

  // ------------------------------------------------------------
  // ANTI-VACUIDAD (P17/P19): si el fixture no pudiera expresar la violación,
  // todo lo de abajo sería una guarda que no puede fallar. Se comprueba ANTES
  // de afirmar nada sobre el código.
  // ------------------------------------------------------------
  it('el fixture PUEDE expresar la diferencia (si no, todo lo de abajo es vacuo)', () => {
    const conRegla = filas(true);
    const visibles = conRegla.filter((f) => !f.marcas.excluida_del_catalogo).length;
    const excluidas = conRegla.length - visibles;
    expect(visibles, 'el fixture necesita filas VISIBLES').toBeGreaterThan(0);
    expect(excluidas, 'el fixture necesita filas EXCLUIDAS, o nada de esto mide nada').toBeGreaterThan(0);
    // y la marca excluida tiene que aportar más de una fila y señales propias
    expect(excluidas).toBeGreaterThan(1);
    expect(conRegla.some((f) => f.marcas.excluida_del_catalogo && f.tecnologia !== null)).toBe(true);
  });

  // ------------------------------------------------------------
  // CONTROL POSITIVO: el MISMO fixture con la bandera apagada tiene que dar el
  // universo COMPLETO en las dos mitades. Sin esto, las aserciones de abajo
  // pasarían igual con un `filter` que no filtra nada.
  // ------------------------------------------------------------
  it('control positivo · con la bandera APAGADA, las dos mitades cuentan el universo completo', async () => {
    const rows = filas(false);
    const { catalogo, dashboard } = await ambasMitades(rows);

    expect(catalogo.total).toBe(rows.length);
    expect(dashboard.kpis.catalogo_total.valor).toBe(rows.length);
    expect(catalogo.excluidos.total).toBe(0);
    expect(catalogo.excluidos.marcas).toEqual([]);
  });

  // ------------------------------------------------------------
  // ROJO (a) · la regla ENCENDIDA tiene que quitar a los excluidos, y el
  // esperado se DERIVA del fixture (nunca se teclea una cifra del bloque).
  // ------------------------------------------------------------
  it('rojo (a) · con la regla encendida, los excluidos NO cuentan — y si vuelven, esto falla', async () => {
    const rows = filas(true);
    const esperado = rows.filter((f) => !f.marcas.excluida_del_catalogo).length;
    const { catalogo, dashboard } = await ambasMitades(rows);

    expect(catalogo.total, 'el CATÁLOGO dejó de aplicar la regla: volvieron los excluidos').toBe(esperado);
    expect(dashboard.kpis.catalogo_total.valor, 'el DASHBOARD dejó de aplicar la regla: volvieron los excluidos').toBe(
      esperado,
    );
  });

  // ------------------------------------------------------------
  // ROJO (b) · EL QUE VIGILA. Las dos mitades, mismo fixture, misma cifra.
  // ------------------------------------------------------------
  it('rojo (b) · catálogo y dashboard cuentan LO MISMO, y el rojo nombra cuál se cayó', async () => {
    const rows = filas(true);
    const esperado = rows.filter((f) => !f.marcas.excluida_del_catalogo).length;
    const { catalogo, dashboard } = await ambasMitades(rows);

    const nCatalogo = catalogo.total;
    const nDashboard = dashboard.kpis.catalogo_total.valor;

    expect(nDashboard, diagnostico(nCatalogo, nDashboard, esperado)).toBe(nCatalogo);
    expect(nCatalogo, diagnostico(nCatalogo, nDashboard, esperado)).toBe(esperado);
  });

  // ------------------------------------------------------------
  // Lo excluido no puede volver por la puerta del ÁRBOL. El total podría estar
  // bien y las facetas seguir pintando la marca escondida: son dos lecturas
  // distintas del mismo corte y hay que exigir las dos.
  // ------------------------------------------------------------
  it('las facetas tampoco listan lo excluido — ni su marca, ni su familia, ni su tecnología', async () => {
    const rows = filas(true);
    const { catalogo } = await ambasMitades(rows);

    expect(catalogo.facetas.marcas.map((m) => m.valor)).not.toContain('VERTICAL');
    expect(catalogo.facetas.familias.map((f) => f.valor)).not.toContain('ANAQUEL');
    expect(catalogo.facetas.tecnologias.map((t) => t.valor)).not.toContain('VERT-TEC');
  });

  // ============================================================
  // LA TRAMPA DE LA REGLA ANTI-TRAMPA.
  //
  // `facetaConSeleccion` reinyecta el valor SELECCIONADO con conteo 0 cuando
  // ya no aparece en el universo — para que el usuario nunca quede sin forma
  // de quitar el filtro. Es una regla BUENA y no se toca: existe porque un
  // valor puede caer a 0 POR LA CASCADA (elegiste una tecnología donde esa
  // marca no tiene nada) y seguir siendo un destino legítimo.
  //
  // Pero con una liga guardada `?marca=VERTICAL` reinyectaba la marca que la
  // regla acaba de esconder: el árbol repintaba «VERTICAL (0)» sobre una
  // rejilla vacía. Dos partes de la misma pantalla afirmando lo contrario.
  //
  // LO QUE SE ESTRECHA, y por qué es un estrechamiento y no un apagado: sólo
  // se deja de reinyectar un valor que existe ÚNICAMENTE en la población
  // excluida. Un valor que vive en el universo visible sigue reinyectándose
  // aunque caiga a 0 por la cascada, y uno que no existe en ninguna parte
  // también — si no, una URL con una errata dejaría un filtro imposible de
  // quitar desde el selector.
  // ============================================================
  it('la marca excluida NO se reinyecta en la faceta aunque venga seleccionada en la URL', async () => {
    armarMocks();
    const page = await listInventory(fakeDb(filas(true)), { ...QUERY, marca: 'VERTICAL' });

    expect(page.total).toBe(0);
    expect(
      page.facetas.marcas.map((m) => m.valor),
      'el árbol repintaría «VERTICAL (0)» sobre una rejilla vacía: la pantalla diciendo dos cosas a la vez',
    ).not.toContain('VERTICAL');
  });

  it('y tampoco con otra capitalización — se compara como ya comparan la cascada y el filtro', async () => {
    armarMocks();
    const page = await listInventory(fakeDb(filas(true)), { ...QUERY, marca: 'vertical' });

    // La 0039 se ancló a `marca_id` justamente para que la regla no se pudiera
    // esquivar cambiando el texto. Reinyectar la cadena CRUDA de la URL habría
    // devuelto esa fragilidad por la puerta de atrás.
    expect(page.facetas.marcas.map((m) => m.valor.toLowerCase())).not.toContain('vertical');
  });

  it('lo mismo en tecnología y familia: un valor que SOLO vive en lo excluido no vuelve por la URL', async () => {
    armarMocks();
    const porTecnologia = await listInventory(fakeDb(filas(true)), { ...QUERY, tecnologia: 'VERT-TEC' });
    armarMocks();
    const porFamilia = await listInventory(fakeDb(filas(true)), { ...QUERY, familia: 'ANAQUEL' });

    expect(porTecnologia.facetas.tecnologias.map((t) => t.valor)).not.toContain('VERT-TEC');
    expect(porFamilia.facetas.familias.map((f) => f.valor)).not.toContain('ANAQUEL');
  });

  // ------------------------------------------------------------
  // LA MITAD QUE PROTEGE LA REGLA BUENA. Sin estos dos casos, «estrechar» y
  // «apagar» darían el mismo verde — y apagarla dejaría al usuario con un
  // filtro que no puede quitar desde el selector.
  // ------------------------------------------------------------
  it('la anti-trampa SIGUE viva: un valor visible que cae a 0 por la CASCADA se reinyecta igual', async () => {
    armarMocks();
    // EAS existe en el universo visible, pero no tiene ningún SKU con tecnología BRAND1.
    const page = await listInventory(fakeDb(filas(true)), { ...QUERY, tecnologia: 'BRAND1', marca: 'EAS' });

    expect(page.facetas.marcas).toContainEqual({ valor: 'EAS', conteo: 0 });
  });

  it('la anti-trampa SIGUE viva: un valor que no existe en ninguna parte también se reinyecta', async () => {
    armarMocks();
    const page = await listInventory(fakeDb(filas(true)), { ...QUERY, marca: 'NO-EXISTE' });

    expect(page.facetas.marcas).toContainEqual({ valor: 'NO-EXISTE', conteo: 0 });
  });

  // ------------------------------------------------------------
  // Y lo escondido se DECLARA. Una población oculta en silencio es el defecto
  // que este bloque existe para impedir: el contrato tiene que poder decirlo.
  // ------------------------------------------------------------
  it('el contrato DECLARA lo escondido: total y marcas, para que la pantalla pueda decirlo', async () => {
    const rows = filas(true);
    const excluidas = rows.filter((f) => f.marcas.excluida_del_catalogo);
    const { catalogo } = await ambasMitades(rows);

    expect(catalogo.excluidos.total).toBe(excluidas.length);
    expect(catalogo.excluidos.marcas).toEqual(['VERTICAL']);
  });
});
