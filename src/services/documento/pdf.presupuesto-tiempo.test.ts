// ============================================================
// [2.0.1-C] pdf.presupuesto-tiempo.test.ts — LA TERCERA DIMENSIÓN DEL
// PRESUPUESTO DE IMÁGENES: TIEMPO.
//
// El hueco medido: `CANTIDAD` y `BYTES` acotaban el bucle de descarga de
// `descargarImagenes` (`pdf.ts`); `TIEMPO` no. El `fetch` de Node no trae
// timeout por omisión, así que un bucket lento o colgado dejaba ese bucle
// SIN COTA dentro de una ruta HTTP que un usuario espera — y esa ruta declara
// `maxDuration = 60`: sin esta cota, el techo real nunca fue "96 s" (12 × la
// cota individual); era 60 s **y cero documento**, porque la plataforma mata
// la petición completa. Esta cota convierte "60 s y nada" en "acotado, con
// el PDF completo y su confesión".
//
// ⚠ LO QUE ESTE ARCHIVO NO PRUEBA, Y NO HAY QUE AFIRMARLO: que esto arregle
// un congelamiento reportado en la pestaña Documento. Eso NO
// se reproduce. Este archivo prueba
// un hueco real e independiente — el único sitio del camino donde un
// congelamiento largo podría esconderse — sin confirmar que sea su causa.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-C · revisión del carril] EL MECANISMO SE PRUEBA APARTE DE LAS
// CONSTANTES, y es deliberado: una primera versión de este archivo probaba
// las DOS cotas dejando correr los topes REALES de producción
// (8 000/20 000 ms) a través de `renderizarPdf()`. Eso hacía el ARCHIVO
// completo pasar de ~1,4 s a ~28,8 s — 28 s de reloj, en cada corrida de
// `verificar`, PARA SIEMPRE, solo para re-verificar dos constantes.
//
// La descomposición que evita pagar eso sin perder la propiedad:
//
//   1 · EL MECANISMO se prueba con un PRESUPUESTO INYECTADO Y PEQUEÑO —
//       `descargarImagenes(filas, presupuesto)` acepta el presupuesto como
//       parámetro opcional precisamente para esto. La propiedad de fondo
//       (que `AbortSignal.timeout` corta un bucket colgado; que
//       `AbortSignal.any` hace que el techo del bucle sea `maxMsTotal` y NO
//       `maxMsTotal + maxMsPorImagen`) no depende del VALOR de las cotas,
//       así que se demuestra igual de bien con milisegundos de prueba que
//       con los de producción — **80× más barata, misma discriminación**.
//   2 · LAS CONSTANTES DE PRODUCCIÓN se pinnean con una aserción directa
//       sobre `PRESUPUESTO_IMAGENES`. Es gratis (0 ms) y atrapa EXACTAMENTE
//       lo que la espera real atrapaba: que alguien cambie `8_000`/`20_000`
//       sin darse cuenta. Lo que la espera real medía sobre el RELOJ, esto
//       lo mide sobre el VALOR — mismo hecho, sin pagar el reloj.
//   3 · LA INTEGRACIÓN con `renderizarPdf()` (que un timeout no tumba el PDF
//       y que el documento confiesa la causa correcta) se prueba con un
//       `fetch` que RECHAZA DE INMEDIATO con la forma exacta de un timeout
//       (`DOMException` de nombre `TimeoutError`) — sin esperar a que
//       `AbortSignal.timeout(...)` dispare de verdad, porque lo que aquí se
//       prueba es qué hace `renderizarPdf` con ese resultado, no cuánto
//       tarda en producirse.
//
// Las tres juntas implican el comportamiento de producción: mecanismo
// probado + constantes pinneadas + integración verificada. Ninguna de las
// tres necesita reloj real de producción para existir.
// ────────────────────────────────────────────────────────────
//
// DOS COTAS, DOS PROPIEDADES DE MECANISMO, cada una con su propia
// anti-vacuidad:
//
//   1 · POR IMAGEN (`AbortSignal.timeout` en cada `fetch`) — protege de UN
//       bucket que cuelga. Se prueba con un `fetch` mockeado que NUNCA
//       resuelve salvo que reciba la señal de abortar: sin el
//       `AbortSignal` real en `pdf.ts`, ese mock jamás se asienta y la
//       prueba cuelga hasta agotar su propio timeout de `it(...)` — no pasa
//       en silencio.
//   2 · TOTAL DEL BUCLE (acumulado, y capaz de INTERRUMPIR un `fetch` ya en
//       vuelo — `AbortSignal.any` en `pdf.ts`) — protege de N imágenes que,
//       INDIVIDUALMENTE, no agotan su propia cota, pero SUMADAS sí agotan el
//       presupuesto del documento; y, aparte, protege de que el techo real
//       termine siendo la SUMA de las dos cotas en vez de solo la total
//       (ALTO 2 de la revisión). Cada propiedad trae su propio control
//       positivo — si solo se probara una dirección, la otra sería una
//       guarda que nunca puede dispararse (P19).
//
// NO SE USA LA RED. Las suites mockean `global.fetch` (esta con respuestas a
// medida; `documento.presentacion.test.ts` con `imagenes-minimas.ts`).
// ============================================================
import { describe, expect, it, vi } from 'vitest';
import { armarModelo } from './modelo';
import { renderizarPdf, descargarImagenes, FORMATOS_PDF, PRESUPUESTO_IMAGENES } from './pdf';
import { piezasDeTextoDelPdf, piezasPorPagina } from './huella';
import { partida, SESION_FIXTURE, AHORA_FIXTURE, DETALLE_PEOR_CASO } from './fixture-peor-caso';
import { pngMinimo } from './imagenes-minimas';
import type { ProyectoDetalle } from '@/types/proyectos';

// PNG mínimo válido, generado en código. No es basura de prueba: `doc.image()`
// intenta decodificarlo, y lo que aquí se prueba es la cota de TIEMPO, no el
// propio `try/catch` de "una imagen corrupta no tumba el documento" (ese ya
// existe y no es de este bloque).
const PNG_1X1 = pngMinimo();

/** N partidas con fotografía `.png` propia — cada una entra a `descargarImagenes` (capa 'sku'). */
function detalleConNImagenes(n: number): ProyectoDetalle {
  return {
    ...DETALLE_PEOR_CASO,
    folio: 'PRJ-TIEMPO',
    titulo: 'Presupuesto de tiempo · fetch mockeado',
    descripcion: '',
    notas: '',
    partidas: Array.from({ length: n }, (_, i) =>
      partida({
        partida_id: `tiempo-${i}`,
        sku: `TIEMPO-${String(i).padStart(2, '0')}`,
        descripcion: 'Partida con fotografía para el arnés de presupuesto de tiempo',
        marca: 'BRAND5',
        tecnologia: 'EAS',
        banda: 'EAS',
        cantidad: 1,
        total: 1,
        reservado: 0,
        disponible: 1,
        // Dominio inventado a propósito: si esto llegara a hacer un fetch de
        // verdad, tiene que fallar por DNS y no colarse como éxito real.
        imagen_url: `https://bucket-mockeado.invalid/producto-imagenes/foto-${i}.png`,
      }),
    ),
    skus: n,
    piezas: n,
    agrupacion: { eje: 'tecnologia', sinBanda: 0 },
  };
}

function modeloDe(detalle: ProyectoDetalle) {
  return armarModelo({
    sesion: SESION_FIXTURE,
    entorno: 'Desarrollo',
    ahora: AHORA_FIXTURE,
    detalle,
    formatosEmpotrables: FORMATOS_PDF,
  });
}

/** Lo mínimo que `descargarImagenes` le pide a un `Response`: `.ok` y `.arrayBuffer()`. */
function respuestaOk(cuerpo: Buffer): Response {
  return { ok: true, arrayBuffer: async () => cuerpo } as unknown as Response;
}

/**
 * `fetch` que NUNCA se resuelve salvo que reciba la señal de abortar.
 *
 * ES EL CONTROL POSITIVO DE LA COTA POR IMAGEN (y, reutilizado más abajo,
 * de la combinación `AbortSignal.any` de la cota TOTAL): si `pdf.ts` dejara
 * de pasar una señal de aborto en su `fetch`, esta promesa jamás se
 * asienta — la prueba que la usa cuelga hasta su propio `it(..., ms)` y
 * REPRUEBA por timeout, no pasa por accidente. Es agnóstica de qué tipo de
 * `AbortSignal` reciba (uno solo o el resultado de `AbortSignal.any`): solo
 * escucha su evento `abort` y lee su `reason`, así que ejercita las dos
 * cotas por igual.
 */
function fetchQueCuelgaSalvoAbort() {
  return vi.fn((_url: string, opciones?: { signal?: AbortSignal }) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = opciones?.signal;
      if (!signal) return; // sin señal: cuelga para siempre. A propósito.
      const rechazar = () => reject(signal.reason);
      if (signal.aborted) rechazar();
      else signal.addEventListener('abort', rechazar, { once: true });
    });
  });
}

/** `fetch` que resuelve con éxito tras `ms` reales — para poblar el presupuesto TOTAL sin tocar la cota individual. */
function fetchConDemora(ms: number) {
  return vi.fn((_url: string, opciones?: { signal?: AbortSignal }) => {
    return new Promise<Response>((resolve, reject) => {
      const id = setTimeout(() => resolve(respuestaOk(PNG_1X1)), ms);
      const signal = opciones?.signal;
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(id);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
}

/**
 * `fetch` cuya PRIMERA llamada resuelve con éxito tras `msPrimera` reales, y
 * cuya SEGUNDA llamada en adelante cuelga salvo aborto (como
 * `fetchQueCuelgaSalvoAbort`). Existe para la prueba de discriminación de
 * ALTO 2: necesita que, al arrancar la SEGUNDA imagen, ya haya transcurrido
 * una porción conocida y real del presupuesto TOTAL — algo que un mock
 * uniforme no puede producir con una sola llamada.
 */
function fetchPrimeraOkSegundaCuelga(msPrimera: number) {
  let llamadas = 0;
  return vi.fn((_url: string, opciones?: { signal?: AbortSignal }) => {
    llamadas++;
    if (llamadas === 1) {
      return new Promise<Response>((resolve) => setTimeout(() => resolve(respuestaOk(PNG_1X1)), msPrimera));
    }
    return new Promise<Response>((_resolve, reject) => {
      const signal = opciones?.signal;
      if (!signal) return;
      const rechazar = () => reject(signal.reason);
      if (signal.aborted) rechazar();
      else signal.addEventListener('abort', rechazar, { once: true });
    });
  });
}

/**
 * `fetch` que rechaza con la MISMA forma que un timeout real, derivada de un
 * `AbortSignal.timeout(1)` genuino — casi de inmediato (1 ms), sin pasar por
 * el `fetch` real. Para las pruebas de INTEGRACIÓN con `renderizarPdf()`: lo
 * que ahí se verifica es qué hace el generador con un resultado de timeout
 * (que el PDF salga completo y confiese la causa correcta), no cuánto tarda
 * en producirse ese resultado — eso ya lo prueba, por separado y rápido, el
 * mecanismo de más arriba.
 *
 * ⚠ NO SE CONSTRUYE `new DOMException(...)` A MANO. Verificado en el entorno
 * `jsdom` de esta suite (`vitest.config.ts`): el `DOMException` global de
 * jsdom da un objeto que **no** extiende `Error`, así que `esTimeout`
 * (`pdf.ts`, que hace `error instanceof Error`) lo clasificaría como
 * `fallidas` — un falso rojo por un artefacto DEL ENTORNO DE PRUEBAS, no de
 * producción: el `AbortSignal.timeout` real de Node (el que `pdf.ts` de
 * verdad usa) sí produce un `reason` que extiende `Error`, y así lo
 * confirma la prueba de mecanismo de arriba. Derivar el `reason` de un
 * `AbortSignal.timeout` real evita fabricar una forma que ni producción ni
 * este entorno producen de esa manera.
 */
function fetchQueRechazaComoTimeoutDeInmediato() {
  return vi.fn(async () => {
    const senal = AbortSignal.timeout(1);
    await new Promise<void>((resolve) => senal.addEventListener('abort', () => resolve(), { once: true }));
    throw senal.reason;
  });
}

describe('[2.0.1-C] las CONSTANTES de producción — pinneadas directamente, sin reloj', () => {
  it('PRESUPUESTO_IMAGENES.maxMsPorImagen y maxMsTotal no cambian por accidente', () => {
    // Gratis (0 ms) y atrapa EXACTAMENTE lo que una espera real de 8 s/20 s
    // atrapaba: que alguien cambie el número sin darse cuenta. La
    // JUSTIFICACIÓN de estos valores —el ancla medida en Supabase, el
    // margen sobre ella, el hueco declarado sobre una descarga completa bajo
    // degradación— vive en el comentario de `PRESUPUESTO_IMAGENES` (`pdf.ts`),
    // no aquí: repetirla en dos sitios es como se vuelve dos verdades.
    expect(PRESUPUESTO_IMAGENES.maxMsPorImagen).toBe(8_000);
    expect(PRESUPUESTO_IMAGENES.maxMsTotal).toBe(20_000);
  });
});

describe('[2.0.1-C] MECANISMO · la cota POR IMAGEN — presupuesto inyectado, sin reloj de producción', () => {
  it('control positivo · un fetch que nunca resuelve termina ACOTADO por AbortSignal.timeout (no cuelga la prueba)', async () => {
    // Presupuesto de PRUEBA, no el de producción: la propiedad que se
    // verifica —que `pdf.ts` pasa una señal real y la respeta— no depende
    // del VALOR de la cota. 120 ms es grande frente al ruido normal del
    // planificador de Node en este entorno (unos pocos ms) y minúsculo
    // frente a cualquier timeout razonable de `it(...)`.
    const presupuestoDePrueba = { ...PRESUPUESTO_IMAGENES, maxMsPorImagen: 120, maxMsTotal: 5000 };
    vi.stubGlobal('fetch', fetchQueCuelgaSalvoAbort());

    const modelo = modeloDe(detalleConNImagenes(1));
    const resultado = await descargarImagenes(modelo.filas, presupuestoDePrueba);

    expect(resultado.imagenes.size).toBe(0);
    expect(resultado.fallidas, 'un timeout se clasificó como fallo de descarga').toBe(0);
    expect(resultado.omitidasPorTiempo, 'el fetch colgado no se acotó por tiempo').toBe(1);

    vi.unstubAllGlobals();
  }, 1000); // sin `AbortSignal` real en `pdf.ts`, este mock cuelga para siempre y la prueba reprueba AQUÍ por timeout — no en silencio.

  it('un error de red REAL (no un timeout) se sigue contando como fallida — la distinción no confunde las dos causas', async () => {
    // La forma real en que Node reporta una conexión rechazada/DNS que no
    // resuelve: un `TypeError`, no una `DOMException` de nombre `TimeoutError`.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const modelo = modeloDe(detalleConNImagenes(1));
    const resultado = await descargarImagenes(modelo.filas); // sin 2.º argumento: no espera nada, el mock rechaza de inmediato.

    expect(resultado.imagenes.size).toBe(0);
    expect(resultado.omitidasPorTiempo, 'un error de red se contó como agotamiento de tiempo').toBe(0);
    expect(resultado.fallidas).toBe(1);

    vi.unstubAllGlobals();
  });
});

describe('[2.0.1-C] MECANISMO · la cota TOTAL — presupuesto inyectado, sin reloj de producción', () => {
  it('cada imagen cabe SOBRADAMENTE en su propia cota, y aun así el presupuesto TOTAL corta el bucle antes de terminar — sin intentar las que quedan', async () => {
    // Presupuesto LOCAL a esta prueba: no toca `PRESUPUESTO_IMAGENES`, así
    // que no hace falta `afterEach` ni hay estado que dos pruebas puedan
    // pisarse si algún día corrieran con `it.concurrent`.
    const presupuestoDePrueba = { ...PRESUPUESTO_IMAGENES, maxMsPorImagen: 5000, maxMsTotal: 150 };
    const N = 8; // 8 × 50 ms = 400 ms nominales, muy por encima de los 150 ms totales.
    const fetchMock = fetchConDemora(50);
    vi.stubGlobal('fetch', fetchMock);

    const modelo = modeloDe(detalleConNImagenes(N));
    const { imagenes, fallidas, omitidasPorTiempo, omitidasPorPresupuesto } = await descargarImagenes(modelo.filas, presupuestoDePrueba);

    expect(fallidas, 'ninguna de estas descargas debía fallar de verdad').toBe(0);
    expect(omitidasPorPresupuesto, 'no se agotó el límite de conteo/bytes: el que debía agotarse era el de tiempo').toBe(0);
    // Las dos mitades de la aserción anti-vacuidad de ESTA cota: si nunca
    // completara ninguna, la cota individual (no la total) sería sospechosa
    // de estar disparándose; si completaran las N, la cota total no se
    // habría probado en absoluto.
    expect(imagenes.size, 'con el presupuesto total agotado, no todas debieron completarse').toBeLessThan(N);
    expect(imagenes.size, 'con 50 ms muy por debajo de la cota individual, al menos una debió completarse').toBeGreaterThan(0);
    expect(omitidasPorTiempo, 'debía haber al menos una imagen omitida por el presupuesto TOTAL').toBeGreaterThan(0);
    expect(imagenes.size + fallidas + omitidasPorTiempo + omitidasPorPresupuesto, 'las categorías no suman las candidatas').toBe(
      N,
    );
    // LA ASERCIÓN QUE DISTINGUE CUÁL COTA SE DISPARÓ (no solo que "algo" se
    // disparó): con la cota individual generosísima (5 000 ms) como ÚNICA
    // responsable, las 8 candidatas se habrían INTENTADO igual —la cota
    // individual no impide arrancar un `fetch`, solo puede matarlo ya en
    // vuelo—, así que `fetchMock` habría sido llamado 8 veces. Que se haya
    // llamado MENOS de 8 veces solo se explica por el chequeo PROACTIVO del
    // presupuesto TOTAL (`msRestantes <= 0`, antes de arrancar). Sin esta
    // línea, un `descargarImagenes` que intentara las 8 y dejara morir
    // varias por su cota individual habría pasado las aserciones de arriba
    // igual de verde, con la causa equivocada (P25).
    //
    // NO se afirma `toHaveBeenCalledTimes(imagenes.size)`: con la cota TOTAL
    // capaz de interrumpir un `fetch` YA EN VUELO (ver la prueba de
    // discriminación más abajo), una imagen puede INTENTARSE y aun así no
    // completar, así que "intentadas" y "completadas" ya no son
    // necesariamente el mismo número. Lo que sigue siendo cierto, y es lo
    // que aquí se prueba, es que no TODAS se intentan.
    expect(fetchMock.mock.calls.length, 'el presupuesto TOTAL debía impedir que se intentaran las 8 candidatas').toBeLessThan(N);
    expect(imagenes.size, 'no puede haber más completadas que intentadas').toBeLessThanOrEqual(fetchMock.mock.calls.length);

    vi.unstubAllGlobals();
  }, 5000);

  it('control positivo · con presupuesto total de sobra, las N imágenes SÍ terminan — la cota total de verdad puede no dispararse', async () => {
    // Sin esto, la prueba de arriba podría estar en verde porque la cota
    // TOTAL corta SIEMPRE, sin importar cuánto presupuesto haya — un
    // contador que nunca puede DEJAR de incrementarse es tan vacuo como uno
    // que nunca puede incrementarse (P19, con el signo cambiado).
    const presupuestoDePrueba = { ...PRESUPUESTO_IMAGENES, maxMsPorImagen: 5000, maxMsTotal: 5000 }; // de sobra para 8 × 50 ms.
    const N = 8;
    const fetchMock = fetchConDemora(50);
    vi.stubGlobal('fetch', fetchMock);

    const modelo = modeloDe(detalleConNImagenes(N));
    const { imagenes, fallidas, omitidasPorTiempo, omitidasPorPresupuesto } = await descargarImagenes(modelo.filas, presupuestoDePrueba);

    expect(fallidas).toBe(0);
    expect(omitidasPorPresupuesto).toBe(0);
    expect(omitidasPorTiempo, 'con presupuesto de sobra, no debía omitirse nada por tiempo').toBe(0);
    expect(imagenes.size).toBe(N);
    expect(fetchMock, 'con presupuesto de sobra, las N debieron intentarse').toHaveBeenCalledTimes(N);

    vi.unstubAllGlobals();
  }, 5000);

  // ────────────────────────────────────────────────────────────
  // [ALTO 2 de la revisión] LA PROPIEDAD ESPECÍFICA: el techo del BUCLE es
  // `maxMsTotal` — no `maxMsTotal + maxMsPorImagen`.
  //
  // Sin `AbortSignal.any` combinando las dos señales, un `fetch` YA EN
  // VUELO cuando se agota el plazo total seguiría corriendo hasta SU PROPIA
  // cota individual completa, y el techo real del bucle sería la suma de
  // las dos constantes. Esta prueba mide el RELOJ (no hay otra forma de
  // distinguir "se combinaron las señales" de "no se combinaron" desde
  // fuera) pero con números de MILISEGUNDOS DE PRUEBA, no los de
  // producción — 80× más barata que repetir esto con 8 000/20 000 reales.
  //
  // NÚMEROS Y TOLERANCIA, Y POR QUÉ SOBREVIVEN AL RUIDO DEL PLANIFICADOR:
  // `maxMsPorImagen = 400`, `maxMsTotal = 250`, primera imagen resuelta a
  // los 200 ms reales (dentro de su propia cota Y del plazo total). Al
  // arrancar la SEGUNDA imagen quedan ~50 ms de plazo total (250 − 200), así
  // que la composición correcta (`AbortSignal.any`) la corta ahí: total
  // esperado ≈ 250 ms. Si el techo fuera la SUMA (el defecto que ALTO 2
  // cerró), esa segunda imagen ignoraría el plazo agotado y correría su
  // cota individual COMPLETA desde que arrancó (t≈200 ms), terminando
  // ≈ 600 ms después del inicio — muy cerca de los "~650 ms" (200 + 400 +
  // margen) que ilustra el defecto. La brecha entre 250 y 600 es de 350 ms:
  // muy por encima del jitter típico de `setTimeout`/`AbortSignal.timeout`
  // en Node sobre Windows en este entorno (decenas de ms, no cientos), así
  // que un umbral de corte en 450 ms —a medio camino, con margen amplio a
  // los dos lados— no puede confundir "bien" (≈250) con "mal" (≈600) por
  // ruido del reloj.
  // ────────────────────────────────────────────────────────────
  it('DISCRIMINACIÓN (ALTO 2) · el techo real es maxMsTotal, no maxMsTotal + maxMsPorImagen', async () => {
    const presupuestoDePrueba = { ...PRESUPUESTO_IMAGENES, maxMsPorImagen: 400, maxMsTotal: 250 };
    vi.stubGlobal('fetch', fetchPrimeraOkSegundaCuelga(200));

    const modelo = modeloDe(detalleConNImagenes(2));
    const inicio = Date.now();
    const { imagenes, omitidasPorTiempo, fallidas } = await descargarImagenes(modelo.filas, presupuestoDePrueba);
    const transcurrido = Date.now() - inicio;

    expect(fallidas).toBe(0);
    expect(imagenes.size, 'la primera imagen (200 ms, dentro de las dos cotas) debía completarse').toBe(1);
    expect(omitidasPorTiempo, 'la segunda imagen debía cortarse por tiempo').toBe(1);
    // LA ASERCIÓN DE FONDO: el umbral de 450 ms está a medio camino entre el
    // "bien" (≈250 ms) y el "mal" (≈600 ms) descritos arriba, con ~200 ms de
    // margen a cada lado sobre el jitter esperado.
    expect(
      transcurrido,
      `tardó ${transcurrido} ms — como si el techo fuera la SUMA de las dos cotas (≈600 ms), no maxMsTotal (≈250 ms)`,
    ).toBeLessThan(450);
    // Anti-vacuidad de esta misma prueba: si terminara sospechosamente
    // rápido (p. ej. porque el mock no colgó de verdad, o alguien volviera
    // `descargarImagenes` sin `await` real), esto lo detecta.
    expect(transcurrido, 'terminó demasiado rápido para haber esperado siquiera el plazo total').toBeGreaterThanOrEqual(150);

    vi.unstubAllGlobals();
  }, 2000);
});

describe('[2.0.1-C] INTEGRACIÓN · renderizarPdf() sale y confiesa — sin esperar los topes reales de producción', () => {
  it('un timeout no tumba el PDF: el documento se genera igual, sin la imagen, y confiesa el agotamiento de tiempo (no un fallo de descarga)', async () => {
    // `fetch` rechaza DE INMEDIATO con la forma de un timeout real — lo que
    // se prueba aquí es la reacción de `renderizarPdf` ante ese resultado,
    // no cuánto tarda en producirse (eso ya lo prueba el mecanismo, arriba,
    // con presupuestos inyectados). `renderizarPdf` no acepta un presupuesto
    // por parámetro, así que esta prueba usa las cotas REALES de
    // producción — pero como el mock nunca espera nada, el tiempo de la
    // prueba no depende de esas cotas.
    vi.stubGlobal('fetch', fetchQueRechazaComoTimeoutDeInmediato());

    const pdf = await renderizarPdf(modeloDe(detalleConNImagenes(1)));
    expect(pdf.length, 'el documento no se generó').toBeGreaterThan(0);

    const paginas = piezasPorPagina(pdf);
    const tieneAnexo = paginas.some((p) => p.some((t) => t.includes('Fotografías')));
    expect(tieneAnexo, 'con la única imagen agotada por tiempo, el anexo no debía dibujarse').toBe(false);

    const texto = piezasDeTextoDelPdf(pdf).join(' ');
    expect(texto, 'la confesión de agotamiento de tiempo no aparece en el documento').toContain('agotarse el tiempo');
    // La distinción que pide el brief: un timeout NO es un fallo de descarga.
    expect(texto, 'un timeout se confesó como fallo de descarga, no como agotamiento de tiempo').not.toContain(
      'no se pudo descargar',
    );
    expect(texto).not.toContain('no se pudieron descargar');

    vi.unstubAllGlobals();
  });
});
