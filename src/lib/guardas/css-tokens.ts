// ============================================================
// [2.0.1-B · S-1] css-tokens.ts — leer los tokens de `globals.css` desde una
// guarda, con UNA sola implementación.
//
// Vivían dentro de `globals-tema.test.ts`. En S-1 hizo falta el mismo lector
// desde `apariencia-proyecto.test.ts` —que compara el acento del proyecto contra
// el `--mx-tag-azul` del que sale— y la alternativa era copiarlos. Dos lectores
// del mismo CSS que pueden discrepar es cómo empieza una guarda que mide otra
// cosa que la de al lado. Es la misma jugada que `codigo-fuente.ts`, en la
// segunda clase.
//
// **Estas funciones NO quitan comentarios.** Quien las use decide, y la decisión
// tiene consecuencia medida: `bloqueDe` localiza por `indexOf`, así que un
// selector CITADO en un comentario le roba el bloque al de verdad. Pasó en S-1 y
// costó una guarda entera en rojo. Ver `globals-tema.test.ts`.
// ============================================================

// `bloqueDe` vive en `codigo-fuente.ts` desde S-1: empareja llaves y no tiene
// nada de CSS — la usa también la guarda del contrato de lista, sobre
// interfaces de TypeScript. Se reexporta para no romper a quien ya la importaba
// de aquí.
export { bloqueDe } from './codigo-fuente';

/** `--mx-algo: valor;` → { '--mx-algo': 'valor' }. Ignora lo anidado en @media. */
export function tokensDe(cuerpo: string): Record<string, string> {
  const sinAnidado = cuerpo.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, ' ');
  const out: Record<string, string> = {};
  for (const m of Array.from(sinAnidado.matchAll(/(--mx-[\w-]+)\s*:\s*([^;]+);/g))) out[m[1]] = m[2].trim();
  return out;
}

/** Un hex, o una terna RGB suelta para `rgb(var(--x) / alpha)`. Todo lo demás es geometría. */
export function esColor(valor: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(valor) || /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(valor);
}
