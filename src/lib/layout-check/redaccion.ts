// ============================================================
// [DASH-E · C-DASH·13] redaccion.ts — que un mensaje de error NO PUEDA publicar
// una URL. 100 % PURO.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ EXISTE, y la historia es de seguridad.
//
// La guía de ingeniería del proyecto documenta el incidente del 2026-09-02: un arnés de Playwright
// llenó el formulario de `/login` **antes de que la página hidratara**. Sin
// `onSubmit` montado, el navegador cayó al comportamiento por omisión del `<form>`
// y lo mandó **por GET** — usuario y contraseña en el query string. Nadie los
// imprimió: **el timeout de Playwright imprimió la URL**.
//
// Y el 15-sep se midió que **el propio `layout-check` llevaba dentro el mecanismo
// exacto del incidente que esa guía documenta** (esa guía lo citaba como ejemplo de
// la buena práctica, y era falso). Su `catch` hacía `String(e).slice(0, 160)` — y
// eso **acorta, no garantiza**: un `page.waitForURL: Timeout 30000ms exceeded.
// waiting for navigation to "http://…/login?email=…&password=…"` mete la URL muy
// por dentro de los primeros 160 caracteres.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ VIVE AQUÍ Y NO EN EL `.mjs`.
//
// Es el mismo motivo que sacó a `decidirPasarela` del arnés: **un `.mjs` es la
// única capa que ninguno de los tres instrumentos vigila.** Una redacción que no
// se puede poner en rojo no es una contramedida, es una intención. Aquí la ve
// `tsc`, la ejerce `vitest` y su control positivo son mensajes REALES de
// Playwright con credenciales dentro.
//
// ────────────────────────────────────────────────────────────
// EL LÍMITE, DICHO: esto redacta un TEXTO. No impide que el envío por GET ocurra
// — eso lo cierra esperar la hidratación, del lado del arnés—; impide que, si
// ocurre, el log lo publique. Son las dos mitades y hacen falta las dos.
// ============================================================

/** Lo que queda en su lugar. Se nombra para que el lector sepa que faltó algo. */
export const MARCA_OMITIDA = '«url omitida»';

/**
 * Deja un mensaje de error **sin ninguna URL ni query string**, y solo entonces
 * lo acota.
 *
 * Tres pasadas, y cada una cubre una vía distinta por la que una credencial
 * llega a un log:
 *
 * 1. **URL con esquema** (`http://…`, `https://…`) — la forma que imprimió el
 *    incidente. Se borra entera hasta el primer espacio o comilla.
 * 2. **URL sin esquema** (`127.0.0.1:3210/login?email=…`) — Playwright también
 *    las escribe así, y una regex que solo mirara `http` las dejaría pasar.
 * 3. **Query string suelto** (`?email=x&password=y`) — lo que queda si alguien
 *    corta la URL antes de llegar aquí. Es la vía que el `.slice(0, 160)` viejo
 *    producía en vez de cerrar.
 *
 * El recorte va **AL FINAL** a propósito: recortar primero puede partir una URL
 * por la mitad y dejar el `password=` dentro del trozo que sobrevive.
 */
export function sinUrls(texto: string, maxLargo = 300): string {
  const limpio = String(texto)
    // 1 · con esquema
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)\]]*/gi, MARCA_OMITIDA)
    // 2 · host:puerto/ruta sin esquema
    .replace(/\b(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?\/[^\s"'`)\]]*/gi, MARCA_OMITIDA)
    // 3 · query string suelto
    .replace(/\?[^\s"'`)\]]*=[^\s"'`)\]]*/g, MARCA_OMITIDA);
  return limpio.length > maxLargo ? `${limpio.slice(0, maxLargo)}…` : limpio;
}

/**
 * Los nombres de campo que NUNCA pueden aparecer en un log de este repo. Se
 * exportan para que la prueba los use como control positivo sobre mensajes
 * reales: si `sinUrls` dejara pasar cualquiera de estos, la prueba enrojece.
 *
 * No es la lista de «lo que se redacta» —`sinUrls` no mira nombres, mira
 * FORMAS— sino la de «lo que hay que comprobar que ya no está».
 */
export const CAMPOS_PROHIBIDOS_EN_LOG = ['password', 'email', 'contrasena', 'token', 'secret'] as const;
