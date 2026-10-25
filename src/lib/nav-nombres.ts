// ============================================================
// [2.0.1-B · R] nav-nombres.ts — CÓMO SE LLAMA CADA PANTALLA, en un solo sitio.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ EXISTE, y no es «una constante más».
//
// El carril R renombró dos pantallas, y el renombre fue un INTERCAMBIO:
//
//     /cruce      «El Cruce»  →  «Embarques»              (ahora en /embarques)
//     /embarques  «Embarques» →  «Histórico de embarques»  (ahora en /embarques/historico)
//
// Eso rompe la forma obvia de vigilarlo. Un barrido que busque la cadena vieja
// «Embarques» y exija que no quede ninguna **se dispara sobre la etiqueta NUEVA
// de `/cruce`**: la misma cadena es, a la vez, lo que hay que quitar de un sitio
// y lo que hay que poner en otro. Una lista negra de cadenas no puede distinguir
// las dos, y su rojo no significaría nada.
//
// Por eso el gate de R-2 **no pregunta «¿queda esta cadena?» sino «¿qué dice
// ESTA superficie?»**: cada renglón de aquí abajo ata una RUTA a los nombres que
// tiene que llevar, y `nav-nombres.test.ts` los va a buscar al árbol. Un
// renombre a medias no deja una cadena huérfana suelta: deja una SUPERFICIE
// diciendo lo que no debe, con su archivo y su línea.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTE ARCHIVO **NO** GOBIERNA, y hay que decirlo porque un barrido
// ingenuo lo destrozaría:
//
//   · **«En Aduana» es un DATO, no una etiqueta.** Es un valor de
//     `estatus_catalogo` que viaja desde la base (`cruce-view.test.tsx:59`,
//     `pipeline-aduana.test.tsx:13`). Renombrarlo no es un cambio de copy: es
//     inventar un estatus que la base no tiene.
//   · **«Histórico» ya estaba en uso dentro del pipeline** con otro significado:
//     `foco-sku.tsx:127` pinta «Histórico recibido» (piezas ya recibidas de un
//     SKU). Desde el renombre conviven DOS «histórico» distintos: una métrica de
//     piezas dentro de `/embarques`, y la pantalla `/embarques/historico`. No es
//     un defecto —los dos son correctos en su contexto— pero está dicho aquí
//     para que nadie los confunda al tocar cualquiera de los dos.
//
// ────────────────────────────────────────────────────────────
// CÓMO SE USA EN R-1: se cambian los valores de aquí **y** el código, en el
// mismo commit. Si se cambia uno solo, el gate lo dice con archivo y línea. Ese
// es todo el mecanismo: la tabla no genera el JSX (hoy cada pantalla escribe su
// título), lo CONTRASTA.
// ============================================================

/** Los CUATRO sitios donde una pantalla dice cómo se llama. */
export interface NombresDeRuta {
  /** La etiqueta del menú lateral (`nav.ts`). Ausente = la ruta no está en el nav. */
  nav?: string;
  /** El cintillo en versalitas sobre el título (`<span class="…text-brand">`). Ausente = no lleva. */
  cintillo?: string;
  /** El `<h1>` de la página. Ausente = el `page.tsx` no pinta uno (lo hace un hijo). */
  h1?: string;
  /**
   * La etiqueta CORTA de la barra inferior (`BOTTOM_SLOTS` en
   * `components/layout/bottom-nav.tsx`). Ausente = la ruta no está en la barra
   * móvil. **No tiene por qué coincidir con `nav`**: son cortas a propósito, por
   * el espacio, y exigir igualdad sería inventarse un requisito.
   *
   * LA QUINTA SUPERFICIE, y apareció al mapear R-1: la barra inferior tiene su
   * PROPIA lista de etiquetas y el gate solo miraba la de `NAV_ITEMS`. Peor que
   * un hueco de cobertura — `BOTTOM_SLOTS` busca su `href` en `NAV_ITEMS` y hace
   * `return null` si no lo encuentra, así que un renombre de ruta que no toque
   * esa lista **no rompe nada: hace desaparecer el ítem del nav móvil, en
   * silencio**. El gate lo caza en pruebas; en pantalla sigue tragando. Ver la
   * deuda NAV-MOVIL-TRAGA-EN-SILENCIO.
   */
  movil?: string;
}

/**
 * NOMBRES QUE YA NO PUEDE LLEVAR NINGUNA SUPERFICIE, y esto cierra un agujero
 * concreto del gate: las aserciones de abajo comparan lo declarado contra el
 * árbol, así que impiden la DERIVA —que el código y la tabla se separen— pero
 * no impiden **declarar aquí un nombre retirado**. Alguien que actualice los
 * `href` de la barra móvil y conserve el `label` viejo puede dejar la barra
 * diciendo «Cruce» hacia `/embarques` con el gate en verde, si además actualiza
 * la tabla para que cuadre.
 *
 * Esta lista es lo que lo vuelve imposible: sea cual sea la ruta, ninguna
 * superficie declarada puede valer una de estas cadenas.
 *
 * Alcance, dicho: aplica a las CUATRO superficies de `NOMBRES`, no al resto del
 * árbol. **«Cruce» sigue vivo por dentro** —servicio, API, componentes, tipos—
 * y eso es deliberado: lo retirado es el nombre de
 * cara al usuario, no el vocabulario interno.
 */
export const NOMBRES_RETIRADOS = ['El Cruce', 'Cruce'] as const;

/**
 * La verdad de HOY, medida contra el árbol el 2026-08-30. **Cada renglón se
 * comprueba**: sobra uno que no exista y falta uno que exista.
 *
 * Rutas sin entrada = rutas cuyo `page.tsx` no pinta ni cintillo ni `<h1>` y que
 * no están en el nav. El gate exige que ese conjunto también cuadre, para que
 * una pantalla nueva no entre sin que nadie decida cómo se llama.
 */
export const NOMBRES: Record<string, NombresDeRuta> = {
  '/': { nav: 'Dashboard', movil: 'Inicio' },
  '/catalogo': { nav: 'Catálogo', cintillo: 'Catálogo', h1: 'Catálogo', movil: 'Catálogo' },
  // El PIPELINE. Era `/cruce`; «Cruce» sigue siendo su nombre INTERNO.
  '/embarques': { nav: 'Embarques', cintillo: 'Embarques', h1: 'Embarques', movil: 'Embarques' },
  '/proyectos': { nav: 'Proyectos' },
  // El HISTÓRICO (Libro Mayor). Era `/embarques`. El cintillo «Aduana» no es un
  // nombre retirado: nombra el dominio, no la pantalla, y las dos son de aduana.
  '/embarques/historico': {
    nav: 'Histórico de embarques',
    cintillo: 'Aduana',
    h1: 'Histórico de embarques',
    movil: 'Histórico',
  },
  '/snapshots': { nav: 'Snapshots', cintillo: 'Datos', h1: 'Snapshots' },
  '/carga': { nav: 'Carga de imágenes', h1: 'Carga de imágenes' },
  '/config': { nav: 'Configuración', h1: 'Configuración' },
  // Fuera del nav a propósito: la página de control del `layout-check` es 404
  // sin `LAYOUT_CHECK=1` y no se enlaza desde ningún sitio (decisión D1 de 2.0.1-A).
  '/control-layout': { h1: 'Control de layout' },
  // Mismo criterio: instrumento, no producto. Gateada por LAYOUT_CHECK=1 y sin
  // enlace en ningun nav — su gate SI esta probado (gate.test.tsx).
  '/control-estados': { cintillo: 'Instrumento', h1: 'Control de estados' },
};

/**
 * La CUARTA superficie, y la que más se olvida: lo que anuncia un lector de
 * pantalla mientras la pantalla carga. Se llavea por archivo porque un
 * esqueleto puede servir a más de una ruta y no siempre hay correspondencia 1:1.
 *
 * Medido, no enumerado a ojo: son todos los `aria-label="Cargando …"` del árbol.
 * `cruce-skeleton.tsx` y `embarques-skeleton.tsx` los toco el renombre: las dos pantallas decian «embarques».
 */
export const CARGANDO: Record<string, string[]> = {
  'src/components/catalogo/catalogo-skeleton.tsx': ['Cargando catálogo…', 'Cargando catálogo…'],
  'src/components/cruce/cruce-skeleton.tsx': ['Cargando pipeline de aduana…', 'Cargando cruce del SKU…', 'Cargando embarques…'],
  'src/components/dashboard/dashboard-skeleton.tsx': ['Cargando panel…'],
  'src/components/embarques/embarques-skeleton.tsx': ['Cargando el histórico…', 'Cargando el histórico…'],
  'src/components/ficha/ficha-skeleton.tsx': ['Cargando ficha…'],
  'src/components/pendientes/bandeja-view.tsx': ['Cargando pendientes…'],
  'src/components/proyectos/proyecto-detalle-skeleton.tsx': ['Cargando proyecto…'],
  // DOS desde S-1: el esqueleto tiene una rama por ancho (pasarela / lista) y
  // cada una anuncia lo suyo. Que el gate lo cazara al cambiar de forma es
  // exactamente para lo que existe — y lo cazó desde el otro carril.
  'src/components/proyectos/proyectos-skeleton.tsx': ['Cargando proyectos…', 'Cargando proyectos…'],
  'src/components/snapshots/cambios-skeleton.tsx': ['Cargando snapshot…', 'Cargando cambios…'],
  'src/components/snapshots/snapshots-skeleton.tsx': ['Cargando snapshots…'],
  'src/app/(app)/config/page.tsx': ['Cargando configuración…'],
};
