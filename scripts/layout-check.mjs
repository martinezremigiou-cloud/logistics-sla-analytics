// ============================================================
// [2.0.1-A] O0 · layout-check.mjs — el arnés del instrumento de layout
// (deuda B11-1). Se corre A PROPÓSITO (`npm run layout-check`), no en CI
// ni en un gancho: la misma filosofía del pre-commit que corre solo tsc —
// un gate lento es un gate que alguien desactiva.
//
// QUÉ HACE: levanta el BUILD DE PRODUCCIÓN, abre las pantallas REALES
// (derivadas de src/app/**/page.tsx, no una lista a mano) en Chromium
// headless, en los SEIS anchos de `escenarios.ts` —los cuatro del encargo
// (390 · 768 · 1280 · 1536) más 640, la banda donde se escapó un defecto, y
// 1704, el viewport donde vive la queja de `/proyectos`— y en dos
// estados (base / Selección de 15 SKU —los MÁS LARGOS del catálogo— con
// el panel ABIERTO por un clic real), y le pregunta al motor de layout
// las aserciones mecánicas de `src/lib/layout-check/predicados.ts`.
//
// ESTE ARCHIVO ES ORQUESTACIÓN, NO LÓGICA: todo lo decidible sin
// navegador (derivación de rutas, expansión de escenarios, veredicto)
// vive en src/lib/layout-check/*.ts bajo tsc y vitest, y se importa aquí
// vía ts-loader (mismo mecanismo que ingesta-mensual.mjs). Un `.mjs` es
// la única capa que ninguno de los tres instrumentos vigila — cuanto más
// delgado, mejor.
//
// EL VEREDICTO ES `$?`, NUNCA LA ÚLTIMA LÍNEA:
//   0 · VERDE — todo medido, control plantado denunciado (cada marca por
//       SU aserción), 0 violaciones reales.
//   1 · ROJO — violaciones reales, con el instrumento sano.
//   2 · SIN VEREDICTO — no se pudo medir (puerto ocupado, build roja,
//       navegador ausente, credencial que no abre, panel que no abrió,
//       control no denunciado, derivación incompleta…). Cero y no-medido
//       son valores distintos.
//
// USO:
//   npm run layout-check                  (el gate completo)
//   npm run layout-check -- --sin-build   (reusa .next — SOLO iteración:
//                                          mide un build que puede no ser
//                                          el árbol actual)
//   npm run layout-check -- --solo-ruta=/catalogo
//                                         (corrida ACOTADA de diagnóstico:
//                                          agrega siempre /control-layout,
//                                          puede salir ROJO, jamás VERDE)
//
// ENV:
//   PARCHE_ADMIN_EMAIL / PARCHE_ADMIN_PASSWORD — la credencial de los
//     arneses (un administrador preexistente). SOLO del
//     entorno del proceso, jamás de .env.local, jamás se imprimen.
//     La guarda comprueba la CAPACIDAD, no la presencia (P6): abre sesión
//     de verdad por el SDK antes de dar nada por bueno — y además
//     comprueba también el ROL, porque «abre» nunca fue la pregunta
//     completa (ver la guarda en `main`).
//     Y EL REVERSO DE ESO: **la cuenta
//     que nombra PARCHE_ADMIN_EMAIL NO SE DA DE BAJA.** Es la única con la
//     que este arnés abre sesión, y el portal sabe suspender pero no crear
//     ni eliminar administradores: retirarla no se deshace desde ningún
//     sitio del producto — el gate de layout no volvería a correr. Un
//     checkpoint de 2.0.1-A la puso en la misma línea que una cuenta de
//     humo bajo un «baja definitiva de las dos», y se atajó midiendo
//     antes de ejecutar. Desde entonces la defensa es código y no un
//     recordatorio: cualquier script de baja de cuentas debe rechazarla, derivándola de
//     esta misma variable, y fallar CERRADO si la variable no está.
//
//     ESTE ARNÉS NO CREA CUENTAS, a propósito: exige una preexistente. Un
//     proceso que da de alta administradores y no puede darlos de baja
//     deja residuo permanente — y este repo ya tiene un admin fantasma por
//     esa vía. Lo vigila `arnes-cuentas.test.ts`, que es un trinquete.
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — proceso o
//     .env.local (claves públicas, mismo criterio que el resto).
//   LAYOUT_CHECK_PORT — puerto propio (default 3210). El 3000 además debe
//     estar LIBRE: este arnés compila, y un build sobre un dev server vivo
//     deja el puerto escuchando y las rutas en 500 (P1, detector #5).
//
// CONVIVENCIA: no corre en paralelo con los arneses en vivo del repo
// (smoke-usuarios, rls-negativas…) — regla general de los arneses.
//
// LÍMITES DECLARADOS (y dónde está su prueba):
//   · Una sola sesión (admin). Los defectos que motivaron el instrumento
//     son del shell, independientes del rol (escenarios.ts, O0-6).
//   · A1 no asevera overflow:visible (contenido que se pinta ENCIMA de un
//     vecino sin truncarse); los casos que motivaron B11-1 son hidden
//     (riel) y altura (nav), y ambos están cubiertos y re-plantados en el
//     DoD del bloque.
//   · El asentamiento por caso es load + 350 ms; una fuente que tarde más
//     puede medir anchos de fallback. Si un caso oscila, se verá como
//     diferencia entre corridas, no como verde falso silencioso.
//
//     [S-1] Y ESE LÍMITE YA NO CUBRE TODO LO QUE CUBRÍA. Una espera fija
//     tampoco alcanzaba para lo que depende de un FETCH, no de una fuente:
//     `/proyectos` pinta su esqueleto hasta que resuelve `/api/proyectos`, y
//     a los 350 ms el control de la pasarela valía 0 incluso a 1280 —medido
//     con un sondeo que imita a este arnés—. Ese caso ya no espera un número
//     de milisegundos: espera al TESTIGO, con tope. Lo que sigue en pie es el
//     límite de la TIPOGRAFÍA, que es de lo que hablaba esta línea.
//
// LO QUE SÍ SE PUEDE CITAR, y hasta S-1 no se podía:
//   · **EL RECUENTO DE CASOS ES DERIVADO Y REPRODUCIBLE**, así que una corrida
//     se puede comparar contra otra y no sólo juzgar en absoluto. Los 268 de
//     hoy se explican enteros: 205 de la escalera anterior × 6/5 anchos = 246,
//     + `/control-estados` que la derivación saca del árbol = 264, + los 4
//     casos de `pasarela-avanzada` (768 · 1280 · 1536 · 1704) = 268.
//     Ninguna cifra queda sin origen, y ése era el requisito: mientras un caso
//     podía salir SIN MEDIR según cayera el reloj, «medidos» variaba entre
//     corridas y comparar dos totales no significaba nada.
//   · El corolario, que es lo que hay que vigilar: **si el total cambia sin que
//     nadie haya tocado el árbol, la escalera o la banda de una pasarela, eso
//     es el hallazgo** — no un detalle del reporte.
// ============================================================

const [majorNode, minorNode] = process.versions.node.split('.').map(Number);
if (!(majorNode > 23 || (majorNode === 23 && minorNode >= 6))) {
  console.error(`[ERROR] layout-check requiere Node >= 23.6 (type-stripping nativo). Versión actual: ${process.versions.node}`);
  process.exit(2); // sin handles abiertos todavía: process.exit es seguro aquí y solo aquí
}

const { register } = await import('node:module');
register(new URL('./ts-loader.mjs', import.meta.url).href);

const { readFileSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const net = await import('node:net');
const { spawn, spawnSync } = await import('node:child_process');
const { createClient } = await import('@supabase/supabase-js');

const BASE_LIB = new URL('../src/lib/layout-check/', import.meta.url);
const { medirPagina } = await import(new URL('predicados.ts', BASE_LIB).href);
const { RUTA_CONTROL, CLAVE_SIDEBAR_COLAPSADO, derivarEscenarios, rutaDesdeArchivo } = await import(new URL('escenarios.ts', BASE_LIB).href);
const { veredicto } = await import(new URL('veredicto.ts', BASE_LIB).href);
const { decidirPasarela, ATRIBUTO_AVANZAR } = await import(new URL('pasarela.ts', BASE_LIB).href);
// [C-DASH-13] La redaccion vive en TS y no aqui por el mismo motivo que
// `decidirPasarela`: un `.mjs` es la unica capa que ninguno de los tres
// instrumentos vigila, y una contramedida de SEGURIDAD que no se puede poner en
// rojo no es una contramedida. Su control positivo son mensajes REALES de
// Playwright con credenciales dentro (`redaccion.test.ts`).
const { sinUrls } = await import(new URL('redaccion.ts', BASE_LIB).href);
const { claveDeSeleccion } = await import(new URL('../src/lib/seleccion.ts', import.meta.url).href);

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DIR_APP = join(RAIZ, 'src', 'app');
const PUERTO = Number(process.env.LAYOUT_CHECK_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PUERTO}`;
const N_SEMBRADOS = 15;

// El contrato del control positivo: qué marcas se plantaron y qué aserción
// debe denunciar a cada una. Espejo de src/app/(app)/control-layout/page.tsx.
const CONFIG_MEDICION = { umbralLegibilidadPx: 48, umbralAltoNavPx: 8, solapeMinPx: 4 };
const PLANTADOS_ESPERADOS = [
  { marca: 'a1', tipo: 'a1_truncado_ilegible' },
  { marca: 'a2', tipo: 'a2_nav_aplastado' },
  { marca: 'a3', tipo: 'a3_solape_flotantes' },
  { marca: 'a4', tipo: 'a4_control_tapado' },
  // [C-DASH-13] El unico con contrato de DOS direcciones: denuncia con el
  // sidebar EXPANDIDO y CALLA colapsado. El plantado lleva el eje dentro —mide
  // `460px` menos el ancho real del `<aside>`— y el veredicto exige ademas que
  // los DOS regimenes se hayan medido de verdad en la corrida.
  { marca: 'a5', tipo: 'a1_recortado_por_ancestro', calladoEnEstado: 'sidebar-colapsado' },
];
// La ÚNICA lista de nombres de solape permitido registrados. Un
// data-solape-permitido nuevo en un componente que no se registre aquí sale
// como violación — así el conjunto no crece en silencio.
const NOMBRES_SOLAPE_CONOCIDOS = ['control-permitido'];
const SOLAPE_DEL_CONTROL = 'control-permitido';
// Contrato INVERTIDO: el control lo planta para que NO se denuncie. Si aparece,
// el instrumento mide de más → SIN VEREDICTO. Ver el comentario de
// `plantadosSilenciosos` en veredicto.ts y el par «Fantasma» de la página de control.
// `a5-fantasma` asoma A MEDIAS de su contenedor: sigue alcanzable, asi que A1c
// NO debe denunciarlo. Es el control que demuestra que A1c SEPARA (P20) en vez
// de acusar a todo lo que roza un borde.
const PLANTADOS_SILENCIOSOS = ['a3-fantasma', 'a5-fantasma'];

function leerEnvConFallback(nombre) {
  if (process.env[nombre]) return process.env[nombre];
  try {
    const linea = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${nombre}=`));
    const valor = linea?.slice(`${nombre}=`.length).trim().replace(/^"(.*)"$/, '$1');
    if (valor) return valor;
  } catch {
    // sin .env.local: cae al error de abajo
  }
  console.error(`[SIN VEREDICTO] ${nombre} no encontrado (ni en el entorno ni en .env.local).`);
  return null;
}

/** SOLO del proceso, jamás de .env.local, jamás se imprime (regla #8). */
function leerCredencial(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`[SIN VEREDICTO] ${nombre} no está en el entorno del proceso.`);
    console.error('Uso: PARCHE_ADMIN_EMAIL=... PARCHE_ADMIN_PASSWORD=... npm run layout-check');
  }
  return valor ?? null;
}

function puertoLibre(puerto) {
  return new Promise((resolver) => {
    const sonda = net.createServer();
    sonda.once('error', () => resolver(false));
    sonda.listen(puerto, '127.0.0.1', () => sonda.close(() => resolver(true)));
  });
}

function archivosPageTsx(dir) {
  const encontrados = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) encontrados.push(...archivosPageTsx(ruta));
    else if (entrada.name === 'page.tsx') encontrados.push(ruta);
  }
  return encontrados;
}

async function esperarServer(urlSalud, intentos = 120) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(urlSalud, { redirect: 'manual' });
      if (r.status === 200) return true;
    } catch {
      // aún no levanta
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function matarArbol(pid) {
  // La /T es la parte crítica (P1): `next start` vive como nieto del shell.
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ya murió
      }
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const sinBuild = argv.includes('--sin-build');
  const soloRutaArg = argv.find((a) => a.startsWith('--solo-ruta='));
  const soloRuta = soloRutaArg ? soloRutaArg.slice('--solo-ruta='.length) : null;

  const email = leerCredencial('PARCHE_ADMIN_EMAIL');
  const password = leerCredencial('PARCHE_ADMIN_PASSWORD');
  const supaUrl = leerEnvConFallback('NEXT_PUBLIC_SUPABASE_URL');
  const supaAnon = leerEnvConFallback('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!email || !password || !supaUrl || !supaAnon) return 2;

  // ---------- puertos (P1): el propio libre, y NINGÚN server en :3000 ----------
  if (!(await puertoLibre(PUERTO))) {
    console.error(`[SIN VEREDICTO] el puerto ${PUERTO} está ocupado. layout-check levanta su propio server; baja el que esté ahí o usa LAYOUT_CHECK_PORT.`);
    return 2;
  }

  // La guarda de :3000 vigila la precondición de UN PASO CONCRETO —el `next build`—
  // y su propio mensaje lo dice: «este arnés COMPILA». Con `--sin-build` NO compila,
  // así que estaba negándose a medir para proteger un paso que ya no se da.
  //
  // `GUARDA-DE-UN-PASO-QUE-NO-SE-DA` (ver docs/engineering/failure-patterns.md). No es P19 —la
  // guarda vacua que no puede morder—: es su reverso, muerde a un sujeto que ya no
  // existe. Engaña porque el mensaje es verdadero EN EL CASO GENERAL, así que nadie
  // lo discute. Costó que el cuarto instrumento no corriera en todo el bloque DASH-E.
  if (!sinBuild && !(await puertoLibre(3000))) {
    console.error('[SIN VEREDICTO] hay un server escuchando en :3000. Este arnés COMPILA, y un `next build` sobre un dev server vivo deja el puerto escuchando y las rutas en 500 (P1, detector #5). Bájalo por árbol, o usa `--sin-build` si solo quieres iterar sobre el .next existente.');
    return 2;
  }

  // Y la puerta que la línea de arriba ABRE, cerrada en el mismo sitio: saltarse el
  // build no elimina el riesgo de P1, lo MUEVE de escribir a LEER. `next start` sirve
  // `NEXT_DIST_DIR ?? '.next'`, y `.next` es la carpeta COMPARTIDA: servirla mientras
  // un `next dev` ajeno la reescribe es la misma corrupción por la otra puerta.
  // Con una carpeta propia por frente (`NEXT_DIST_DIR=.next-dash`) no hay solape y no
  // se pregunta nada.
  const distDir = process.env.NEXT_DIST_DIR ?? '.next';
  if (sinBuild && distDir === '.next' && !(await puertoLibre(3000))) {
    console.error(`[SIN VEREDICTO] --sin-build sobre la carpeta COMPARTIDA .next con un server vivo en :3000: se mediría un build que otro frente puede estar reescribiendo (P1 por la puerta de lectura). Exporta NEXT_DIST_DIR=.next-<tu frente> y reintenta.`);
    return 2;
  }

  // ---------- credencial: capacidad, no presencia (P6) ----------
  const sdk = createClient(supaUrl, supaAnon, { auth: { persistSession: false, autoRefreshToken: false } });
  const acceso = await sdk.auth.signInWithPassword({ email, password });
  if (acceso.error || !acceso.data?.user?.id) {
    console.error(`[SIN VEREDICTO] la credencial de PARCHE_ADMIN_EMAIL no ABRE sesión (${acceso.error?.message ?? 'sin usuario'}). Que la variable exista no era la pregunta.`);
    return 2;
  }
  const uid = acceso.data.user.id;

  // ---------- ¿y QUIÉN abrió? (P6, la mitad que faltaba) ----------
  // Que la credencial ABRA era una pregunta; ésta es la otra, y sin ella el
  // instrumento no sabe QUÉ midió. El límite O0-6 de `escenarios.ts` DECLARA
  // que se navega con una sesión admin —el rol que ve todas las pantallas—
  // pero nunca lo comprobaba: escrito y no medido. Una corrida
  // completa salió con rol `visitante`, y de sus casos «sin violaciones»
  // 60 no eran siquiera la pantalla que el veredicto nombra: /proyectos y
  // /carga sirven una tarjeta de «sin permiso», /config sirve 2 pestañas en
  // vez de 5, y ?tab=pendientes cae de vuelta en «Preferencias» sin reescribir
  // la URL. Ni un número del log lo delataba.
  //
  // NO hace falta la llave de servicio, y que no haga falta es parte del
  // diseño: la policy `perfiles_select_own_or_admin` (0012_b7b_hardening.sql)
  // es `USING (id = auth.uid() OR is_admin())`, así que CUALQUIER sesión lee
  // su propia fila con la llave anon. Es la misma consulta que ya corre el
  // portal en `src/lib/api/perfil-rol.ts`.
  //
  // No es una guarda vacua (P19): puede ponerse roja, y se habría puesto roja
  // en esa corrida.
  const perfil = await sdk.from('perfiles').select('rol').eq('id', uid).maybeSingle();
  if (perfil.error) {
    console.error(
      `[SIN VEREDICTO] la sesión abrió pero no se pudo leer su rol (${perfil.error.message}). Sin saber QUIÉN mide, ningún 0 de esta corrida significa nada.`,
    );
    return 2;
  }
  if (perfil.data?.rol !== 'admin') {
    console.error(
      `[SIN VEREDICTO] la credencial abrió sesión con rol «${perfil.data?.rol ?? 'sin perfil'}», no «admin». El instrumento DECLARA medir con admin (escenarios.ts, O0-6), y con otro rol mide OTRAS pantallas: /proyectos y /carga devuelven una tarjeta de «sin permiso», /config sirve 2 pestañas en vez de 5, y /proyectos/[id] no resuelve. Un verde así sería sobre una aplicación distinta.`,
    );
    return 2;
  }
  await sdk.auth.signOut({ scope: 'local' });

  // ---------- build de producción ----------
  if (sinBuild) {
    console.error('[AVISO] --sin-build: se mide el .next existente, que puede NO ser el árbol actual (P25-A: la representación no es la cosa).');
  } else {
    process.stderr.write('· next build (producción)…\n');
    const build = spawnSync('npx', ['next', 'build'], { cwd: RAIZ, shell: true, encoding: 'utf8' });
    if (build.status !== 0) {
      console.error('[SIN VEREDICTO] `next build` salió distinto de 0 — no hay qué medir. Últimas líneas:');
      console.error(String(build.stdout ?? '').split('\n').slice(-15).join('\n'));
      console.error(String(build.stderr ?? '').split('\n').slice(-15).join('\n'));
      return 2;
    }
  }

  // ---------- derivación de escenarios (del árbol real, no de una lista) ----------
  const todosArchivos = archivosPageTsx(DIR_APP);
  let archivos = todosArchivos;
  if (soloRuta) {
    archivos = todosArchivos.filter((a) => {
      const r = rutaDesdeArchivo(a);
      return r !== null && (r.ruta === soloRuta || r.ruta === RUTA_CONTROL);
    });
    console.error(`[AVISO] corrida ACOTADA a ${soloRuta} (+ control). Sirve para diagnóstico; JAMÁS puede salir VERDE.`);
  }
  const rutas = archivos.map(rutaDesdeArchivo).filter((r) => r !== null);

  // ---------- server ----------
  let server = null;
  let browser = null;
  const salidaServer = [];
  try {
    process.stderr.write(`· next start -p ${PUERTO} (LAYOUT_CHECK=1)…\n`);
    server = spawn('npx', ['next', 'start', '-p', String(PUERTO)], {
      cwd: RAIZ,
      shell: true,
      env: { ...process.env, LAYOUT_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (d) => salidaServer.push(String(d)));
    server.stderr.on('data', (d) => salidaServer.push(String(d)));

    if (!(await esperarServer(`${BASE}/login`))) {
      console.error('[SIN VEREDICTO] el server no contestó 200 en /login en 60 s. Cola de salida:');
      console.error(salidaServer.join('').split('\n').slice(-15).join('\n'));
      return 2;
    }
    const humo = salidaServer.join('');
    if (/EPIPE|jest-worker|WorkerError/.test(humo)) {
      console.error('[SIN VEREDICTO] el server escucha pero su consola trae EPIPE/jest-worker — un socket abierto no es un server sano (P1).');
      return 2;
    }

    // ---------- navegador ----------
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
      browser = await chromium.launch();
    } catch (e) {
      console.error(`[SIN VEREDICTO] no se pudo lanzar Chromium (${sinUrls(String(e?.message ?? e), 120)}). ¿Falta el binario? npx playwright install chromium`);
      return 2;
    }

    // ---------- login por la página real ----------
    const ctxLogin = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pgLogin = await ctxLogin.newPage();
    try {
      await pgLogin.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 30000 });
      // ============================================================
      // [C-DASH-13] SE ESPERA A QUE EL HANDLER EXISTA, y esto es de seguridad.
      //
      // Un incidente documentado del proyecto (login enviado por GET) y, durante un tiempo,
      // este archivo se citaba como ejemplo de la buena practica. Era falso: aqui se
      // conducia el login con `waitUntil: 'load'`, que NO es hidratacion. Sin
      // `onSubmit` montado —`login-form.tsx:53` lo pone, y el `<form>` no declara
      // `method`— el navegador cae al comportamiento por omision y manda el
      // formulario por GET, con usuario y contrasena en el query string. Nadie los
      // imprime: los imprime el timeout.
      //
      // NO se espera un `waitForTimeout` ni la presencia del input: se pregunta si
      // el HANDLER esta montado, que es la cosa. React cuelga sus props del nodo
      // DOM al hidratar, asi que `onSubmit` sobre el `<form>` es la unica senal
      // que significa «un submit ya no cae al comportamiento por omision».
      //
      // Y su modo de fallo es el seguro: si React cambiara esa clave interna, esto
      // agota su tope, el login no ocurre y el veredicto es 2. Nunca un verde.
      // ============================================================
      await pgLogin.waitForFunction(
        () => {
          const form = document.querySelector('form');
          if (!form) return false;
          const clave = Object.keys(form).find((k) => k.startsWith('__reactProps$'));
          return !!clave && typeof form[clave]?.onSubmit === 'function';
        },
        { timeout: 30000 },
      );
      await pgLogin.fill('#login-email', email);
      await pgLogin.fill('#login-password', password);
      await pgLogin.getByRole('button', { name: 'Iniciar sesión' }).click();
      await pgLogin.waitForURL(`${BASE}/`, { timeout: 30000 });
    } catch (e) {
      console.error(`[SIN VEREDICTO] el login por la página real no llegó al dashboard (${sinUrls(String(e?.message ?? e), 160)}).`);
      return 2;
    }
    const storageState = await ctxLogin.storageState();
    await ctxLogin.close();

    // ---------- resolución de params + los 15 SKU más largos, contra las APIs del propio portal ----------
    const ctxApi = await browser.newContext({ storageState });
    // Devuelve un resultado DISCRIMINADO, no un `null` que sirve para dos cosas.
    // «La API no contestó» y «la API contestó una lista vacía» son diagnósticos
    // opuestos —uno es una avería, el otro un permiso— y con un solo `null` los
    // SIN MEDIR de una corrida se leyeron como «las rutas dinámicas fallan»
    // cuando lo que pasaba es que la sesión no podía ver ningún proyecto.
    const pedirJson = async (ruta) => {
      const r = await ctxApi.request.get(`${BASE}${ruta}`);
      if (r.status() !== 200) return { ok: false, estado: r.status(), json: null };
      return { ok: true, estado: 200, json: await r.json() };
    };
    const skus = [];
    for (let pagina = 1; pagina <= 10; pagina++) {
      const res = await pedirJson(`/api/inventory?pageSize=200&page=${pagina}`);
      const items = res.json?.items ?? [];
      for (const it of items) if (typeof it?.sku === 'string') skus.push(it.sku);
      if (items.length < 200) break;
    }
    const masLargos = [...skus].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, N_SEMBRADOS);
    const snapshots = await pedirJson('/api/snapshots');
    const proyectos = await pedirJson('/api/proyectos');
    const primerId = (res) => (res.ok && res.json?.items?.[0]?.id != null ? String(res.json.items[0].id) : null);
    const resueltos = {
      '/catalogo/[sku]': masLargos[0] ?? null,
      '/snapshots/[id]': primerId(snapshots),
      '/proyectos/[id]': primerId(proyectos),
    };
    /** POR QUÉ no se resolvió — lo que separa una avería de un permiso. */
    const porQueNo = (res, api) =>
      !res.ok
        ? `${api} no contestó 200 (HTTP ${res.estado}) — el instrumento no llegó ni a preguntar`
        : `${api} contestó 200 con lista VACÍA — no hay ninguna fila que esta sesión pueda ver; no es una avería de la ruta dinámica`;
    const motivosResolucion = {};
    if (resueltos['/snapshots/[id]'] === null) motivosResolucion['/snapshots/[id]'] = porQueNo(snapshots, '/api/snapshots');
    if (resueltos['/proyectos/[id]'] === null) motivosResolucion['/proyectos/[id]'] = porQueNo(proyectos, '/api/proyectos');
    if (resueltos['/catalogo/[sku]'] === null) motivosResolucion['/catalogo/[sku]'] = '/api/inventory no devolvió ningún SKU en 10 páginas';
    await ctxApi.close();

    const escenarios = derivarEscenarios(rutas, resueltos, motivosResolucion);

    // ---------- contextos: base y con Selección sembrada ----------
    const ctxBase = await browser.newContext({ storageState });
    const ctxSel = await browser.newContext({ storageState });
    // [C-DASH-13] EL OTRO REGIMEN DEL SHELL. El estado del sidebar es un eje
    // DISCRETO que el gate no enumeraba: `--mx-sidebar-w` vale `0px` colapsado y
    // no existe expandido, la preferencia se PERSISTE en localStorage, y la
    // columna de contenido cambia de forma notable entre los dos (medido en un
    // viewport de tablet). Se siembra con el MISMO mecanismo que la Seleccion
    // —`addInitScript`, antes de que exista React— porque el script bloqueante
    // de `sidebar-colapso.ts` lee la clave al cargar.
    const ctxColapsado = await browser.newContext({ storageState });
    await ctxColapsado.addInitScript(
      ([clave]) => {
        try {
          localStorage.setItem(clave, '1');
        } catch {
          // sin almacenamiento: la guarda de abajo lo vera expandido y el caso
          // saldra SIN MEDIR con su razon, nunca verde.
        }
      },
      [CLAVE_SIDEBAR_COLAPSADO],
    );
    const semilla = JSON.stringify({ items: masLargos.map((sku) => ({ sku, cantidad: 1 })) });
    await ctxSel.addInitScript(
      ([clave, valor]) => {
        try {
          localStorage.setItem(clave, valor);
        } catch {
          // sin almacenamiento: el caso saldrá SIN MEDIR al no poder abrir el panel
        }
      },
      [claveDeSeleccion(uid), semilla],
    );

    // ---------- medir, caso por caso ----------
    const resultados = [];
    let n = 0;
    for (const esc of escenarios) {
      n++;
      const etiqueta = `${esc.ruta} · ${esc.estado} · ${esc.ancho}×${esc.alto}`;
      process.stderr.write(`· [${n}/${escenarios.length}] ${etiqueta}\n`);
      const casoBase = { ruta: esc.ruta, url: esc.url, estado: esc.estado, ancho: esc.ancho, alto: esc.alto };
      if (esc.url === null) {
        resultados.push({ ...casoBase, resultado: 'SIN_MEDIR', motivoSinMedir: esc.motivoSinUrl ?? 'sin URL' });
        continue;
      }
      const conSeleccion = esc.estado === 'seleccion-abierta' || esc.estado === 'seleccion-contraida';
      if (conSeleccion && masLargos.length === 0) {
        resultados.push({ ...casoBase, resultado: 'SIN_MEDIR', motivoSinMedir: 'catálogo sin SKUs para sembrar la Selección' });
        continue;
      }
      const colapsado = esc.estado === 'sidebar-colapsado';
      const ctx = colapsado ? ctxColapsado : conSeleccion ? ctxSel : ctxBase;
      const page = await ctx.newPage();
      try {
        await page.setViewportSize({ width: esc.ancho, height: esc.alto });
        const resp = await page.goto(`${BASE}${esc.url}`, { waitUntil: 'load', timeout: 30000 });
        const status = resp?.status() ?? 0;
        if (status !== 200) {
          resultados.push({ ...casoBase, resultado: 'SIN_MEDIR', motivoSinMedir: `status ${status}` });
          continue;
        }
        // Se compara solo el PATH: la variante viaja en la query y una pestaña
        // puede reescribirla (`/config` hace `router.replace` con su propio
        // `?tab=`), lo que no es un redirect ni una pérdida de sesión.
        const rutaFinal = new URL(page.url()).pathname;
        const pathEsperado = esc.url.split('?')[0];
        if (rutaFinal !== pathEsperado) {
          resultados.push({ ...casoBase, resultado: 'SIN_MEDIR', motivoSinMedir: `redirigido a ${rutaFinal} (¿sesión?)` });
          continue;
        }
        await page.waitForTimeout(350);
        // ---------- [2.0.1-B · AB-5] la pasarela, DESPLAZADA ----------
        // Este estado solo nace en rutas que DECLARAN pasarela
        // (`RUTAS_CON_PASARELA` en escenarios.ts), así que llegar aquí y no
        // encontrarla no es «no aplica»: es una declaración falsa. Sale SIN
        // MEDIR con su razón, jamás verde — declarar una pasarela que no existe
        // tiene que doler.
        //
        // Se avanza con el propio control de la pasarela y no con un `scrollBy`
        // sintético: lo que hay que medir es el estado en el que queda la
        // pantalla cuando un usuario pulsa la flecha, no uno que el arnés
        // fabricó. Si el botón está deshabilitado en el extremo, tampoco hay
        // caso que medir y se dice.
        if (esc.estado === 'pasarela-avanzada') {
          // El arnés solo aporta los DOS HECHOS que únicamente él puede mirar;
          // quién los convierte en veredicto es `decidirPasarela`, que es pura
          // y tiene su control positivo en `pasarela.test.ts`. Esta rama vivía
          // aquí dentro y por eso no se podía ejercer: un `.mjs` es la única
          // capa que ninguno de los tres instrumentos vigila.
          //
          // ANTES DE PREGUNTAR, SE ESPERA — y esto NO es un parche de timing:
          // es que `waitUntil:'load'` + 350 ms **no significa «la pantalla está
          // lista»**. `/proyectos` pinta su ESQUELETO hasta que resuelve
          // `/api/proyectos`, y el esqueleto no tiene control de pasarela.
          //
          // Medido en la primera corrida tras declarar la ruta, con un sondeo que
          // imita a este arnés: a los 350 ms el control valía 0 tanto en 768 como
          // en 1280 —con el esqueleto todavía en pantalla— y a los 1500 ms valía
          // 1 en los dos. O sea que el SIN MEDIR no era del ancho: era una
          // CARRERA CON EL FETCH, y el gate la habría cobrado a cualquier ancho
          // según cómo cayera el reloj.
          //
          // Esperar no debilita la aserción: si el control no aparece nunca, el
          // `waitFor` agota su tope, `count()` sigue en 0 y el caso sale SIN
          // MEDIR con el mismo motivo. Lo que se elimina es el falso SIN MEDIR,
          // que es ruido que enseña a ignorar el instrumento.
          const flecha = page.locator(`[${ATRIBUTO_AVANZAR}]:visible`).first();
          try {
            await flecha.waitFor({ state: 'visible', timeout: 8000 });
          } catch {
            // Sigue adelante con `count() === 0`: el veredicto lo da
            // `decidirPasarela`, no este `catch`.
          }
          const hayControl = (await flecha.count()) > 0;
          const decision = decidirPasarela({
            hayControl,
            deshabilitado: hayControl ? await flecha.isDisabled() : false,
          });
          if (!decision.medir) {
            resultados.push({ ...casoBase, resultado: 'SIN_MEDIR', motivoSinMedir: decision.motivo });
            continue;
          }
          await flecha.click();
          await page.waitForTimeout(400);
        }
        // [C-DASH-13] EL REGIMEN COLAPSADO SE COMPRUEBA, NO SE SUPONE.
        //
        // Sembrar la clave en `localStorage` no prueba que el shell la haya
        // leido: si la clave cambiara de nombre, si el script bloqueante dejara
        // de correr, o si el almacenamiento no estuviera disponible, el caso
        // mediria el regimen EXPANDIDO creyendo medir el otro — y saldria VERDE
        // sobre el unico regimen que ya estaba cubierto. Es el mismo molde que la
        // pasarela: declarar un estado que no existe tiene que DOLER.
        //
        // Se pregunta por el EFECTO —la custom property sobre <html>—, no por la
        // clave que acabamos de escribir nosotros: preguntarle a la semilla si
        // germino seria cotejar una copia con ella misma.
        if (colapsado) {
          const anchoVar = await page.evaluate(() =>
            document.documentElement.style.getPropertyValue('--mx-sidebar-w').trim(),
          );
          if (anchoVar !== '0px') {
            resultados.push({
              ...casoBase,
              resultado: 'SIN_MEDIR',
              motivoSinMedir: `el sidebar NO quedo colapsado (--mx-sidebar-w = «${anchoVar || 'sin valor'}», esperaba «0px») — la semilla no llego al shell`,
            });
            continue;
          }
        }
        if (esc.estado === 'seleccion-abierta') {
          try {
            // AQUÍ HABÍA UN RODEO, Y BORRARLO ES PARTE DE LA PRUEBA. Mientras el
            // saludo del asistente tapaba la píldora (H4), el arnés lo cerraba
            // con su ✕ para poder pulsarla: yo esquivando el defecto que estaba
            // midiendo. Con el carril puesto el saludo se aparta solo cuando hay
            // Selección (regla 5), así que el rodeo sobra — y si el defecto
            // volviera, el clic no llega, el caso sale SIN MEDIR y el veredicto
            // es 2. La ausencia de estas líneas es la guarda.
            // La píldora, por su CONTRATO aria y no por su texto: a 390 el
            // primer botón que casa /Selección/ es el «En Selección» de una
            // fila del catálogo (el riel del sidebar está oculto y el punto
            // flotante se monta DESPUÉS de la tabla) — la corrida A lo cazó
            // como timeout. `aria-expanded="false"` distingue la píldora del
            // botón de contraer; `:visible` esquiva el gemelo oculto (el panel
            // se pinta en DOS puntos de render, cada uno con su id desde H5).
            //
            // Y el arnés YA NO ESCRIBE EL id: casa por PREFIJO y luego lee el
            // `aria-controls` del botón que pulsó. Cuando H5 partió el id en
            // dos, un selector con el id literal dejó de casar y varios casos
            // salieron SIN MEDIR — el veredicto fue 2, no verde, que es
            // exactamente lo que debía pasar. Se mide el PUENTE que el atributo
            // nombra, no una cadena que el arnés supone (P27).
            const pildora = page.locator('button[aria-controls^="panel-seleccion"][aria-expanded="false"]:visible').first();
            await pildora.waitFor({ state: 'visible', timeout: 8000 });
            const idPanel = await pildora.getAttribute('aria-controls');
            await pildora.click();
            await page.locator(`[id="${idPanel}"]:visible`).waitFor({ state: 'visible', timeout: 5000 });
            await page.waitForTimeout(200);
          } catch (e) {
            resultados.push({
              ...casoBase,
              resultado: 'SIN_MEDIR',
              motivoSinMedir: `no se pudo abrir el panel de Selección (${sinUrls(String(e?.message ?? e), 100)})`,
            });
            continue;
          }
        }
        let medicion;
        try {
          medicion = await page.evaluate(medirPagina, CONFIG_MEDICION);
        } catch (e) {
          // O0-3: una excepción de evaluate JAMÁS se lee como «sin violaciones».
          resultados.push({
            ...casoBase,
            resultado: 'SIN_MEDIR',
            motivoSinMedir: `evaluate reventó: ${sinUrls(String(e?.message ?? e), 160)}`,
          });
          continue;
        }
        resultados.push({ ...casoBase, resultado: 'MEDIDO', medicion });
      } catch (e) {
        resultados.push({ ...casoBase, resultado: 'SIN_MEDIR', motivoSinMedir: sinUrls(String(e?.message ?? e), 160) });
      } finally {
        await page.close();
      }
    }

    // ---------- veredicto (lógica pura, probada en vitest) ----------
    const v = veredicto(resultados, {
      archivosPagina: archivos.length,
      rutasDerivadas: rutas.length,
      rutaControl: RUTA_CONTROL,
      nombresSolapeConocidos: NOMBRES_SOLAPE_CONOCIDOS,
      plantadosEsperados: PLANTADOS_ESPERADOS,
      solapePermitidoDelControl: SOLAPE_DEL_CONTROL,
      plantadosSilenciosos: PLANTADOS_SILENCIOSOS,
    });
    for (const linea of v.lineas) console.log(linea);
    if (soloRuta && v.codigo === 0) {
      console.log('VEREDICTO AJUSTADO: la corrida fue ACOTADA (--solo-ruta) — un verde parcial no absuelve el árbol. Exit 2.');
      return 2;
    }
    return v.codigo;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server?.pid) matarArbol(server.pid);
  }
}

// `process.exitCode`, nunca `process.exit()`: con handles de red vivos
// (Supabase/Playwright) el exit forzado revienta libuv en Windows y el
// código reportado deja de ser el del script (P1, QA-REG-19).
process.exitCode = await main();
