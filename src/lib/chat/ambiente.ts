// ============================================================
// [INV-B11] O6 · EL AMBIENTE — dónde está parado quien pregunta.
//
// Es el sexto renglón de O6, y el único que no cazó nadie: **«Contexto de
// navegación del lado del SERVIDOR. No entra al prompt.»**
//
// QUÉ ARREGLA. Alguien abre la ficha de `KYA2490`, tiene los números delante,
// y escribe *«¿cuánto hay?»*. Hoy el sistema contesta:
//
//     «Para eso necesito saber de qué SKU hablas.»
//
// Con la respuesta en la misma pantalla. Es la clase de pregunta que hace
// cualquiera —el objeto está en el contexto, no en la frase— y es exactamente
// lo que el brief llamó ambiente.
//
// ────────────────────────────────────────────────────────────
// LAS DOS MITADES DE LA REGLA, Y LA SEGUNDA ES LA QUE IMPORTA:
//
//     «del lado del SERVIDOR»   →  el cliente dice DÓNDE ESTÁ, no QUÉ SIGNIFICA
//     «no entra al prompt»      →  el modelo NUNCA ve el contexto
//
// **Por qué el modelo no lo ve, que es la mitad delicada.** Si el SKU de la
// pantalla viajara en el prompt, el modelo podría usarlo cuando le pareciera:
// meterlo en una pregunta que no iba sobre él, o contestar sobre él una
// pregunta general. Sería un dato más que puede alucinar, y encima uno con
// cara de verdad.
//
// Fuera del prompt, el reparto queda limpio y comprobable:
//
//     el MODELO decide QUÉ se preguntó        (y no sabe dónde está nadie)
//     el SERVIDOR decide SOBRE QUÉ, si falta  (con una regla, no con un juicio)
//
// ────────────────────────────────────────────────────────────
// Y LA TERCERA REGLA, QUE NO ESTABA EN EL BRIEF Y HACE FALTA:
//
// **Cuando el ambiente decide, la respuesta lo DICE.** Un número exacto sobre
// un SKU que el usuario no nombró, sin avisar, es la misma clase de daño que
// adivinar entre decenas de candidatos — solo que más convincente, porque acertó.
// ============================================================

/**
 * Lo que el cliente manda: **dónde está**, no qué significa.
 *
 * Se manda la RUTA y no un SKU ya resuelto a propósito. Si el cliente mandara
 * el SKU, el cliente estaría decidiendo — y el brief dice que decide el
 * servidor. Además, una ruta es verificable contra el catálogo; un SKU que
 * llega hecho hay que creérselo igual, pero sin saber de dónde salió.
 */
export interface Ambiente {
  /** `window.location.pathname` tal cual. */
  ruta: string;
}

/**
 * El SKU que la ruta implica, o `null`.
 *
 * **No consulta nada** y por eso vive en `lib` y no en un servicio: es una
 * regla sobre la forma de una ruta, comprobable sin base y sin navegador. Que
 * ese SKU EXISTA lo comprueba después quien lo use, con el catálogo.
 *
 * Solo `/catalogo/:sku`. El dashboard, El Cruce y Proyectos NO aportan un SKU
 * —no hay uno solo en pantalla— y adivinarlo desde una tabla de cientos de renglones
 * sería inventar. **Una lista no es un contexto.**
 */
export function skuDelAmbiente(ambiente: Ambiente | null | undefined): string | null {
  const ruta = ambiente?.ruta;
  if (!ruta || typeof ruta !== 'string') return null;

  // Se corta la query y el hash antes de mirar: `/catalogo/KYA2490?tab=x` es la
  // misma pantalla, y el SKU no incluye el `?`.
  const limpia = ruta.split('?')[0]!.split('#')[0]!;

  const m = /^\/catalogo\/([^/]+)\/?$/.exec(limpia);
  if (!m) return null;

  // La ruta viene codificada (`%2F`, acentos). Si el decodificado falla, la
  // ruta está rota y no hay contexto — no se intenta arreglar.
  let sku: string;
  try {
    sku = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }

  sku = sku.trim();
  return sku.length > 0 ? sku.toUpperCase() : null;
}

/**
 * ¿Esta decisión se puede completar con el ambiente?
 *
 * **Solo cuando el usuario no dio NINGUNA pista.** Si escribió un SKU, ése
 * manda; si dijo un nombre, ése manda. El ambiente rellena un hueco, nunca
 * corrige lo que alguien dijo — y esa es la línea que separa «ayudar» de
 * «cambiarle la pregunta a la gente».
 */
export function admiteAmbiente(decision: {
  tipo: string;
  sku?: string | null;
  termino?: string | null;
}): boolean {
  return decision.tipo === 'intencion' && !decision.sku && !decision.termino;
}

/**
 * La nota que acompaña a una respuesta resuelta por ambiente.
 *
 * Va SIEMPRE que el ambiente decida. Sin ella, alguien recibiría cifras
 * exactas de un SKU que no nombró y no tendría cómo saber de cuál son.
 */
export function notaDeAmbiente(sku: string): string {
  return `Te contesto sobre ${sku}, que es la ficha que tienes abierta.`;
}
