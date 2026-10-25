// ============================================================
// [2.0.1-A] O0 · escenarios.test.ts — la derivación archivo→ruta y la
// expansión, que son las dos cosas que pueden dejar al gate ciego a una
// pantalla sin que nadie lo note (P17 aplicado al propio universo).
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../../tailwind.config';
import { ANCHOS, ANCHO_MINIMO_PASARELA, ANCHO_MINIMO_SIDEBAR, CLAVE_SIDEBAR_COLAPSADO, derivarEscenarios, rutaDesdeArchivo, type RutaDerivada } from './escenarios';
import { SIDEBAR_COLAPSADO_STORAGE_KEY } from '@/components/layout/sidebar-colapso';
import { CORTE_PASARELA } from '@/components/proyectos/use-es-ancho';

describe('[2.0.1-A] rutaDesdeArchivo', () => {
  it('quita los route groups y conserva el resto: (app)/catalogo/[sku]/page.tsx → /catalogo/[sku]', () => {
    expect(rutaDesdeArchivo('src/app/(app)/catalogo/[sku]/page.tsx')).toEqual({
      ruta: '/catalogo/[sku]',
      param: 'sku',
      enShell: true,
    });
  });

  it('la raíz del grupo (app) es "/" y está en el shell', () => {
    expect(rutaDesdeArchivo('src/app/(app)/page.tsx')).toEqual({ ruta: '/', param: null, enShell: true });
  });

  it('una página fuera de (app) no está en el shell', () => {
    expect(rutaDesdeArchivo('src/app/login/page.tsx')).toEqual({ ruta: '/login', param: null, enShell: false });
  });

  it('acepta separadores de Windows (los produce el glob del arnés en este repo)', () => {
    expect(rutaDesdeArchivo('src\\app\\(app)\\proyectos\\[id]\\page.tsx')).toEqual({
      ruta: '/proyectos/[id]',
      param: 'id',
      enShell: true,
    });
  });

  it('un archivo que no es page.tsx bajo src/app devuelve null (el llamador decide, aquí no se filtra en silencio)', () => {
    expect(rutaDesdeArchivo('src/app/(app)/layout.tsx')).toBeNull();
    expect(rutaDesdeArchivo('src/components/x/page.tsx')).toBeNull();
  });
});

describe('[2.0.1-A] derivarEscenarios', () => {
  // [C-DASH·13] Los anchos donde el `<aside>` existe, y por tanto donde nace el
  // estado `sidebar-colapsado`. Se DERIVA de la escalera en vez de escribirse:
  // un `4` a mano quedaría viejo el día que `ANCHOS` gane un ancho.
  const conSidebar = ANCHOS.filter((a) => a.ancho >= ANCHO_MINIMO_SIDEBAR).length;
  const rutas = [
    { ruta: '/', param: null, enShell: true },
    { ruta: '/login', param: null, enShell: false },
    { ruta: '/catalogo/[sku]', param: 'sku', enShell: true },
  ];

  it('shell → 3 estados × 4 anchos; fuera del shell → solo base × 4', () => {
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': 'ABC-1' });
    // [C-DASH·13] Los 3 estados en TODOS los anchos, más `sidebar-colapsado` solo
    // en los anchos donde hay `<aside>` que colapsar.
    expect(e.filter((x) => x.ruta === '/')).toHaveLength(3 * ANCHOS.length + conSidebar);
    expect(e.filter((x) => x.ruta === '/login')).toHaveLength(ANCHOS.length);
    expect(e.filter((x) => x.ruta === '/login').every((x) => x.estado === 'base')).toBe(true);
  });

  it('el estado de la píldora CONTRAÍDA existe en el shell — es donde vivía H4', () => {
    // Sin él, la píldora contraída no se mide NUNCA (el otro estado la
    // despliega) y el arreglo del saludo sería infalsificable.
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': 'ABC-1' });
    const contraidos = e.filter((x) => x.estado === 'seleccion-contraida');
    expect(contraidos).toHaveLength(2 * ANCHOS.length); // las 2 rutas del shell
    expect(contraidos.every((x) => x.enShell)).toBe(true);
  });

  it('param resuelto (llaveado por RUTA, no por nombre — dos [id] distintos no pueden colisionar): sustituye y CODIFICA', () => {
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': 'DN-HN73 BOTTLE TAG 58KHZ' });
    const caso = e.find((x) => x.ruta === '/catalogo/[sku]');
    expect(caso?.url).toBe('/catalogo/DN-HN73%20BOTTLE%20TAG%2058KHZ');
    expect(caso?.motivoSinUrl).toBeNull();
  });

  it('param SIN resolver: los casos NO desaparecen — url null con motivo (cero y no-medido son distintos)', () => {
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': null });
    const casos = e.filter((x) => x.ruta === '/catalogo/[sku]');
    expect(casos).toHaveLength(3 * ANCHOS.length + conSidebar); // los 3 estados del shell + el eje del sidebar
    expect(casos.every((x) => x.url === null)).toBe(true);
    expect(casos[0].motivoSinUrl).toContain('[sku] sin resolver');
  });

  it('[2.0.1-A] una ruta con VARIANTE declarada produce sus casos extra, con la query en la URL', () => {
    // `/config` en su estado por omisión aterriza en Preferencias: la Bandeja
    // —y sus tarjetas derivadas— no la había medido el instrumento nunca.
    const conConfig = [...rutas, { ruta: '/config', param: null, enShell: true }];
    const e = derivarEscenarios(conConfig, { '/catalogo/[sku]': 'ABC-1' });
    const base = e.filter((x) => x.ruta === '/config');
    const variante = e.filter((x) => x.ruta === '/config?tab=pendientes');
    expect(base).toHaveLength(3 * ANCHOS.length + conSidebar);
    expect(variante).toHaveLength(3 * ANCHOS.length + conSidebar);
    expect(variante.every((x) => x.url === '/config?tab=pendientes')).toBe(true);
    expect(variante.every((x) => x.variante === 'tab=pendientes')).toBe(true);
  });

  it('[2.0.1-A] una ruta SIN variante declarada no gana casos: la lista es explícita, no un comodín', () => {
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': 'ABC-1' });
    expect(e.every((x) => x.variante === null)).toBe(true);
  });

  it('todo escenario lleva ancho Y alto declarados (el aplastamiento de A2 depende del alto)', () => {
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': 'X' });
    expect(e.every((x) => x.ancho > 0 && x.alto > 0)).toBe(true);
  });
});

// ============================================================
// [2.0.1-B · S · AB-5] El cuarto estado: la pasarela desplazada.
// ============================================================
describe('[2.0.1-B] `pasarela-avanzada` solo nace donde hay pasarela declarada', () => {
  const conSidebar = ANCHOS.filter((a) => a.ancho >= ANCHO_MINIMO_SIDEBAR).length;
  const rutas: RutaDerivada[] = [
    { ruta: '/proyectos', param: null, enShell: true },
    { ruta: '/catalogo', param: null, enShell: true },
  ];

  it('sin declarar ninguna pasarela, el estado NO existe — no sale verde sobre nada', () => {
    // El punto de AB-5: un cuarto estado universal produciría, en las rutas sin
    // carril, un caso que no puede medir nada y que saldría VERDE. Aquí no nace.
    const e = derivarEscenarios(rutas, {}, {}, []);
    expect(e.some((x) => x.estado === 'pasarela-avanzada')).toBe(false);
    expect(e).toHaveLength(2 * (3 * ANCHOS.length + conSidebar)); // las 2 rutas del shell, con su eje de sidebar
  });

  it('declarada una ruta, el estado nace SOLO en ella y SOLO de 768 para arriba', () => {
    // ────────────────────────────────────────────────────────────
    // [S-1 · corrida 1] LA SEGUNDA MITAD DE ESTA PRUEBA ES NUEVA, y la escribió
    // una corrida real. Decía «y en todos los anchos», y eso producía tres casos
    // que NO PUEDEN medirse nunca —390, 640, 768(*)— porque bajo el corte la
    // pantalla sirve la lista vertical por decisión de producto. Resultado: EXIT=2
    // permanente. Un gate que no puede dar veredicto no es más estricto: es un
    // gate roto.
    //
    // (*) 768 fallaba por otra causa —una carrera con el fetch, arreglada en el
    // arnés—, y confundir las dos habría «arreglado» la de ancho dejando viva la
    // de tiempo. Por eso se midieron por separado antes de tocar nada.
    const e = derivarEscenarios(rutas, {}, {}, ['/proyectos']);
    const avanzados = e.filter((x) => x.estado === 'pasarela-avanzada');
    const anchosConCarril = ANCHOS.filter((a) => a.ancho >= ANCHO_MINIMO_PASARELA);
    expect(avanzados.map((x) => x.ruta)).toEqual(Array(anchosConCarril.length).fill('/proyectos'));
    expect(avanzados.map((x) => x.ancho)).toEqual(anchosConCarril.map((a) => a.ancho));
    // Y la otra ruta del shell no gana ningún caso.
    expect(e.filter((x) => x.ruta === '/catalogo')).toHaveLength(3 * ANCHOS.length + conSidebar);
  });

  // ────────────────────────────────────────────────────────────
  // [C-DASH·13] EL EJE DEL SIDEBAR, que el gate no enumeraba.
  //
  // El estado del sidebar es un eje DISCRETO del layout con exactamente dos
  // valores —`--mx-sidebar-w` vale `0px` colapsado y no existe expandido, así
  // que el `<aside>` cae a su literal de 230 px— persistido en `localStorage`
  // (`mx-sidebar-colapsado`). El gate medía uno de los dos y absolvía los dos.
  //
  // MEDIDO el 15-sep en los siete viewports, lo que mueve:
  //   768 → contenido 489 px expandido vs 719 colapsado (+47 %)
  //   1024 → 632 vs 862   ·   1280 → 888 vs 1118   ·   1536 → 1144 vs 1298
  //
  // Es P17 sobre un eje discreto — el catálogo ya lo tenía para el eje continuo
  // de anchos («medir las orillas no es medir la banda»), y aquí la falla es
  // anterior: **el eje entero no se enumeraba.**
  it('[C-DASH·13] `sidebar-colapsado` nace SOLO en el shell y SOLO donde el sidebar existe', () => {
    const e = derivarEscenarios(rutas, { '/catalogo/[sku]': 'ABC-1' });
    const colapsados = e.filter((x) => x.estado === 'sidebar-colapsado');
    const anchosConSidebar = ANCHOS.filter((a) => a.ancho >= ANCHO_MINIMO_SIDEBAR);

    // Las DOS rutas del shell, y solo en los anchos donde hay sidebar.
    expect(colapsados).toHaveLength(2 * anchosConSidebar.length);
    expect(colapsados.every((x) => x.enShell)).toBe(true);
    expect(colapsados.every((x) => x.ancho >= ANCHO_MINIMO_SIDEBAR)).toBe(true);

    // Y fuera del shell no nace: `/login` no monta `<aside>`.
    expect(e.filter((x) => x.ruta === '/login').every((x) => x.estado === 'base')).toBe(true);
  });

  // Por debajo de `md` el `<aside>` es `hidden` (`app-shell.tsx`), así que ahí
  // colapsarlo no cambia NADA: el caso no tendría sujeto y saldría verde en cada
  // corrida. Es la misma regla que `pasarela-avanzada` — el estado no nace donde
  // no hay sujeto— y está MEDIDA: a 390 y a 640 el `<aside>` mide 0 px en los DOS
  // regímenes.
  it('[C-DASH·13] control positivo · la escalera atraviesa el corte del sidebar', () => {
    // Sin esto la prueba de arriba sería vacua de dos maneras opuestas: con todos
    // los anchos por encima, el filtro no filtraría nada; con todos por debajo,
    // no nacería ningún caso. Las dos pasarían sin decir nada.
    expect(ANCHOS.some((a) => a.ancho < ANCHO_MINIMO_SIDEBAR), 'ningún ancho bajo el corte del sidebar').toBe(true);
    expect(ANCHOS.some((a) => a.ancho >= ANCHO_MINIMO_SIDEBAR), 'ningún ancho sobre el corte del sidebar').toBe(true);
  });

  // El molde de `CORTE_PASARELA`: dos copias que no se pueden unir, comparadas.
  // El corte del sidebar vive en una CLASE de Tailwind (`md:block` sobre el
  // `<aside>` de `app-shell.tsx`) y este módulo lo carga el arnés desde Node, así
  // que no se puede importar. Se lee el archivo y se resuelve el prefijo contra
  // la config REAL de Tailwind — no contra los defaults de memoria.
  it('[C-DASH·13] el corte del arnés ES el de la pantalla — leído de app-shell y de la config', () => {
    const fuente = readFileSync(join(process.cwd(), 'src', 'components', 'layout', 'app-shell.tsx'), 'utf8');
    const aside = fuente.match(/<aside[\s\S]{0,600}?className="([^"]+)"/);
    expect(aside, 'el <aside> de app-shell cambió de forma y esta guarda dejó de ver su clase').not.toBeNull();
    const prefijo = (aside?.[1] ?? '').match(/\b([a-z0-9]+):block\b/);
    expect(prefijo, `el <aside> ya no declara un breakpoint para aparecer: «${aside?.[1]}»`).not.toBeNull();

    const screens = resolveConfig(tailwindConfig).theme?.screens as Record<string, string>;
    const px = screens?.[prefijo?.[1] ?? ''];
    expect(px, `el breakpoint «${prefijo?.[1]}» no existe en la config de Tailwind`).toBeTruthy();
    expect(Number(String(px).replace('px', ''))).toBe(ANCHO_MINIMO_SIDEBAR);
  });

  // La otra copia que no se puede unir: el arnés carga este módulo desde Node con
  // el despojado de tipos nativo, donde un `import` de valor exige la extensión
  // `.ts` que `tsc` y Next rechazan. Si la clave se cambiara en un sitio y no en
  // el otro, el arnés sembraría una preferencia que nadie lee y los casos
  // `sidebar-colapsado` medirían el régimen EXPANDIDO creyendo medir el otro —
  // verdes, sobre el régimen que ya estaba cubierto.
  it('[C-DASH·13] la clave que siembra el arnés ES la que lee el shell', () => {
    expect(CLAVE_SIDEBAR_COLAPSADO).toBe(SIDEBAR_COLAPSADO_STORAGE_KEY);
  });

  it('control positivo · la escalera SÍ tiene anchos a los dos lados del corte', () => {
    // Sin esto, la prueba de arriba sería vacua de dos maneras opuestas: con
    // todos los anchos por encima del corte, el filtro no filtraría nada y
    // «sólo de 768 para arriba» pasaría sin decir nada; con todos por debajo,
    // no nacería ningún caso y también pasaría. Se exige que la escalera
    // atraviese el corte de verdad (P17 sobre el conjunto de evaluación).
    expect(ANCHOS.some((a) => a.ancho < ANCHO_MINIMO_PASARELA), 'la escalera no tiene ningún ancho bajo el corte').toBe(true);
    expect(ANCHOS.some((a) => a.ancho >= ANCHO_MINIMO_PASARELA), 'la escalera no tiene ningún ancho sobre el corte').toBe(true);
  });

  it('el corte del arnés ES el de la pantalla — dos copias que no se pueden unir, comparadas', () => {
    // `use-es-ancho.ts` es `"use client"` e importa React; este módulo lo carga
    // el arnés desde Node. No se pueden unir, así que se comparan — el molde de
    // `carril.ts` contra `globals.css`. Si alguien mueve el breakpoint de la
    // pantalla y no el del arnés, el gate declararía pasarela donde ya no la hay
    // y saldría SIN MEDIR sin que nadie supiera por qué.
    const m = CORTE_PASARELA.match(/min-width:\s*(\d+)px/);
    expect(m, `CORTE_PASARELA cambió de forma: «${CORTE_PASARELA}»`).not.toBeNull();
    expect(Number(m?.[1])).toBe(ANCHO_MINIMO_PASARELA);
  });

  it('el ancho donde vive la queja (1704) está en la escalera', () => {
    // Sin él el instrumento cubre todos los anchos MENOS aquel en el que se
    // midió el alto vacío — y `auto-fill` empeora hacia arriba.
    expect(ANCHOS.map((a) => a.ancho)).toContain(1704);
    expect(ANCHOS.map((a) => a.ancho)).toEqual([...ANCHOS].map((a) => a.ancho).sort((x, y) => x - y));
  });
});
