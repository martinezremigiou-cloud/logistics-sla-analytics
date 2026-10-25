import { describe, it, expect } from 'vitest';
import {
  overrideActivo,
  efectivas,
  totalDe,
  derivarSku,
  badgesDe,
  resolverClasificacion,
  agruparReservasPorSku,
  descuadresDe,
  esRetrasado,
  fueraDelVigente,
  divergenciaFamilia,
  enRiesgo,
  contarSinTecnologia,
  type ProductoLectura,
  type StockLectura,
  type ReservaLectura,
  type OverrideLectura,
  type ClasificacionV2Lectura,
} from './derivaciones';
import type { CampoOverride } from '@/types/enums';

function producto(overrides: Partial<ProductoLectura> = {}): ProductoLectura {
  return {
    sku: 'A-1',
    marca: 'BRAND1',
    familia: 'CANDADOS',
    descr_origen: 'Candado estándar',
    cliente: null,
    resv: 0,
    // [FIX-B1] `null` explícito y no ausente: `tecnologia` es OBLIGATORIO en
    // `ProductoLectura` desde este bloque (antídoto P25 — ver derivaciones.ts).
    tecnologia: null,
    ...overrides,
  };
}

function stock(cantidad: number, almacen = 'NORTH'): StockLectura {
  return { sku: 'A-1', almacen, cantidad };
}

function reserva(cantidad: number, overrides: Partial<ReservaLectura> = {}): ReservaLectura {
  return { sku: 'A-1', kam: 'LUCAS', cliente: 'RETAILER64', cantidad, motivo: null, fecha: '2026-07-01', ...overrides };
}

function override(
  campo: CampoOverride,
  valor: string,
  opts: Partial<OverrideLectura> = {},
): OverrideLectura {
  return {
    sku: 'A-1',
    campo,
    valor_editado: valor,
    editado_en: '2026-07-01T00:00:00.000Z',
    id: 'ovr-1',
    activo: true,
    ...opts,
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

describe('overrideActivo', () => {
  it('sin overrides → null', () => {
    expect(overrideActivo([], 'A-1', 'familia')).toBeNull();
  });

  it('ignora overrides de otro sku o de otro campo', () => {
    const overrides = [
      override('familia', 'OTRA', { sku: 'B-2' }),
      override('descripcion', 'Otra descr'),
    ];
    expect(overrideActivo(overrides, 'A-1', 'familia')).toBeNull();
  });

  it('override activo=false se ignora', () => {
    const overrides = [override('familia', 'NUEVA', { activo: false })];
    expect(overrideActivo(overrides, 'A-1', 'familia')).toBeNull();
  });

  it('dos overrides activos, mismo campo → gana el de mayor editado_en', () => {
    const viejo = override('familia', 'VIEJA', { id: 'ovr-1', editado_en: '2026-07-01T00:00:00.000Z' });
    const nuevo = override('familia', 'NUEVA', { id: 'ovr-2', editado_en: '2026-07-05T00:00:00.000Z' });
    expect(overrideActivo([viejo, nuevo], 'A-1', 'familia')).toEqual(nuevo);
    expect(overrideActivo([nuevo, viejo], 'A-1', 'familia')).toEqual(nuevo);
  });

  it('mismo editado_en → desempate por mayor id', () => {
    const a = override('familia', 'A', { id: 'ovr-1', editado_en: '2026-07-01T00:00:00.000Z' });
    const b = override('familia', 'B', { id: 'ovr-2', editado_en: '2026-07-01T00:00:00.000Z' });
    expect(overrideActivo([a, b], 'A-1', 'familia')).toEqual(b);
    expect(overrideActivo([b, a], 'A-1', 'familia')).toEqual(b);
  });
});

describe('efectivas', () => {
  it('sin overrides → origen', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Candado estándar' });
    expect(efectivas(p, [])).toEqual({ familia_efectiva: 'CANDADOS', descr_efectiva: 'Candado estándar' });
  });

  it('override de familia Y de descripcion aplican independientemente', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Candado estándar' });
    const overrides = [override('familia', 'SEGURIDAD'), override('descripcion', 'Candado reforzado')];
    expect(efectivas(p, overrides)).toEqual({ familia_efectiva: 'SEGURIDAD', descr_efectiva: 'Candado reforzado' });
  });

  it('familia origen null sin override → familia_efectiva null', () => {
    const p = producto({ familia: null });
    expect(efectivas(p, []).familia_efectiva).toBeNull();
  });

  it('override activo=false no afecta: se usa el origen', () => {
    const p = producto({ familia: 'CANDADOS' });
    const overrides = [override('familia', 'IGNORADA', { activo: false })];
    expect(efectivas(p, overrides).familia_efectiva).toBe('CANDADOS');
  });
});

describe('totalDe', () => {
  it('suma cantidad de todas las filas de stock', () => {
    expect(totalDe([stock(10, 'NORTH'), stock(5, 'SOUTH')])).toBe(15);
  });

  it('sin filas de stock → 0', () => {
    expect(totalDe([])).toBe(0);
  });

  it('incluye WEST como un almacén más', () => {
    expect(totalDe([stock(7, 'WEST')])).toBe(7);
  });
});

describe('derivarSku', () => {
  it('DD8309-G: resv 7350, Σreservas 0 → reservado 7350, descuadre true', () => {
    const p = producto({ sku: 'DD8309-G', resv: 7350 });
    const d = derivarSku(p, [{ sku: 'DD8309-G', almacen: 'NORTH', cantidad: 7350 }], [], []);
    expect(d.reservado).toBe(7350);
    expect(d.reserva_descuadre).toBe(true);
  });

  it('reserva_descuadre false cuando Σreservas === resv', () => {
    const p = producto({ resv: 8 });
    const d = derivarSku(p, [stock(20)], [reserva(3), reserva(5)], []);
    expect(d.reserva_descuadre).toBe(false);
  });

  it('WEST-only: total = cantidad de WEST, sin badge sobre_reservado', () => {
    const p = producto({ resv: 0 });
    const d = derivarSku(p, [{ sku: 'A-1', almacen: 'WEST', cantidad: 9 }], [], []);
    expect(d.total).toBe(9);
    expect(d.disponible).toBe(9);
    expect(d.sobre_reservado).toBe(false);
  });

  it('sobre_reservado: disponible < 0', () => {
    const p = producto({ resv: 10 });
    const d = derivarSku(p, [stock(4)], [reserva(10)], []);
    expect(d.total).toBe(4);
    expect(d.disponible).toBe(-6);
    expect(d.sobre_reservado).toBe(true);
  });

  it('stock_cero: sin filas de stock → total 0', () => {
    const p = producto({ resv: 0 });
    const d = derivarSku(p, [], [], []);
    expect(d.total).toBe(0);
    expect(d.disponible).toBe(0);
  });

  it('aplica familia_efectiva y descr_efectiva vía overrides', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const d = derivarSku(p, [stock(1)], [], [override('familia', 'SEGURIDAD'), override('descripcion', 'Editada')]);
    expect(d.familia_efectiva).toBe('SEGURIDAD');
    expect(d.descr_efectiva).toBe('Editada');
  });

  it('disponible = total - reservado (reservado = producto.resv, no Σreservas)', () => {
    const p = producto({ resv: 6 });
    const d = derivarSku(p, [stock(10)], [reserva(2)], []); // Σreservas=2 pero resv=6
    expect(d.reservado).toBe(6);
    expect(d.disponible).toBe(4);
  });
});

describe('badgesDe', () => {
  it('sin condiciones → []', () => {
    const p = producto({ resv: 0, familia: 'CANDADOS' });
    const d = derivarSku(p, [stock(5)], [], []);
    expect(badgesDe(d)).toEqual([]);
  });

  it('sin_familia: familia_efectiva null', () => {
    const p = producto({ resv: 0, familia: null });
    const d = derivarSku(p, [stock(5)], [], []);
    expect(badgesDe(d)).toEqual(['sin_familia']);
  });

  it('stock_cero: total === 0', () => {
    const p = producto({ resv: 0, familia: 'CANDADOS' });
    const d = derivarSku(p, [], [], []);
    expect(badgesDe(d)).toEqual(['stock_cero']);
  });

  it('sobre_reservado: disponible < 0', () => {
    const p = producto({ resv: 10, familia: 'CANDADOS' });
    const d = derivarSku(p, [stock(3)], [], []);
    expect(badgesDe(d)).toEqual(['sobre_reservado']);
  });

  it('orden fijo cuando aplican los 3 a la vez: [sobre_reservado, sin_familia, stock_cero]', () => {
    // total 0 (stock_cero) + resv>0 ⇒ disponible<0 (sobre_reservado) + familia null (sin_familia)
    const p = producto({ resv: 5, familia: null });
    const d = derivarSku(p, [], [], []);
    expect(badgesDe(d)).toEqual(['sobre_reservado', 'sin_familia', 'stock_cero']);
  });

  describe('R2-1 — sin_familia vía sinFamilia (único predicado, no solo === null)', () => {
    it('familia efectiva "/" (sin átomos tras separar, pero no null) → SÍ dispara sin_familia', () => {
      const p = producto({ resv: 0, familia: '/' });
      const d = derivarSku(p, [stock(5)], [], []);
      expect(badgesDe(d)).toEqual(['sin_familia']);
    });

    it('familia efectiva "   " (solo espacios) → SÍ dispara sin_familia', () => {
      const p = producto({ resv: 0, familia: '   ' });
      const d = derivarSku(p, [stock(5)], [], []);
      expect(badgesDe(d)).toEqual(['sin_familia']);
    });

    it('familia efectiva con al menos un átomo real → NO dispara, aunque venga con separadores vacíos', () => {
      const p = producto({ resv: 0, familia: 'CANDADOS / /' });
      const d = derivarSku(p, [stock(5)], [], []);
      expect(badgesDe(d)).toEqual([]);
    });
  });
});

describe('resolverClasificacion — D-1(a) CAT-B1 · Tramo B (17-sep): clasificacion_v2 CONGELADA', () => {
  it('descr y familia con override activo → gana manual (v2 poblada de por medio, ignorada)', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const overrides = [override('familia', 'FAM MANUAL'), override('descripcion', 'DESCR MANUAL')];
    const r = resolverClasificacion(p, overrides, v2Fixture({ familia_v2: 'FAM V2', descr_v2: 'DESCR V2' }));
    expect(r.familia).toEqual({ valor: 'FAM MANUAL', origen: 'manual' });
    expect(r.descr).toEqual({ valor: 'DESCR MANUAL', origen: 'manual' });
  });

  // ============================================================
  // GATE B (a) — nace en rojo primero (ver bitácora de esta corrida en el
  // reporte del bloque): sin manual, con una fila v2 que trae OTRO valor,
  // `resolverClasificacion` YA NO deja ganar a la v2 — origen 'fuente'.
  // ============================================================
  it('[GATE B·a] descr y familia sin manual, con v2 (otro valor) → gana FUENTE, origen "fuente" (v2 ya no gana)', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const r = resolverClasificacion(p, [], v2Fixture({ familia_v2: 'FAM V2', descr_v2: 'DESCR V2' }));
    expect(r.familia).toEqual({ valor: 'CANDADOS', origen: 'fuente' });
    expect(r.descr).toEqual({ valor: 'Original', origen: 'fuente' });
  });

  it('descr y familia sin manual y sin v2 → gana fuente (sin cambio: nunca dependió de esto)', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const r = resolverClasificacion(p, [], null);
    expect(r.familia).toEqual({ valor: 'CANDADOS', origen: 'fuente' });
    expect(r.descr).toEqual({ valor: 'Original', origen: 'fuente' });
  });

  it('override activo=false no cuenta como manual → cae a FUENTE (antes caía a v2; v2 ya no es capa intermedia)', () => {
    const p = producto({ familia: 'CANDADOS' });
    const overrides = [override('familia', 'IGNORADA', { activo: false })];
    const r = resolverClasificacion(p, overrides, v2Fixture({ familia_v2: 'FAM V2' }));
    expect(r.familia).toEqual({ valor: 'CANDADOS', origen: 'fuente' });
  });

  it('v2 con familia_v2 null y descr_v2 poblada → AMBAS caen a fuente (v2 congelada, sin importar qué campo trae poblado)', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const r = resolverClasificacion(p, [], v2Fixture({ familia_v2: null, descr_v2: 'DESCR V2' }));
    expect(r.familia).toEqual({ valor: 'CANDADOS', origen: 'fuente' });
    expect(r.descr).toEqual({ valor: 'Original', origen: 'fuente' });
  });

  it('marca: SIEMPRE fuente — v2 se ignora aunque marca_v2 esté poblada', () => {
    const p = producto({ marca: 'BRAND1' });
    expect(resolverClasificacion(p, [], v2Fixture({ marca_v2: 'MARCA V2' })).marca).toEqual({
      valor: 'BRAND1',
      origen: 'fuente',
    });
    expect(resolverClasificacion(p, [], v2Fixture({ marca_v2: null })).marca).toEqual({
      valor: 'BRAND1',
      origen: 'fuente',
    });
    expect(resolverClasificacion(p, [], null).marca).toEqual({ valor: 'BRAND1', origen: 'fuente' });
  });

  it('clase: SIEMPRE fuente — v2 se ignora aunque clase_v2 esté poblada', () => {
    const p = producto({ clase: 'CLASE ORIGEN' });
    expect(resolverClasificacion(p, [], v2Fixture({ clase_v2: 'CLASE V2' })).clase).toEqual({
      valor: 'CLASE ORIGEN',
      origen: 'fuente',
    });
    expect(resolverClasificacion(p, [], v2Fixture({ clase_v2: null })).clase).toEqual({
      valor: 'CLASE ORIGEN',
      origen: 'fuente',
    });
    expect(resolverClasificacion(p, [], null).clase).toEqual({ valor: 'CLASE ORIGEN', origen: 'fuente' });
  });

  it('clase sin fixture previo a F1 (producto.clase undefined) y sin v2 → fuente con valor null', () => {
    const p = producto(); // sin campo `clase`: fixture anterior a F1
    expect(resolverClasificacion(p, [], null).clase).toEqual({ valor: null, origen: 'fuente' });
  });

  // ============================================================
  // `tecnologia` es el campo que CAMBIA DE FORMA, no solo de ganador: antes
  // de CAT-B1 no tenía capa fuente (`capaV2Solo`, sin `productos.tecnologia`)
  // y devolvía `{valor: null, origen: null}` sin v2. Desde la migración 0036
  // + D-1(a), `productos.tecnologia` es la ÚNICA fuente.
  // ============================================================
  it('tecnologia: AHORA tiene capa fuente (productos.tecnologia) — v2 se ignora aunque traiga otro valor', () => {
    const p = producto({ tecnologia: 'RFID' });
    expect(resolverClasificacion(p, [], v2Fixture({ tecnologia: 'OTRA DE V2' })).tecnologia).toEqual({
      valor: 'RFID',
      origen: 'fuente',
    });
    expect(resolverClasificacion(p, [], null).tecnologia).toEqual({ valor: 'RFID', origen: 'fuente' });
  });

  it('tecnologia: sin dato en la fuente y sin override → {valor: null, origen: "fuente"}, aunque v2 sí traiga tecnologia', () => {
    const p = producto(); // sin campo `tecnologia`: fixture anterior a esta migración
    expect(resolverClasificacion(p, [], v2Fixture({ tecnologia: 'RFID' })).tecnologia).toEqual({
      valor: null,
      origen: 'fuente',
    });
    expect(resolverClasificacion(p, [], null).tecnologia).toEqual({ valor: null, origen: 'fuente' });
  });

  // ============================================================
  // [FIX-B1] LA ASIMETRÍA: `tecnologia` es la ÚNICA capa donde EL EXCEL
  // GANA (`capaFuenteManual`), inversa de familia/descripción (donde EL
  // PORTAL gana, `capaManualFuente` — ver el primer `it` de este describe).
  // Las cuatro combinaciones de (fuente, override) puestas una al lado de
  // la otra, con el MISMO fixture de override reusado en ambas capas para
  // que la comparación sea directa.
  // ============================================================
  it('[FIX-B1] tecnologia con override activo Y fuente VACÍA → gana el PORTAL (capa "manual")', () => {
    const p = producto({ tecnologia: null });
    const overrides = [override('tecnologia', 'EAS')];
    expect(resolverClasificacion(p, overrides, null).tecnologia).toEqual({ valor: 'EAS', origen: 'manual' });
  });

  it('[FIX-B1] tecnologia con override activo Y fuente POBLADA → gana EL EXCEL (capa "fuente"), el override queda sin efecto', () => {
    const p = producto({ tecnologia: 'BRAND1' });
    const overrides = [override('tecnologia', 'EAS')];
    expect(resolverClasificacion(p, overrides, null).tecnologia).toEqual({ valor: 'BRAND1', origen: 'fuente' });
  });

  it('[FIX-B1] la asimetría, lado a lado: MISMO override activo, familia lo deja ganar y tecnologia no, cuando la fuente de AMBAS está poblada', () => {
    const p = producto({ familia: 'CANDADOS', tecnologia: 'BRAND1' });
    const overrides = [override('familia', 'FAM MANUAL'), override('tecnologia', 'EAS')];
    const r = resolverClasificacion(p, overrides, null);
    expect(r.familia).toEqual({ valor: 'FAM MANUAL', origen: 'manual' }); // el portal gana
    expect(r.tecnologia).toEqual({ valor: 'BRAND1', origen: 'fuente' }); // el Excel gana
  });

  it('[FIX-B1] override de tecnologia inactivo (activo:false) no cuenta como manual → cae a fuente (null si la fuente tampoco trae nada)', () => {
    const p = producto({ tecnologia: null });
    const overrides = [override('tecnologia', 'EAS', { activo: false })];
    expect(resolverClasificacion(p, overrides, null).tecnologia).toEqual({ valor: null, origen: 'fuente' });
  });

  it('[FIX-B1] override de OTRO sku no interfiere en la resolución de tecnologia', () => {
    const p = producto({ tecnologia: null });
    const overrides = [override('tecnologia', 'EAS', { sku: 'B-2' })];
    expect(resolverClasificacion(p, overrides, null).tecnologia).toEqual({ valor: null, origen: 'fuente' });
  });

  // ============================================================
  // [FIX-B1 · revisión] UNA SOLA REGLA DE "VACÍO": `capaFuenteManual` debe
  // tratar la cadena en blanco (trim === '') como AUSENTE, igual que la SQL
  // (`btrim()`, migración 0044) — antes sólo comprobaba `!= null`, así que
  // una celda del Excel con puros espacios contaba como "SÍ trae tecnología"
  // en TypeScript mientras la base la trataba como ausente.
  // ============================================================
  it('[FIX-B1 · revisión] tecnologia: fuente en BLANCO (solo espacios) se trata como AUSENTE → gana el PORTAL', () => {
    const p = producto({ tecnologia: '   ' });
    const overrides = [override('tecnologia', 'EAS')];
    expect(resolverClasificacion(p, overrides, null).tecnologia).toEqual({ valor: 'EAS', origen: 'manual' });
  });

  it('[FIX-B1 · revisión] tecnologia: fuente en BLANCO y SIN override → {valor: null, origen: "fuente"} (no queda atrapado el "espacio")', () => {
    const p = producto({ tecnologia: '  ' });
    expect(resolverClasificacion(p, [], null).tecnologia).toEqual({ valor: null, origen: 'fuente' });
  });

  it('[FIX-B1 · revisión] tecnologia: override en BLANCO se trata también como AUSENTE (misma regla, simétrica) → {valor: null, origen: "fuente"}', () => {
    const p = producto({ tecnologia: null });
    const overrides = [override('tecnologia', '   ')];
    expect(resolverClasificacion(p, overrides, null).tecnologia).toEqual({ valor: null, origen: 'fuente' });
  });

  it('[FIX-B1 · revisión] tecnologia: fuente con espacios ALREDEDOR de un valor real SIGUE contando como presente (no se vacía el valor, solo se decide presencia)', () => {
    const p = producto({ tecnologia: '  BRAND1  ' });
    expect(resolverClasificacion(p, [], null).tecnologia).toEqual({ valor: '  BRAND1  ', origen: 'fuente' });
  });

  // ============================================================
  // `producto`: CAMPO NUEVO en `ClasificacionResuelta` — no existía antes de
  // este bloque. No tiene capa v2 (nunca existió `producto_v2`) ni capa
  // manual propia (a diferencia de `tecnologia` desde FIX-B1,
  // `productos_override.campo` no tiene un valor `'producto'`): es fuente
  // siempre, igual que marca/clase.
  // ============================================================
  it('producto (CAMPO NUEVO): siempre fuente, sin capa v2 ni manual', () => {
    const p = producto({ producto: 'CLIP 3.0 CUSTOM RETAILER24' });
    expect(resolverClasificacion(p, [], null).producto).toEqual({
      valor: 'CLIP 3.0 CUSTOM RETAILER24',
      origen: 'fuente',
    });
  });

  it('producto: sin dato en la fuente → {valor: null, origen: "fuente"}', () => {
    const p = producto(); // sin campo `producto`
    expect(resolverClasificacion(p, [], null).producto).toEqual({ valor: null, origen: 'fuente' });
  });

  it('familia sin dato y sin v2 → familia {valor:null, origen:"fuente"}', () => {
    const p = producto({ familia: null });
    expect(resolverClasificacion(p, [], null).familia).toEqual({ valor: null, origen: 'fuente' });
  });

  it('undefined se comporta igual que null para v2 (parámetro opcional en la práctica — y ahora SIEMPRE, se lea o no)', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original', clase: 'CLASE ORIGEN' });
    expect(resolverClasificacion(p, [], undefined)).toEqual(resolverClasificacion(p, [], null));
  });

  // ============================================================
  // GATE B (b) — el override SIGUE ganando: la capa buena (`productos_override`)
  // no se tocó. Control de que D-1(a) congeló SOLO la v2.
  // ============================================================
  it('[GATE B·b] override de familia activo → origen "manual" y el valor editado, con o sin v2 de por medio', () => {
    const p = producto({ familia: 'CANDADOS' });
    const overrides = [override('familia', 'FAM EDITADA MANUAL')];
    const r = resolverClasificacion(p, overrides, v2Fixture({ familia_v2: 'FAM V2 QUE NO IMPORTA' }));
    expect(r.familia).toEqual({ valor: 'FAM EDITADA MANUAL', origen: 'manual' });
  });
});

describe('efectivas — retro-compatibilidad tras B-PARCHE F1', () => {
  it('sin v2 (2 args): se comporta EXACTAMENTE igual que antes — override ?? origen', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const overrides = [override('familia', 'SEGURIDAD'), override('descripcion', 'Editada')];
    expect(efectivas(p, overrides)).toEqual({ familia_efectiva: 'SEGURIDAD', descr_efectiva: 'Editada' });
  });

  it('sin v2, sin overrides → valores de origen', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    expect(efectivas(p, [])).toEqual({ familia_efectiva: 'CANDADOS', descr_efectiva: 'Original' });
  });

  it('v2 explícito null se comporta igual que v2 ausente', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const overrides = [override('descripcion', 'Editada')];
    expect(efectivas(p, overrides, null)).toEqual(efectivas(p, overrides));
  });

  it('con v2 poblado y sin override: v2 YA NO gana — familia/descr son la fuente (D-1(a))', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    expect(efectivas(p, [], v2Fixture({ familia_v2: 'FAM V2', descr_v2: 'DESCR V2' }))).toEqual({
      familia_efectiva: 'CANDADOS',
      descr_efectiva: 'Original',
    });
  });

  it('con v2 poblado pero override manual activo: manual sigue ganando', () => {
    const p = producto({ familia: 'CANDADOS', descr_origen: 'Original' });
    const overrides = [override('familia', 'FAM MANUAL')];
    expect(efectivas(p, overrides, v2Fixture({ familia_v2: 'FAM V2' })).familia_efectiva).toBe('FAM MANUAL');
  });
});

describe('agruparReservasPorSku', () => {
  it('agrupa por sku, preservando orden de inserción dentro de cada grupo', () => {
    const r1 = reserva(3, { sku: 'A-1' });
    const r2 = reserva(5, { sku: 'B-2' });
    const r3 = reserva(2, { sku: 'A-1' });
    const map = agruparReservasPorSku([r1, r2, r3]);
    expect(map.get('A-1')).toEqual([r1, r3]);
    expect(map.get('B-2')).toEqual([r2]);
    expect(map.get('C-3')).toBeUndefined();
  });

  it('lista vacía → Map vacío', () => {
    expect(agruparReservasPorSku([]).size).toBe(0);
  });
});

describe('descuadresDe (Bloque 6 — bandeja/dashboard, aritmética compartida)', () => {
  it('resv === Σreservas → no aparece en la lista', () => {
    const p = producto({ sku: 'A-1', resv: 8 });
    const reservasBySku = agruparReservasPorSku([reserva(3, { sku: 'A-1' }), reserva(5, { sku: 'A-1' })]);
    expect(descuadresDe([p], reservasBySku)).toEqual([]);
  });

  it('resv !== Σreservas → aparece con {sku, resv, suma_reservas}', () => {
    const p = producto({ sku: 'DD8309-G', resv: 7350 });
    expect(descuadresDe([p], new Map())).toEqual([{ sku: 'DD8309-G', resv: 7350, suma_reservas: 0 }]);
  });

  it('sku sin ninguna reserva en el Map → suma_reservas 0 (Σ vacía)', () => {
    const p = producto({ sku: 'A-1', resv: 5 });
    const reservasBySku = agruparReservasPorSku([reserva(9, { sku: 'OTRO' })]);
    expect(descuadresDe([p], reservasBySku)).toEqual([{ sku: 'A-1', resv: 5, suma_reservas: 0 }]);
  });

  it('múltiples productos: solo los descuadrados entran a la lista, en el orden de entrada', () => {
    const cuadrado = producto({ sku: 'A-1', resv: 3 });
    const descuadrado1 = producto({ sku: 'B-2', resv: 10 });
    const descuadrado2 = producto({ sku: 'C-3', resv: 1 });
    const reservasBySku = agruparReservasPorSku([reserva(3, { sku: 'A-1' }), reserva(4, { sku: 'B-2' })]);
    expect(descuadresDe([cuadrado, descuadrado1, descuadrado2], reservasBySku)).toEqual([
      { sku: 'B-2', resv: 10, suma_reservas: 4 },
      { sku: 'C-3', resv: 1, suma_reservas: 0 },
    ]);
  });

  it('sin productos → []', () => {
    expect(descuadresDe([], new Map())).toEqual([]);
  });
});

describe('esRetrasado (compartida por cruce.service.ts/dashboard.service.ts)', () => {
  const HOY = '2026-07-12';

  it('true: eta pasada sin fecha_llegada', () => {
    expect(esRetrasado('2026-07-01', null, HOY)).toBe(true);
  });

  it('false: con fecha_llegada aunque eta ya pasó', () => {
    expect(esRetrasado('2026-07-01', '2026-07-05', HOY)).toBe(false);
  });

  it('false: eta null', () => {
    expect(esRetrasado(null, null, HOY)).toBe(false);
  });

  it('false: eta igual a hoy (comparación estricta <)', () => {
    expect(esRetrasado(HOY, null, HOY)).toBe(false);
  });

  it('false: eta futura', () => {
    expect(esRetrasado('2026-08-01', null, HOY)).toBe(false);
  });
});

describe('[INV-B8] fueraDelVigente (el sello de fecha y la mentira de "Sin stock")', () => {
  it('fila del snapshot pinneado → false', () => {
    expect(fueraDelVigente(producto({ snapshot_id: 'S1' }), 'S1')).toBe(false);
  });

  it('fila de un snapshot ANTERIOR → true: el SKU salió del archivo vigente', () => {
    expect(fueraDelVigente(producto({ snapshot_id: 'S0' }), 'S1')).toBe(true);
  });

  it('sin snapshot_id en la fila → false (no se puede saber; no afirmar nada)', () => {
    expect(fueraDelVigente(producto(), 'S1')).toBe(false);
    expect(fueraDelVigente(producto({ snapshot_id: null }), 'S1')).toBe(false);
  });

  it('sin snapshot pinneado → false (misma razón)', () => {
    expect(fueraDelVigente(producto({ snapshot_id: 'S0' }), null)).toBe(false);
    expect(fueraDelVigente(producto({ snapshot_id: 'S0' }), undefined)).toBe(false);
  });

  it('el SKU que VUELVE al Excel se arregla solo, sin reabrir nada', () => {
    // El caso que ninguna de las opciones evaluadas
    // esquivaba. Aqui es gratis porque el predicado es derivado, no persistido:
    // la re-ingesta reescribe snapshot_id y esto vuelve a false sin intervencion.
    const salio = producto({ snapshot_id: 'S0' });
    expect(fueraDelVigente(salio, 'S1')).toBe(true);
    const volvio = producto({ snapshot_id: 'S1' });
    expect(fueraDelVigente(volvio, 'S1')).toBe(false);
  });
});

describe('[INV-B8] enRiesgo — y la SUBSUNCION que sostiene su definicion', () => {
  it('alcanza para la partida → false', () => {
    expect(enRiesgo({ disponible: 500 }, 120)).toBe(false);
  });

  it('justo lo pedido no es riesgo; una pieza menos si', () => {
    expect(enRiesgo({ disponible: 120 }, 120)).toBe(false);
    expect(enRiesgo({ disponible: 119 }, 120)).toBe(true);
  });

  it('SUBSUME sobre_reservado: disponible<0 siempre entra, con cualquier cantidad valida', () => {
    // `cantidad >= 1` lo garantiza el CHECK (cantidad > 0) de proyecto_partidas.
    for (const cantidad of [1, 7, 400, 99999]) {
      const d = derivarSku(producto({ resv: 10 }), [stock(3)], [], []);
      expect(d.sobre_reservado).toBe(true);
      expect(enRiesgo(d, cantidad)).toBe(true);
    }
  });

  it('SUBSUME stock_cero, tanto con reserva como sin ella', () => {
    for (const resv of [0, 25]) {
      const d = derivarSku(producto({ resv }), [], [], []);
      expect(badgesDe(d)).toContain('stock_cero');
      expect(enRiesgo(d, 1)).toBe(true);
    }
  });

  it('la disyuncion completa daria EXACTAMENTE lo mismo: las 2 clausulas extra nunca son el motivo real', () => {
    // Barrido: si en algun punto la comparacion sola difiere de la disyuncion
    // escrita a mano, este test lo dice — y entonces el docstring miente.
    for (let total = 0; total <= 6; total++) {
      for (let resv = 0; resv <= 6; resv++) {
        for (let cantidad = 1; cantidad <= 6; cantidad++) {
          const d = derivarSku(producto({ resv }), total === 0 ? [] : [stock(total)], [], []);
          const disyuncionCompleta =
            d.sobre_reservado || badgesDe(d).includes('stock_cero') || d.disponible < cantidad;
          expect(enRiesgo(d, cantidad)).toBe(disyuncionCompleta);
        }
      }
    }
  });
});

describe('[2.0.1-A · D3] divergenciaFamilia — la pantalla contra el archivo', () => {
  const ovr = (valor: string): OverrideLectura => ({
    id: 'o1',
    sku: 'A-1',
    campo: 'familia',
    valor_editado: valor,
    editado_en: '2026-08-01T00:00:00.000Z',
    activo: true,
  });
  const v2de = (familia_v2: string | null): ClasificacionV2Lectura => ({
    sku: 'A-1',
    tecnologia: null,
    marca_v2: null,
    familia_v2,
    clase_v2: null,
    descr_v2: null,
  });

  // ============================================================
  // ⚠ CONSECUENCIA MEDIDA DE D-1(a) (17-sep, ver el doc-comment largo de
  // `divergenciaFamilia` en `derivaciones.ts`): con `v2` fuera de la
  // precedencia, `resuelto.familia.origen` de la cláusula (1) SOLO puede ser
  // 'manual' o 'fuente'. La cláusula (1) ya descarta 'fuente', así que para
  // llegar a las cláusulas (2)/(3)/(4) hace falta un OVERRIDE ACTIVO — la
  // clase `'v2'` queda INALCANZABLE. Los tests de abajo se reescriben para
  // seguir ejerciendo esas cláusulas, ahora por el único camino que queda.
  // ============================================================

  // ============================================================
  // EL CASO REAL, con nombre y apellido: del mapa de O2 §4. Antes de D-1(a)
  // este SKU divergía por v2; ahora la v2 está presente y CONGELADA, así
  // que ya no hay divergencia que marcar — es el resultado esperado, no un
  // defecto de este bloque.
  // ============================================================
  it('DMY5139-A: el archivo dice OBSOLETO y v2 dice CLIP 2.0 → YA NO diverge (v2 congelada, D-1(a))', () => {
    const p = producto({ sku: 'DMY5139-A', familia: 'OBSOLETO', snapshot_id: 'S1' });
    const d = divergenciaFamilia(p, [], v2de('CLIP 2.0'), 'S1');
    expect(d.clase).toBeNull();
    expect(d.fuente).toEqual(['OBSOLETO']);
    // `efectiva` es la que PINTA la resolución — y ahora es la fuente, no v2.
    expect(d.efectiva).toEqual(['OBSOLETO']);
    expect(efectivas(p, [], v2de('CLIP 2.0')).familia_efectiva).toBe('OBSOLETO');
  });

  it('HQ1811: el archivo dice SERIES1 y v2 dice UL4 — el espécimen del arco, ahora sin divergencia', () => {
    const p = producto({ sku: 'HQ1811', familia: 'SERIES1', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [], v2de('UL4'), 'S1').clase).toBeNull();
  });

  // ============================================================
  // VACUIDAD (P19): los estados donde la respuesta TIENE que ser `null`, cada
  // uno con el mutante que lo pondría en rojo. Reescritas con OVERRIDE ACTIVO
  // (el único camino que hoy no corta en la cláusula 1) — `v2de(...)` queda
  // en la llamada solo para probar que, de todas formas, se ignora.
  // ============================================================
  it('cláusula 2 · REMANENTE: el SKU ya no viene en el archivo vigente → null (vía override, único camino que llega aquí)', () => {
    // Mutante: borrar la cláusula (2) → cae a la (4), los conjuntos difieren
    // ('OBSOLETO' vs 'CLIP 2.0') y devuelve 'manual' — este caso deja de ser null.
    const p = producto({ familia: 'OBSOLETO', snapshot_id: 'S0' });
    expect(divergenciaFamilia(p, [ovr('CLIP 2.0')], v2de('CLIP 2.0'), 'S1').clase).toBeNull();
  });

  it('cláusula 3 · la fuente SIN familia no es discrepancia — las CUATRO formas de vacío (vía override)', () => {
    // `sinFamilia` no es `=== null`: cubre '', '   ' y '/'. Mutante: quitar la
    // cláusula (3) → los cuatro devuelven 'manual' (conjunto vacío ≠ conjunto del override).
    for (const vacia of [null, '', '   ', '/']) {
      const p = producto({ familia: vacia, snapshot_id: 'S1' });
      expect(
        divergenciaFamilia(p, [ovr('CLIP 2.0')], null, 'S1').clase,
        `familia=${JSON.stringify(vacia)}`,
      ).toBeNull();
    }
  });

  it('cláusula 4 · MISMO conjunto, distinta escritura (QZ8/H5980 vs QZ8 / H5980) → null (vía override)', () => {
    // ÉSTE separa el instrumento fino del burdo: por cadenas sería divergente;
    // por conjuntos de átomos no lo es. Mutante: comparar strings → pasa a 'manual'.
    const p = producto({ familia: 'QZ8/H5980', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [ovr('QZ8 / H5980')], null, 'S1').clase).toBeNull();
  });

  it('cláusula 4 · mismo conjunto en distinto ORDEN → null (vía override)', () => {
    const p = producto({ familia: 'CLIP 3.0 / CLIP ROTATIVO', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [ovr('CLIP ROTATIVO / CLIP 3.0')], null, 'S1').clase).toBeNull();
  });

  it('cláusula 4 · mismo conjunto en distinta CAJA → null (vía override)', () => {
    const p = producto({ familia: 'series 25', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [ovr('SERIES 25')], null, 'S1').clase).toBeNull();
  });

  // La diferencia entre preguntar «¿tiene fila v2?» (la representación) y
  // «¿v2 GANÓ?» (la cosa). Un predicado que mirara la fila devolvería 'v2'.
  //
  // ⚠ VACUA desde D-1(a) (CAT-B1 · Tramo B, 17-sep): con la v2 fuera de la
  // precedencia, la cláusula (1) de `divergenciaFamilia` ya corta ANTES de
  // llegar a esta distinción — `resuelto.familia.origen` es 'fuente' tanto
  // si la fila v2 existe con `familia_v2` vacía como si no existe ninguna
  // fila. La aserción pasa con CUALQUIER implementación que respete D-1(a),
  // no solo con la que distingue "representación" de "cosa" que este test
  // nació para falsar.
  it('fila v2 que EXISTE pero con familia_v2 vacía → gana la fuente → null (y da igual, v2 nunca gana ya)', () => {
    const p = producto({ familia: 'OBSOLETO', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [], v2de(null), 'S1').clase).toBeNull();
    expect(divergenciaFamilia(p, [], null, 'S1').clase).toBeNull();
  });

  // ============================================================
  // EL OVERRIDE MANUAL: diverge, pero en OTRO cubo.
  // ============================================================
  it('un override manual sobre la fuente se clasifica «manual», no «v2»', () => {
    const p = producto({ familia: 'OBSOLETO', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [ovr('CLIP 2.0')], null, 'S1').clase).toBe('manual');
  });

  it('el override gana sobre la v2 y la clase lo refleja (precedencia intacta)', () => {
    const p = producto({ familia: 'OBSOLETO', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [ovr('CANDADOS')], v2de('CLIP 2.0'), 'S1').clase).toBe('manual');
  });

  it('un override que COINCIDE con la fuente no es divergencia, aunque la capa sea manual', () => {
    const p = producto({ familia: 'CANDADOS', snapshot_id: 'S1' });
    expect(divergenciaFamilia(p, [ovr('CANDADOS')], null, 'S1').clase).toBeNull();
  });

  // ============================================================
  // BARRIDO: las dos direcciones sobre una rejilla, con la expectativa DERIVADA
  // de las cláusulas (no copiada del resultado).
  // ============================================================
  it('barrido: fuente × v2 (ignorada) × override × snapshot, con su tabla de expectativas — D-1(a)', () => {
    const fuentes: Array<string | null> = ['CANDADOS', 'OBSOLETO', null, '/'];
    // `v2s` se mantiene en el barrido a propósito: prueba, en cada combinación,
    // que el resultado es EL MISMO sin importar qué traiga v2 — v2 ya no
    // participa de nada. Si `resolverClasificacion` volviera a dejarla ganar,
    // este barrido se pondría en rojo (las combinaciones con v ≠ null y sin
    // override dejarían de coincidir con la expectativa DERIVADA de fuente/override).
    const v2s: Array<string | null> = [null, 'CANDADOS', 'CLIP 2.0', 'candados'];
    const overrides: OverrideLectura[][] = [[], [ovr('CLIP 3.0')], [ovr('CANDADOS')]];
    const snapshots: Array<[string, string]> = [
      ['S1', 'S1'],
      ['S0', 'S1'],
    ];
    let divergentes = 0;
    let nulos = 0;
    for (const f of fuentes) {
      for (const v of v2s) {
        for (const o of overrides) {
          for (const [snapFila, vigente] of snapshots) {
            const p = producto({ familia: f, snapshot_id: snapFila });
            const d = divergenciaFamilia(p, o, v2de(v), vigente);
            // D-1(a): sin override, SIEMPRE gana la fuente — v2 quedó fuera de
            // la fórmula de la "efectiva" (antes era `o[0]?.valor_editado ?? v ?? f`).
            const efectiva = o.length > 0 ? o[0].valor_editado : f;
            const ganoLaFuente = o.length === 0;
            const arriba = (x: string | null) => String(x ?? '').toLocaleUpperCase('es-MX');
            const esperadoNulo =
              ganoLaFuente ||
              snapFila !== vigente ||
              f === null ||
              f === '/' ||
              arriba(efectiva) === arriba(f);
            expect(d.clase === null, `f=${f} v=${v} ovr=${o.length} snap=${snapFila}`).toBe(esperadoNulo);
            if (d.clase === null) nulos++;
            else divergentes++;
          }
        }
      }
    }
    // El barrido EJERCE las dos direcciones: si alguna fuera 0, la rejilla no
    // probaría lo que dice probar (P19 sobre el propio barrido).
    expect(divergentes).toBeGreaterThan(0);
    expect(nulos).toBeGreaterThan(0);
  });
});

// ============================================================
// [FIX-B1 · item 7] contarSinTecnologia — la MISMA aritmética que
// `inventory.service.ts` (facetas.sin_tecnologia) y `dashboard.service.ts`
// (kpis.productos_sin_tecnologia) comparten, en vez de dos recorridos que
// puedan divergir.
// ============================================================
describe('contarSinTecnologia', () => {
  it('cuenta SOLO los ítems con tecnologia null', () => {
    const items = [{ tecnologia: 'EAS' }, { tecnologia: null }, { tecnologia: 'BRAND1' }, { tecnologia: null }];
    expect(contarSinTecnologia(items)).toBe(2);
  });

  it('lista vacía → 0', () => {
    expect(contarSinTecnologia([])).toBe(0);
  });

  it('todos con tecnologia → 0', () => {
    expect(contarSinTecnologia([{ tecnologia: 'EAS' }, { tecnologia: 'BRAND2' }])).toBe(2 - 2);
  });

  it('todos sin tecnologia → cuenta todos', () => {
    expect(contarSinTecnologia([{ tecnologia: null }, { tecnologia: null }, { tecnologia: null }])).toBe(3);
  });

  it('tolera `tecnologia` ausente (undefined) como "sin tecnología" — mismo criterio que `== null`', () => {
    const items: Array<{ tecnologia?: string | null }> = [{}, { tecnologia: 'EAS' }];
    expect(contarSinTecnologia(items)).toBe(1);
  });

  // [FIX-B1 · revisión] UNA SOLA REGLA DE "VACÍO", igual que `capaFuenteManual`
  // (arriba): una cadena en blanco cuenta como "sin tecnología", mismo
  // criterio que la SQL (`btrim()`).
  it('[FIX-B1 · revisión] cuenta un ítem con tecnologia en BLANCO (solo espacios) como SIN tecnología', () => {
    const items = [{ tecnologia: 'EAS' }, { tecnologia: '   ' }, { tecnologia: '' }];
    expect(contarSinTecnologia(items)).toBe(2);
  });

  it('[FIX-B1 · revisión] tecnologia con espacios alrededor de un valor real NO cuenta como sin tecnología', () => {
    const items = [{ tecnologia: '  EAS  ' }];
    expect(contarSinTecnologia(items)).toBe(0);
  });
});

// ============================================================
// [FIX-B1] overrideActivo con campo='tecnologia' — mismo mecanismo
// latest-active-wins que familia/descripcion, ahora también disponible
// para el tercer campo de `CampoOverride`.
// ============================================================
describe("overrideActivo — campo='tecnologia' (FIX-B1)", () => {
  it('encuentra el override activo de tecnologia del sku, ignorando otros campos/skus', () => {
    const overrides = [
      override('familia', 'FAM', { id: 'ovr-familia' }),
      override('tecnologia', 'EAS', { id: 'ovr-tec' }),
      override('tecnologia', 'BRAND2', { sku: 'B-2', id: 'ovr-otro-sku' }),
    ];
    const ganador = overrideActivo(overrides, 'A-1', 'tecnologia');
    expect(ganador?.id).toBe('ovr-tec');
    expect(ganador?.valor_editado).toBe('EAS');
  });

  it('sin override de tecnologia → null', () => {
    const overrides = [override('familia', 'FAM')];
    expect(overrideActivo(overrides, 'A-1', 'tecnologia')).toBeNull();
  });

  it('latest-active-wins también aplica a tecnologia: gana el de mayor (editado_en, id)', () => {
    const overrides = [
      override('tecnologia', 'EAS', { id: 'ovr-1', editado_en: '2026-07-01T00:00:00.000Z' }),
      override('tecnologia', 'BRAND1', { id: 'ovr-2', editado_en: '2026-07-02T00:00:00.000Z' }),
    ];
    expect(overrideActivo(overrides, 'A-1', 'tecnologia')?.valor_editado).toBe('BRAND1');
  });
});
