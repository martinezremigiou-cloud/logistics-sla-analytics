// ============================================================
// [INV-B11] O3 · lib/corpus/secretos.ts — la parada ante contenido con forma
// de secreto. PURO.
//
// POR QUÉ ESTO SUBE DE UN `.mjs` A UNA LIBRERÍA. Porque el indexador necesita
// exactamente estos detectores, y si se los copiara habría **dos definiciones
// de qué es un secreto**. Este repo ya sabe cómo termina eso: cuatro
// implementaciones de `piezas_en_camino`, ninguna compartida, nada que las
// compare. Un detector duplicado diverge y **el que diverge en silencio es el
// que deja pasar**.
//
// ────────────────────────────────────────────────────────────
// PARA, NO SALTA. Es la regla de O3 y es deliberada:
//
//     Un archivo saltado en silencio es INVISIBLE.
//     Una parada es una DECISIÓN.
//
// Si un archivo con forma de secreto se omitiera del índice, el sistema
// respondería «no tengo ficha de este producto» para siempre y **nadie sabría
// por qué**. Parar obliga a que un humano mire.
//
// ────────────────────────────────────────────────────────────
// LOS QUE NO PARAN SIGUEN AQUÍ, CON SU MEDICIÓN AL LADO.
//
// Borrarlos escondería por qué se descartaron, y el siguiente que pase los
// volvería a proponer como si fueran obvios. Medidos sobre los archivos
// reales del corpus:
//
//   · `la PALABRA sola`  → varios archivos, y uno era una FICHA DE PRODUCTO
//     (`Vitrina-Conectada.md`) que habla de tokens legítimamente. Pararía la sync
//     sobre documentación correcta, todos los días.
//   · `base64 >= 40`     → varios hits, y todos eran RUTAS (`brand1/...`, `NORTH/A...`).
//     El alfabeto base64 incluye `/`, así que casa con cualquier ruta larga.
//   · `hex >= 32`        → ninguno, **y sin control positivo**: el cebo no lo
//     ejercita, así que ese cero es una hipótesis, no una medición.
// ============================================================

export interface DetectorSecreto {
  nombre: string;
  re: RegExp;
  /** `true` = detiene la sincronización entera. */
  para: boolean;
  /** Qué se midió sobre el corpus real. Va en el código, no en un documento aparte. */
  medicion: string;
}

export const DETECTORES: readonly DetectorSecreto[] = Object.freeze([
  {
    nombre: 'sk- de OpenAI',
    re: /\bsk-[A-Za-z0-9_-]{20,}/,
    para: true,
    medicion: 'sin coincidencias en el corpus · cebo positivo OK',
  },
  {
    nombre: 'JWT (eyJ...)',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    para: true,
    medicion: 'sin coincidencias en el corpus · cebo positivo OK',
  },
  {
    nombre: 'AWS AKIA',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    para: true,
    medicion: 'sin coincidencias en el corpus · cebo positivo OK',
  },
  {
    nombre: 'GitHub ghp_',
    re: /\bghp_[A-Za-z0-9]{30,}/,
    para: true,
    medicion: 'sin coincidencias en el corpus · cebo positivo OK',
  },
  {
    nombre: 'clave = valor largo',
    re: /\b(api[_-]?key|secret|token|password|contrasena|contraseña)\b\s*[:=]\s*\S{16,}/i,
    para: true,
    medicion: 'sin coincidencias en el corpus · cebo positivo OK',
  },
  {
    nombre: 'la PALABRA sola',
    re: /\b(api[_-]?key|secret|token|password|contrasena|contraseña)\b/i,
    para: false,
    medicion: 'varios archivos, uno una FICHA que habla de tokens legitimamente. Pararia a diario.',
  },
  {
    nombre: 'base64 >= 40',
    re: /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
    para: false,
    medicion: 'varios hits, todos RUTAS. El alfabeto base64 incluye "/".',
  },
  {
    nombre: 'hex >= 32 (SIN control positivo)',
    re: /\b[0-9a-f]{32,}\b/i,
    para: false,
    medicion: 'sin hits sobre el corpus, pero el cebo no lo ejercita: hipotesis, no medicion.',
  },
]);

export interface HallazgoSecreto {
  ruta: string;
  detector: string;
  /** `true` si este hallazgo detiene la sincronización. */
  para: boolean;
}

/**
 * Revisa un LOTE completo, no un archivo.
 *
 * **La firma es la guarda.** Si esto recibiera un archivo a la vez, el llamador
 * escribiría el bucle natural —revisar uno, mandarlo, revisar el siguiente— y
 * ese bucle **manda los N−1 primeros antes de descubrir el secreto del
 * N-ésimo**. Recibiendo el lote entero, no hay forma de llamarlo tarde.
 *
 * Es el mismo razonamiento de orden que en B10: el techo se cobra ANTES de
 * llamar al modelo, no después, porque después ya se gastó.
 */
export function revisarLote(archivos: readonly { ruta: string; texto: string }[]): HallazgoSecreto[] {
  const hallazgos: HallazgoSecreto[] = [];
  for (const a of archivos) {
    for (const d of DETECTORES) {
      // `new RegExp` en cada prueba: los literales sin `g` no llevan estado,
      // pero copiarlo deja la función inmune a que alguien agregue una `g`
      // después y provoque el clásico salto de `lastIndex`.
      if (new RegExp(d.re.source, d.re.flags).test(a.texto)) {
        hallazgos.push({ ruta: a.ruta, detector: d.nombre, para: d.para });
      }
    }
  }
  return hallazgos;
}

/** ¿Alguno de los hallazgos detiene la sincronización? */
export function hayParada(hallazgos: readonly HallazgoSecreto[]): boolean {
  return hallazgos.some((h) => h.para);
}

/**
 * El motivo, en palabras, para el registro del intento.
 *
 * **Nombra el archivo y el detector, y NO el contenido.** Un motivo que citara
 * lo que casó metería el secreto en la base y en los logs — que es exactamente
 * de lo que este archivo intenta proteger. La regla #8 del proyecto aplica
 * también al mensaje de error.
 */
export function motivoParada(hallazgos: readonly HallazgoSecreto[]): string {
  const paran = hallazgos.filter((h) => h.para);
  if (paran.length === 0) return '';
  const lista = paran.map((h) => h.ruta + ' [' + h.detector + ']').join(' · ');
  return (
    'Contenido con forma de secreto en ' +
    paran.length +
    ' archivo(s). Se detiene ANTES de mandar nada. Revisar a mano: ' +
    lista
  );
}
