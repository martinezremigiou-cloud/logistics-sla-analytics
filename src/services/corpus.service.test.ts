// ============================================================
// [INV-B11] corpus.service — y lo que se prueba aquí es el ORDEN.
//
// La prueba central de este archivo no comprueba un resultado: comprueba que
// **el embebedor no fue llamado NI UNA VEZ** cuando el lote traía un secreto.
//
// Y esa distinción importa. Un test que solo mirara `resultado === 'detenido'`
// pasaría igual con un servicio que embebe todos los documentos, los manda al
// proveedor, y DESPUÉS descubre el secreto y se detiene. El resultado sería
// idéntico; el daño, irreversible. **Un texto enviado no se des-envía.**
//
// Es el mismo tipo de prueba que en B10 contaba `llamadasAlModelo` para el
// atajo: cuando la garantía es de secuencia, hay que contar llamadas, no leer
// salidas.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sincronizar } from './corpus.service';
import { DIMENSIONES_EMBEDDING, type Embebedor, type FuenteCorpus } from '@/lib/corpus/fuente';

// ------------------------------------------------------------
// Dobles
// ------------------------------------------------------------

interface Operacion {
  tabla: string;
  verbo: string;
  filas?: number;
}

/** Lo que el índice tiene antes de la corrida. */
let indice: { ruta: string; hash: string }[] = [];
let ops: Operacion[] = [];
let intentos: Record<string, unknown>[] = [];

function fakeDb(): SupabaseClient {
  const api = {
    from(tabla: string) {
      return {
        insert(filas: unknown) {
          const arr = Array.isArray(filas) ? filas : [filas];
          ops.push({ tabla, verbo: 'insert', filas: arr.length });
          if (tabla === 'corpus_sync_intentos') intentos.push(arr[0] as Record<string, unknown>);
          return {
            select: () => ({
              single: async () => ({ data: { id: 'intento-1' }, error: null }),
            }),
            then: undefined,
            // `insert` sin `.select()` se espera directamente
            ...(tabla === 'corpus_sync_intentos'
              ? {}
              : { then: (r: (v: { error: null }) => void) => r({ error: null }) }),
          };
        },
        upsert(filas: unknown[]) {
          ops.push({ tabla, verbo: 'upsert', filas: filas.length });
          return Promise.resolve({ error: null });
        },
        update(campos: Record<string, unknown>) {
          ops.push({ tabla, verbo: 'update' });
          if (tabla === 'corpus_sync_intentos') intentos.push(campos);
          return { eq: async () => ({ error: null }) };
        },
        delete() {
          return {
            in: async (...args: unknown[]) => {
              const valores = args[1] as unknown[];
              ops.push({ tabla, verbo: 'delete', filas: valores.length });
              return { error: null };
            },
          };
        },
        select() {
          ops.push({ tabla, verbo: 'select' });
          return Promise.resolve({ data: indice, error: null });
        },
      };
    },
  };
  return api as unknown as SupabaseClient;
}

/** Cuenta llamadas: es lo que convierte una garantía de ORDEN en algo medible. */
class EmbebedorFalso implements Embebedor {
  readonly nombre = 'falso';
  llamadas = 0;
  textosVistos: string[] = [];
  constructor(readonly dimensiones: number = DIMENSIONES_EMBEDDING, private readonly desalinea = false) {}
  async embeber(textos: readonly string[]) {
    this.llamadas++;
    this.textosVistos.push(...textos);
    const n = this.desalinea ? textos.length - 1 : textos.length;
    return {
      vectores: Array.from({ length: Math.max(0, n) }, () => new Array(this.dimensiones).fill(0.1)),
      tokens: textos.length * 100,
    };
  }
}

function fuenteFalsa(archivos: Record<string, string>, version = 'local-sin-git'): FuenteCorpus {
  return {
    nombre: 'falsa',
    version: async () => version,
    listar: async () =>
      Object.keys(archivos).map((ruta) => ({ ruta, hash: 'h-' + ruta + '-' + archivos[ruta]!.length })),
    leer: async (ruta) => archivos[ruta] ?? '',
  };
}

const FICHA = [
  '---',
  'name: "Series2"',
  'description: "Display seguro."',
  'type: reference',
  'fuente_pdf: "Mkt/Series2.pdf"',
  '---',
  '',
  '# Series2',
  '',
  'Cable de 28 pulgadas, alarma de 88 dB.',
].join('\n');

// El cebo se arma por fragmentos (como en src/lib/corpus/secretos.test.ts): en ejecución tiene
// forma de llave para que el detector la vea; en disco no la tiene, y los escáneres de secretos
// del repo no la confunden con una credencial.
const CON_SECRETO = ['# Notas', '', ['api_key = sk-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH1234'].join('')].join('\n');

beforeEach(() => {
  indice = [];
  ops = [];
  intentos = [];
});

// ------------------------------------------------------------

describe('[INV-B11] sincronizar · ★ la parada ante secreto es de ORDEN', () => {
  it('con un secreto en el lote NO se llama al embebedor NI UNA VEZ', async () => {
    const emb = new EmbebedorFalso();
    const r = await sincronizar(
      fakeDb(),
      fuenteFalsa({ 'a/Series2.md': FICHA, 'a/notas.md': CON_SECRETO }),
      emb,
    );

    // ────────────────────────────────────────────────────────
    // LA ASERCIÓN QUE JUSTIFICA EL ARCHIVO VA PRIMERO, y el orden no es estilo.
    //
    // Estaba después de `expect(r.resultado)`, y al sabotear el corte temprano
    // la prueba se ponía roja **por el resultado**, no por la llamada. O sea
    // que el mensaje que vería quien la rompa diría «esperaba detenido, dio
    // ok» — cierto, y sin nombrar el daño real: que el texto ya salió.
    //
    // Es la cara C de P25 dentro de una prueba: **roja por otra razón**.
    // ────────────────────────────────────────────────────────
    expect(emb.llamadas, 'se habló con el proveedor ANTES de revisar el lote: el texto ya salió').toBe(0);
    expect(emb.textosVistos, 'salió texto del perímetro con un secreto dentro').toHaveLength(0);
    expect(r.resultado).toBe('detenido');
  });

  it('tampoco se escribe nada: ni documentos ni trozos', async () => {
    await sincronizar(fakeDb(), fuenteFalsa({ 'a.md': FICHA, 'b.md': CON_SECRETO }), new EmbebedorFalso());
    expect(ops.filter((o) => o.tabla === 'corpus_documentos' && o.verbo === 'upsert')).toHaveLength(0);
    expect(ops.filter((o) => o.tabla === 'corpus_trozos')).toHaveLength(0);
  });

  it('el motivo nombra el archivo y NO el secreto', async () => {
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a/notas.md': CON_SECRETO }), new EmbebedorFalso());
    expect(r.motivo).toContain('a/notas.md');
    expect(r.motivo).not.toContain('sk-AAAA');
  });

  // El control positivo: sin él, un servicio que se detuviera SIEMPRE pondría
  // verdes las tres de arriba y no indexaría nada nunca (P19).
  it('control positivo · sin secreto SÍ se embebe y SÍ se escribe', async () => {
    const emb = new EmbebedorFalso();
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a/Series2.md': FICHA }), emb);
    expect(r.resultado).toBe('ok');
    expect(emb.llamadas).toBeGreaterThan(0);
    expect(ops.some((o) => o.tabla === 'corpus_trozos' && o.verbo === 'insert')).toBe(true);
  });
});

describe('[INV-B11] sincronizar · el intento se registra al EMPEZAR', () => {
  it('una corrida detenida deja su renglón, no lo omite', async () => {
    await sincronizar(fakeDb(), fuenteFalsa({ 'x.md': CON_SECRETO }), new EmbebedorFalso());
    // El primero es el INSERT con 'corriendo'; el último, el UPDATE final.
    expect(intentos[0]).toMatchObject({ resultado: 'corriendo' });
    expect(intentos[intentos.length - 1]).toMatchObject({ resultado: 'detenido' });
  });

  it('`detenido` NO es `error`: una defensa no se registra como falla', async () => {
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'x.md': CON_SECRETO }), new EmbebedorFalso());
    expect(r.resultado).toBe('detenido');
    expect(r.resultado).not.toBe('error');
  });

  it('el intento guarda los CUATRO números del diff, no solo lo que cambió', async () => {
    indice = [{ ruta: 'viejo.md', hash: 'h-viejo' }];
    await sincronizar(fakeDb(), fuenteFalsa({ 'viejo.md': FICHA, 'nuevo.md': FICHA }), new EmbebedorFalso());
    const fin = intentos[intentos.length - 1]!;
    expect(fin).toHaveProperty('altas');
    expect(fin).toHaveProperty('cambios');
    expect(fin).toHaveProperty('bajas');
    expect(fin).toHaveProperty('sin_cambio');
  });
});

describe('[INV-B11] sincronizar · el borrado masivo exige declaración escrita', () => {
  const indiceGrande = () =>
    Array.from({ length: 10 }, (_, i) => ({ ruta: 'd' + i + '.md', hash: 'h' + i }));

  it('sin declaración se detiene y NO borra', async () => {
    indice = indiceGrande();
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'd0.md': FICHA }), new EmbebedorFalso());
    expect(r.resultado).toBe('detenido');
    expect(r.motivo).toContain('declaración escrita');
    expect(ops.filter((o) => o.verbo === 'delete')).toHaveLength(0);
  });

  it('una declaración de dos letras no cuenta: un clic no es una declaración', async () => {
    indice = indiceGrande();
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'd0.md': FICHA }), new EmbebedorFalso(), {
      irreversibilidad: 'si',
    });
    expect(r.resultado).toBe('detenido');
  });

  it('CON declaración procede, y la declaración queda GUARDADA en el renglón', async () => {
    indice = indiceGrande();
    const decl = 'El PO vacio la carpeta de Brand7 a proposito el 2026-08-21; las fichas se rehacen.';
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'd0.md': FICHA }), new EmbebedorFalso(), {
      irreversibilidad: decl,
    });
    expect(r.resultado).toBe('ok');
    expect(r.motivo).toContain(decl);
    const fin = intentos[intentos.length - 1]!;
    expect(String(fin.motivo)).toContain(decl);
  });

  it('un manifiesto VACÍO se detiene aunque el umbral no aplicara', async () => {
    indice = indiceGrande();
    const r = await sincronizar(fakeDb(), fuenteFalsa({}), new EmbebedorFalso(), { umbralBorrado: 0.99 });
    expect(r.resultado).toBe('detenido');
    expect(r.motivo).toContain('lectura fallida');
  });
});

describe('[INV-B11] sincronizar · el embebedor', () => {
  it('una dimensión distinta se detiene ANTES de gastar', async () => {
    const emb = new EmbebedorFalso(768);
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a.md': FICHA }), emb);
    expect(r.resultado).toBe('error');
    expect(r.motivo).toContain('768');
    expect(emb.llamadas, 'se pagó por vectores que no caben en la columna').toBe(0);
  });

  it('si devuelve otra cantidad de vectores se detiene: emparejarlos mal se ve sano', async () => {
    const r = await sincronizar(
      fakeDb(),
      fuenteFalsa({ 'a.md': FICHA }),
      new EmbebedorFalso(DIMENSIONES_EMBEDDING, true),
    );
    expect(r.resultado).toBe('error');
    expect(r.motivo).toContain('vectores');
    expect(ops.some((o) => o.tabla === 'corpus_trozos' && o.verbo === 'insert')).toBe(false);
  });
});

describe('[INV-B11] sincronizar · las tres reglas de exclusión', () => {
  it('un `_README.md` se GUARDA pero no produce trozos', async () => {
    const emb = new EmbebedorFalso();
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'x/_README.md': FICHA }), emb);
    expect(r.resultado).toBe('ok');
    expect(r.excluidos).toBe(1);
    expect(r.embebidos).toBe(0);
    expect(r.trozos).toBe(0);
    // Se guarda: si no, volvería a salir como ALTA en cada corrida, para siempre.
    expect(ops.some((o) => o.tabla === 'corpus_documentos' && o.verbo === 'upsert')).toBe(true);
    // Y no se le paga embebido.
    expect(emb.llamadas).toBe(0);
  });

  it('`type: meta` se excluye aunque el nombre sea normal', async () => {
    const meta = ['---', 'name: "Indice"', 'type: meta', '---', '', '# Indice'].join('\n');
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'x/Indice.md': meta }), new EmbebedorFalso());
    expect(r.excluidos).toBe(1);
    expect(r.embebidos).toBe(0);
  });
});

describe('[INV-B11] sincronizar · SIN embebedor', () => {
  // ============================================================
  // No es un modo degradado, y la medición lo sostiene: **casi todas las
  // fichas de producto son UN SOLO TROZO**. Buscar vectorialmente dentro de un
  // trozo no significa nada — la ficha ES el trozo y cabe entera en un prompt.
  //
  // Y cumple el invariante del bloque MEJOR que con embeddings: sin puntaje de
  // similitud desaparece el único sitio donde algo podría escoger mal.
  // ============================================================
  it('indexa igual, con `embedding` en null y CERO tokens', async () => {
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a/Series2.md': FICHA }), null);
    expect(r.resultado).toBe('ok');
    expect(r.trozos).toBeGreaterThan(0);
    expect(r.tokens).toBe(0);
    expect(ops.some((o) => o.tabla === 'corpus_trozos' && o.verbo === 'insert')).toBe(true);
  });

  it('la parada ante secreto sigue corriendo aunque no haya nada que mandar', async () => {
    // Sin embebedor no sale texto, pero **el archivo igual se guarda en la
    // base**. Un secreto entraría al índice y de ahí a una respuesta.
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a.md': CON_SECRETO }), null);
    expect(r.resultado).toBe('detenido');
    expect(ops.some((o) => o.tabla === 'corpus_trozos')).toBe(false);
  });
});

describe('[INV-B11] sincronizar · simular', () => {
  it('no embebe ni escribe, pero SÍ corre la parada ante secreto', async () => {
    const emb = new EmbebedorFalso();
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a.md': FICHA }), emb, { simular: true });
    expect(r.resultado).toBe('ok');
    expect(r.motivo).toContain('SIMULACIÓN');
    expect(emb.llamadas).toBe(0);
    expect(ops.some((o) => o.tabla === 'corpus_documentos' && o.verbo === 'upsert')).toBe(false);
    expect(r.trozos).toBeGreaterThan(0); // sí calculó lo que haría
  });

  it('y una simulación con secreto se detiene igual', async () => {
    const r = await sincronizar(fakeDb(), fuenteFalsa({ 'a.md': CON_SECRETO }), new EmbebedorFalso(), {
      simular: true,
    });
    expect(r.resultado).toBe('detenido');
  });
});
