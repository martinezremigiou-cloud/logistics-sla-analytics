// ============================================================
// [INV-B10] lib/chat/topes.ts — el techo, y el mensaje de quien lo topa.
//
// Vive fuera del route handler por dos razones. La técnica: Next solo deja
// exportar de una ruta sus verbos y su configuración, así que una constante
// exportada ahí rompe el build. La de fondo, que es la que importa: **el arnés
// que prueba el techo tiene que leer los mismos números que aplica la ruta.**
// Copiarlos en la prueba sería probar la copia.
//
// ────────────────────────────────────────────────────────────
// CALIBRADOS, NO ELEGIDOS:
//
//   🔴 ESTA LÍNEA DECÍA «~400 tokens de entrada MEDIDOS contra la API real», y
//   estaba ENVEJECIDA. Medido el 21-sep-2026 sobre las filas del camino largo
//   de `consumo_chat`: **casi el doble de lo declarado.**
//   O sea que el número era falso **antes** de este bloque, y con él se calculó
//   la «holgura» que INV-B10 declaró. Lo que vale de aquello no es la
//   cifra: es que el techo acota bucles y no raciona usuarios.
//
//   Y la lección, que vale más que la corrección: *una afirmación envejecida no
//   es una línea ausente — tiene la autoridad del archivo, y se lee y se cree.*
//   Se destapó porque alguien fue a medir en vez de citar.
//
//   · Con `gpt-5.6-luna` a $0.20/$1.20 por millón y los tokens de entrada
//     medidos, una pregunta de sólo clasificación cuesta ≈ $0.00018.
//     **El techo no raciona usuarios: acota bucles.**
//   · [CHAT-B1] Desde este bloque una pregunta DOCUMENTAL son DOS llamadas: la
//     que clasifica y la que redacta desde la ficha (hasta 12 000 B ≈ 3 000
//     tokens de entrada, y hasta 600 de salida a $1,20 el millón). El techo
//     NO SE SUBE aquí — sigue acotando bucles, no gasto— pero el gasto por
//     pregunta deja de ser comparable con el de antes, y por eso la `0040`
//     registra las dos llamadas **en columnas distintas**: sumadas, sería
//     incalculable cuál subió.
//   · Un KAM real pregunta pocas veces al día, así que el tope diario no le estorba nunca.
//   · Los usuarios previstos × lo que preguntan de verdad, contra el global
//     diario, dejan una holgura amplia.
//   · Un bucle choca con el de 30/hora en dos minutos.
//
// Son PARÁMETROS de la función de la base, no constantes horneadas dentro de
// ella: recalibrar es cambiar estas tres líneas, no una migración.
// ============================================================

export const TOPE_HORA = 30;
export const TOPE_DIA = 150;
export const TOPE_GLOBAL_DIA = 1200;

/** Lo que devuelve `chat_registrar_pregunta`. */
export interface Veredicto {
  permitido: boolean;
  /** Id de la fila creada. Es lo que permite completarla después sin insertar otra. */
  id?: string;
  motivo?: string;
  tope?: number;
}

/**
 * El mensaje que ve quien topó.
 *
 * **Dice CUÁL techo y cuándo se libera.** Un «límite alcanzado» a secas deja a
 * la persona sin saber si esperar una hora, un día, o avisarle a alguien — y
 * las tres cosas son respuestas distintas.
 */
export function mensajeDeTope(v: Veredicto): string {
  switch (v.motivo) {
    case 'tope_hora':
      return `Llegaste al máximo de ${v.tope} preguntas por hora. Vuelve a intentarlo más tarde.`;
    case 'tope_dia':
      return `Llegaste al máximo de ${v.tope} preguntas al día. Se libera mañana.`;
    // Éste no es culpa de quien lo lee, y por eso apunta a otra persona: el
    // usuario no puede hacer nada con su propio comportamiento.
    case 'tope_global':
      return 'El asistente alcanzó su tope de uso del día para todo el equipo. Avísale al administrador.';
    case 'sin_sesion':
      return 'Tu sesión no es válida.';
    default:
      return 'No se pudo registrar la pregunta.';
  }
}

/**
 * Tope de la pregunta, en caracteres.
 *
 * Vive aquí y no junto al cliente del modelo porque **la caja de texto de la
 * burbuja tiene que conocerlo**, y ese cliente es `server-only`: importarlo
 * desde un componente habría arrastrado la llave al navegador. El límite se
 * aplica en los dos lados —el `maxLength` del input es cortesía, el `z.string()
 * .max()` de la ruta es la regla— y sin un valor compartido serían dos números
 * que divergen.
 *
 * Sin esto, un pegado de 100 KB se convierte en tokens pagados.
 */
export const MAX_PREGUNTA = 500;
