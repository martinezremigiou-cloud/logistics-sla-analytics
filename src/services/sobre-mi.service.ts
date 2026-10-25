// ============================================================
// [CHAT-B3] services/sobre-mi.service.ts — LO QUE EL ASISTENTE SABE DE SÍ MISMO.
//
// ────────────────────────────────────────────────────────────
// EL HALLAZGO QUE LO PIDE, según el QA manual:
//
//   «¿sabes de fichas técnicas?»  →  la tarjeta fija de renglones
//   «¿de qué marcas sabes?»       →  LA MISMA TARJETA, byte a byte
//   «¿tú qué eres?»               →  «No sé contestar eso.»
//
// ⇒ **El asistente sabe contestar sobre productos. No sabía nada sobre sí mismo.**
//
// Y las tres tenían respuesta exacta, a una consulta de distancia.
//
// ────────────────────────────────────────────────────────────
// SE CONSULTA, NO SE ESCRIBE. Y ésa es toda la razón de que esto sea un
// servicio y no una constante.
//
// La tarjeta de `capacidades` es una lista escrita a mano que no consulta nada:
// **la lista de lo que se dice que se sabe y la lista de lo que hay son dos
// listas, y nada las compara.** El corpus ya creció y la
// tarjeta seguía diciendo exactamente lo mismo. El corpus se va a alimentar y
// va a crecer con el tiempo.
//
// Deuda con nombre: `UNA-LISTA-FIJA-SOBRE-UN-CORPUS-QUE-CRECE-ENVEJECE-SOLA`.
//
// ────────────────────────────────────────────────────────────
// 🔴 LA CIFRA ES LA MÁS ESTRECHA, Y SE DECIDIÓ SOBRE LO MEDIDO.
//
// Había cuatro candidatas, y la diferencia entre ellas no es cosmética:
//
//     A   todo lo indexado            ← incluye clientes y sistema
//     B   indexado DENTRO del perímetro
//     C   … y legible (con trozos)
//     D   … y además ficha de catálogo de producto
//
// El bloque recomendaba B. Medido, una parte de B no tiene trozos: el
// asistente la tiene en el índice y **no la puede abrir**. Decir B sería
// prometer fichas que al pedírselas no puede entregar — el mismo bucle de
// «ofrece y no da» una capa más abajo.
//
// **D es la única cifra donde «tengo N fichas» y «puedo contestarte de N
// fichas» son la misma frase.**
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { CARPETAS_REDACTABLES } from '@/lib/chat/entrega';

/** La carpeta donde viven las fichas de producto dentro del perímetro. */
const CATALOGO = '06_Fichas';

export interface LoQueSe {
  /** Fichas de producto que el asistente puede ABRIR Y CITAR. Ver la cabecera. */
  readonly fichas: number;
  /** Las marcas, con su nombre legible y cuántas fichas legibles tiene cada una. */
  readonly marcas: readonly { readonly nombre: string; readonly fichas: number }[];
}

/**
 * El nombre legible de una carpeta de marca.
 *
 * `20.01_brand1` → `brand1`. El prefijo numérico es orden del vault, no nombre —
 * y es exactamente la clase de andamiaje que el contrato del asistente
 * (`docs/decisions/0009-grounded-assistant-persona-contract.md`) prohíbe en pantalla.
 */
export function nombreDeMarca(carpeta: string): string {
  return carpeta.replace(/^\d+\.\d+_/, '').replace(/[-_]/g, ' ');
}

/** `true` si la carpeta es una MARCA y no otra cosa del vault. */
function esCarpetaDeMarca(carpeta: string): boolean {
  // Las marcas son `20.0N_Nombre`. Quedan fuera el README, el perfil de empresa
  // (`20.00_`) y la plantilla (`20.99_`), que no son marcas y no se nombran.
  return /^20\.0[1-8]_/.test(carpeta);
}

/**
 * Lo que el asistente puede afirmar de sí mismo. **Todo sale de la base.**
 *
 * Se leen las RUTAS y no un conteo agregado porque hacen falta las dos cosas
 * —cuántas y de quién— y pedirlas por separado abriría la puerta a que una
 * corrida las devuelva de estados distintos.
 *
 * La lectura se acota al perímetro EN LA CONSULTA además de en el filtro: son
 * pocas filas de una columna, y traer el resto para descartarlo sería pagar por
 * datos que el propio contrato prohíbe usar.
 */
export async function loQueSe(db: SupabaseClient): Promise<LoQueSe> {
  const raiz = CARPETAS_REDACTABLES[0];

  const { data, error } = await db
    .from('corpus_documentos')
    .select('ruta')
    .like('ruta', `${raiz}/%${CATALOGO}%`);
  if (error) throw new Error('sobre-mi: documentos: ' + error.message);

  const rutas = (data ?? []).map((d) => String((d as { ruta: string }).ruta));
  if (rutas.length === 0) return { fichas: 0, marcas: [] };

  // ⚠️ SÓLO LAS LEGIBLES. Un documento indexado sin trozos no se puede abrir, y
  // contarlo sería prometer una ficha que al pedirla no llega. Medido: una parte del
  // perímetro está así.
  const { data: conTexto, error: errT } = await db
    .from('corpus_trozos')
    .select('ruta')
    .in('ruta', rutas);
  if (errT) throw new Error('sobre-mi: trozos: ' + errT.message);

  const legibles = new Set((conTexto ?? []).map((t) => String((t as { ruta: string }).ruta)));

  const porMarca = new Map<string, number>();
  for (const r of rutas) {
    if (!legibles.has(r)) continue;
    const carpeta = r.split('/')[1] ?? '';
    if (!esCarpetaDeMarca(carpeta)) continue;
    porMarca.set(carpeta, (porMarca.get(carpeta) ?? 0) + 1);
  }

  const marcas = Array.from(porMarca.entries())
    .map(([carpeta, fichas]) => ({ nombre: nombreDeMarca(carpeta), fichas }))
    .sort((a, b) => b.fichas - a.fichas || a.nombre.localeCompare(b.nombre, 'es'));

  return { fichas: rutas.filter((r) => legibles.has(r)).length, marcas };
}
