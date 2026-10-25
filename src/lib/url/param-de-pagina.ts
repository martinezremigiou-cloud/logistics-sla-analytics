// ============================================================
// Contrato de decodificación de `params` en rutas de PÁGINA
// (App Router, no rutas API).
//
// Diagnóstico medido (FIX-B1): para un SKU con '/' el enlace codifica
// UNA vez (`/catalogo/${encodeURIComponent(sku)}` → `01654365%2F3225`).
// Next 14.2.35 decodifica el segmento de ruta para armar `params` y
// LO VUELVE A CODIFICAR antes de pasarlo a la página — es el propio
// framework quien hace esto, no un bug de esta app:
//   node_modules/next/dist/server/app-render/app-render.js:117
//   `value = encodeURIComponent(value);`
// Consecuencia: una página que reciba `params.sku` y lo use tal cual
// (p.ej. para armar la URL de un fetch, que a su vez lo vuelve a
// codificar) codifica DOS veces sin que nadie haya decodificado
// ninguna. La ruta API, en cambio, decodifica exactamente UNA vez
// (`route-matcher.js:21`, `decodeURIComponent`) porque ahí sí llega
// crudo desde el motor de ruteo — las rutas API NUNCA deben volver a
// decodificar por su cuenta.
//
// El contrato que esto fija: toda PÁGINA que reciba un segmento
// dinámico de `params` y vaya a re-emitirlo (a un fetch, a un link,
// a cualquier lado que lo vuelva a codificar) lo pasa PRIMERO por
// este helper — exactamente una decodificación, ni cero ni dos.
//
// Si una actualización de Next dejara de re-codificar en `params`,
// esta función decodificaría de más y volvería a romper el mismo
// caso por el lado contrario; por eso existe una prueba-alarma que
// lee ese archivo de `node_modules` y exige la línea citada arriba.
// ============================================================
export function paramDePagina(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    // Un valor que no es URI-encoding válido (p.ej. un '%' suelto que
    // no forma parte de un escape) se deja tal cual: es mejor un SKU
    // "raro" que un 500 en la página.
    return v;
  }
}
