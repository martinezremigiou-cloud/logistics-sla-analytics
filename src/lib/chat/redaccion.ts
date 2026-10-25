// ============================================================
// [CHAT-B1] lib/chat/redaccion.ts — el paso completo, en un solo sitio.
//
// Arma la entrega, llama al redactor, valida la forma, verifica el contenido y
// decide qué se enseña. Está aquí y no en `chat.service.ts` porque **no toca la
// base**: eso lo vuelve probable sin doblar Supabase, que es justo lo que hoy
// impide probar la rama documental a fondo (`chat.service.test.ts:193` usa
// `{} as SupabaseClient`).
//
// ────────────────────────────────────────────────────────────
// EL USO SUBE POR UN CANAL EXPLÍCITO, Y NO POR EL TIPO DE RETORNO.
//
// La factura tiene que llegar a `consumo_chat`, y si no subiera por un canal que
// la ruta LEE, los tokens del segundo escalón se irían sin contar **sin que
// ninguna prueba se pusiera roja** — `route.test.ts` dobla `responder()` entero
// y es ciego a lo que pase dentro.
//
// La forma obvia habría sido cambiar el tipo de retorno de `responder()`. Medido
// el 21-sep: son **decenas de llamadores**, y uno de ellos —el corredor de evaluación—
// es un `.mjs` que `tsc` NO ve y `vitest` NO corre, así que su rotura no
// existiría como rojo: reventaría en la primera pregunta de una corrida de
// evaluación, a mitad de otra cosa.
//
// Por eso el canal es un **registro que el llamador crea y lee**. Sigue siendo
// explícito —lo construye la ruta, lo pasa, lo lee— y `tsc` garantiza que es el
// mismo objeto. Lo que se gana: cero llamadores rotos y ninguna rotura invisible.
//
// ────────────────────────────────────────────────────────────
// EL TIEMPO ES UN PRESUPUESTO COMPARTIDO, NO DOS RELOJES SUELTOS.
//
// `route.ts` declara `maxDuration = 30`. El clasificador ya se lleva hasta 15 s
// (`TIEMPO_LIMITE_MS`), así que un segundo reloj fijo encima podría sumar más
// que el techo de la función: la plataforma cortaría a mitad y el usuario vería
// un fallo sin causa. Aquí la redacción recibe **lo que queda** del presupuesto,
// no una constante — y si no queda nada, ni se intenta.
// ============================================================
import type { Uso } from './modelo';
import type { Redactor, PeticionRedaccion } from './redactor';
import { interpretarSalida } from './redactor';
import type { Turno } from './hilo';
import { armarEntrega, seccionesOmitidas, type Entrega } from './entrega';
import { verificarRedaccion, seccionesQueSiTrae, type Veredicto } from './verificar-redaccion';

/**
 * En qué terminó el intento. **NUEVE estados y ninguno se colapsa**, por la
 * misma razón que `ResultadoFicha` tiene ocho: «no lo intenté», «no me dejaron»
 * y «lo intenté y mintió» mandan a mirar cosas opuestas.
 *
 * 🔴 Este comentario decía «Siete» y eran nueve — **P35 en el archivo que
 * inventó P35**, encontrado al releerlo dos horas después. Se deja anotado
 * porque el conteo es justo la clase de afirmación que nadie vuelve a
 * comprobar: se lee, suena razonable y se cree. La cifra de arriba ya no puede
 * volver a mentir sola — `redaccion-check.test.ts` la cotea contra el `CHECK`
 * de la `0040` en las dos direcciones.
 */
export const ESTADOS_REDACCION = [
  'sin_intento',
  'fuera_del_perimetro',
  'sin_texto',
  'sin_tiempo',
  'limpia',
  'sucia',
  'no_esta',
  'ilegible',
  'fallo',
] as const;

/**
 * El tipo se DERIVA del arreglo, no al revés.
 *
 * Y no es estilo: la `0040` guarda estos mismos nueve valores en un `CHECK` de
 * Postgres, o sea que **son dos copias del mismo hecho**. El propio `RAISE
 * NOTICE` de la migración lo declaró como una de las tres cosas que no podía
 * comprobar desde donde estaba — *«sólo una prueba de aplicación las cotea»*.
 *
 * Con un union de literales, esa prueba no se podría escribir: los tipos se
 * borran al compilar y no hay nada que recorrer en tiempo de ejecución. Con el
 * arreglo, `redaccion-check.test.ts` lee el `.sql` y los compara **en las dos
 * direcciones**. Añadir un estado aquí y olvidar la migración pasa a ser un
 * rojo, no un `INSERT` que revienta en producción.
 */
export type EstadoRedaccion = (typeof ESTADOS_REDACCION)[number];

/** Lo que el servicio escribe y la ruta lee para registrar. */
export interface RegistroDeRedaccion {
  estado: EstadoRedaccion;
  modelo: string | null;
  uso: Uso | null;
  /** Cuántos datos duros comprobó la guarda. Cero con un `limpia` es sospechoso. */
  datosComprobados: number;
  /** Para el reporte: por qué se descartó. Nunca va a pantalla. */
  motivos: string[];
}

export function registroVacio(): RegistroDeRedaccion {
  return { estado: 'sin_intento', modelo: null, uso: null, datosComprobados: 0, motivos: [] };
}

/**
 * Lo que se pinta. **No es del mismo tipo que escupe el modelo, y es a propósito.**
 *
 * Si `Tarjeta.respuesta` llevara la salida cruda, pintar prosa sin verificar
 * compilaría, y la regla «si el veredicto no es limpio no se enseña» quedaría
 * repartida entre tres archivos sin que ningún tipo la impusiera. El único
 * constructor es `respuestaDesde()`, que devuelve `null` salvo con un veredicto
 * limpio.
 */
export interface RespuestaRedactada {
  readonly frases: readonly string[];
  /** LA CITA. Sale de la entrega, no se arma aparte: una cita armada en otro sitio puede nombrar otro documento. */
  readonly ruta: string;
  /**
   * [CHAT-B2] El nombre LEGIBLE del documento, para la cita de una línea.
   *
   * Sale de la misma `Entrega` que la ruta, y por la misma razón: componerlo en
   * la pantalla a partir de la ruta sería una segunda forma de nombrar el mismo
   * documento. La ruta técnica completa no desaparece — se pliega al detalle.
   */
  readonly titulo: string | null;
  readonly fuentePdf: string | null;
  readonly camino: 'completo' | 'parcial';
  readonly seccionesLeidas: number;
  readonly seccionesTotales: number;
}

/** El ÚNICO constructor. Sin veredicto limpio no hay respuesta que pintar. */
export function respuestaDesde(entrega: Entrega, veredicto: Veredicto): RespuestaRedactada | null {
  if (veredicto.tipo !== 'limpia') return null;
  return {
    frases: veredicto.frases.map((f) => f.texto),
    ruta: entrega.ruta,
    titulo: entrega.titulo,
    fuentePdf: entrega.fuentePdf,
    camino: entrega.camino,
    seccionesLeidas: entrega.trozos.length,
    seccionesTotales: entrega.trozosTotales,
  };
}

/**
 * Lo que se enseña cuando el modelo dijo honestamente que no está.
 *
 * **Distingue los dos casos y NO los funde**, que es P17 en miniatura: «no está
 * en la ficha» y «no está en las secciones que consulté» son afirmaciones
 * distintas, y con un documento de 25 secciones del que vimos 6, la primera
 * sería mentira.
 */
export function mensajeNoEsta(entrega: Entrega): string {
  const secciones = seccionesQueSiTrae(entrega).slice(0, 8).join(' · ');
  if (entrega.camino === 'parcial') {
    return (
      `Eso no está en las ${entrega.trozos.length} secciones que consulté de esta ficha ` +
      `(tiene ${entrega.trozosTotales}, así que quedaron ${seccionesOmitidas(entrega)} sin revisar). ` +
      `Lo que sí revisé: ${secciones}.`
    );
  }
  return `Eso no está en la ficha. Lo que trae es: ${secciones}.`;
}

export interface PedidoRedaccion {
  readonly redactor: Redactor | null;
  readonly pregunta: string;
  readonly hilo: readonly Turno[];
  /** Instante (ms epoch) en el que ya no hay presupuesto. `null` = sin límite (arneses). */
  readonly limite: number | null;
  readonly registro: RegistroDeRedaccion;
}

/** Piso por debajo del cual ni se intenta: una llamada que nace muerta cuesta igual. */
export const MINIMO_PARA_INTENTAR_MS = 3_000;

export interface EntradaRedaccion {
  readonly ruta: string;
  readonly familia: string;
  readonly titulo: string | null;
  readonly fuentePdf: string | null;
  readonly trozos: readonly { orden: number; rutaSeccion: string; texto: string }[];
  readonly trozosTotales?: number;
}

export type ResultadoRedaccion =
  | { tipo: 'respuesta'; respuesta: RespuestaRedactada }
  | { tipo: 'no_esta'; mensaje: string; ruta: string }
  /** No hay prosa que enseñar. El llamador cae al verbatim, que sigue siendo verdad. */
  | { tipo: 'sin_prosa' };

/**
 * El paso completo. **Nunca lanza**: cualquier fallo se convierte en `sin_prosa`
 * y el llamador enseña el verbatim.
 *
 * Que no lance es la decisión que vuelve esto desplegable: la redacción es una
 * MEJORA sobre una respuesta que ya funcionaba, y una mejora que puede tumbar la
 * respuesta base no es una mejora. Hoy el usuario recibe la ficha entera; si
 * esto falla, la sigue recibiendo.
 */
export async function redactar(entrada: EntradaRedaccion, p: PedidoRedaccion): Promise<ResultadoRedaccion> {
  const { registro } = p;

  if (!p.redactor) {
    registro.estado = 'sin_intento';
    return { tipo: 'sin_prosa' };
  }

  const armada = armarEntrega(entrada);
  if (armada.tipo === 'fuera_del_perimetro') {
    // No es un fallo: es la lista blanca haciendo su trabajo, y se CUENTA.
    registro.estado = 'fuera_del_perimetro';
    return { tipo: 'sin_prosa' };
  }
  if (armada.tipo === 'sin_texto') {
    registro.estado = 'sin_texto';
    return { tipo: 'sin_prosa' };
  }
  const entrega = armada.entrega;

  if (p.limite !== null && p.limite - Date.now() < MINIMO_PARA_INTENTAR_MS) {
    registro.estado = 'sin_tiempo';
    return { tipo: 'sin_prosa' };
  }

  registro.modelo = p.redactor.nombre;

  let crudo: unknown;
  try {
    const peticion: PeticionRedaccion = { pregunta: p.pregunta, entrega, hilo: p.hilo };
    const r = await p.redactor.redactar(peticion);
    crudo = r.crudo;
    // El uso se anota AUNQUE la redacción acabe descartada: se pagó igual, y una
    // fila en ceros dejaría el modo de fallo más caro sin rastro en la factura.
    registro.uso = r.uso;
  } catch {
    registro.estado = 'fallo';
    return { tipo: 'sin_prosa' };
  }

  const salida = interpretarSalida(crudo);
  if (!salida) {
    registro.estado = 'ilegible';
    return { tipo: 'sin_prosa' };
  }

  const veredicto = verificarRedaccion(entrega, salida);
  registro.datosComprobados = veredicto.tipo === 'no_esta' ? 0 : veredicto.datosComprobados;

  if (veredicto.tipo === 'no_esta') {
    registro.estado = 'no_esta';
    return { tipo: 'no_esta', mensaje: mensajeNoEsta(entrega), ruta: entrega.ruta };
  }

  if (veredicto.tipo === 'sucia') {
    registro.estado = 'sucia';
    registro.motivos = veredicto.motivos.map((m) =>
      m.clase === 'dato_no_anclado'
        ? `dato_no_anclado:${m.dato}`
        : m.clase === 'andamiaje'
          ? `andamiaje:${m.marca}`
          : m.clase,
    );
    return { tipo: 'sin_prosa' };
  }

  const respuesta = respuestaDesde(entrega, veredicto);
  if (!respuesta) {
    // Irrepresentable: `limpia` siempre construye. Está por si el constructor cambia.
    registro.estado = 'sucia';
    return { tipo: 'sin_prosa' };
  }
  registro.estado = 'limpia';
  return { tipo: 'respuesta', respuesta };
}
