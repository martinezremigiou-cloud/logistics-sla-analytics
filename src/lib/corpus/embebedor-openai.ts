// ============================================================
// [INV-B11] O3 · el embebedor real. **Este archivo es el único de todo el
// bloque que saca texto del perímetro**, y por eso está solo.
//
// Autorizado el 2026-08-21, con dos condiciones:
//   1. **Solo corpus, nunca dato de inventario.** Las dos mitades viajan por
//      caminos distintos y se juntan en la pantalla, no en el prompt.
//   2. **La lista blanca y la parada ante secreto corren ANTES de mandar nada.**
//      Eso no se cumple aquí: se cumple en `corpus.service.ts`, que llama a
//      `revisarLote` sobre el lote entero antes de tocar esta función. Aquí
//      solo queda escrito que ese orden es una condición, no una preferencia.
//
// ────────────────────────────────────────────────────────────
// SIN REINTENTO, y es la misma decisión que en `modelo-openai.ts`.
//
// Un reintento automático convierte un fallo en un silencio: la corrida tarda
// más y acaba pareciendo normal. El intento queda registrado con su error, y
// **volver a correr la sync es barato** —lo que ya está indexado no se vuelve a
// embeber, porque el hash no cambió—. Reintentar aquí sería resolver a mano un
// problema que el diseño del diff ya resuelve solo.
//
// EL ORDEN DE SALIDA ES PARTE DEL CONTRATO. La API de embeddings puede devolver
// los objetos desordenados y trae un `index` para eso. **Se ordena por `index`,
// no se confía en el orden de llegada**: pegar cada vector al trozo equivocado
// produce un índice que se ve perfectamente sano y contesta cualquier cosa.
// ============================================================
import { DIMENSIONES_EMBEDDING, type Embebedor, type ResultadoEmbebido } from './fuente';

/** `text-embedding-3-small`, 1536. Ver `DIMENSIONES_EMBEDDING` para el porqué. */
export const MODELO_EMBEDDING_POR_OMISION = 'text-embedding-3-small';

const TIEMPO_LIMITE_MS = 60_000;

export class ErrorDelEmbebedor extends Error {
  readonly codigo: 'rechazado' | 'sin_contenido' | 'desordenado';
  constructor(codigo: ErrorDelEmbebedor['codigo'], mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDelEmbebedor';
    this.codigo = codigo;
  }
}

interface RespuestaOpenAI {
  data?: { index?: number; embedding?: number[] }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export function embebedorOpenAI(
  apiKey: string,
  modelo: string = process.env.OPENAI_MODELO_EMBEDDING || MODELO_EMBEDDING_POR_OMISION,
): Embebedor {
  return {
    nombre: modelo,
    dimensiones: DIMENSIONES_EMBEDDING,

    async embeber(textos: readonly string[]): Promise<ResultadoEmbebido> {
      if (textos.length === 0) return { vectores: [], tokens: 0 };

      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);

      try {
        const res = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelo, input: textos }),
          signal: control.signal,
          cache: 'no-store',
        });

        if (!res.ok) {
          // El cuerpo puede traer detalles de la cuenta: se corta y no se
          // propaga entero para que no acabe en un log.
          const detalle = (await res.text().catch(() => '')).slice(0, 200);
          throw new ErrorDelEmbebedor('rechazado', `El embebedor respondió ${res.status}. ${detalle}`);
        }

        const cuerpo = (await res.json()) as RespuestaOpenAI;
        const datos = cuerpo.data ?? [];
        if (datos.length !== textos.length) {
          throw new ErrorDelEmbebedor(
            'sin_contenido',
            `Pedí ${textos.length} embeddings y llegaron ${datos.length}.`,
          );
        }

        // Se ORDENA por `index`. Confiar en el orden de llegada es la clase de
        // suposición que produce un índice sano por fuera y equivocado por
        // dentro — y que ninguna prueba de forma detecta.
        const ordenados = [...datos].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const vectores: number[][] = [];
        // Índice explícito y no `.entries()`: el `target` de este proyecto no
        // itera un iterador sin `downlevelIteration`, y mover un ajuste global
        // por comodidad local es mal negocio.
        for (let i = 0; i < ordenados.length; i++) {
          const d = ordenados[i]!;
          if ((d.index ?? i) !== i) {
            throw new ErrorDelEmbebedor('desordenado', `Falta el embedding del índice ${i}.`);
          }
          const v = d.embedding;
          if (!Array.isArray(v) || v.length !== DIMENSIONES_EMBEDDING) {
            throw new ErrorDelEmbebedor(
              'sin_contenido',
              `El embedding ${i} tiene ${Array.isArray(v) ? v.length : 'ninguna'} dimensión(es) y se esperaban ${DIMENSIONES_EMBEDDING}.`,
            );
          }
          vectores.push(v);
        }

        return { vectores, tokens: cuerpo.usage?.total_tokens ?? cuerpo.usage?.prompt_tokens ?? 0 };
      } finally {
        clearTimeout(reloj);
      }
    },
  };
}
