// ============================================================
// [FIX-B2] fake-postgrest.ts — SÓLO PARA PRUEBAS. Un PostgREST de mentiras que
// se porta como el de verdad en las tres cosas que deciden el corte de 1 000
// filas. Nació dentro de `persist.loadPrevState.paginacion.test.ts` (ronda 1) y
// se extrajo aquí en la ronda 2, cuando el mismo defecto apareció en
// `avisos.service.ts` y `proyectos.service.ts`: tres copias del mismo fake
// habrían sido tres verdades sobre cómo se porta PostgREST.
//
// POR QUÉ NO BASTA UN FAKE QUE DEVUELVA LO QUE SE LE DA: contra un fake así,
// una lectura SIN paginar recibe miles de filas y la prueba sale verde por la
// razón equivocada (P25) — el fake le regala exactamente lo que el servidor
// real le niega (P36). Éste se porta como PostgREST en:
//
//   1. Nunca entrega más de 1 000 filas por respuesta — ni sin `.range`, ni con
//      un `.range` más ancho que eso. Es lo que la casa midió en producción:
//      `.range(0, 4999)` sobre una tabla grande devuelve 1 000, sin error.
//   2. Respeta `.range(from, to)` como `OFFSET from LIMIT to-from+1`.
//   3. Sin `ORDER BY` no promete orden: la n-ésima consulta a una misma tabla
//      ve las filas en orden físico natural si n es par y AL REVÉS si es impar,
//      y un `.order()` sobre una columna no única deja los empates en ese orden
//      físico. Así, paginar sin orden total repite filas y se salta otras aquí
//      igual que en Postgres — y la prueba lo ve.
//
// LO QUE ESTE FAKE NO HACE, declarado: no proyecta columnas (devuelve la fila
// entera pida lo que pida el `select`, así que no vigila la CADENA del select —
// para eso están las aserciones sobre `Consulta.select`); no resuelve embebidos
// (la fila de prueba los trae ya puestos); no aplica RLS. Y compara como
// NÚMERO sólo si los dos valores son números: todo lo demás se compara como
// TEXTO, que es correcto para las columnas que estas pruebas ordenan o acotan
// (uuid, sku, clave de almacén, ISO-8601 escrito siempre con el mismo formato).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

/** `max-rows` de PostgREST: el tope por respuesta (1 000 por omisión en Supabase). */
export const MAX_FILAS = 1000;

export type Fila = Record<string, unknown>;
export type Respuesta = { data: Fila[] | null; error: { message: string } | null };
export type RespuestaUna = { data: Fila | null; error: { message: string } | null };

export interface Orden {
  columna: string;
  ascendente: boolean;
}

/** Lo que el fake registra de cada consulta EJECUTADA (una por página). */
export interface Consulta {
  tabla: string;
  select: string;
  /** `.eq(col, valor)`, en el orden en que se aplicaron. */
  filtros: Array<[string, unknown]>;
  /** `.gte(col, valor)`. */
  desde: Array<[string, unknown]>;
  /** `.lte(col, valor)`. */
  hasta: Array<[string, unknown]>;
  /** `.in(col, valores)`. */
  listas: Array<[string, readonly unknown[]]>;
  orden: Orden[];
  rango: [number, number] | null;
  limite: number | null;
  /** n-ésima consulta a ESTA tabla (0 = la primera): decide el orden físico. */
  n: number;
}

export type ConsultaSinN = Omit<Consulta, 'n'>;

interface Constructor extends PromiseLike<Respuesta> {
  eq(columna: string, valor: unknown): Constructor;
  gte(columna: string, valor: unknown): Constructor;
  lte(columna: string, valor: unknown): Constructor;
  in(columna: string, valores: readonly unknown[]): Constructor;
  order(columna: string, opciones?: { ascending?: boolean }): Constructor;
  limit(n: number): Constructor;
  range(desde: number, hasta: number): Constructor;
  maybeSingle(): PromiseLike<RespuestaUna>;
}

export interface FakePostgrest {
  db: SupabaseClient;
  consultas: Consulta[];
}

/** Números como números; todo lo demás, como texto. Ver la cabecera. */
export function comparar(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function fakePostgrest(
  tablas: Record<string, Fila[]>,
  /** Devuelve el mensaje de error para ESA consulta, o null si responde bien. */
  falla: (c: ConsultaSinN) => string | null = () => null,
): FakePostgrest {
  const consultas: Consulta[] = [];
  const porTabla: Record<string, number> = {};

  /** Las filas que la consulta ve, ya filtradas y ordenadas, ANTES de rango, límite y tope. */
  function filasDe(c: ConsultaSinN, n: number): Fila[] {
    const fisico = (tablas[c.tabla] ?? []).filter(
      (f) =>
        c.filtros.every(([col, v]) => f[col] === v) &&
        c.desde.every(([col, v]) => comparar(f[col], v) >= 0) &&
        c.hasta.every(([col, v]) => comparar(f[col], v) <= 0) &&
        c.listas.every(([col, vs]) => vs.includes(f[col])),
    );
    // Sin ORDER BY no hay orden prometido: par = natural, impar = al revés.
    const filas = n % 2 === 0 ? [...fisico] : [...fisico].reverse();
    if (c.orden.length > 0) {
      // `sort` es estable (ES2019): los empates conservan el orden físico de ESTA consulta.
      filas.sort((a, b) => {
        for (const o of c.orden) {
          const d = comparar(a[o.columna], b[o.columna]);
          if (d !== 0) return o.ascendente ? d : -d;
        }
        return 0;
      });
    }
    return filas;
  }

  /** Registra la consulta y devuelve su número de orden para ESA tabla, o el error que toque. */
  function registrar(c: ConsultaSinN): { n: number; error: string | null } {
    const n = porTabla[c.tabla] ?? 0;
    porTabla[c.tabla] = n + 1;
    consultas.push({ ...c, n });
    return { n, error: falla(c) };
  }

  function ejecutar(c: ConsultaSinN): Respuesta {
    const { n, error } = registrar(c);
    if (error !== null) return { data: null, error: { message: error } };
    let ventana = filasDe(c, n);
    if (c.rango) ventana = ventana.slice(c.rango[0], c.rango[1] + 1);
    if (c.limite !== null) ventana = ventana.slice(0, c.limite);
    // El tope de PostgREST aplica SIEMPRE: con o sin `.range`.
    return { data: ventana.slice(0, MAX_FILAS), error: null };
  }

  /** `.maybeSingle()`: 0 filas → null; 1 → la fila; más de 1 → error, como PostgREST (PGRST116). */
  function ejecutarUna(c: ConsultaSinN): RespuestaUna {
    const { n, error } = registrar(c);
    if (error !== null) return { data: null, error: { message: error } };
    const filas = filasDe(c, n);
    if (filas.length > 1) return { data: null, error: { message: `maybeSingle: ${filas.length} filas` } };
    return { data: filas[0] ?? null, error: null };
  }

  function constructor(c: ConsultaSinN): Constructor {
    return {
      eq: (columna, valor) => constructor({ ...c, filtros: [...c.filtros, [columna, valor]] }),
      gte: (columna, valor) => constructor({ ...c, desde: [...c.desde, [columna, valor]] }),
      lte: (columna, valor) => constructor({ ...c, hasta: [...c.hasta, [columna, valor]] }),
      in: (columna, valores) => constructor({ ...c, listas: [...c.listas, [columna, [...valores]]] }),
      order: (columna, opciones) =>
        constructor({ ...c, orden: [...c.orden, { columna, ascendente: opciones?.ascending ?? true }] }),
      limit: (limite) => constructor({ ...c, limite }),
      range: (desde, hasta) => constructor({ ...c, rango: [desde, hasta] }),
      maybeSingle: () => ({
        then: (onfulfilled, onrejected) => Promise.resolve().then(() => ejecutarUna(c)).then(onfulfilled, onrejected),
      }),
      then: (onfulfilled, onrejected) => Promise.resolve().then(() => ejecutar(c)).then(onfulfilled, onrejected),
    };
  }

  const db = {
    from: (tabla: string) => ({
      select: (select: string) =>
        constructor({ tabla, select, filtros: [], desde: [], hasta: [], listas: [], orden: [], rango: null, limite: null }),
    }),
  };
  return { db: db as unknown as SupabaseClient, consultas };
}

/** `columna[ desc],columna…` — la firma del ORDER BY de una consulta, para comparar contra lo esperado. */
export function firmaOrden(c: Consulta): string {
  return c.orden.map((o) => `${o.columna}${o.ascendente ? '' : ' desc'}`).join(',');
}

/** Biyección de 1..n sobre sí mismo: un `id` que NO sigue el orden de inserción (como un uuid). */
export function revuelto(i: number, n: number): number {
  return ((i * 7919) % n) + 1;
}
