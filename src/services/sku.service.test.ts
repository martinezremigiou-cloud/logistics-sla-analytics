import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';

const resolveVigentesMock = vi.fn();
vi.mock('./vigente.service', () => ({
  resolveVigentes: (...args: unknown[]) => resolveVigentesMock(...args),
}));

import {
  getSkuDetalle,
  buildSkuDetalle,
  type SkuProductoRow,
  type SkuStockRow,
  type SkuReservaRow,
  type SkuOverrideRow,
  type SkuEmbarqueRow,
  type SkuMetadataRow,
} from './sku.service';
import type { ClasificacionV2Lectura } from './derivaciones';
import type { CampoOverride } from '@/types/enums';
import { separarFamilias } from '@/lib/familias';

// ------------------------------------------------------------
// Fixtures — buildSkuDetalle (PURO)
// ------------------------------------------------------------
function productoRow(overrides: Partial<SkuProductoRow> = {}): SkuProductoRow {
  return {
    sku: 'A-1',
    resv: 0,
    descr_origen: 'Descripción original',
    cliente: 'RETAILER64',
    snapshot_id: 'snap-stock-1',
    marcas: { nombre: 'BRAND1' },
    familias: { nombre: 'CANDADOS' },
    ...overrides,
  };
}
function stockRow(almacen: string, cantidad: number): SkuStockRow {
  return { cantidad, almacenes: { clave: almacen } };
}
function reservaRow(overrides: Partial<SkuReservaRow> = {}): SkuReservaRow {
  return { cliente: 'RETAILER64', cantidad: 5, motivo: null, fecha: '2026-07-01', kams: { nombre: 'LUCAS' }, ...overrides };
}
function overrideRow(
  campo: CampoOverride,
  valor: string,
  opts: Partial<SkuOverrideRow> = {},
): SkuOverrideRow {
  return {
    id: 'ovr-1',
    sku: 'A-1',
    campo,
    valor_editado: valor,
    editado_en: '2026-07-01T00:00:00.000Z',
    activo: true,
    ...opts,
  };
}
function embarqueRow(overrides: Partial<SkuEmbarqueRow> = {}): SkuEmbarqueRow {
  return {
    id: 'emb-1',
    oc_po: 'OC-1',
    proveedor: 'PROV',
    referencia: null,
    factura: null,
    pais_origen: 'CN',
    piezas: 100,
    fw: 'AIR',
    tipo_importacion: 'MAR',
    fecha_recoleccion: null,
    etd: null,
    eta: '2026-08-01',
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus_id: 7,
    proyecto: null,
    observaciones: null,
    is_historial: false,
    estatus_catalogo: { nombre: 'En Aduana' },
    ...overrides,
  };
}
function v2Fixture(overrides: Partial<ClasificacionV2Lectura> = {}): ClasificacionV2Lectura {
  return {
    sku: 'A-1',
    tecnologia: 'RFID',
    marca_v2: 'MARCA V2',
    familia_v2: 'FAMILIA V2',
    clase_v2: 'CLASE V2',
    descr_v2: 'Descr V2',
    ...overrides,
  };
}

const vigenteStock: SnapshotVigente = {
  id: 'snap-stock-1',
  created_at: '2026-07-10T00:00:00.000Z',
  filas: 900,
  archivo: 'stock.xlsx',
};
const vigenteAduana: SnapshotVigente = {
  id: 'snap-aduana-1',
  created_at: '2026-07-09T00:00:00.000Z',
  filas: 300,
  archivo: 'aduana.xlsx',
};
const snapshotPropio = vigenteStock;
const HOY = '2026-07-12';

describe('buildSkuDetalle', () => {
  it('caso completo: stock multi-almacén, reserva, override, embarque, metadata, snapshots vigentes', () => {
    const producto = productoRow({ resv: 5 });
    const stock = [stockRow('NORTH', 10), stockRow('SOUTH', 3)];
    const reservas = [reservaRow({ cantidad: 5 })];
    const overrides = [overrideRow('descripcion', 'Descripción editada')];
    const embarques = [embarqueRow()];
    const metadata: SkuMetadataRow = { imagen_url: 'https://cdn/x.png', color: 'turquesa' };

    const d = buildSkuDetalle({
      producto,
      stockRows: stock,
      reservasRows: reservas,
      overrides,
      embarquesRows: embarques,
      metadata,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });

    expect(d.sku).toBe('A-1');
    expect(d.marca).toBe('BRAND1');
    expect(d.familia_efectiva).toBe('CANDADOS');
    expect(d.descr_efectiva).toBe('Descripción editada');
    expect(d.original).toEqual({ familia: 'CANDADOS', descr: 'Descripción original' });
    expect(d.stock).toEqual([
      { almacen: 'NORTH', cantidad: 10 },
      { almacen: 'SOUTH', cantidad: 3 },
    ]);
    expect(d.total).toBe(13);
    expect(d.reservado).toBe(5);
    expect(d.disponible).toBe(8);
    expect(d.sobre_reservado).toBe(false);
    expect(d.reserva_descuadre).toBe(false);
    expect(d.reservas).toEqual([{ kam: 'LUCAS', cliente: 'RETAILER64', cantidad: 5, motivo: null, fecha: '2026-07-01' }]);
    expect(d.embarques).toHaveLength(1);
    expect(d.embarques[0]).toMatchObject({ id: 'emb-1', estatus: 'En Aduana', estatus_orden: 7, is_historial: false });
    expect(d.imagen_url).toBe('https://cdn/x.png');
    expect(d.color).toBe('turquesa');
    expect(d.snapshot.stock).toEqual({
      id: 'snap-stock-1',
      created_at: vigenteStock.created_at,
      filas: 900,
      archivo: 'stock.xlsx',
      vigente: true,
    });
    expect(d.snapshot.aduana).toEqual({
      id: 'snap-aduana-1',
      created_at: vigenteAduana.created_at,
      filas: 300,
      archivo: 'aduana.xlsx',
      vigente: true,
    });
  });

  it('DD8309-G: resv 7350 y Σreservas 0 → reservado 7350, reserva_descuadre true', () => {
    const producto = productoRow({ sku: 'DD8309-G', resv: 7350 });
    const d = buildSkuDetalle({
      producto,
      stockRows: [stockRow('NORTH', 7350)],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.sku).toBe('DD8309-G');
    expect(d.reservado).toBe(7350);
    expect(d.reserva_descuadre).toBe(true);
  });

  it('WEST-only: stock [{WEST,n}] → total = n, sin tratamiento especial', () => {
    const producto = productoRow({ resv: 0 });
    const d = buildSkuDetalle({
      producto,
      stockRows: [stockRow('WEST', 9)],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.stock).toEqual([{ almacen: 'WEST', cantidad: 9 }]);
    expect(d.total).toBe(9);
    expect(d.disponible).toBe(9);
    expect(d.sobre_reservado).toBe(false);
  });

  it('sobre_reservado true cuando disponible < 0', () => {
    const producto = productoRow({ resv: 20 });
    const d = buildSkuDetalle({
      producto,
      stockRows: [stockRow('NORTH', 5)],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.disponible).toBe(-15);
    expect(d.sobre_reservado).toBe(true);
  });

  it('BAJA: snapshot propio ya no es el vigente de stock → snapshot.stock.vigente false (la ficha se sirve igual)', () => {
    const producto = productoRow({ snapshot_id: 'snap-stock-OLD' });
    const snapshotViejo: SnapshotVigente = {
      id: 'snap-stock-OLD',
      created_at: '2026-06-01T00:00:00.000Z',
      filas: 800,
      archivo: 'viejo.xlsx',
    };
    const d = buildSkuDetalle({
      producto,
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio: snapshotViejo,
      hoy: HOY,
    });
    expect(d.snapshot.stock).toEqual({
      id: 'snap-stock-OLD',
      created_at: snapshotViejo.created_at,
      filas: 800,
      archivo: 'viejo.xlsx',
      vigente: false,
    });
  });

  it('sin vigente aduana → embarques [] y snapshot.aduana null', () => {
    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana: null,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.embarques).toEqual([]);
    expect(d.snapshot.aduana).toBeNull();
  });

  it('orden de embarques: is_historial ASC → estatus_orden ASC → eta ASC con nulls al final', () => {
    const e1 = embarqueRow({ id: 'e1', is_historial: false, estatus_id: 5, eta: '2026-09-01' });
    const e2 = embarqueRow({ id: 'e2', is_historial: false, estatus_id: 5, eta: '2026-08-01' });
    const e3 = embarqueRow({ id: 'e3', is_historial: false, estatus_id: 5, eta: null });
    const e4 = embarqueRow({ id: 'e4', is_historial: false, estatus_id: 2, eta: '2026-12-01' });
    const e5 = embarqueRow({ id: 'e5', is_historial: true, estatus_id: 1, eta: '2026-01-01' });

    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [e1, e2, e3, e4, e5],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });

    expect(d.embarques.map((e) => e.id)).toEqual(['e4', 'e2', 'e1', 'e3', 'e5']);
  });

  it('imagen_url y color null cuando no hay fila de metadata', () => {
    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.imagen_url).toBeNull();
    expect(d.color).toBeNull();
  });

  it('metadata con imagen_url pero sin color asignado → color null (independiente de imagen_url)', () => {
    const metadata: SkuMetadataRow = { imagen_url: 'https://cdn/x.png', color: null };
    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.imagen_url).toBe('https://cdn/x.png');
    expect(d.color).toBeNull();
  });

  it('snapshot.stock null si la fila de snapshot propio no aparece (defensivo)', () => {
    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio: null,
      hoy: HOY,
    });
    expect(d.snapshot.stock).toBeNull();
  });

  it('familia origen null sin override → familia_efectiva y original.familia null', () => {
    const producto = productoRow({ familias: null });
    const d = buildSkuDetalle({
      producto,
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.familia_efectiva).toBeNull();
    expect(d.original.familia).toBeNull();
  });

  describe('INV-TAXO F2 — familias_efectivas (multi-valor)', () => {
    it('invariante: familias_efectivas === separarFamilias(familia_efectiva)', () => {
      const producto = productoRow({ familias: { nombre: 'CLIP 3.0 / CLIP ROTATIVO' } });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.familia_efectiva).toBe('CLIP 3.0 / CLIP ROTATIVO');
      expect(d.familias_efectivas).toEqual(['CLIP 3.0', 'CLIP ROTATIVO']);
      expect(d.familias_efectivas).toEqual(separarFamilias(d.familia_efectiva));
    });

    it('familia_efectiva null (sin familia) → familias_efectivas []', () => {
      const producto = productoRow({ familias: null });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.familias_efectivas).toEqual([]);
    });

    it('single-valor (sin "/"): familias_efectivas es un arreglo de 1 elemento', () => {
      const producto = productoRow({ familias: { nombre: 'CANDADOS' } });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.familias_efectivas).toEqual(['CANDADOS']);
    });

    it('familias_efectivas refleja la familia EFECTIVA (override manual), no la de fuente', () => {
      const producto = productoRow({ familias: { nombre: 'CANDADOS' } });
      const overrides = [overrideRow('familia', 'FAM MANUAL / OTRA FAM')];
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides,
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.familia_efectiva).toBe('FAM MANUAL / OTRA FAM');
      expect(d.familias_efectivas).toEqual(['FAM MANUAL', 'OTRA FAM']);
    });

    it('familias_efectivas separa la familia de FUENTE cuando no hay override manual (D-1(a): familia_v2 ya no gana)', () => {
      const producto = productoRow({ familias: { nombre: 'SENSORES / CARGADORES' } });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        // v2 presente y con OTRO valor: se ignora, sigue siendo la fuente la que se separa.
        v2: v2Fixture({ familia_v2: 'FAM V2 QUE NO IMPORTA' }),
      });
      expect(d.familias_efectivas).toEqual(['SENSORES', 'CARGADORES']);
    });
  });

  it('stock_cero: sin filas de stock → total 0', () => {
    const d = buildSkuDetalle({
      producto: productoRow({ resv: 0 }),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });
    expect(d.total).toBe(0);
    expect(d.disponible).toBe(0);
  });

  it('piezas_en_camino: Σ piezas (null→0) de embarques activos; ignora históricos', () => {
    const activos = [
      embarqueRow({ id: 'e1', is_historial: false, piezas: 100 }),
      embarqueRow({ id: 'e2', is_historial: false, piezas: null }),
      embarqueRow({ id: 'e3', is_historial: false, piezas: 50 }),
    ];
    const historial = [embarqueRow({ id: 'h1', is_historial: true, piezas: 999 })];

    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [...activos, ...historial],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });

    expect(d.piezas_en_camino).toBe(150);
  });

  it('piezas_historial: Σ piezas (null→0) de embarques históricos; ignora activos', () => {
    const activos = [embarqueRow({ id: 'e1', is_historial: false, piezas: 100 })];
    const historial = [
      embarqueRow({ id: 'h1', is_historial: true, piezas: 30 }),
      embarqueRow({ id: 'h2', is_historial: true, piezas: null }),
      embarqueRow({ id: 'h3', is_historial: true, piezas: 20 }),
    ];

    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [...activos, ...historial],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });

    expect(d.piezas_historial).toBe(50);
  });

  it('piezas_en_camino y piezas_historial son 0 sin embarques', () => {
    const d = buildSkuDetalle({
      producto: productoRow(),
      stockRows: [],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock,
      vigenteAduana,
      snapshotPropio,
      hoy: HOY,
    });

    expect(d.piezas_en_camino).toBe(0);
    expect(d.piezas_historial).toBe(0);
  });

  describe('retrasado por embarque', () => {
    it('true: eta vencida (< hoy) sin fecha_llegada', () => {
      const e1 = embarqueRow({ id: 'e1', eta: '2026-07-01', fecha_llegada: null });
      const d = buildSkuDetalle({
        producto: productoRow(),
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [e1],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.embarques[0].retrasado).toBe(true);
    });

    it('false: eta vencida pero ya tiene fecha_llegada', () => {
      const e1 = embarqueRow({ id: 'e1', eta: '2026-07-01', fecha_llegada: '2026-07-05' });
      const d = buildSkuDetalle({
        producto: productoRow(),
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [e1],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.embarques[0].retrasado).toBe(false);
    });

    it('false: eta null', () => {
      const e1 = embarqueRow({ id: 'e1', eta: null, fecha_llegada: null });
      const d = buildSkuDetalle({
        producto: productoRow(),
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [e1],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.embarques[0].retrasado).toBe(false);
    });

    it('false: eta futura (>= hoy)', () => {
      const e1 = embarqueRow({ id: 'e1', eta: '2026-08-01', fecha_llegada: null });
      const d = buildSkuDetalle({
        producto: productoRow(),
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [e1],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.embarques[0].retrasado).toBe(false);
    });
  });

  describe('CAT-B1 · Tramo B — clasificacion_v2 CONGELADA (D-1(a), 17-sep)', () => {
    it('[FIX-B1] v2 completa, sin override: familia/descr/marca/clase/tecnologia son SIEMPRE de fuente (tecnologia DERIVADA de productos.tecnologia — DEFECTO ALTO cerrado en este bloque: sku.service.ts ya selecciona la columna)', () => {
      const producto = productoRow({
        marcas: { nombre: 'BRAND1' },
        familias: { nombre: 'CANDADOS' },
        class: 'CLASE SUCIA',
        // La fila CRUDA trae tecnología — antes de FIX-B1 el `select` de
        // sku.service.ts no la pedía y `d.tecnologia` salía `null` para
        // CUALQUIER SKU, aunque el archivo sí la trajera (DEFECTO ALTO #1).
        tecnologia: 'BRAND1',
      });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: v2Fixture(),
      });

      expect(d.marca).toBe('BRAND1');
      expect(d.familia_efectiva).toBe('CANDADOS');
      expect(d.descr_efectiva).toBe('Descripción original');
      expect(d.clase).toBe('CLASE SUCIA');
      // El Excel manda: la fila v2 trae 'RFID' y se ignora — DERIVADO de la
      // fila cruda, no fabricado en el DTO (P36).
      expect(d.tecnologia).toBe('BRAND1');
      expect(d.tecnologia_portal).toBeNull(); // sin override capturado en el portal
      expect(d.origenes).toEqual({
        descr: 'fuente',
        familia: 'fuente',
        marca: 'fuente',
        clase: 'fuente',
        tecnologia: 'fuente',
      });
      // La fila v2 CRUDA sigue viajando intacta en el DTO — D-1(a) congela la
      // capa (le quita la precedencia), NO la borra ni dejar de leerla aquí.
      expect(d.v2).toEqual({
        descr: 'Descr V2',
        familia: 'FAMILIA V2',
        marca: 'MARCA V2',
        clase: 'CLASE V2',
        tecnologia: 'RFID',
      });
      // `original` conserva la fuente prístina, sin tocar por v2/manual.
      expect(d.original).toEqual({ familia: 'CANDADOS', descr: 'Descripción original' });
    });

    it('override manual de familia/descripción encima de v2: gana manual, pero `v2` en el DTO sigue mostrando la capa inmediata', () => {
      const producto = productoRow({ familias: { nombre: 'CANDADOS' }, descr_origen: 'Original' });
      const overrides = [
        overrideRow('familia', 'FAM MANUAL'),
        overrideRow('descripcion', 'DESCR MANUAL', { id: 'ovr-2' }),
      ];
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides,
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: v2Fixture({ familia_v2: 'FAM V2', descr_v2: 'DESCR V2' }),
      });

      expect(d.familia_efectiva).toBe('FAM MANUAL');
      expect(d.descr_efectiva).toBe('DESCR MANUAL');
      expect(d.origenes?.familia).toBe('manual');
      expect(d.origenes?.descr).toBe('manual');
      // La fila v2 cruda viaja intacta en `v2` aunque el manual haya ganado la efectiva.
      expect(d.v2).toMatchObject({ familia: 'FAM V2', descr: 'DESCR V2' });
    });

    it('sin fila v2 (v2: null): orígenes fuente/null y `v2` null en el DTO', () => {
      const producto = productoRow({ marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CANDADOS' } });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: null,
      });

      expect(d.marca).toBe('BRAND1');
      expect(d.familia_efectiva).toBe('CANDADOS');
      expect(d.clase).toBeNull();
      // `producto` (fixture, sin `tecnologia`) → la fuente NO trae el dato y
      // no hay override: null es genuino, no un defecto de selección.
      expect(d.tecnologia).toBeNull();
      expect(d.origenes).toEqual({
        descr: 'fuente',
        familia: 'fuente',
        marca: 'fuente',
        clase: 'fuente',
        // [CAT-B1 · Tramo B] antes de D-1(a) `tecnologia` no tenía capa
        // fuente y sin v2 devolvía `origen: null`; ahora SIEMPRE hay una
        // capa fuente (`productos.tecnologia`) — el origen ya nunca es
        // `null`, aunque su VALOR sí pueda serlo.
        tecnologia: 'fuente',
      });
      expect(d.v2).toBeNull();
    });

    it('v2 ausente (campo omitido, retro-compat de fixtures previos a F3): se comporta igual que v2: null', () => {
      const producto = productoRow({ familias: { nombre: 'CANDADOS' } });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.familia_efectiva).toBe('CANDADOS');
      expect(d.v2).toBeNull();
      expect(d.tecnologia).toBeNull();
    });

    // ============================================================
    // [FIX-B1] La asimetría en la Ficha: EL EXCEL GANA para tecnología
    // (inversa de familia/descripción). Las cuatro combinaciones que
    // `ficha-atributos.tsx` necesita distinguir.
    // ============================================================
    it('[FIX-B1] Excel VACÍO + override activo → tecnologia_efectiva es la del portal, origen "manual"', () => {
      const producto = productoRow({ tecnologia: null });
      const overrides = [overrideRow('tecnologia', 'EAS')];
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides,
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.tecnologia).toBe('EAS');
      expect(d.tecnologia_portal).toBe('EAS');
      expect(d.origenes?.tecnologia).toBe('manual');
    });

    it('[FIX-B1] Excel POBLADO + override activo (leftover) → tecnologia_efectiva es la del Excel, PERO tecnologia_portal sigue mostrando la captura sin efecto', () => {
      const producto = productoRow({ tecnologia: 'BRAND1' });
      const overrides = [overrideRow('tecnologia', 'EAS')];
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides,
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.tecnologia).toBe('BRAND1');
      expect(d.origenes?.tecnologia).toBe('fuente');
      // El override quedó activo en la BD (nadie lo desactivó) pero sin
      // efecto — la Ficha lo usa para la nota «ya no aplica».
      expect(d.tecnologia_portal).toBe('EAS');
    });

    it('[FIX-B1] Excel VACÍO, sin override → tecnologia_efectiva y tecnologia_portal ambos null', () => {
      const producto = productoRow({ tecnologia: null });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
      });
      expect(d.tecnologia).toBeNull();
      expect(d.tecnologia_portal).toBeNull();
      expect(d.origenes?.tecnologia).toBe('fuente');
    });

    it('clase sucia de fuente (productos.class) sin fila v2 → se muestra tal cual, origen fuente', () => {
      const producto = productoRow({ class: '  clase-SUCIA_de-fuente  ' });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: null,
      });
      expect(d.clase).toBe('  clase-SUCIA_de-fuente  ');
      expect(d.origenes?.clase).toBe('fuente');
    });

    it('clase_v2 YA NO puebla encima de una clase sucia de fuente (D-1(a)): la clase efectiva SIGUE SUCIA', () => {
      const producto = productoRow({ class: 'clase-sucia' });
      const d = buildSkuDetalle({
        producto,
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: v2Fixture({ clase_v2: 'CLASE LIMPIA' }),
      });
      expect(d.clase).toBe('clase-sucia');
      expect(d.origenes?.clase).toBe('fuente');
      // La v2 sigue legible en el DTO informativo, solo que ya no gobierna la efectiva.
      expect(d.v2?.clase).toBe('CLASE LIMPIA');
    });
  });

  describe('R2-4 — decidido_en_bandeja (marca decidida en la bandeja de pendientes, no en el Excel)', () => {
    function detalleConFuenteVersion(fuente_version: string | null) {
      return buildSkuDetalle({
        producto: productoRow(),
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: v2Fixture({ fuente_version }),
      });
    }

    it("fuente_version='pendiente:marca_ambigua' → decidido_en_bandeja.marca true", () => {
      const d = detalleConFuenteVersion('pendiente:marca_ambigua');
      expect(d.decidido_en_bandeja).toEqual({ marca: true });
    });

    it("prefijo 'pendiente:' presente pero el tipo NO decide marca (familia_atomo_dudoso) → false: el string nombra el campo decidido, no solo la procedencia", () => {
      const d = detalleConFuenteVersion('pendiente:familia_atomo_dudoso');
      expect(d.decidido_en_bandeja).toEqual({ marca: false });
    });

    it('fuente_version de una ingesta normal (sin el prefijo pendiente:) → false', () => {
      const d = detalleConFuenteVersion('260713-v1');
      expect(d.decidido_en_bandeja).toEqual({ marca: false });
    });

    it('sin fila v2 (v2: null) → false — hoy las filas vigentes dan false (migración 0011 aún no aplicada)', () => {
      const d = buildSkuDetalle({
        producto: productoRow(),
        stockRows: [],
        reservasRows: [],
        overrides: [],
        embarquesRows: [],
        metadata: null,
        vigenteStock,
        vigenteAduana,
        snapshotPropio,
        hoy: HOY,
        v2: null,
      });
      expect(d.decidido_en_bandeja).toEqual({ marca: false });
    });
  });
});

// ------------------------------------------------------------
// getSkuDetalle — orquestación (fake db mínimo, thenable por tabla)
// ------------------------------------------------------------
// `code` opcional (B-PARCHE F3): shape real de `PostgrestError`, usado por los
// tests de tolerancia 42P01 de `clasificacion_v2`.
type Resp = { data: unknown; error: { message: string; code?: string } | null };

interface FakeChain {
  eq(col: string, val: unknown): FakeChain;
  maybeSingle(): Promise<Resp>;
  then<TResult1 = Resp, TResult2 = never>(
    onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

function makeFakeDb(responses: Partial<Record<string, Resp>>) {
  const calls: { table: string; select: string; eq: [string, unknown][]; maybeSingle: boolean }[] = [];

  function chain(table: string, select: string): FakeChain {
    const eqCalls: [string, unknown][] = [];
    const node: FakeChain = {
      eq(col, val) {
        eqCalls.push([col, val]);
        return node;
      },
      maybeSingle() {
        calls.push({ table, select, eq: [...eqCalls], maybeSingle: true });
        return Promise.resolve(responses[table] ?? { data: null, error: null });
      },
      then(onfulfilled, onrejected) {
        calls.push({ table, select, eq: [...eqCalls], maybeSingle: false });
        const resp: Resp = responses[table] ?? { data: [], error: null };
        return Promise.resolve(resp).then(onfulfilled, onrejected);
      },
    };
    return node;
  }

  const db = {
    from(table: string) {
      return { select: (select: string) => chain(table, select) };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

describe('getSkuDetalle', () => {
  beforeEach(() => {
    resolveVigentesMock.mockReset();
  });

  it('sku no encontrado en productos (maybeSingle sin fila, sin error) → null', async () => {
    const { db } = makeFakeDb({ productos: { data: null, error: null } });
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });

    const result = await getSkuDetalle(db, 'NOEXISTE');

    expect(result).toBeNull();
  });

  it('pinnea stock/reservas al snapshot PROPIO del producto (P_snap) y consulta embarques contra vigente(aduana)', async () => {
    const responses: Partial<Record<string, Resp>> = {
      productos: {
        data: {
          sku: 'A-1',
          resv: 5,
          descr_origen: 'Descr',
          cliente: 'RETAILER64',
          snapshot_id: 'snap-stock-1',
          marcas: { nombre: 'BRAND1' },
          familias: { nombre: 'CANDADOS' },
        },
        error: null,
      },
      stock_por_almacen: { data: [{ cantidad: 10, almacenes: { clave: 'NORTH' } }], error: null },
      reservas: {
        data: [{ cliente: 'RETAILER64', cantidad: 5, motivo: null, fecha: '2026-07-01', kams: { nombre: 'LUCAS' } }],
        error: null,
      },
      productos_override: { data: [], error: null },
      productos_metadata: { data: { imagen_url: null, color: 'rojo' }, error: null },
      snapshots: {
        data: { id: 'snap-stock-1', created_at: '2026-07-10T00:00:00.000Z', filas: 900, archivo: 'stock.xlsx' },
        error: null,
      },
      embarques: {
        data: [
          {
            id: 'emb-1',
            oc_po: null,
            proveedor: null,
            referencia: null,
            factura: null,
            pais_origen: null,
            piezas: null,
            fw: null,
            tipo_importacion: null,
            fecha_recoleccion: null,
            etd: null,
            eta: null,
            fecha_llegada: null,
            fecha_disponibilidad: null,
            estatus_id: 7,
            proyecto: null,
            observaciones: null,
            is_historial: false,
            estatus_catalogo: { nombre: 'En Aduana' },
          },
        ],
        error: null,
      },
    };
    const { db, calls } = makeFakeDb(responses);
    resolveVigentesMock.mockResolvedValueOnce({ stock: vigenteStock, aduana: vigenteAduana });

    const result = await getSkuDetalle(db, 'A-1');

    expect(result?.sku).toBe('A-1');
    expect(result?.embarques).toHaveLength(1);
    expect(result?.color).toBe('rojo');
    expect(result?.snapshot.aduana).toEqual({ ...vigenteAduana, vigente: true });
    expect(result?.snapshot.stock).toEqual({ ...vigenteStock, vigente: true });

    const metadataCall = calls.find((c) => c.table === 'productos_metadata');
    expect(metadataCall?.select).toBe('imagen_url,color');

    const stockCall = calls.find((c) => c.table === 'stock_por_almacen');
    expect(stockCall?.eq).toEqual([
      ['sku', 'A-1'],
      ['snapshot_id', 'snap-stock-1'],
    ]);
    const reservasCall = calls.find((c) => c.table === 'reservas');
    expect(reservasCall?.eq).toEqual([
      ['sku', 'A-1'],
      ['snapshot_id', 'snap-stock-1'],
    ]);
    const overridesCall = calls.find((c) => c.table === 'productos_override');
    // [FIX-B1] Cadena fijada: el cast `as SkuOverrideRow[]` ciega a tsc, y sin
    // `campo` o `activo` `overrideActivo` descarta TODAS las capturas — la ficha
    // perdería familia, descripción y tecnología capturadas sin ningún error.
    expect(overridesCall?.select).toBe('id,sku,campo,valor_editado,editado_en,activo');
    expect(overridesCall?.eq).toEqual([
      ['sku', 'A-1'],
      ['activo', true],
    ]);
    const embarquesCall = calls.find((c) => c.table === 'embarques');
    expect(embarquesCall?.eq).toEqual([
      ['sku', 'A-1'],
      ['snapshot_id', 'snap-aduana-1'],
    ]);
    const snapshotsCall = calls.find((c) => c.table === 'snapshots');
    expect(snapshotsCall?.eq).toEqual([['id', 'snap-stock-1']]);
    expect(snapshotsCall?.maybeSingle).toBe(true);

    const productosCall = calls.find((c) => c.table === 'productos');
    // [VERT-B2] La Ficha pide `excluida_del_catalogo` para DECIRLO, jamás para
    // filtrar: la Ficha se sirve SIEMPRE, incluso de una marca excluida y de un
    // SKU que ya no viene en el archivo. Si algún día este `select` se usara
    // para no servir la ficha, se habría roto esa garantía sin tocar esta línea
    // — por eso la distinción se escribe aquí, junto a la cadena pinneada.
    expect(productosCall?.select).toBe(
      'sku,resv,descr_origen,cliente,class,tecnologia,snapshot_id, marcas(nombre,excluida_del_catalogo), familias(nombre)',
    );
  });

  it('(v2) consulta clasificacion_v2 por sku (maybeSingle) — la puebla en el DTO informativo `v2`, pero YA NO gobierna clase/marca/tecnologia (D-1(a))', async () => {
    const responses: Partial<Record<string, Resp>> = {
      productos: {
        data: {
          sku: 'A-1',
          resv: 0,
          descr_origen: 'Descr',
          cliente: null,
          class: 'CLASE SUCIA',
          // [FIX-B1] fila CRUDA con tecnología — antes de este bloque el
          // `select` de `getSkuDetalle` no la pedía y este valor se perdía
          // sin importar lo que trajera la BD.
          tecnologia: 'BRAND1',
          snapshot_id: 'snap-stock-1',
          marcas: { nombre: 'BRAND1' },
          familias: { nombre: 'CANDADOS' },
        },
        error: null,
      },
      stock_por_almacen: { data: [], error: null },
      reservas: { data: [], error: null },
      productos_override: { data: [], error: null },
      productos_metadata: { data: null, error: null },
      snapshots: {
        data: { id: 'snap-stock-1', created_at: '2026-07-10T00:00:00.000Z', filas: 900, archivo: null },
        error: null,
      },
      clasificacion_v2: {
        data: {
          sku: 'A-1',
          tecnologia: 'RFID',
          marca_v2: 'MARCA V2',
          familia_v2: 'FAMILIA V2',
          clase_v2: 'CLASE V2',
          descr_v2: 'DESCR V2',
        },
        error: null,
      },
    };
    const { db, calls } = makeFakeDb(responses);
    resolveVigentesMock.mockResolvedValueOnce({ stock: vigenteStock, aduana: null });

    const result = await getSkuDetalle(db, 'A-1');

    // Fuente gana los tres — v2 se sigue leyendo (ver `v2Call` abajo) pero
    // ya no decide ningún valor efectivo. [FIX-B1] `tecnologia` DERIVADA de
    // la fila cruda (P36): el Excel trae 'BRAND1' y gana sobre la v2 'RFID'.
    expect(result?.tecnologia).toBe('BRAND1');
    expect(result?.tecnologia_portal).toBeNull();
    expect(result?.clase).toBe('CLASE SUCIA');
    expect(result?.marca).toBe('BRAND1');
    // El DTO informativo `v2` SIGUE poblado con la fila cruda — D-1(a) congela
    // la precedencia, no apaga la lectura de la tabla.
    expect(result?.v2).toEqual({
      descr: 'DESCR V2',
      familia: 'FAMILIA V2',
      marca: 'MARCA V2',
      clase: 'CLASE V2',
      tecnologia: 'RFID',
    });

    const v2Call = calls.find((c) => c.table === 'clasificacion_v2');
    expect(v2Call?.select).toBe('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2,fuente_version');
    expect(v2Call?.eq).toEqual([['sku', 'A-1']]);
    expect(v2Call?.maybeSingle).toBe(true);
  });

  it('(v2) 42P01 en clasificacion_v2 (tabla aún no aplicada) → ficha idéntica al pre-parche, sin lanzar', async () => {
    const responses: Partial<Record<string, Resp>> = {
      productos: {
        data: {
          sku: 'A-1',
          resv: 0,
          descr_origen: 'Descr',
          cliente: null,
          class: 'CLASE SUCIA',
          snapshot_id: 'snap-stock-1',
          marcas: { nombre: 'BRAND1' },
          familias: { nombre: 'CANDADOS' },
        },
        error: null,
      },
      stock_por_almacen: { data: [], error: null },
      reservas: { data: [], error: null },
      productos_override: { data: [], error: null },
      productos_metadata: { data: null, error: null },
      snapshots: {
        data: { id: 'snap-stock-1', created_at: '2026-07-10T00:00:00.000Z', filas: 900, archivo: null },
        error: null,
      },
      clasificacion_v2: {
        data: null,
        error: { message: 'relation "public.clasificacion_v2" does not exist', code: '42P01' },
      },
    };
    const { db } = makeFakeDb(responses);
    resolveVigentesMock.mockResolvedValueOnce({ stock: vigenteStock, aduana: null });

    const result = await getSkuDetalle(db, 'A-1');

    expect(result?.marca).toBe('BRAND1');
    expect(result?.familia_efectiva).toBe('CANDADOS');
    expect(result?.clase).toBe('CLASE SUCIA');
    expect(result?.tecnologia).toBeNull();
    expect(result?.v2).toBeNull();
  });

  it('error 500 genuino (no 42P01) en clasificacion_v2 → lanza (no se confunde con "tabla ausente")', async () => {
    const responses: Partial<Record<string, Resp>> = {
      productos: {
        data: {
          sku: 'A-1',
          resv: 0,
          descr_origen: null,
          cliente: null,
          snapshot_id: 'snap-stock-1',
          marcas: null,
          familias: null,
        },
        error: null,
      },
      stock_por_almacen: { data: [], error: null },
      reservas: { data: [], error: null },
      productos_override: { data: [], error: null },
      productos_metadata: { data: null, error: null },
      snapshots: {
        data: { id: 'snap-stock-1', created_at: '2026-07-10T00:00:00.000Z', filas: 1, archivo: null },
        error: null,
      },
      clasificacion_v2: { data: null, error: { message: 'timeout secreto', code: '57014' } },
    };
    const { db } = makeFakeDb(responses);
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });

    await expect(getSkuDetalle(db, 'A-1')).rejects.toThrow(/timeout secreto/);
  });

  it('sin vigente aduana: NO consulta embarques → embarques [] y snapshot.aduana null', async () => {
    const responses: Partial<Record<string, Resp>> = {
      productos: {
        data: {
          sku: 'A-1',
          resv: 0,
          descr_origen: null,
          cliente: null,
          snapshot_id: 'snap-stock-1',
          marcas: { nombre: 'BRAND1' },
          familias: null,
        },
        error: null,
      },
      stock_por_almacen: { data: [], error: null },
      reservas: { data: [], error: null },
      productos_override: { data: [], error: null },
      productos_metadata: { data: null, error: null },
      snapshots: {
        data: { id: 'snap-stock-1', created_at: '2026-07-10T00:00:00.000Z', filas: 900, archivo: null },
        error: null,
      },
    };
    const { db, calls } = makeFakeDb(responses);
    resolveVigentesMock.mockResolvedValueOnce({ stock: vigenteStock, aduana: null });

    const result = await getSkuDetalle(db, 'A-1');

    expect(result?.embarques).toEqual([]);
    expect(result?.snapshot.aduana).toBeNull();
    expect(calls.some((c) => c.table === 'embarques')).toBe(false);
  });

  it('error en una query paralela → lanza (el route lo captura y responde 500 sin fuga)', async () => {
    const responses: Partial<Record<string, Resp>> = {
      productos: {
        data: {
          sku: 'A-1',
          resv: 0,
          descr_origen: null,
          cliente: null,
          snapshot_id: 'snap-stock-1',
          marcas: null,
          familias: null,
        },
        error: null,
      },
      stock_por_almacen: { data: null, error: { message: 'constraint boom secreto' } },
      reservas: { data: [], error: null },
      productos_override: { data: [], error: null },
      productos_metadata: { data: null, error: null },
      snapshots: {
        data: { id: 'snap-stock-1', created_at: '2026-07-10T00:00:00.000Z', filas: 1, archivo: null },
        error: null,
      },
    };
    const { db } = makeFakeDb(responses);
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });

    await expect(getSkuDetalle(db, 'A-1')).rejects.toThrow(/constraint boom secreto/);
  });
});
