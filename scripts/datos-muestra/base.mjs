// ============================================================
// scripts/datos-muestra/base.mjs
// Piezas comunes del generador de datos de muestra: PRNG de semilla fija,
// vocabulario GENÉRICO inventado y constructores de códigos.
//
// Nada aquí proviene de datos reales: cada valor sale de una semilla fija y
// de listas de palabras genéricas. El generador es determinista: la misma
// semilla produce los mismos bytes en los JSON.
// ============================================================

/** Semilla única del conjunto de datos de muestra. */
export const SEMILLA = 20260731;

/** mulberry32: PRNG de 32 bits, rápido y determinista. */
export function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de una cadena → entero de 32 bits (para derivar sub-semillas). */
function fnv1a(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Generador con utilidades; cada `etiqueta` obtiene su propio flujo independiente. */
export class Rng {
  constructor(etiqueta) {
    this.next = mulberry32((SEMILLA ^ fnv1a(etiqueta)) >>> 0);
  }
  /** Entero en [a, b] (ambos incluidos). */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Elección ponderada: `pares` = [[valor, peso], ...]. */
  weighted(pares) {
    const total = pares.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of pares) {
      r -= w;
      if (r < 0) return v;
    }
    return pares[pares.length - 1][0];
  }
  /** Copia barajada (Fisher–Yates). */
  shuffle(arr) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  /** Letra de código: alfabeto de consonantes poco frecuentes en siglas, para que los códigos no se lean como palabras ni como siglas. */
  letra() {
    return 'BCFGJKNQRSTVXYZ'[Math.floor(this.next() * 15)];
  }
  digitos(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String(Math.floor(this.next() * 10));
    return s;
  }
  letras(n) {
    let s = '';
    for (let i = 0; i < n; i++) s += this.letra();
    return s;
  }
}

// ------------------------------------------------------------
// Vocabulario genérico (ver el vocabulario fijado del repo)
// ------------------------------------------------------------

/** Marcas ya sembradas en el catálogo de las pruebas (`makeCatalogIndex`). */
export const MARCAS_SEMBRADAS = ['BRAND1', 'BRAND6', 'VERTICAL', 'EAS', 'CARGADOR', 'SERIES5', 'NACIONAL'];

/** Marcas que las pruebas esperan como NUEVAS (no sembradas) en el fixture de abril. */
export const MARCAS_NUEVAS_TESTIGO = ['BRAND5', 'BRAND9', 'BRAND2'];

/** Otras marcas nuevas (no sembradas) que pueden aparecer. */
export const MARCAS_NUEVAS_EXTRA = ['BRAND3', 'GENERAL'];

/** KAM sembrados en el catálogo de las pruebas (en datos van en MAYÚSCULAS). */
export const KAM_SEMBRADOS = ['LAURA', 'DIEGO', 'HUGO', 'ELENA', 'JULIO', 'SERGIO', 'LUCAS'];

/** KAM ficticios que NO están sembrados (reserva con KAM desconocido). */
export const KAM_NO_SEMBRADOS = ['NADIA', 'PAULA', 'RAQUEL', 'TOMAS', 'IVAN'];

export const FAMILIAS = [
  'SERIES2',
  'SERIES 2',
  'SERIES3',
  'SERIES4',
  'SERIES6',
  'SERIES7',
  'SERIES8',
  'SERIES9',
  'SERIES10',
  'SERIES 41',
  'TAG',
  'LABEL ROLL',
  'CABLE',
  'POWER',
];

export const TIPOS_PRODUCTO = [
  'Security tag',
  'Display stand',
  'Tamper probe',
  'Link cord',
  'Latch plate',
  'Label roll',
  'Charger kit',
  'Hook pin',
  'Clip holder',
  'Wireless remote',
  'Mount bracket',
  'Shelf rail',
  'Cord spool',
  'Pad adhesive',
];

export const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Razón social ficticia de la hoja Reserva (banner de la fila 1). */
export const RAZON_SOCIAL = 'DEMO COMERCIAL S DE RL DE CV';

/** Año de los datos de ejemplo (distinto del de la operación real, a propósito). */
export const ANIO = 2031;

/** Los once estatus del pipeline (leyenda vertical de las hojas de embarques). */
export const ESTATUS_PIPELINE = [
  'Producto Solicitado',
  'En Preparación',
  'En Recolección',
  'En Almacén FW',
  'En Tránsito Aéreo',
  'En Tránsito Marítimo',
  'En Aduana',
  'En Tránsito Terrestre',
  'En Almacén Fiscal',
  'En Almacén North',
  'Producto Disponible',
];

/** SKU reservados: los testigo de las pruebas y los de relleno que las pruebas escriben a mano. */
export const SKU_RESERVADOS = new Set([
  '0875-7566-14',
  '0861-5844-9317',
  '2444N-M',
  '7802-1101-3426',
  '3818-3500-5293',
  'LV0029',
  'Q017-07-R99',
  'SUJ500-F',
  'SW8196',
  'AAA-1',
  'BBB-2',
  'CCC-3',
  'SKU-1',
  'X-1',
  'A-1',
]);

/** Códigos con forma de SKU (letras, dígitos y guiones), únicos dentro de `usados`. */
export function nuevoSku(rng, usados, { numericos = true } = {}) {
  for (;;) {
    const forma = rng.weighted([
      [1, 4], // AA9999-A
      [2, numericos ? 4 : 0], // 9999-9999-9999 (en un .xlsx, tras una celda numérica de 2–3 dígitos se lee como teléfono: se omite)
      [3, 3], // AAA999-A
      [4, 2], // AAAA99A
      [5, 3], // AA9999
      [6, 2], // 9999A-A
      [7, 2], // A999-99-A99
      [8, 1], // AAA9999
    ]);
    let sku;
    if (forma === 1) sku = `${rng.letras(2)}${rng.digitos(4)}-${rng.letra()}`;
    else if (forma === 2) sku = `${rng.digitos(4)}-${rng.digitos(4)}-${rng.digitos(4)}`;
    else if (forma === 3) sku = `${rng.letras(3)}${rng.digitos(3)}-${rng.letra()}`;
    else if (forma === 4) sku = `${rng.letras(4)}${rng.digitos(2)}${rng.letra()}`;
    else if (forma === 5) sku = `${rng.letras(2)}${rng.digitos(4)}`;
    else if (forma === 6) sku = `${rng.digitos(4)}${rng.letra()}-${rng.letra()}`;
    else if (forma === 7) sku = `${rng.letra()}${rng.digitos(3)}-${rng.digitos(2)}-${rng.letra()}${rng.digitos(2)}`;
    else sku = `${rng.letras(3)}${rng.digitos(4)}`;
    const clave = sku.toUpperCase();
    if (usados.has(clave) || SKU_RESERVADOS.has(clave)) continue;
    // un SKU numérico que arranca en «52» se lee como teléfono con lada de país (+52): se evita
    if (forma === 2 && sku.startsWith('52')) continue;
    usados.add(clave);
    return sku;
  }
}

/** Descripción genérica de producto (inventada). */
export function nuevaDescripcion(rng) {
  const tipo = rng.pick(TIPOS_PRODUCTO);
  const modelo = `${rng.letra()}${rng.int(10, 99)}`;
  const medida = rng.pick([
    `${rng.int(20, 90)}MM`,
    `${rng.int(1, 9)}M`,
    `${rng.int(5, 48)}V`,
    `${rng.int(2, 12)} PACK`,
    `${rng.int(10, 60)} IN`,
  ]);
  return `${tipo} ${modelo} ${medida}`;
}

// ------------------------------------------------------------
// Fechas
// ------------------------------------------------------------

/** Serial de Excel (base 1899-12-30) de una fecha civil. */
export function serialExcel(anio, mes, dia) {
  return Math.round((Date.UTC(anio, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function iso(anio, mes, dia) {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Fecha civil aleatoria dentro de ANIO (días 1..28 para no pelear con los meses cortos). */
export function fechaAleatoria(rng, mesMin = 1, mesMax = 12) {
  return { y: ANIO, m: rng.int(mesMin, mesMax), d: rng.int(1, 28) };
}

/** `dd-mmm-yy` en español, como se escribe en la hoja Reserva. */
export function fechaEs({ y, m, d }) {
  return `${String(d).padStart(2, '0')}-${MESES_ES[m - 1]}-${String(y).slice(2)}`;
}
