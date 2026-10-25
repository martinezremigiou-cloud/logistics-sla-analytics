// ============================================================
// [2.0.1-A] O0 · layout-check · escenarios.ts (100% PURO)
//
// Los escenarios se DERIVAN de las pantallas reales — la regla del
// encargo: «un gate cuyo sujeto es una enumeración escrita a mano es
// ciego a lo no enumerado». La entrada es la lista de archivos
// `src/app/**/page.tsx` que el arnés encuentra en el disco; aquí solo
// vive la traducción archivo→ruta y la expansión ruta×estado×ancho,
// para que las DOS cosas que pueden mentir (¿derivé todas las rutas?
// ¿expandí todos los casos?) queden bajo `tsc` y vitest.
//
// EL EJE DE ESTADO existe por la condición O0-1 del gate de
// arquitectura (P24): los dos defectos del DoD viven dentro del panel
// de Selección DESPLEGADO, y el panel arranca contraído — sembrar
// `localStorage` no lo abre. Sin este eje, el instrumento jamás podría
// alcanzar lo que vino a cazar y su verde sería infalsificable.
//
// LÍMITE DECLARADO (O0-6): se navega con UNA sesión (admin), que es el
// rol que ve TODAS las pantallas y todos los ítems del nav (8; un KAM ve
// 7). Los dos defectos que motivaron el instrumento (B11 av.10) son
// independientes del rol — el panel y el nav son del shell. Si algún
// día un defecto vive en una pantalla que el admin no ve, este límite
// es el lugar donde buscarlo.
//
// Y DESDE EL 28-AGO EL LÍMITE SE COMPRUEBA, no solo se declara: el arnés
// lee `perfiles.rol` con la sesión recién abierta y sale SIN VEREDICTO
// si no es `admin`. Hizo falta porque una corrida entera se midió con
// rol `visitante`: una parte de sus casos no eran la pantalla que el
// veredicto nombraba —dos rutas devolvían una tarjeta de «sin permiso»
// y /config servía 2 pestañas en vez de 5— y ni un número del log lo
// delataba. **Una premisa escrita y no medida es una premisa que ya
// falló al menos una vez sin que nadie se enterara.**
//
// Y el límite que esto DEJA abierto, dicho aquí para que no se pierda:
// el rol `kam`, que es el usuario REAL de este portal. Exigir admin
// cierra el agujero del instrumento y deja sin medir la pantalla de
// quien de verdad la usa. Ver deuda A1-15.
// ============================================================

/**
 * Anchos REALES del encargo (mínimo 390 · 768 · 1280 · 1536), con altos fijos
 * declarados: el aplastamiento de A2 depende del alto de la ventana.
 *
 * EL 640 NO ESTABA EN EL ENCARGO Y SE AÑADE POR UN DEFECTO QUE SE ESCAPÓ POR
 * AHÍ. La revisión adversaria de este bloque encontró que el panel del
 * asistente desplegado se anclaba con `sm:bottom-6`, y `sm` empieza en 640
 * mientras `BottomNav` no desaparece hasta `md` (768): en toda la banda
 * [640, 768) el panel se sentaba encima de 3 de los 5 ítems del nav. El
 * instrumento estaba VERDE — porque medía 390 (donde manda la regla móvil) y
 * 768 (donde ya no hay nav), y **ninguno de los dos anchos vive en la banda
 * donde el defecto existe**.
 *
 * Es P17 sobre el eje de anchos, y la lección es del tamaño del gate: los
 * breakpoints de Tailwind parten la pantalla en CUATRO regímenes (<640, [640,
 * 768), [768, 1024), ≥1024) y medir sólo en las orillas deja bandas enteras sin
 * testigo. 640 es la primera de esas bandas y la única donde conviven reglas de
 * `sm` con la navegación móvil viva — el cruce exacto que produjo el defecto.
 */
export const ANCHOS = [
  { ancho: 390, alto: 844 },
  { ancho: 640, alto: 960 },
  { ancho: 768, alto: 1024 },
  { ancho: 1280, alto: 720 },
  { ancho: 1536, alto: 864 },
  // [2.0.1-B · S] 1704×1296 — EL ANCHO DONDE VIVE LA QUEJA, y por eso entra.
  //
  // No es un número redondo: es el viewport REAL en el que se midió el «antes»
  // de `/proyectos`, donde la rejilla `auto-fill` ponía varias columnas y dejaba
  // un hueco vertical grande sin contenido.
  //
  // Y la razón de que ese ancho importe es estructural: `auto-fill` añade
  // columnas conforme hay sitio, así que **consume MENOS alto cuanto más ancha
  // es la pantalla**. El defecto EMPEORA hacia arriba, y 1536 era el techo de la
  // escalera. Sin este renglón el instrumento cubre todos los anchos menos aquel
  // en el que se ve el problema.
  { ancho: 1704, alto: 1296 },
] as const;

/**
 * `base`: la página tal cual carga (Selección vacía, panel ausente).
 * `seleccion-contraida`: 15 SKU sembrados y el panel CERRADO — o sea la
 *   PÍLDORA, más el saludo del asistente si toca. Es el estado donde vivía H4
 *   (el saludo cubriendo el centro de la píldora), y no existía: sin él, el
 *   arreglo de H4 sería infalsificable — la píldora contraída no se medía nunca
 *   porque el otro estado la despliega (P17 sobre el propio conjunto).
 * `seleccion-abierta`: los mismos 15 SKU (los MÁS LARGOS del catálogo —
 *   B11-1: «el defecto no se ve con SUJ500-F, se ve con DN-HN73 BOTTLE TAG
 *   58KHZ») y el panel ABIERTO con un clic real en la píldora.
 *
 * `sidebar-colapsado`: el OTRO régimen del shell. [C-DASH·13]
 *
 *   El estado del sidebar es un eje DISCRETO del layout con exactamente dos
 *   valores y NINGÚN tercero: `sidebar-colapso.ts` pone `--mx-sidebar-w: 0px` al
 *   colapsar y la quita al expandir, con lo que el `<aside>` cae a su literal de
 *   `var(--mx-sidebar-w, 230px)`. La preferencia se PERSISTE en `localStorage`
 *   (`mx-sidebar-colapsado`), así que un usuario vive en uno de los dos durante
 *   días — y el gate medía uno y absolvía los dos.
 *
 *   MEDIDO el 15-sep en los siete viewports, lo que mueve:
 *     768 → columna de contenido 489 px expandido vs **719** colapsado (+47 %)
 *     1024 → 632 vs 862 · 1280 → 888 vs 1118 · 1536 → 1144 vs 1298
 *
 *   **No se cruza con los estados de Selección, y es una decisión de costo, no un
 *   olvido.** El producto cartesiano de los dos ejes multiplicaría por dos TODOS
 *   los casos del shell; este estado añade uno por ruta del shell y ancho con
 *   sidebar. Lo que queda sin medir —el régimen colapsado CON la Selección
 *   abierta— se declara aquí en vez de fingir que no existe.
 */
export type EstadoEscenario =
  | 'base'
  | 'seleccion-contraida'
  | 'seleccion-abierta'
  | 'pasarela-avanzada'
  | 'sidebar-colapsado';

/**
 * [2.0.1-B · S · AB-5] Rutas que tienen una PASARELA horizontal, y por tanto un
 * estado que ninguna otra ruta puede tener: **desplazada**.
 *
 * ────────────────────────────────────────────────────────────
 * POR QUÉ SE DECLARA A MANO. Igual que `VARIANTES_QUERY`, esto es conocimiento
 * de producto y no es derivable del árbol de archivos: un componente con
 * `overflow-x` no se distingue de otro leyendo una ruta. Lo que sí queda
 * vigilado es que cada ruta declarada produzca su caso.
 *
 * ────────────────────────────────────────────────────────────
 * Y POR QUÉ ES UNA LISTA Y NO UN ESTADO UNIVERSAL. Un cuarto estado que se
 * expandiera a TODAS las rutas produciría, en las que no tienen carril, un caso
 * que no puede medir nada — y saldría VERDE. Un verde sobre una pantalla donde
 * la aserción no tenía sujeto es exactamente la guarda vacua que este gate
 * existe para no ser (P19). Así que el caso **no nace** donde no hay pasarela.
 *
 * La otra mitad la pone el arnés: si una ruta DECLARADA aquí no expone una
 * pasarela que se pueda desplazar, ese caso sale **SIN MEDIR con su razón**,
 * nunca verde. Declarar una pasarela que no existe tiene que doler.
 *
 * ────────────────────────────────────────────────────────────
 * [S-1] YA NO ESTÁ VACÍA. El mecanismo aterrizó antes que su sujeto a propósito
 * —así se revisó solo, en vez de enterrado dentro del commit que construye la
 * pasarela— y con S-1 entregado el sujeto existe: `/proyectos` monta un carril
 * de verdad de 768 para arriba.
 *
 * **Declarar aquí una ruta es una AFIRMACIÓN comprobable**, y por eso el commit
 * que la declara trae su control positivo: `rutas-con-pasarela.test.tsx` renderiza
 * cada ruta de esta lista y exige que su control exista de verdad, en vez de
 * confiar en que alguien se acordó. Lo que ese control NO puede ver —si el
 * control está habilitado, que depende de geometría— lo dice el navegador, y por
 * eso este estado existe.
 */
export const RUTAS_CON_PASARELA: string[] = ['/proyectos'];

/**
 * [S-1 · corrida 1] EL CUARTO ESTADO NO NACE BAJO EL CORTE, y esto salió de una
 * corrida real, no de un razonamiento.
 *
 * La primera versión lo hacía nacer en TODOS los anchos de una ruta declarada.
 * Consecuencia medida en la primera corrida del arnés tras declarar
 * `/proyectos`: **3 casos SIN MEDIR permanentes** —390, 640 y 768— y por tanto
 * `EXIT=2` para siempre. A 390 y 640 la pantalla sirve la lista vertical por
 * decisión de producto: **ahí no hay pasarela que desplazar, y un caso que no puede
 * medirse nunca no es rigor, es un gate que no puede dar veredicto.**
 *
 * Es además lo que la regla de AB-5 pedía de verdad —«el estado sólo nace donde
 * hay pasarela»—: el sujeto de una pasarela no es sólo la ruta, es la ruta EN SU
 * BANDA DE ANCHO. Declararla sin la banda era declarar de más.
 *
 * **768 es una segunda copia de `CORTE_PASARELA`** (`use-es-ancho.ts`), y no se
 * puede unir: aquel módulo es `"use client"` e importa React, y este archivo lo
 * carga el arnés desde Node. Así que se COMPARA, en `escenarios.test.ts`, como
 * `carril.ts` contra `globals.css`.
 */
export const ANCHO_MINIMO_PASARELA = 768;

/**
 * [C-DASH·13] El ancho a partir del cual el `<aside>` del shell EXISTE, y por
 * tanto a partir del cual colapsarlo cambia algo.
 *
 * **Por debajo, colapsar no tiene sujeto:** `app-shell.tsx` monta el `<aside>`
 * con `hidden … md:block`, así que a 390 y a 640 mide **0 px en los DOS
 * regímenes** —medido el 15-sep, no razonado— y el caso saldría VERDE sin haber
 * podido medir nada. Es la misma regla que `ANCHO_MINIMO_PASARELA`: **el estado
 * no nace donde no hay sujeto**, porque un verde sobre una aserción sin sujeto
 * es la guarda vacua que este gate existe para no ser (P19).
 *
 * **Es una SEGUNDA COPIA y por eso se compara, no se confía.** El original es una
 * clase de Tailwind (`md:block`) dentro de un `.tsx` que este módulo no puede
 * importar —lo carga el arnés desde Node—, así que `escenarios.test.ts` lee
 * `app-shell.tsx`, saca el prefijo del `<breakpoint>:block` del `<aside>` y lo
 * resuelve contra la config REAL de Tailwind. El molde de `CORTE_PASARELA`.
 */
export const ANCHO_MINIMO_SIDEBAR = 768;

/**
 * [C-DASH·13] La clave de `localStorage` que el arnés siembra para pedir el
 * régimen colapsado. Es la misma que lee el script bloqueante de
 * `sidebar-colapso.ts` antes de que exista React.
 *
 * **Es una SEGUNDA COPIA a propósito, y no se puede unir con la primera.** El
 * arnés carga este módulo desde Node por URL relativa, con el despojado de tipos
 * nativo: ahí un `import` de valor exige la extensión `.ts` en el especificador,
 * que es justo lo que `tsc` y Next rechazan. Uniendo se rompería el cargador;
 * repitiendo sin comparar se tendrían dos verdades. Así que se COMPARA contra
 * `SIDEBAR_COLAPSADO_STORAGE_KEY` en `escenarios.test.ts` — el mismo molde que
 * `ANCHO_MINIMO_PASARELA` contra `CORTE_PASARELA`.
 *
 * Si alguien cambia la clave en un sitio y no en el otro, el arnés sembraría una
 * preferencia que nadie lee: los casos `sidebar-colapsado` medirían el régimen
 * EXPANDIDO creyendo medir el otro, y saldrían verdes. Por eso la guarda.
 */
export const CLAVE_SIDEBAR_COLAPSADO = 'mx-sidebar-colapsado';

export interface RutaDerivada {
  /** Ruta URL con los params dinámicos aún en corchetes (p. ej. `/catalogo/[sku]`). */
  ruta: string;
  /** Nombre del único param dinámico, o null (multi-param no existe hoy en este árbol; si naciera, la derivación lo declara). */
  param: string | null;
  /** true si vive bajo el route group `(app)` (tiene shell, requiere sesión, recibe el eje de Selección). */
  enShell: boolean;
}

export interface Escenario {
  ruta: string;
  /** La variante de query string, si el caso mide una pantalla que solo existe con ella. */
  variante: string | null;
  url: string | null;
  motivoSinUrl: string | null;
  estado: EstadoEscenario;
  ancho: number;
  alto: number;
  enShell: boolean;
}

/** La ruta del control positivo plantado — la única con expectativas invertidas (debe SER denunciada). */
export const RUTA_CONTROL = '/control-layout';

/**
 * [2.0.1-A] Pantallas que solo existen detrás de un query string, y por tanto
 * **nunca se habían medido**: la derivación visita cada ruta en su estado por
 * omisión, así que `/config` siempre aterrizaba en «Preferencias» y la Bandeja
 * de pendientes —con sus tarjetas derivadas, la más antigua desde el Bloque 6—
 * no la había visto el instrumento ni una vez. Es P17 sobre el propio universo
 * de escenarios: no basta con derivar las rutas si media aplicación vive en una
 * pestaña.
 *
 * Se declara aquí, a mano y con nombre, porque una variante no es derivable del
 * árbol de archivos: es conocimiento de producto. Lo que sí queda vigilado es
 * que cada variante declarada produzca su caso.
 */
export const VARIANTES_QUERY: Record<string, string[]> = {
  '/config': ['tab=pendientes'],
};

/**
 * `src/app/(app)/catalogo/[sku]/page.tsx` → `/catalogo/[sku]`.
 * Acepta separadores de Windows o POSIX. Devuelve null si el archivo no
 * es un `page.tsx` bajo `src/app/` (el llamador decide qué hacer con eso;
 * aquí no se filtra en silencio).
 */
export function rutaDesdeArchivo(archivo: string): RutaDerivada | null {
  const normalizado = archivo.replace(/\\/g, '/');
  const m = normalizado.match(/(?:^|\/)src\/app\/(.*)page\.tsx$/);
  if (!m) return null;
  const segmentos = m[1].split('/').filter((s) => s.length > 0);
  const grupos = segmentos.filter((s) => s.startsWith('(') && s.endsWith(')'));
  const visibles = segmentos.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  const params = visibles.filter((s) => s.startsWith('[') && s.endsWith(']'));
  return {
    ruta: '/' + visibles.join('/'),
    param: params.length === 1 ? params[0].slice(1, -1) : null,
    enShell: grupos.includes('(app)'),
  };
}

/**
 * Expande rutas × estados × anchos. `resueltos` trae el valor real del
 * param dinámico de cada RUTA PLANTILLA (obtenido por el arnés contra
 * las APIs del propio portal, con la sesión). Se llavea por RUTA y no
 * por nombre de param a propósito: `/snapshots/[id]` y `/proyectos/[id]`
 * comparten el nombre `id` y son identidades DISTINTAS — llavear por
 * nombre las colisionaría en silencio. Un param sin resolver NO
 * desaparece: produce escenarios con `url: null` y su motivo — cero y
 * no-medido son valores distintos, y el veredicto los trata como SIN
 * MEDIR (exit 2).
 */
export function derivarEscenarios(
  rutas: RutaDerivada[],
  resueltos: Record<string, string | null>,
  /**
   * Motivo ESPECÍFICO por ruta cuando su param no se resolvió. Existe porque el
   * texto genérico de abajo cubría dos cosas que no se parecen en nada: «la API
   * contestó 200 con lista vacía» y «la API no contestó». Los SIN MEDIR de
   * aquella corrida eran lo primero —una sesión sin permiso para ver
   * ningún proyecto— y el reporte no podía saberlo desde el log.
   */
  motivos: Record<string, string> = {},
  /** Las rutas con pasarela. Parametro para poder PROBAR la derivacion sin declarar una ruta real. */
  conPasarela: string[] = RUTAS_CON_PASARELA,
): Escenario[] {
  const escenarios: Escenario[] = [];
  for (const r of rutas) {
    let url: string | null = r.ruta;
    let motivo: string | null = null;
    if (r.param !== null) {
      const valor = resueltos[r.ruta] ?? null;
      if (valor === null) {
        url = null;
        motivo = motivos[r.ruta] ?? `param [${r.param}] sin resolver contra las APIs del portal`;
      } else {
        url = r.ruta.replace(`[${r.param}]`, encodeURIComponent(valor));
      }
    } else if (r.ruta.includes('[')) {
      url = null;
      motivo = 'ruta con más de un param dinámico — la derivación no la cubre todavía (declarado, no silenciado)';
    }
    const estados: EstadoEscenario[] = r.enShell ? ['base', 'seleccion-contraida', 'seleccion-abierta'] : ['base'];
    // El cuarto estado SOLO donde hay carril: en una ruta sin pasarela el caso
    // no puede medir nada, y un verde ahí sería un verde sobre una aserción sin
    // sujeto. Ver `RUTAS_CON_PASARELA`.
    if (conPasarela.includes(r.ruta)) estados.push('pasarela-avanzada');
    // [C-DASH·13] El otro régimen del shell. Solo donde hay shell —fuera de
    // `(app)` no hay `<aside>` que colapsar— y, abajo, solo donde el `<aside>`
    // existe: ver `ANCHO_MINIMO_SIDEBAR`.
    if (r.enShell) estados.push('sidebar-colapsado');
    // La ruta en su estado por omisión, más una pasada por cada variante
    // declarada (ver VARIANTES_QUERY): sin esto, media aplicación que vive
    // detrás de una pestaña no se mide nunca.
    const variantes: Array<string | null> = [null, ...(VARIANTES_QUERY[r.ruta] ?? [])];
    for (const variante of variantes) {
      for (const estado of estados) {
        for (const a of ANCHOS) {
          // Bajo el corte no hay carril: la pantalla sirve la lista vertical, así
          // que el caso no tendría sujeto y saldría SIN MEDIR en cada corrida.
          if (estado === 'pasarela-avanzada' && a.ancho < ANCHO_MINIMO_PASARELA) continue;
          // Y bajo el corte del sidebar no hay `<aside>`: colapsarlo no cambia
          // nada y el caso saldría verde sin sujeto. Medido: 0 px en los dos
          // regímenes a 390 y a 640.
          if (estado === 'sidebar-colapsado' && a.ancho < ANCHO_MINIMO_SIDEBAR) continue;
          escenarios.push({
            ruta: variante === null ? r.ruta : `${r.ruta}?${variante}`,
            variante,
            url: url === null ? null : variante === null ? url : `${url}?${variante}`,
            motivoSinUrl: motivo,
            estado,
            ancho: a.ancho,
            alto: a.alto,
            enShell: r.enShell,
          });
        }
      }
    }
  }
  return escenarios;
}
