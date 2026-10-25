// ============================================================
// [CHAT-B1] lib/chat/verificar-redaccion.ts — la contención.
//
// El invariante del bloque es **«el modelo no sabe nada que no le hayan
// entregado»**. `entrega.ts` cierra la mitad de ENTRADA: qué puede recibir. Este
// archivo cierra la de SALIDA: qué se le deja decir.
//
// ────────────────────────────────────────────────────────────
// EL DATO SE COMPRUEBA CONTRA **SU ANCLA**, NO CONTRA TODO LO ENTREGADO.
//
// Ésta es la decisión central del archivo, y llegó por una refutación. La
// versión obvia —«que el número aparezca en algún sitio de lo que le di»— deja
// pasar el error más probable de todos: **una frase con el número correcto
// sacado de otra sección**. «Pesa 3,2 kg» es verdad de la sección de montaje y
// falso del producto del que se preguntó, y contra el documento entero sale
// limpia.
//
// Por eso el modelo no devuelve prosa: devuelve **frases con su cita**. Cada
// frase copia TAL CUAL el fragmento del que salió, y cada dato duro de esa frase
// tiene que estar **dentro de esa cita**. Un modelo que cite dos palabras para
// escaparse no se escapa: dos palabras no contienen ningún número.
//
// ────────────────────────────────────────────────────────────
// LA NORMALIZACIÓN ES es-MX, Y EL REPO YA LO DECÍA.
//
// `src/lib/formato.ts` usa `Intl.NumberFormat('es-MX')`, que imprime **2,376**
// para mil quinientos nueve: la COMA es el separador de millar y el PUNTO es el
// decimal. La regla contraria —la de España— tendría dos consecuencias y las dos
// son malas:
//
//   · «2.376» (dos coma tres siete seis) quedaría declarado igual que «2376»,
//     y una invención de ×1000 pasaría limpia.
//   · un trozo que diga «2,376» contra un modelo que escriba «2376» saldría
//     FUGA sin que nadie haya inventado nada.
//
// ────────────────────────────────────────────────────────────
// EL UNIVERSO DE LA COMPARACIÓN, DICHO ENTERO.
//
// «Lo entregado» no son sólo los trozos: el prompt también lleva el nombre de la
// familia, el título y la ruta, y el modelo TIENE que poder nombrarlos («la
// ficha del SERIES11 PW03»). `PW03` es un token con dígito, o sea un dato duro por
// la definición de abajo. Si el universo fueran sólo los trozos, la respuesta
// correcta saldría sucia.
//
// Así que el universo es: **la cita de esa frase, más la metadata que el propio
// prompt le enseñó**. Se declara aquí porque un universo implícito es un
// universo que cada lector supone distinto.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTA GUARDA **NO** CUBRE, y hay que decirlo donde se lee:
//
// **La paráfrasis.** Una afirmación sin números, anclada a un tramo que existe
// pero que dice otra cosa, PASA. `evaluacion-rag.ts:175-176` ya dejó escrito el
// mismo límite un nivel más arriba. No se inventa un umbral semántico para
// taparlo: un umbral sin calibrar es una perilla con aire de rigor (P20).
//
// La contramedida es **el verbatim al lado**, siempre en el DOM, y es del
// lector: si alguien lo retira «porque duplica», esta garantía desaparece sin
// que ninguna prueba se ponga roja.
// ============================================================
import type { Entrega } from './entrega';

/**
 * Una frase de la respuesta, con el sitio exacto de donde salió.
 *
 * ────────────────────────────────────────────────────────────
 * 🔴 EL ANCLA ES UNA **CITA COPIADA**, NO UN RANGO DE ÍNDICES. Cambiado el
 * 21-sep-2026 **midiendo**, no suponiendo, y la medición fue contundente.
 *
 * La primera versión pedía `{orden, desde, hasta}`. Contra `deepseek-flash` —el
 * modelo elegido— eso resultó **imposible**: calcular desplazamientos
 * de carácter sobre una ficha de 6 KB es una tarea de razonamiento sin fondo, y
 * el modelo quemó el presupuesto entero sin emitir nada.
 *
 *     max_tokens=600   → 600 tokens de razonamiento, content = 0 B
 *     max_tokens=2000  → 2000 de razonamiento, content = 0 B
 *     max_tokens=4000  → 4000 de razonamiento, content = 0 B
 *
 * Con la cita literal, el mismo modelo y la misma ficha: **5 de 5**, con las
 * citas exactas, entre 25 y 726 tokens de razonamiento y respuesta en menos de
 * un segundo.
 *
 * Y lo importante: **la cita no es un anclaje más débil, es MÁS fuerte.** Un
 * rango de índices se puede desplazar por un espacio de más y seguir
 * «resolviendo»; una subcadena o está literalmente en el texto o no está. El
 * off-by-one deja de ser expresable.
 */
export interface FraseAnclada {
  readonly texto: string;
  /**
   * De qué sección dice el modelo que salió. **Es una PISTA, no el ancla.**
   *
   * Medido el 21-sep contra la API real: `deepseek-flash` devolvió `orden: 1`
   * sobre una sección rotulada `[0]`. Si el `orden` tuviera que casar, esa
   * respuesta —con su cita EXACTA y su dato correcto— se habría rechazado. El
   * número de sección es contabilidad del modelo; **la evidencia es la cita**,
   * y exigir las dos cosas sólo añade falsos rechazos sin añadir garantía.
   */
  readonly orden?: number;
  /** Un fragmento COPIADO TAL CUAL de ALGUNO de los trozos entregados. Es el ancla. */
  readonly cita: string;
}

/**
 * Lo que el modelo puede devolver, y **nada más**.
 *
 * `no_esta` no lleva ningún texto del modelo a propósito. La versión que le
 * dejaba escribir «lo que sí trae la ficha» era un hueco: ese texto no tiene
 * frases, así que no pasaba por ninguna comprobación y se pintaba tal cual. Lo
 * que sí trae la ficha **lo sabe el servidor** —son los `rutaSeccion` de los
 * trozos que entregó— y lo pone él.
 */
export type SalidaRedactor =
  | { readonly tipo: 'respuesta'; readonly frases: readonly FraseAnclada[] }
  | { readonly tipo: 'no_esta' };

export type MotivoSucio =
  | { readonly clase: 'sin_frases' }
  | { readonly clase: 'cita_inventada'; readonly frase: number; readonly detalle: string }
  | { readonly clase: 'dato_no_anclado'; readonly frase: number; readonly dato: string }
  | { readonly clase: 'andamiaje'; readonly frase: number; readonly marca: string };

export type Veredicto =
  | { readonly tipo: 'limpia'; readonly frases: readonly FraseAnclada[]; readonly datosComprobados: number }
  | { readonly tipo: 'sucia'; readonly motivos: readonly MotivoSucio[]; readonly datosComprobados: number }
  /** El modelo dijo que no está. Es una respuesta correcta y frecuente, no un fallo. */
  | { readonly tipo: 'no_esta' };

/**
 * Un DATO DURO: lo que no se puede parafrasear sin mentir.
 *
 * Dos formas, y las dos importan:
 *   · números, con o sin separadores y decimales — «3.2», «2,376», «55»
 *   · tokens alfanuméricos **con al menos un dígito** — «PW03», «SUJ500-F»,
 *     «0861-5844-9317». Un SKU alucinado se ve exactamente como uno real.
 *
 * Las palabras sin dígitos NO son datos duros y no se comprueban: ahí es donde
 * vive el límite declarado en la cabecera.
 */
const TOKEN_DURO = /[A-Za-zÀ-ÿ0-9]+(?:[.,\-/][A-Za-zÀ-ÿ0-9]+)*/g;

/**
 * Normaliza un dato para comparar, en es-MX.
 *
 * Quita el separador de millar (coma entre grupos de dígitos) y conserva el
 * punto decimal. Mayúsculas fuera, para que `pw03` y `PW03` sean el mismo dato.
 */
export function normalizarDato(s: string): string {
  return s
    .replace(/(\d),(?=\d{3}\b)/g, '$1') // 2,376 -> 2376 · NO toca 2.376
    .toUpperCase();
}

/** `true` si el token contiene al menos un dígito. Lo demás es prosa. */
function esDuro(token: string): boolean {
  return /\d/.test(token);
}

/** Los datos duros de un texto, ya normalizados y sin repetir. */
export function datosDurosDe(texto: string): string[] {
  const vistos = new Set<string>();
  for (const m of texto.match(TOKEN_DURO) ?? []) {
    if (!esDuro(m)) continue;
    vistos.add(normalizarDato(m));
  }
  // `Array.from` y no un spread: el `target` del proyecto es anterior a es2015
  // para el spread de `Set`, y `tsc` lo rechaza (TS2802).
  return Array.from(vistos);
}

/**
 * [CHAT-B2] EL ANDAMIAJE DEL VAULT · SOUL §5, hecho estructura y no promesa.
 *
 * **Medido: una parte de los trozos del corpus lleva andamiaje dentro, y buena
 * parte de ellos vive DENTRO de fichas de producto.** Así que no se resuelve excluyendo
 * documentos —el perímetro ya hizo lo suyo— sino callando lo que se REDACTA.
 *
 * Y va en la GUARDA, no sólo en el prompt. Una regla del prompt es una promesa
 * sin nadie detrás: el modelo la cumple casi siempre y el día que no, nadie se
 * entera. Aquí una frase con andamiaje **ensucia la redacción** y se cae al
 * verbatim, que sigue siendo verdad.
 *
 * ⚠️ APLICA A LA PROSA, NO AL VERBATIM. El texto del documento sale tal cual —
 * ésa es la garantía de contención, y recortarlo la rompería. Lo que se acota es
 * lo que el Asistente *dice*, que es lo que el KAM lee primero.
 */
const ANDAMIAJE: readonly RegExp[] = Object.freeze([
  // `\b` delante NO es adorno: sin él, `v\d+\.\d+` muerde un modelo como
  // «SV1.5» y tumbaría una respuesta correcta. Un bloqueo demasiado ancho no es
  // «más seguro»: convierte la guarda en ruido y alguien acaba aflojándola.
  /\bv\d+\.\d+\b/i,                      // v0.1 · v1.2 — versiones del vault
  /\bADR-\d/i,                           // ADR-001, decisiones de arquitectura
  /\blast_updated\b/i,
  /\bbumpear\b/i,
  /historial de versiones/i,
  /c[oó]mo contribuir/i,
  /\bfrontmatter\b/i,
  /\bstatus:\s*active\b/i,
  /\bver\s+_README\b/i,
  /\b\d{2}_[A-Za-zÁÉÍÓÚÑáéíóúñ-]+\//,    // rutas del vault: 50_Referencia/…
]);

/**
 * La metadata que el prompt le enseñó al modelo. Parte del universo legítimo.
 *
 * Es CHICA y CONOCIDA —tres campos—, y por eso se puede declarar entera en vez
 * de dejarla como excepción difusa.
 */
function metadataEntregada(e: Entrega): string {
  return [e.familia, e.titulo ?? '', e.ruta].join(' ');
}

/**
 * ¿La redacción se puede enseñar?
 *
 * Estricto a propósito: **una sola frase sucia ensucia la respuesta entera**. La
 * alternativa —enseñar las limpias y callar las otras— deja al usuario una
 * respuesta con un hueco que no puede ver, y el hueco es justo donde estaba el
 * error. Cuando sale sucia se cae al verbatim, que sigue siendo verdad.
 */
export function verificarRedaccion(entrega: Entrega, salida: SalidaRedactor): Veredicto {
  if (salida.tipo === 'no_esta') return { tipo: 'no_esta' };

  const motivos: MotivoSucio[] = [];
  let datosComprobados = 0;

  if (salida.frases.length === 0) {
    return { tipo: 'sucia', motivos: [{ clase: 'sin_frases' }], datosComprobados: 0 };
  }

  const trozos = entrega.trozos.map((t) => t.texto);
  const meta = normalizarDato(metadataEntregada(entrega));

  salida.frases.forEach((f, i) => {
    // (a) LA CITA TIENE QUE ESTAR **LITERALMENTE** EN ALGO QUE VIAJÓ.
    //     Se busca en TODOS los trozos entregados y no sólo en el que el modelo
    //     dice: el `orden` es una pista suya y puede equivocarse —medido—, pero
    //     una subcadena o está en lo entregado o no está. Eso no se puede fingir,
    //     y es lo único que hace falta: la evidencia es la cita.
    const cita = typeof f.cita === 'string' ? f.cita.trim() : '';
    const fuente = cita.length === 0 ? undefined : trozos.find((t) => t.includes(cita));

    if (fuente === undefined) {
      motivos.push({
        clase: 'cita_inventada',
        frase: i,
        detalle: cita.length === 0 ? 'cita vacía' : 'la cita no está literalmente en nada de lo entregado',
      });
      return;
    }

    // (a-bis) NADA DE ANDAMIAJE DEL VAULT EN LA PROSA (SOUL §5).
    //     Va ANTES de los datos porque es más barato y porque un changelog
    //     citado correctamente pasaría la comprobación de datos sin problema:
    //     la cita sería válida y la frase seguiría siendo ruido.
    const conAndamiaje = ANDAMIAJE.find((re) => re.test(f.texto));
    if (conAndamiaje) {
      motivos.push({ clase: 'andamiaje', frase: i, marca: conAndamiaje.source });
      return;
    }

    // (b) CADA DATO DURO DE LA FRASE, DENTRO DE SU PROPIA CITA.
    //     Aquí es donde muere «el número correcto de la sección equivocada»: la
    //     cifra tiene que estar en el fragmento que la frase dice haber leído,
    //     no en cualquier punto del documento.
    const tramo = normalizarDato(cita);
    for (const dato of datosDurosDe(f.texto)) {
      if (tramo.includes(dato) || meta.includes(dato)) {
        datosComprobados++;
        continue;
      }
      motivos.push({ clase: 'dato_no_anclado', frase: i, dato });
    }
  });

  if (motivos.length > 0) return { tipo: 'sucia', motivos, datosComprobados };
  return { tipo: 'limpia', frases: salida.frases, datosComprobados };
}

/**
 * Lo que la respuesta enseña cuando el modelo dijo que no está.
 *
 * **Lo escribe el servidor**, desde los `rutaSeccion` de lo que entregó. Que lo
 * escribiera el modelo era el hueco que cerró la refutación: sin frases no hay
 * anclas, sin anclas no hay comprobación, y ese texto salía a pantalla sin pasar
 * por ninguna guarda.
 */
export function seccionesQueSiTrae(entrega: Entrega): string[] {
  return entrega.trozos.map((t) => t.rutaSeccion);
}
