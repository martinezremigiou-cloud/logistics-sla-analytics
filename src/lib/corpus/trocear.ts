// ============================================================
// [INV-B11] O3 · lib/corpus/trocear.ts — partir una ficha SIN romperla. PURO.
//
// LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO ES UNA SOLA:
//
//     **PROHIBIDO PARTIR UNA TABLA.**
//
// Y no es estética. Es el caso D2 del conjunto de evaluación: media tabla da
// **un número sin su condición**. Si el trozo se corta entre el renglón `Cwr96`
// y el encabezado que dice qué columna es «Nivel seguridad», el sistema puede
// recuperar «Alta» y atribuirlo al modelo equivocado — con la ficha correcta,
// la sección correcta, y la respuesta mal. Es el fallo más caro del dominio
// porque **no se ve**: sale bien formado.
//
// De ahí sale la única concesión del troceador, y va dicha en voz alta:
//
//     **Si una tabla sola excede el umbral, el trozo excede el umbral.**
//
// No se parte. Se marca `excede: true` y quien indexa decide. Un trozo grande
// es un problema de costo; media tabla es un problema de verdad.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ CADA TROZO LLEVA SU CABECERA. Un trozo viaja solo hasta el modelo, y
// «28 pulgadas» sin «Series2 > Tabla comparativa > Veb08» no significa nada. La
// procedencia no es metadato de auditoría: es **parte del texto que se recupera**,
// por el mismo motivo que una tarjeta del chat lleva su corte (regla #3).
//
// LO QUE ESTE ARCHIVO NO HACE: no elige la ficha —eso es la tabla del puente, y
// el invariante del bloque lo prohíbe explícitamente—, no embebe, y no habla
// con nadie. Recibe texto y devuelve trozos.
// ============================================================

/** El umbral del brief. Por encima de esto hay que trocear. */
export const UMBRAL_BYTES = 6 * 1024;

export interface Documento {
  /** Lo que el frontmatter declara. Vacío si el archivo no trae `---`. */
  meta: Record<string, string>;
  /** El cuerpo, ya sin frontmatter. */
  cuerpo: string;
}

export interface Trozo {
  orden: number;
  /** `Series2 > Características principales > Tabla comparativa de variantes`. */
  rutaSeccion: string;
  /** El texto que se embebe, **ya con su cabecera de procedencia**. */
  texto: string;
  bytes: number;
  tieneTabla: boolean;
  /**
   * `true` cuando el trozo pasa del umbral y **no se pudo partir más sin
   * romper una tabla**. No es un error: es la concesión, dicha.
   */
  excede: boolean;
}

/**
 * Separa el frontmatter YAML del cuerpo.
 *
 * **No es un parser de YAML y no pretende serlo:** saca pares `clave: valor` de
 * primer nivel, que es lo que el vault garantiza en su §4.2. Una lista o un
 * anidado se ignoran en vez de adivinarse — un lector tolerante que rellena lo
 * que no entiende es P12, y aquí el campo que importa (`fuente_pdf`) es una
 * cadena simple.
 */
export function leerDocumento(md: string): Documento {
  const texto = md.replace(/\r\n/g, '\n');
  if (!texto.startsWith('---\n')) return { meta: {}, cuerpo: texto.trim() };

  const cierre = texto.indexOf('\n---', 4);
  if (cierre === -1) return { meta: {}, cuerpo: texto.trim() };

  const bloque = texto.slice(4, cierre);
  const cuerpo = texto.slice(cierre + 4).trim();

  const meta: Record<string, string> = {};
  for (const linea of bloque.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(linea);
    if (!m) continue;
    const valor = m[2]!.trim().replace(/^["']|["']$/g, '');
    if (valor) meta[m[1]!] = valor;
  }
  return { meta, cuerpo };
}

/** Un renglón de tabla markdown: empieza por `|` una vez quitada la sangría. */
const esRenglonTabla = (l: string) => l.trimStart().startsWith('|');

/**
 * Parte el texto en BLOQUES ATÓMICOS.
 *
 * Un bloque es o bien una tabla entera, o bien un párrafo. **La tabla nunca se
 * subdivide**, y por eso este paso existe: sin él, cualquier corte por tamaño
 * podría caer dentro de una.
 */
function bloquesAtomicos(texto: string): { texto: string; tabla: boolean }[] {
  const lineas = texto.split('\n');
  const bloques: { texto: string; tabla: boolean }[] = [];
  let buffer: string[] = [];
  let enTabla = false;

  const volcar = () => {
    if (buffer.length === 0) return;
    const t = buffer.join('\n').trim();
    if (t) bloques.push({ texto: t, tabla: enTabla });
    buffer = [];
  };

  for (const l of lineas) {
    const esTabla = esRenglonTabla(l);
    if (esTabla !== enTabla) {
      // Cambia el régimen: cierra lo que venía y abre lo nuevo.
      volcar();
      enTabla = esTabla;
    }
    // Una línea en blanco fuera de tabla cierra el párrafo. Dentro de tabla no
    // debería haberla, y si la hay, la tabla ya terminó en la línea anterior.
    if (!enTabla && l.trim() === '') {
      volcar();
      continue;
    }
    buffer.push(l);
  }
  volcar();
  return bloques;
}

interface Seccion {
  ruta: string[];
  texto: string;
}

/** Corta por encabezados `##` y `###`, conservando la ruta jerárquica. */
function seccionar(cuerpo: string, titulo: string): Seccion[] {
  const lineas = cuerpo.split('\n');
  const secciones: Seccion[] = [];
  let ruta: string[] = [titulo];
  let buffer: string[] = [];

  const volcar = () => {
    const t = buffer.join('\n').trim();
    if (t) secciones.push({ ruta: [...ruta], texto: t });
    buffer = [];
  };

  for (const l of lineas) {
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      const nivel = h[1]!.length;
      const nombre = h[2]!.trim();
      if (nivel === 1) {
        // El `# Título` ya está en la ruta por el frontmatter; su contenido
        // (el blockquote de resumen) es la sección raíz.
        volcar();
        ruta = [nombre];
        continue;
      }
      volcar();
      ruta = nivel === 2 ? [ruta[0]!, nombre] : [ruta[0]!, ruta[1] ?? '', nombre].filter(Boolean);
      continue;
    }
    buffer.push(l);
  }
  volcar();
  return secciones;
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

export interface OpcionesTroceo {
  umbral?: number;
}

/**
 * Trocea un documento ya leído.
 *
 * El documento entero cabe en un trozo cuando no excede el umbral — **trocear
 * de más también hace daño**: separa una respuesta de su condición igual que
 * partir una tabla, solo que a otra escala.
 */
export function trocear(doc: Documento, opciones: OpcionesTroceo = {}): Trozo[] {
  const umbral = opciones.umbral ?? UMBRAL_BYTES;
  const titulo = doc.meta.name ?? '(sin título)';

  const cabecera = (ruta: string[]) => {
    const linea = ruta.filter(Boolean).join(' > ');
    const desc = doc.meta.description ? '\n' + doc.meta.description : '';
    return linea + desc + '\n\n';
  };

  const trozos: Trozo[] = [];

  const empujar = (ruta: string[], texto: string, tabla: boolean) => {
    const completo = cabecera(ruta) + texto;
    trozos.push({
      orden: trozos.length,
      rutaSeccion: ruta.filter(Boolean).join(' > '),
      texto: completo,
      bytes: bytes(completo),
      tieneTabla: tabla,
      excede: bytes(completo) > umbral,
    });
  };

  // ----------------------------------------------------------
  // EL DOCUMENTO QUE CABE NO SE TOCA — y es lo que dice el brief: «troceo por
  // `##` para los que exceden 6 KB». Los demás son UN trozo.
  //
  // No es ahorro: **trocear de más separa un dato de su condición igual que
  // partir una tabla**, solo que a otra escala. Si «¿qué es?» y «casos de uso»
  // viajan por separado, una consulta puede recuperar el uso sin el producto.
  // ----------------------------------------------------------
  const enteroConCabecera = cabecera([titulo]) + doc.cuerpo;
  if (bytes(enteroConCabecera) <= umbral) {
    empujar([titulo], doc.cuerpo, doc.cuerpo.split('\n').some(esRenglonTabla));
    return trozos;
  }

  const secciones = seccionar(doc.cuerpo, titulo);
  for (const s of secciones) {
    const tabla = s.texto.split('\n').some(esRenglonTabla);
    if (bytes(cabecera(s.ruta) + s.texto) <= umbral) {
      empujar(s.ruta, s.texto, tabla);
      continue;
    }

    // La sección no cabe. Se junta por BLOQUES ATÓMICOS hasta llenar el
    // umbral, y una tabla entra entera o abre trozo nuevo — nunca se parte.
    let acumulado: string[] = [];
    let hayTabla = false;
    const cerrar = () => {
      if (acumulado.length === 0) return;
      empujar(s.ruta, acumulado.join('\n\n'), hayTabla);
      acumulado = [];
      hayTabla = false;
    };

    for (const b of bloquesAtomicos(s.texto)) {
      const tentativa = [...acumulado, b.texto].join('\n\n');
      if (acumulado.length > 0 && bytes(cabecera(s.ruta) + tentativa) > umbral) cerrar();
      acumulado.push(b.texto);
      hayTabla = hayTabla || b.tabla;
    }
    cerrar();
  }

  return trozos;
}

/**
 * ¿El documento se debe embebir?
 *
 * Las TRES reglas acordadas, cada una comprobable por separado. Y la
 * primera mira **dentro del frontmatter**: el conteo de MOC del brief no reproducía
 * porque su `grep` miraba el archivo entero, así que cualquier nota que
 * MENCIONARA el tag contaba.
 */
export function seEmbebe(rutaRelativa: string, doc: Documento): boolean {
  const archivo = rutaRelativa.split('/').pop() ?? '';
  if (doc.meta.type === 'meta') return false;
  if (archivo === '_README.md') return false;
  if (archivo.startsWith('PT-')) return false;
  return true;
}
