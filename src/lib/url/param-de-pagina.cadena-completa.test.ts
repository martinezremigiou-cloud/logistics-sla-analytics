// ============================================================
// [FIX-B1] La cadena COMPLETA, sobre 24 SKU con '/', espacio, ':' o
// paréntesis (en producción eran SKU reales; aquí son códigos inventados con
// la misma forma — la forma es lo que ejerce la cadena).
//
// Esto no es una prueba de `paramDePagina` en aislado (eso ya está en
// `param-de-pagina.test.ts`): recorre la cadena entera sobre los 24 SKU —
// nada de fabricar a mano el SKU final que se compara (P36). PERO de los
// seis pasos, sólo DOS ejecutan código de verdad; los otros cuatro son
// transcripciones o un modelo escritos en este archivo. Se dice paso por
// paso para que nadie lea aquí una cobertura que no hay.
//
// [C2 · CORRECCIÓN] Esta cabecera marcaba los pasos 1 y 5 como «reales» y
// prometía que la falta del fix o un doble-codificado en `FichaView` tumbaban
// alguno de los 24 casos. Las dos cosas eran falsas, medido: esos dos
// mutantes dejan ESTE archivo en verde y sólo los caza
// `src/app/(app)/catalogo/[sku]/page.test.tsx`. Y decía que la prueba-alarma
// vigila «esas dos líneas» de Next, cuando vigila SÓLO la que re-codifica.
// (La corrección anterior, [F3], ya había bajado el paso 3 de «real» a
// «modelo»; se quedó corta en los otros.)
//
//   1) href        = '/catalogo/' + encodeURIComponent(sku)
//                    TRANSCRIPCIÓN del patrón de los enlaces (p. ej.
//                    `catalogo-grid.tsx:39`, `catalogo-tabla.tsx:53`). No
//                    importa ni renderiza ningún componente.
//   2) segmento    = lo que sigue a '/catalogo/' en esa URL — un `slice`
//                    escrito aquí, no el motor de ruteo.
//   3) valorPagina = encodeURIComponent(decodeURIComponent(segmento))
//                    MODELO escrito a mano de lo que Next le entrega a la
//                    página: decodifica (`route-matcher.js:21`) y re-codifica
//                    (`app-render.js:117`, `value = encodeURIComponent(value);`).
//                    La re-codificación ocurre DENTRO del pipeline de
//                    renderizado, que no se puede importar y llamar aislado.
//   4) paramPagina = paramDePagina(valorPagina)         ← REAL: la función del fix.
//   5) urlFetch    = '/api/sku/' + encodeURIComponent(paramPagina)
//                    TRANSCRIPCIÓN de `ficha-view.tsx:34`. No renderiza
//                    `FichaView` ni la página, así que no sabe si la página
//                    llama a `paramDePagina` ni cuántas veces codifica la ficha.
//   6) apiParams   = getRouteMatcher(getRouteRegex('/api/sku/[sku]'))(urlFetch)
//                    ← REAL: el matcher de Next, importado de
//                    `next/dist/shared/lib/router/utils/{route-matcher,route-regex}`,
//                    el mismo módulo que resuelve `params.sku` en la ruta API.
//
// LO QUE ESTE ARCHIVO SÍ PRUEBA, para los 24 SKU:
//   · que `paramDePagina` deshace exactamente el modelo del paso 3
//     (`paramPagina === sku`);
//   · que el matcher REAL de la ruta API, sobre una URL codificada UNA vez,
//     devuelve el SKU intacto, y que `skuParamSchema` lo acepta.
//
// LO QUE NO PRUEBA, Y QUIÉN SÍ:
//   · Que `page.tsx` llame a `paramDePagina` y que `FichaView` codifique una
//     sola vez: `src/app/(app)/catalogo/[sku]/page.test.tsx`, que renderiza la
//     página real y lee la URL del fetch — sobre 2 SKU, no sobre los 24.
//   · Que los enlaces codifiquen una vez: SÓLO PARA ALGUNOS, no «la prueba
//     de cada componente» como decía esta línea. [C2 · ronda 2] Medido con
//     grep el 24-sep-2026 (`catalogo/\$\{` en `src/**/*.tsx` sin pruebas):
//     11 componentes, 15 sitios que arman `/catalogo/${encodeURIComponent(…)}`.
//     Tiene prueba que afirma el `href` con un SKU que lleva '/', espacio o
//     ':' —6 sitios—:
//       - `catalogo-grid.tsx:39`      → `catalogo-grid.test.tsx:45` ("B/2")
//       - `catalogo-tabla.tsx:53`     → `catalogo-tabla.test.tsx:68-69` ("A/B 001")
//       - `dashboard-top-sobre-reservados.tsx:154`
//                                     → `dashboard-top-sobre-reservados.test.tsx:90` ("A-1/B")
//       - `embarques-tabla.tsx:95`    → `embarques-tabla.test.tsx:46` ("A/B 001"),
//                                       y `embarques-view.test.tsx:349` ("A/B 1")
//       - `pendiente-fila.tsx:134` (marca_ambigua)
//                                     → `bandeja-view.test.tsx:420` ("01654365/3225")
//       - `pendiente-acciones.tsx:147` (marca_ambigua)
//                                     → `bandeja-view.test.tsx:639` ("01654365/3225")
//     NO la tiene —9 sitios—: o su prueba usa un SKU sin carácter reservado,
//     o ninguna prueba mira ese `href`:
//       - `pendiente-fila.tsx:87` (marca_west): sólo "HV3602" (`bandeja-view.test.tsx:399`)
//       - `pendiente-fila.tsx:193` (sku_sin_tecnologia): ninguna prueba mira el `href`
//       - `pendiente-acciones.tsx:122` (marca_west): sólo "HV3602" (`bandeja-view.test.tsx:603`)
//       - `pendiente-acciones.tsx:178` (sku_sin_tecnologia): ninguna prueba mira el `href`
//       - `derivados-descuadres.tsx:42`: sólo "A-1" (`bandeja-view.test.tsx:1033`)
//       - `panel-campana.tsx:181`: sólo "SUJ500-F" (`panel-campana.test.tsx:76`)
//       - `foco-sku.tsx:138`: sólo "B-2" (`foco-sku.test.tsx:148`)
//       - `cambios-tabla.tsx:51`: sólo "A-1" (`cambios-tabla.test.tsx:33`)
//       - `tarjeta-chat.tsx:143`: sólo `JEG894-K`…`DVT508-L`, y la esperada se
//         arma SIN `encodeURIComponent` (`evidencia-visual-chat.test.tsx:648`,
//         `toContain` sobre el HTML)
//     Los números de línea son de esa fecha; lo que no envejece es el grep.
//   · Que Next siga RE-codificando `params` de página (`app-render.js:117`):
//     la prueba-alarma de `param-de-pagina.test.ts`, que lee el fuente Y el
//     bundle de producción desde `node_modules`. Vigila SÓLO esa línea.
//   · Que Next siga DEcodificando (`route-matcher.js:21`): ninguna alarma lee
//     esa línea. La cubre de rebote el paso 6 de este archivo, que ejecuta esa
//     misma función: los 24 SKU llevan al menos un '/', espacio o ':', que
//     `encodeURIComponent` sí escapa, así que sin decodificar ninguno volvería
//     intacto. Lo que el paso 6 NO dice es que la PÁGINA pase por ese mismo
//     camino: eso sigue siendo parte del modelo del paso 3.
// ============================================================
import { describe, it, expect } from "vitest";
import { getRouteMatcher } from "next/dist/shared/lib/router/utils/route-matcher";
import { getRouteRegex } from "next/dist/shared/lib/router/utils/route-regex";
import { paramDePagina } from "./param-de-pagina";
import { skuParamSchema } from "@/schemas/sku.schema";

// Los 24 SKU con '/', espacio, ':' o paréntesis (códigos inventados con la
// forma de los de producción; lista literal del bloque FIX-B1).
const SKU_ESPECIALES = [
  "01654365/3225",
  "53284468/500",
  "GFTDL7362/K",
  "PLUGKIT-E/A",
  "NVHD4417T2 (GPS)",
  "TONE-SETS- NO ENG",
  "AV FPB196",
  "KD42/RM18-B2XX",
  "EV547/NLK-WZXX",
  "WN947-X-N/BPU51-H14",
  "YB1743/U",
  "JEW4107/U-WZ42-54-FWM",
  "WF1986 II TENSOR",
  "VT4159 CABLE RETAILER24",
  "DN-HN73 BOTTLE TAG 58KHZ",
  "MPQRT7/256G",
  "AYG3257GR (LZ1832)",
  "NQRB9ZT/MX",
  "PRISM-LABEL AM",
  "TRKLN8QW/500",
  "BOOT-UP NOTICES",
  "KRVNBRIDGE SUB",
  "PAULA: CAMBIA ZU7191-R MP0872-R",
  "QVLX-SP BLACK",
] as const;

const matcherApiSku = getRouteMatcher(getRouteRegex("/api/sku/[sku]"));

describe("[FIX-B1] cadena completa /catalogo/[sku] → /api/sku/[sku] con el matcher real de Next", () => {
  it.each(SKU_ESPECIALES)("SKU %s sobrevive el viaje completo y llega intacto a la API", (sku) => {
    // 1-2 · el patrón de los enlaces (transcrito, ver cabecera) y el tramo tras '/catalogo/'.
    const href = "/catalogo/" + encodeURIComponent(sku);
    const segmento = href.slice("/catalogo/".length);

    // 3 · el MODELO de lo que Next hace antes de entregar `params` a la página.
    const valorPagina = encodeURIComponent(decodeURIComponent(segmento));

    // 4 · el fix.
    const paramPagina = paramDePagina(valorPagina);
    expect(paramPagina).toBe(sku);

    // 5 · el patrón de la URL que arma `FichaView` (transcrito, no su código).
    const urlFetch = "/api/sku/" + encodeURIComponent(paramPagina);

    // 6 · el matcher real de la ruta API.
    const apiParams = matcherApiSku(urlFetch);
    expect(apiParams).not.toBe(false);
    const skuResuelto = (apiParams as Record<string, string>).sku;

    expect(skuResuelto).toBe(sku);
    expect(skuParamSchema.safeParse(skuResuelto).success).toBe(true);
  });
});
