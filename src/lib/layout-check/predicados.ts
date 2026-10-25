// ============================================================
// [2.0.1-A] O0 · layout-check · predicados.ts
//
// LA función que se inyecta a la página real (Playwright `page.evaluate`)
// y le pregunta al MOTOR DE LAYOUT lo que ninguna prueba de este repo
// puede ver (B11-1): jsdom y `renderToStaticMarkup` no calculan layout,
// así que toda guarda de interfaz comprobaba TEXTO DE CLASES y no efecto
// — y una clase presente no es un efecto presente (P25, ejemplar 11).
//
// REGLA DURA DE ESTE ARCHIVO: `medirPagina` es AUTOCONTENIDA. `evaluate`
// serializa la función SIN su clausura — cualquier referencia a una
// constante de módulo revienta dentro del navegador con `X is not
// defined`, y esa excepción se mapearía a SIN MEDIR (nunca a «sin
// violaciones»). Por eso TODO lo que necesita viaja en `config` y no hay
// ni un identificador externo en su cuerpo. El arnés (`layout-check.mjs`)
// atrapa cualquier excepción de evaluate como SIN MEDIR por caso.
//
// QUÉ MIDE (aserciones MECÁNICAS, no de gusto — el encargo de O0):
//   A1a · texto truncado ILEGIBLE: contenido más ancho que su caja
//         (scrollWidth > clientWidth+1) bajo overflow hidden/clip, con la
//         caja por debajo del umbral de legibilidad. El truncado ANCHO
//         (≥ umbral) es un patrón aceptado del repo (B11-2: ellipsis +
//         title) y se REPORTA como conteo, no como violación — el umbral
//         se validó como SEPARADOR contra el defecto real re-plantado
//         (riel a 27 px) y contra el código de hoy sobre el MISMO SKU
//         (condición O0-2 del gate de arquitectura; evidencia en el DoD).
//   A1b · desborde de página entera: el documento scrollea horizontal.
//   A2  · región de navegación APLASTADA: un `nav`/[role=navigation]
//         visible, con algo interactivo dentro, cuya altura computada
//         quedó bajo el umbral (el `<nav>` a 0 px de B11 av.10).
//   A3  · dos contenedores flotantes (fixed/sticky) simultáneamente
//         interactivos que se SOLAPAN. Excepción DECLARADA POR NOMBRE:
//         `[data-solape-permitido="<nombre>"]` en el componente (una sola
//         fuente); los solapes permitidos se REGISTRAN aparte para que el
//         arnés pueda (a) comprobar que la excepción se ejerció en el
//         control y (b) aseverar que el conjunto de nombres no crece sin
//         registrarse. `[role="dialog"]` (modal: suspende el fondo) es la
//         otra excepción con nombre.
//
// Los conteos (`truncadosLegibles`, `navsMedidos`, `flotantesMedidos`)
// existen para que un «0 violaciones» no pueda ser el universo vacío de
// P17: el arnés los imprime por caso, y el control positivo plantado
// (src/app/(app)/control-layout) obliga a que cada aserción DEMUESTRE que
// puede denunciar antes de creerle un verde.
// ============================================================

export interface ConfigMedicion {
  /** Caja mínima (px) para que un truncado se considere legible (A1a). */
  umbralLegibilidadPx: number;
  /** Altura mínima (px) de una región de navegación visible (A2). */
  umbralAltoNavPx: number;
  /** Traslape mínimo (px) en AMBOS ejes para contar un solape (A3). */
  solapeMinPx: number;
}

export type TipoViolacion =
  | 'a1_truncado_ilegible'
  | 'a1_desborde_pagina'
  | 'a1_recortado_por_ancestro'
  | 'a2_nav_aplastado'
  | 'a3_solape_flotantes'
  | 'a4_control_tapado';

export interface Violacion {
  tipo: TipoViolacion;
  /** Descripción mecánica: elemento(s), medidas, muestra de texto. */
  detalle: string;
  /** Valor de `data-plantado` propio o del ancestro más cercano (control positivo), o null si es un hallazgo real. */
  plantado: string | null;
}

export interface SolapePermitido {
  nombre: string;
  detalle: string;
}

export interface Medicion {
  violaciones: Violacion[];
  solapesPermitidos: SolapePermitido[];
  /** Truncados con caja ≥ umbral (patrón aceptado B11-2): se reportan, no se denuncian. */
  truncadosLegibles: number;
  /**
   * Regiones de navegación que A2 SÍ aseveró: visibles **y** con algo
   * interactivo dentro en el instante de medir.
   */
  navsMedidos: number;
  /**
   * Regiones de navegación VISIBLES, se hayan aseverado o no. Existe porque el
   * número de arriba, solo, es indistinguible de «no hay más»: el `<nav>` del
   * árbol del catálogo llega de un fetch de cliente y, mientras pinta su
   * esqueleto, no tiene interactivos — así que ni se cuenta ni se asevera, y el
   * veredicto salía VERDE por encima de una región de navegación entera que
   * nadie miró. Con los dos números, `navs 1/2` lo dice en voz alta.
   */
  navsVisibles: number;
  flotantesMedidos: number;
  /**
   * Controles de un flotante cuyo rect quedó VACÍO tras recortarlo contra el
   * viewport y sus ancestros (típicamente: filas scrolleadas fuera de vista en
   * una lista con `overflow-y: auto`). No participan de ningún par — no se
   * pueden tocar. Se cuenta para que el arreglo no sea invisible: si mañana
   * alguien quita el recorte, este número cae a 0 y los solapes fantasma
   * vuelven (fue el mecanismo exacto de los H2/H3 retirados).
   */
  controlesRecortados: number;
  /**
   * [C-DASH·13 · A1c] Interactivos que asoman de su ancestro recortante pero
   * **no del todo**: siguen alcanzables, así que se REPORTAN y no se denuncian —
   * el molde de `truncadosLegibles`. Sin este número, un «0 violaciones» de A1c
   * no distingue «nada asoma» de «asoma medio tablero y ninguno del todo».
   */
  asomanParcialmente: number;
  /**
   * [C-DASH·13 · A1c] Interactivos cuyo ancestro recortante mide ~0 px de ancho
   * — el caso del `<aside>` COLAPSADO, que recorta a cero a propósito. Ahí el
   * predicado no discrimina nada (todo está «fuera»), así que se salta y se
   * cuenta. Declararlo es lo que impide que A1c se vuelva un generador de ruido
   * en el régimen colapsado y que alguien lo apague entero por eso.
   */
  recortadosPorCajaCero: number;
  /** [C-DASH·13 · A1c] Interactivos que A1c SÍ aseveró — el denominador de su cero. */
  interactivosMedidosA1c: number;
  /**
   * [C-DASH·13 · A1a] Elementos con contenido desbordado cuya caja mide ~0 px de
   * ancho: texto escondido a propósito, no truncado ilegible. El caso que lo
   * destapó es el `<aside>` COLAPSADO. Se cuenta para que la exclusión sea
   * visible: si mañana este número se dispara, alguien está escondiendo texto con
   * cajas de cero en vez de con `display:none`.
   */
  cajasCeroA1a: number;
  elementosRecorridos: number;
}

/** AUTOCONTENIDA (ver cabecera): cero referencias fuera de `config` y el DOM. */
export function medirPagina(config: ConfigMedicion): Medicion {
  const violaciones: Violacion[] = [];
  const solapesPermitidos: SolapePermitido[] = [];
  let truncadosLegibles = 0;
  let navsMedidos = 0;
  let navsVisibles = 0;
  let controlesRecortados = 0;
  let asomanParcialmente = 0;
  let recortadosPorCajaCero = 0;
  let interactivosMedidosA1c = 0;
  let cajasCeroA1a = 0;
  let elementosRecorridos = 0;

  function describir(el: Element): string {
    const clases = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    const texto = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${clases ? '.' + clases : ''}>${texto ? ` «${texto}»` : ''}`;
  }
  function plantadoDe(el: Element): string | null {
    const marcado = el.closest('[data-plantado]');
    return marcado ? marcado.getAttribute('data-plantado') : null;
  }
  function visible(el: Element): boolean {
    // display:none (propio o de un ancestro) no genera cajas; visibility y
    // aria-hidden se excluyen aparte. Un elemento APLASTADO (alto 0) SÍ
    // tiene caja y por eso sigue siendo medible — que es el punto de A2.
    if (el.getClientRects().length === 0 && getComputedStyle(el).position !== 'fixed') return false;
    const estilo = getComputedStyle(el);
    if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
    if (el.closest('[aria-hidden="true"]') !== null) return false;
    return true;
  }
  const SELECTOR_INTERACTIVO = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"], [role="link"]';

  // ---------- A1b · desborde de la página entera ----------
  const raiz = document.scrollingElement;
  if (raiz && raiz.scrollWidth > raiz.clientWidth + 1) {
    violaciones.push({
      tipo: 'a1_desborde_pagina',
      detalle: `documento ${raiz.scrollWidth}px de contenido en ${raiz.clientWidth}px de viewport`,
      plantado: null,
    });
  }

  // ---------- A1a · truncados por elemento ----------
  const todos = document.querySelectorAll('*');
  for (let i = 0; i < todos.length; i++) {
    const el = todos[i];
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' || tag === 'META' || tag === 'LINK' || tag === 'TITLE') continue;
    elementosRecorridos++;
    if (!visible(el)) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const estiloEl = getComputedStyle(el);
    const overflowX = estiloEl.overflowX;
    if (overflowX !== 'hidden' && overflowX !== 'clip') continue; // auto/scroll = contenedor scrolleable legítimo; visible = fuera del alcance v1 (declarado en el arnés)
    // Exclusión MECÁNICA del idioma `sr-only` (etiquetas para lector de
    // pantalla: caja de 1px + clip). No es texto truncado que un usuario
    // entrecierra los ojos para leer: es texto OCULTO a propósito. La
    // exclusión se probó contra el caso que motivó la aserción (el riel a
    // 27 px NO lleva clip y se sigue denunciando — lo vigila el control
    // plantado a1 en cada corrida).
    if (estiloEl.clip !== 'auto' || (estiloEl.clipPath !== 'none' && estiloEl.clipPath !== '')) continue;
    if (el.clientWidth <= 2 && el.clientHeight <= 2) continue;
    // [C-DASH·13] UNA CAJA DE ~0 px DE ANCHO NO ES «TEXTO TRUNCADO»: ES TEXTO
    // ESCONDIDO A PROPÓSITO, y la diferencia la destapó enumerar el eje del
    // sidebar. El `<aside>` colapsado mide 0 px con `overflow-hidden` y sus
    // 230 px de navegación siguen dentro, así que A1a lo denunciaba —«contenido
    // 107px en caja de 0px»— en todos los casos del régimen colapsado, más el correo
    // del perfil: decenas de violaciones de golpe, todas sobre un estado que el usuario
    // pidió. Un gate que sale ROJO sobre una preferencia deja de dar veredicto,
    // y un gate así es el que alguien apaga.
    //
    // Lo que A1a asevera es LEGIBILIDAD, y por debajo de 1 px no hay superficie
    // de lectura que juzgar: el predicado no discrimina nada ahí. Se salta y SE
    // CUENTA — un cero mudo sería el universo vacío otra vez (P17).
    //
    // ⚠ Y ESTO NO CIERRA EL HUECO: LO DECLARA. La primera versión de este
    // comentario decía «si esa caja es una región de navegación, A2 la caza por
    // su ALTO», y era FALSO — lo refutó la revisión del cierre. A2 juzga solo
    // `nav|[role=navigation]` y solo por ALTO contra un umbral de 8 px (:299-317);
    // el sujeto de aquí es el `<aside>` colapsado, aplastado en ANCHO, cuyo `<nav>`
    // interior CONSERVA su alto completo. A2 no puede verlo.
    //
    // Y la prueba es aritmética, no argumental: si A2 lo cazara, los 56 casos
    // `sidebar-colapsado` de cada corrida saldrían ROJOS — y salen verdes.
    //
    // Lo que hay, entonces: **ninguna aserción cubre una caja recortante de ~0 px
    // de ancho.** A1a la salta aquí, A1c la salta en `:282`, y A2 cubre otro caso.
    // Por eso los DOS contadores (`cajasCeroA1a` y `recortadosPorCajaCero`) se
    // imprimen en cada caso: son la única superficie donde ese hueco es visible.
    // El control positivo del propio A1a —el SKU en 27 px— está muy por encima de
    // este corte y siguió denunciándose en todos los casos.
    if (el.clientWidth <= 1) {
      cajasCeroA1a++;
      continue;
    }
    const texto = (el.textContent ?? '').trim();
    if (texto.length === 0) continue;
    if (el.clientWidth >= config.umbralLegibilidadPx) {
      truncadosLegibles++;
      continue;
    }
    violaciones.push({
      tipo: 'a1_truncado_ilegible',
      detalle: `${describir(el)} — contenido ${el.scrollWidth}px en caja de ${el.clientWidth}px (umbral ${config.umbralLegibilidadPx}px)`,
      plantado: plantadoDe(el),
    });
  }

  // ============================================================
  // A1c · RECORTADO POR UN ANCESTRO  [C-DASH·13]
  //
  // EL HUECO QUE VIENE A CERRAR, con su ejemplar medido. A 390 px, TRES de los
  // seis bloques del riel del tablero caían fuera de la pantalla —`almacenes` en
  // [463,527] y `disponible` en [543,607] contra un viewport de 390— y se
  // recortaban EN SILENCIO. Ninguna de las aserciones de aquí podía verlo:
  //
  //   A1a · exige `overflow-x` hidden/clip EN EL PROPIO elemento. El `<nav>` del
  //         riel lo tiene `visible` ⇒ salía por `continue`. El alcance v1 lo
  //         declaraba por escrito; lo que faltaba era este caso.
  //   A1b · pregunta si el DOCUMENTO scrollea. No scrollea: `main` lleva
  //         `overflow-x-hidden` y SE TRAGA el desborde.
  //   A2  · mide el ALTO del `nav`, no su ancho.
  //
  // La combinación es el hueco: **un elemento con `overflow: visible` cuyo
  // contenido desborda, dentro de un ancestro que recorta, no lo ve ninguna.**
  //
  // QUÉ DENUNCIA Y QUÉ NO, y el corte no es un umbral inventado:
  //   · VIOLACIÓN si el interactivo queda **ENTERAMENTE** fuera de la caja de su
  //     ancestro recortante en el eje X. Eso es binario y no admite discusión:
  //     no se ve y no se puede alcanzar.
  //   · Se CUENTA (no se denuncia) si asoma en parte: sigue alcanzable.
  //   · Se SALTA (y se cuenta) si el ancestro mide ~0 px — el `<aside>`
  //     colapsado recorta a cero a propósito, y ahí el predicado no discrimina.
  //
  // Se acota a lo INTERACTIVO a propósito: un adorno fuera de cuadro es ruido,
  // un enlace fuera de cuadro es información perdida. Y `visible()` ya excluye
  // lo que está `visibility:hidden`, así que el panel de detalle del riel —que
  // nace invisible— no entra: su recorte es otro hueco, y tiene su propio nombre
  // (`RIEL-DETALLE-SIN-GUARDA-VISUAL`).
  // ============================================================
  const interactivos = document.querySelectorAll(SELECTOR_INTERACTIVO);
  for (let i = 0; i < interactivos.length; i++) {
    const el = interactivos[i];
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    let recortante: Element | null = null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'hidden' || ox === 'clip') {
        recortante = p;
        break;
      }
      if (ox === 'auto' || ox === 'scroll') break; // scrollea: se puede alcanzar
    }
    if (recortante === null) continue;
    if (recortante.clientWidth <= 1) {
      recortadosPorCajaCero++;
      continue;
    }
    const ra = recortante.getBoundingClientRect();
    interactivosMedidosA1c++;
    const fuera = r.left >= ra.right - 0.5 || r.right <= ra.left + 0.5;
    if (fuera) {
      violaciones.push({
        tipo: 'a1_recortado_por_ancestro',
        detalle: `${describir(el)} — caja [${Math.round(r.left)}, ${Math.round(r.right)}] ENTERAMENTE fuera de ${describir(recortante)} [${Math.round(ra.left)}, ${Math.round(ra.right)}], que recorta`,
        plantado: plantadoDe(el),
      });
    } else if (r.left < ra.left - 1 || r.right > ra.right + 1) {
      asomanParcialmente++;
    }
  }

  // ---------- A2 · regiones de navegación aplastadas ----------
  const navs = document.querySelectorAll('nav, [role="navigation"]');
  for (let i = 0; i < navs.length; i++) {
    const nav = navs[i];
    if (!visible(nav)) continue;
    navsVisibles++;
    if (nav.querySelector(SELECTOR_INTERACTIVO) === null) continue;
    navsMedidos++;
    const alto = nav.getBoundingClientRect().height;
    if (alto < config.umbralAltoNavPx) {
      violaciones.push({
        tipo: 'a2_nav_aplastado',
        detalle: `${describir(nav)} — altura computada ${Math.round(alto * 10) / 10}px (umbral ${config.umbralAltoNavPx}px), con ${nav.querySelectorAll(SELECTOR_INTERACTIVO).length} interactivo(s) dentro`,
        plantado: plantadoDe(nav),
      });
    }
  }

  // ---------- A3 · solape de flotantes interactivos ----------
  const candidatos: Element[] = [];
  for (let i = 0; i < todos.length; i++) {
    const el = todos[i];
    if (!visible(el)) continue;
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const esInteractivo = el.matches(SELECTOR_INTERACTIVO) || el.querySelector(SELECTOR_INTERACTIVO) !== null;
    if (!esInteractivo) continue;
    candidatos.push(el);
  }
  // Solo contenedores EXTERIORES: un fixed dentro de otro fixed es un hijo, no un par.
  const exteriores = candidatos.filter((el) => !candidatos.some((otro) => otro !== el && otro.contains(el)));
  const flotantesMedidos = exteriores.length;
  // El solape se mide entre los CONTROLES de cada flotante, no entre sus
  // contenedores: un riel de ancho completo con su píldora a la izquierda no
  // tapa nada de la burbuja en la esquina opuesta aunque sus CAJAS se crucen
  // — lo que un humano no puede hacer es tocar un control que otro control
  // cubre, y eso es lo que se asevera.
  //
  // Y EL RECT DE UN CONTROL NO ES DONDE ESE CONTROL SE PUEDE TOCAR. Esta
  // corrección la pagó el propio bloque: la primera versión leía
  // `getBoundingClientRect()` a secas y denunció DOS solapes que no existen
  // (los H2/H3 del informe). Medido a 390 con 15 SKU en la Selección:
  // el `<ul>` del panel es `overflow-y: auto` con 674 px de contenido en 321
  // visibles, así que **24 de sus 48 controles tienen su rect FUERA del área
  // visible** — encima de la barra de navegación, que empieza 14 px por
  // debajo de donde el panel termina. El panel real no toca nada; sus filas
  // scrolleadas, sobre el papel, sí. Es P27 dentro del instrumento: se medía
  // la CAJA GEOMÉTRICA del control (la representación) en vez del área donde
  // un dedo lo alcanza (la cosa).
  //
  // Por eso cada rect se recorta contra el viewport y contra la cadena de
  // ancestros que de verdad lo recortan; si queda vacío, ese control no
  // existe para nadie y no participa de ningún par.
  //
  // LÍMITE DECLARADO: un ancestro con `transform`/`filter`/`will-change` crea
  // contenedor para descendientes `fixed` y podría recortarlos — no se
  // contempla (ningún flotante de este repo vive dentro de uno). Si algún día
  // se recorta un `fixed`, este predicado dirá que sigue entero.
  function rectVisibleDe(nodo: Element): { top: number; left: number; right: number; bottom: number } | null {
    const r = nodo.getBoundingClientRect();
    let caja = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
    const recortar = (o: { top: number; left: number; right: number; bottom: number }) => {
      caja = {
        top: Math.max(caja.top, o.top),
        left: Math.max(caja.left, o.left),
        right: Math.min(caja.right, o.right),
        bottom: Math.min(caja.bottom, o.bottom),
      };
      return caja.right - caja.left > 0 && caja.bottom - caja.top > 0;
    };
    // El viewport recorta a todo el mundo, `fixed` incluido.
    if (!recortar({ top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight })) return null;

    // La posición EFECTIVA se arrastra hacia arriba: lo que decide si un
    // ancestro recorta no es cómo esté posicionado el control, sino si algún
    // nodo INTERMEDIO ya sacó al subárbol del flujo. Un botón `static` dentro
    // de un contenedor `fixed` no lo recorta el `<main>` scrolleable de la
    // aplicación — y no advertir eso fue un falso NEGATIVO que se coló en la
    // primera versión de este recorte: el control plantado dejó de denunciarse
    // en 6 de sus 8 casos y el veredicto salió SIN VEREDICTO en vez de verde.
    // El instrumento se negó a absolver, que es exactamente para lo que está
    // el control positivo.
    let posicion = getComputedStyle(nodo).position;
    let ancestro = nodo.parentElement;
    while (ancestro) {
      if (posicion === 'fixed') break; // ningún ancestro lo recorta (ver el límite declarado)
      const estilo = getComputedStyle(ancestro);
      const esContenedor = estilo.position !== 'static';
      // Un `absolute` solo lo recorta un ancestro que además sea su contenedor
      // de posicionamiento; el resto lo atraviesa.
      const puedeRecortar = posicion !== 'absolute' || esContenedor;
      if (puedeRecortar && (estilo.overflowX !== 'visible' || estilo.overflowY !== 'visible')) {
        const ra = ancestro.getBoundingClientRect();
        if (!recortar({ top: ra.top, left: ra.left, right: ra.right, bottom: ra.bottom })) return null;
      }
      if (posicion === 'absolute' && esContenedor) posicion = 'static'; // ya quedó contenido aquí
      if (estilo.position === 'fixed') posicion = 'fixed'; // de aquí hacia arriba, nadie recorta
      ancestro = ancestro.parentElement;
    }
    return caja;
  }

  function rectsInteractivos(el: Element): Array<{ top: number; left: number; right: number; bottom: number }> {
    const propios = el.matches(SELECTOR_INTERACTIVO) ? [el] : [];
    const hijos = Array.prototype.slice.call(el.querySelectorAll(SELECTOR_INTERACTIVO)) as Element[];
    const rects: Array<{ top: number; left: number; right: number; bottom: number }> = [];
    for (const nodo of propios.concat(hijos)) {
      if (!visible(nodo)) continue;
      const r = nodo.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const caja = rectVisibleDe(nodo);
      if (caja === null) {
        controlesRecortados++;
        continue;
      }
      rects.push(caja);
    }
    return rects;
  }
  for (let i = 0; i < exteriores.length; i++) {
    for (let j = i + 1; j < exteriores.length; j++) {
      const a = exteriores[i];
      const b = exteriores[j];
      let mejorX = 0;
      let mejorY = 0;
      for (const ra of rectsInteractivos(a)) {
        for (const rb of rectsInteractivos(b)) {
          const tx = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const ty = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (tx >= config.solapeMinPx && ty >= config.solapeMinPx && tx * ty > mejorX * mejorY) {
            mejorX = tx;
            mejorY = ty;
          }
        }
      }
      if (mejorX < config.solapeMinPx || mejorY < config.solapeMinPx) continue;
      const detalle = `${describir(a)} ⇄ ${describir(b)} — controles traslapados ${Math.round(mejorX)}×${Math.round(mejorY)}px`;
      const permisoA = a.closest('[data-solape-permitido]');
      const permisoB = b.closest('[data-solape-permitido]');
      const modal = a.closest('[role="dialog"]') !== null || b.closest('[role="dialog"]') !== null;
      if (permisoA !== null || permisoB !== null) {
        const nombre =
          (permisoA ? permisoA.getAttribute('data-solape-permitido') : null) ??
          (permisoB ? permisoB.getAttribute('data-solape-permitido') : null) ??
          '(sin nombre)';
        solapesPermitidos.push({ nombre, detalle });
        continue;
      }
      if (modal) {
        solapesPermitidos.push({ nombre: 'dialogo-modal', detalle });
        continue;
      }
      violaciones.push({
        tipo: 'a3_solape_flotantes',
        detalle,
        plantado: plantadoDe(a) ?? plantadoDe(b),
      });
    }
  }

  // ---------- A4 · ¿se puede TOCAR? ----------
  // A3 pregunta si dos cajas se cruzan; A4 pregunta lo único que le importa a
  // un humano: si al tocar el centro de un control, el navegador le entrega ESE
  // control. Es la aserción que descubrió H4 a mano —el saludo del asistente
  // cubriendo el centro de la píldora de Selección, con `elementFromPoint`
  // devolviendo el saludo— y la que cierra la distancia entre medir la
  // representación (cajas) y medir la cosa (alcanzabilidad), que es P27.
  //
  // Solo sobre controles de superficies FLOTANTES: son las que se pisan entre
  // sí. Un control tapado por su propio flotante (un menú sobre su disparador)
  // no cuenta — se comprueba por contención, no por identidad.
  for (const flotante of exteriores) {
    const propios = flotante.matches(SELECTOR_INTERACTIVO) ? [flotante] : [];
    const hijos = Array.prototype.slice.call(flotante.querySelectorAll(SELECTOR_INTERACTIVO)) as Element[];
    for (const control of propios.concat(hijos)) {
      if (!visible(control)) continue;
      const caja = rectVisibleDe(control);
      if (caja === null) continue; // recortado: no se puede tocar y no es culpa de nadie
      const cx = (caja.left + caja.right) / 2;
      const cy = (caja.top + caja.bottom) / 2;
      const encima = document.elementFromPoint(cx, cy);
      if (encima === null) continue;
      if (encima === control || control.contains(encima) || encima.contains(control)) continue;
      // ¿Quién lo tapa? Si es el propio flotante (o algo suyo), no es colisión.
      if (flotante.contains(encima)) continue;
      const permiso = encima.closest('[data-solape-permitido]') ?? control.closest('[data-solape-permitido]');
      const modal = encima.closest('[role="dialog"]') !== null;
      const detalle = `${describir(control)} tapado en su centro (${Math.round(cx)},${Math.round(cy)}) por ${describir(encima)}`;
      if (permiso !== null) {
        solapesPermitidos.push({ nombre: permiso.getAttribute('data-solape-permitido') ?? '(sin nombre)', detalle });
        continue;
      }
      if (modal) {
        solapesPermitidos.push({ nombre: 'dialogo-modal', detalle });
        continue;
      }
      violaciones.push({
        tipo: 'a4_control_tapado',
        detalle,
        plantado: plantadoDe(control) ?? plantadoDe(encima),
      });
    }
  }

  return {
    violaciones,
    solapesPermitidos,
    truncadosLegibles,
    navsMedidos,
    navsVisibles,
    flotantesMedidos,
    controlesRecortados,
    asomanParcialmente,
    recortadosPorCajaCero,
    interactivosMedidosA1c,
    cajasCeroA1a,
    elementosRecorridos,
  };
}
