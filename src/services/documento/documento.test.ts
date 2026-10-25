import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { soloCodigo } from '@/lib/guardas/codigo-fuente';
import { armarModelo, celdaComoTexto, ESTATUS_FUERA_DEL_VIGENTE, type ModeloDocumento } from './modelo';
import { renderizarXlsx } from './xlsx';
import { renderizarPdf, FORMATOS_PDF } from './pdf';
import type { ProyectoDetalle, PartidaItem } from '@/types/proyectos';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const XLSX: any = require('xlsx');

function partida(over: Partial<PartidaItem> = {}): PartidaItem {
  return {
    partida_id: '11111111-1111-4111-8111-111111111111',
    sku: 'NKH922-W',
    descripcion: 'GDX 36 BLnihq Gblvx Uqjnbzn Ujap Xbsdrlfv Efupn',
    marca: 'BRAND1',
    tecnologia: 'BRAND1',
    color: 'azul',
    imagen_url: null,
    cantidad: 518,
    total: 4923,
    reservado: 518,
    disponible: 4405,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: 'BRAND1',
    eje_banda: 'tecnologia',
    ...over,
  };
}

function detalle(over: Partial<ProyectoDetalle> = {}): ProyectoDetalle {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    folio: 'PRJ-001',
    titulo: 'Rollout Retailer9 Series2 Q2',
    descripcion: 'Despliegue de Series2 en 40 tiendas Retailer9 zona centro.',
    notas: 'Confirmar disponibilidad de adhesivos antes de cierre.',
    fecha: '2031-04-17',
    tipo: 'Rollout',
    intencion: 'Cotización',
    responsable: "kam@example.test",
    creado_en: '2031-04-17T18:00:00.000Z',
    skus: 1,
    piezas: 518,
    partidas: [partida()],
    vigencia: { snapshot_id: 'snap-1', tomado_en: '2031-08-13T03:06:00.000Z' },
    agrupacion: { eje: 'tecnologia', sinBanda: 0 },
    facetas: { marcas: ['BRAND1'], tecnologias: ['BRAND1'] },
    ...over,
  };
}

function modeloDe(d: ProyectoDetalle, formatos: readonly string[] = FORMATOS_PDF): ModeloDocumento {
  return armarModelo({
    detalle: d,
    sesion: { nombre: null, correo: 'lmertlbazim@example.test', cuenta: 'uid-1' },
    entorno: 'Producción',
    // Instante FIJO: sin inyectarlo, dos renders no serían comparables y este
    // archivo no podría probar nada.
    ahora: new Date('2031-08-19T18:00:00.000Z'),
    formatosEmpotrables: formatos,
  });
}


/**
 * Extrae el TEXTO REAL de un PDF. No busca en los bytes crudos: pdfkit
 * comprime los flujos de contenido con FlateDecode, asi que el texto no
 * aparece ahi y una asercion sobre los bytes pasaria (o fallaria) por motivos
 * equivocados. Aqui se inflan los flujos con `zlib` —que ya viene en Node, sin
 * dependencia nueva— y se recuperan los literales de los operadores de texto.
 * Es lo que convierte "el PDF dice 4,405" en una afirmacion verificada sobre
 * el ARCHIVO ENTREGADO, y no sobre el modelo del que salio.
 */
function textoDelPdf(bytes: Buffer): string {
  const crudo = bytes.toString('latin1');
  const partes: string[] = [];
  const inicioDeFlujo = /stream\r?\n/g;

  let marca: RegExpExecArray | null;
  while ((marca = inicioDeFlujo.exec(crudo)) !== null) {
    const desde = marca.index + marca[0].length;
    const hasta = crudo.indexOf('endstream', desde);
    if (hasta < 0) continue;

    let inflado: string;
    try {
      inflado = zlib.inflateSync(Buffer.from(crudo.slice(desde, hasta), 'latin1')).toString('latin1');
    } catch {
      // No todos los flujos son texto comprimido: las imagenes empotradas y
      // los subconjuntos de fuente tambien viven en flujos. Se saltan.
      continue;
    }

    // pdfkit NO emite `(literal) Tj`: emite `[<hex> kern <hex> ...] TJ`, un
    // arreglo con los ajustes de interletraje intercalados. Verificado sobre
    // un PDF real de esta misma libreria:
    //   [<4e4b4e3932322d5720646973706f6e6962> 20 <6c6520342c343035> 0] TJ
    // Los `<hex>` son los bytes del texto en WinAnsi — un byte por caracter
    // para es-MX, acentos incluidos —, asi que concatenarlos reconstruye la
    // linea. Buscar `(...) Tj` devolvia cadena vacia y habria hecho que estas
    // pruebas pasaran por vacuidad.
    for (const bloque of Array.from(inflado.matchAll(/\[([^\]]*)\]\s*TJ/g))) {
      let linea = '';
      for (const hex of Array.from(bloque[1].matchAll(/<([0-9A-Fa-f]+)>/g))) {
        linea += Buffer.from(hex[1], 'hex').toString('latin1');
      }
      partes.push(linea);
    }
  }

  return partes.join('\n');
}

/** Lee la hoja "Partidas" de vuelta, como lo haría una máquina que no sabe nada del generador. */
function leerPartidasDelXlsx(bytes: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets['Partidas']);
}

describe('[INV-B8] D1 · el documento NO puede llevar dinero', () => {
  const PROHIBIDOS = ['precio', 'costo', 'moneda', 'iva', 'impuesto', 'descuento', 'importe', 'total mxn', 'usd', 'mxn', '$'];

  it('ninguna columna del modelo nombra dinero', () => {
    const modelo = modeloDe(detalle());
    for (const columna of modelo.columnas) {
      const titulo = columna.titulo.toLowerCase();
      for (const prohibido of PROHIBIDOS) {
        expect(titulo, `la columna "${columna.titulo}" nombra dinero`).not.toContain(prohibido);
      }
    }
  });

  it('el XLSX generado no contiene ningún encabezado monetario, leído de vuelta del archivo', () => {
    const bytes = renderizarXlsx(modeloDe(detalle()));
    const wb = XLSX.read(bytes, { type: 'buffer' });
    const encabezados = (XLSX.utils.sheet_to_json(wb.Sheets['Partidas'], { header: 1 })[0] as string[]).map((h) =>
      String(h).toLowerCase(),
    );
    for (const encabezado of encabezados) {
      for (const prohibido of PROHIBIDOS) {
        expect(encabezado, `el XLSX trae la columna "${encabezado}"`).not.toContain(prohibido);
      }
    }
    // Y la comprobación complementaria: las columnas que SÍ tienen que estar.
    expect(encabezados).toContain('disponible');
    expect(encabezados).toContain('reservado');
  });
});

describe('[INV-B8] los dos documentos coinciden cifra por cifra', () => {
  it('el MISMO modelo alimenta a los dos: no hay dónde divergir', async () => {
    const d = detalle({
      partidas: [
        partida(),
        partida({ partida_id: 'p2', sku: 'UDM839-K', descripcion: 'Series 27', cantidad: 80, total: 900, reservado: 91, disponible: 809 }),
        partida({ partida_id: 'p3', sku: 'GRG2499', descripcion: 'Series 28, 24 Pack', cantidad: 200, total: 50, reservado: 0, disponible: 50, en_riesgo: true }),
      ],
    });
    const modelo = modeloDe(d);

    const xlsxBytes = renderizarXlsx(modelo);
    const pdfBytes = await renderizarPdf(modelo);

    const filasXlsx = leerPartidasDelXlsx(xlsxBytes);
    const textoPdf = textoDelPdf(pdfBytes);

    expect(filasXlsx).toHaveLength(3);

    for (const fila of modelo.filas) {
      const enXlsx = filasXlsx.find((f) => f['SKU'] === fila.sku);
      expect(enXlsx, `el XLSX no trae ${fila.sku}`).toBeDefined();

      // El XLSX guarda NÚMEROS (para poder sumarlos), no texto formateado.
      // [2.0.1-C · F-8] «Del proyecto» / «En almacén»: los encabezados se
      // acortaron por copy firmado; la llave sigue al encabezado.
      expect(enXlsx!['Del proyecto']).toBe(fila.cantidad);
      expect(enXlsx!['En almacén']).toBe(fila.total);
      expect(enXlsx!['Reservado']).toBe(fila.reservado);
      expect(enXlsx!['Disponible']).toBe(fila.disponible);
      expect(enXlsx!['Estatus']).toBe(fila.estatus);

      // El PDF los imprime ya formateados por `celdaComoTexto` — la MISMA
      // función que el XLSX usa para las columnas de texto. Si un
      // renderizador cambiara el formato por su cuenta, esto se cae.
      for (const columna of modelo.columnas.filter((c) => c.tipo === 'numero')) {
        expect(textoPdf, `el PDF no imprime ${columna.titulo} de ${fila.sku}`).toContain(
          celdaComoTexto(fila, columna),
        );
      }
      expect(textoPdf).toContain(fila.sku);
    }
  });

  it('los dos llevan el sello de fecha, el folio y el firmante', async () => {
    const modelo = modeloDe(detalle());
    const xlsxBytes = renderizarXlsx(modelo);
    const pdfBytes = await renderizarPdf(modelo);

    const wb = XLSX.read(xlsxBytes, { type: 'buffer' });
    const meta = XLSX.utils.sheet_to_json(wb.Sheets['Documento'], { header: 1 }) as string[][];
    const planoXlsx = meta.map((f) => (f ?? []).join(' ')).join('\n');
    const planoPdf = textoDelPdf(pdfBytes);

    for (const esperado of [modelo.folio, modelo.firmante.etiqueta]) {
      expect(planoXlsx, `el XLSX no dice ${esperado}`).toContain(esperado);
      expect(planoPdf, `el PDF no dice ${esperado}`).toContain(esperado);
    }
    // La frase de vigencia lleva la fecha del snapshot. Es el invariante 2 del
    // bloque: el documento tiene que poder decir de qué fecha son sus números.
    expect(planoXlsx).toContain(modelo.vigencia);
    expect(modelo.vigencia).toContain('2031');
  });
});

describe('[INV-B8] el SKU que salió del Excel no puede imprimirse como "Sin stock"', () => {
  it('la fila dice la verdad y el documento lo advierte', () => {
    const modelo = modeloDe(
      detalle({
        partidas: [partida({ total: 0, reservado: 0, disponible: 0, badges: ['stock_cero'], fuera_del_vigente: true })],
      }),
    );

    // [2.0.1-C · F-11] El rótulo se unifica: «Fuera del inventario vigente»
    // (antes «Fuera del archivo vigente») y la nota al pie dice «en el
    // inventario vigente» (antes «en el archivo de inventario vigente»).
    expect(modelo.filas[0].estatus).toBe('Fuera del inventario vigente');
    expect(modelo.filas[0].estatus).not.toBe('Sin stock');
    expect(modelo.filas[0].nota).toContain('ya no aparece');
    expect(modelo.advertencias.map((a) => a.texto).join(' ')).toContain('en el inventario vigente');
  });

  // ============================================================
  // [2.0.1-B · S-5] UN SOLO PREDICADO POR ADVERTENCIA.
  //
  // El requisito de producto, hecho prueba: «cambiar el predicado tiene que mover las
  // tres salidas a la vez». Las tres salidas son el CONTEO (la cifra del texto),
  // el SUPERÍNDICE (qué filas se marcan en el papel) y —en S-4— el ENLACE del
  // pre-vuelo. Las tres se derivan de `advertencia.filas`, así que aquí se
  // comprueba que ese arreglo sea el mismo conjunto que la cifra anuncia. Si
  // alguien re-escribiera el predicado en el renderizador, esta prueba seguiría
  // verde y por eso NO basta sola: la acompaña la guarda de fuente de abajo.
  // ============================================================
  it('cada advertencia trae LAS FILAS que la dispararon, y su cifra sale de ellas', () => {
    const modelo = modeloDe(
      detalle({
        partidas: [
          partida({ sku: 'A-1', fuera_del_vigente: true }),
          partida({ sku: 'B-2', fuera_del_vigente: true }),
          partida({ sku: 'C-3', cantidad: 99, disponible: 1, en_riesgo: true }),
        ],
      }),
    );

    const fuera = modelo.advertencias.find((a) => a.texto.includes('en el inventario vigente'));
    expect(fuera, 'no se emitió la advertencia de fuera del vigente').toBeDefined();
    expect(fuera?.alcance).toBe('filas');
    const filasFuera = fuera?.alcance === 'filas' ? fuera.filas : [];
    // El conjunto, no solo el número: una cifra correcta sobre las filas
    // equivocadas pondría superíndices en los renglones que no son.
    expect(filasFuera.map((f) => f.sku).sort()).toEqual(['A-1', 'B-2']);
    // Y la CIFRA del texto es la de ese mismo conjunto, no un conteo aparte.
    expect(fuera?.texto.startsWith(`${filasFuera.length} `), `la cifra del texto no sale de las filas: «${fuera?.texto}»`).toBe(true);

    const riesgo = modelo.advertencias.find((a) => a.texto.includes('menos disponible'));
    const filasRiesgo = riesgo?.alcance === 'filas' ? riesgo.filas : [];
    expect(filasRiesgo.map((f) => f.sku)).toEqual(['C-3']);
  });

  it('control positivo · si NADIE coincide, la advertencia no nace (y no sale con cero filas)', () => {
    // La otra dirección, y es la que hace no-vacua a la de arriba: con un
    // universo donde ninguna fila dispara la regla, la advertencia no puede
    // aparecer «con 0». Cero y no-medido son valores distintos: aquí el valor
    // correcto es que la advertencia NO EXISTA.
    const modelo = modeloDe(detalle({ partidas: [partida({ sku: 'Z-9', fuera_del_vigente: false })] }));
    expect(modelo.advertencias.some((a) => a.texto.includes('en el inventario vigente'))).toBe(false);
    for (const a of modelo.advertencias) {
      if (a.alcance === 'filas') expect(a.filas.length, `«${a.texto}» nació sin filas`).toBeGreaterThan(0);
    }
  });

  // ============================================================
  // [2.0.1-B · S-5] LOS TRES CUBOS SON UNA PARTICIÓN, y hay una fila que lo
  // demuestra estando en dos a la vez si no se cuida.
  //
  // El resumen del formato 1b clasifica las partidas. Con S-6, una fila fuera
  // del archivo vigente imprime «—» en las tres cifras de almacén porque no se
  // puede saber: **no es «cubierta» ni «con déficit», es NO-MEDIDA.** Si se
  // absorbiera en cualquiera de los dos cubos, el resumen ejecutivo de un papel
  // que va a un cliente estaría violando «cero y no-medido son valores
  // distintos» — el peor sitio posible.
  //
  // Y no es teórico: `0692D-W` del peor caso está fuera del vigente **y** marca
  // `enRiesgo`, con `total=0 reservado=0 disponible=0` contra `cantidad=80`. Sin
  // excluirla, `cubiertas + déficit + fuera` contaría esa fila DOS veces y la
  // suma no cuadraría — sin que nadie lo notara.
  // ============================================================
  it('cubiertas + con déficit + fuera del vigente = totalSkus, y ninguna fila cae en dos cubos', () => {
    const modelo = modeloDe(
      detalle({
        partidas: [
          // La que está en los dos: fuera del vigente Y con menos disponible.
          partida({ sku: 'FUERA-1', fuera_del_vigente: true, cantidad: 80, total: 0, reservado: 0, disponible: 0, en_riesgo: true }),
          partida({ sku: 'DEFICIT-1', cantidad: 50, disponible: 1, en_riesgo: true }),
          partida({ sku: 'CUBIERTA-1', cantidad: 1, disponible: 99, en_riesgo: false }),
        ],
      }),
    );

    const fuera = modelo.filas.filter((f) => f.estatus === ESTATUS_FUERA_DEL_VIGENTE);
    const deficit = modelo.filas.filter((f) => f.enRiesgo && f.estatus !== ESTATUS_FUERA_DEL_VIGENTE);
    const cubiertas = modelo.filas.filter((f) => !f.enRiesgo && f.estatus !== ESTATUS_FUERA_DEL_VIGENTE);

    // ANTI-VACUIDAD, y es la que se pidió comprobar: si el universo no
    // trajera ninguna fila fuera del vigente, esta prueba pasaría sin mirar el
    // caso que motiva la partición.
    expect(fuera.length, 'el universo no tiene ninguna fila fuera del vigente: la partición sería vacua').toBeGreaterThan(0);
    // Y la fila que está en los DOS conjuntos crudos, que es el sujeto real.
    expect(fuera.some((f) => f.enRiesgo), 'ninguna fila fuera del vigente marca enRiesgo: el solape no se está probando').toBe(true);

    expect(cubiertas.length + deficit.length + fuera.length, 'los tres cubos no suman totalSkus').toBe(modelo.totalSkus);
    // Y disjuntos: ninguna fila aparece en dos.
    const skus = [...cubiertas, ...deficit, ...fuera].map((f) => f.sku);
    expect(new Set(skus).size, 'una fila cayó en dos cubos').toBe(skus.length);
  });

  it('la advertencia de déficit NO cuenta las filas fuera del vigente', () => {
    // La otra cara de lo mismo, sobre el texto que sale en el papel. Sin esto,
    // el resumen y la advertencia podrían discrepar entre sí y las dos parecer
    // correctas por separado.
    const modelo = modeloDe(
      detalle({
        partidas: [
          partida({ sku: 'FUERA-1', fuera_del_vigente: true, cantidad: 80, disponible: 0, en_riesgo: true }),
          partida({ sku: 'DEFICIT-1', cantidad: 50, disponible: 1, en_riesgo: true }),
        ],
      }),
    );
    const deficit = modelo.advertencias.find((a) => a.texto.includes('menos disponible'));
    expect(deficit?.texto, 'la advertencia contó la fila cuyo disponible es un residuo, no una medición').toContain('1 partida');
    const filas = deficit?.alcance === 'filas' ? deficit.filas : [];
    expect(filas.map((f) => f.sku)).toEqual(['DEFICIT-1']);
  });

  it('el renderizador NO re-escribe los predicados: viven en un solo sitio', () => {
    // Lo que la prueba de arriba no puede ver. Si `pdf.ts` volviera a preguntar
    // `estatus === 'Fuera del archivo vigente'` o `f.enRiesgo` por su cuenta
    // para pintar superíndices, habría DOS verdades sobre el mismo hecho y las
    // pruebas de modelo seguirían verdes — es el patrón de `piezas_en_camino`,
    // con cuatro implementaciones y nada que las comparara.
    //
    // Se lee CÓDIGO y no prosa: los encabezados de estos archivos citan los
    // predicados para explicarlos, y una guarda ingenua mordería ahí.
    for (const archivo of ['src/services/documento/pdf.ts', 'src/services/documento/xlsx.ts']) {
      const codigo = soloCodigo(readFileSync(join(process.cwd(), archivo), 'utf8'));
      expect(codigo, `${archivo} volvió a escribir el predicado del vigente`).not.toContain('Fuera del archivo vigente');
      expect(codigo, `${archivo} volvió a filtrar por enRiesgo`).not.toMatch(/filter\([^)]*enRiesgo/);
    }
  });

  it('un SKU que SÍ está en el vigente y de verdad no tiene stock sigue diciendo "Sin stock"', () => {
    const modelo = modeloDe(
      detalle({
        partidas: [partida({ total: 0, reservado: 0, disponible: 0, badges: ['stock_cero'], fuera_del_vigente: false })],
      }),
    );
    expect(modelo.filas[0].estatus).toBe('Sin stock');
    expect(modelo.filas[0].nota).toBe('');
  });
});

describe('[INV-B8] el SKU pobre y el proyecto vacío no rompen ningún documento', () => {
  it('sin foto, sin marca, sin descripción, sin tecnología: los dos formatos salen', async () => {
    const modelo = modeloDe(
      detalle({
        agrupacion: { eje: 'sin_banda', sinBanda: 1 },
        partidas: [
          partida({
            sku: 'NUEVO-1',
            descripcion: null,
            marca: null,
            tecnologia: null,
            color: null,
            imagen_url: null,
            banda: null,
            eje_banda: 'sin_banda',
          }),
        ],
      }),
    );

    expect(modelo.filas[0].descripcion).toBe('Sin descripción');
    expect(modelo.filas[0].marca).toBe('Sin marca');
    expect(modelo.filas[0].banda).toBe('Sin clasificar');
    expect(modelo.filas[0].imagen.capa).toBe('generico');
    expect(modelo.agrupacion).toContain('sin agrupar');

    const xlsxBytes = renderizarXlsx(modelo);
    const pdfBytes = await renderizarPdf(modelo);
    expect(xlsxBytes.byteLength).toBeGreaterThan(0);
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('proyecto sin partidas: el XLSX trae su encabezado y el PDF lo dice', async () => {
    const modelo = modeloDe(detalle({ partidas: [], skus: 0, piezas: 0 }));
    const wb = XLSX.read(renderizarXlsx(modelo), { type: 'buffer' });
    const encabezado = XLSX.utils.sheet_to_json(wb.Sheets['Partidas'], { header: 1 })[0] as string[];
    expect(encabezado[0]).toBe('SKU');
    expect(leerPartidasDelXlsx(renderizarXlsx(modelo))).toHaveLength(0);

    const pdf = textoDelPdf(await renderizarPdf(modelo));
    expect(pdf).toContain('todav');
  });
});

describe('[INV-B8] la máquina puede releer el XLSX sin adivinar dónde empieza la tabla', () => {
  it('la hoja "Partidas" arranca en A1 y no lleva bloque de título encima', () => {
    const wb = XLSX.read(renderizarXlsx(modeloDe(detalle())), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Partidas', 'Documento']);
    const ws = wb.Sheets['Partidas'];
    expect(ws['!ref'].startsWith('A1')).toBe(true);
    expect(ws['A1'].v).toBe('SKU');
    expect(ws['!autofilter']).toBeDefined();
  });

  it('el enlace a la foto solo existe cuando de verdad hay foto del SKU', () => {
    const conFoto = modeloDe(detalle({ partidas: [partida({ imagen_url: 'https://x/y/a.png' })] }));
    const sinFoto = modeloDe(detalle({ partidas: [partida({ imagen_url: null })] }));

    const colFoto = XLSX.utils.encode_col(conFoto.columnas.findIndex((c) => c.clave === 'foto'));
    const wsCon = XLSX.read(renderizarXlsx(conFoto), { type: 'buffer' }).Sheets['Partidas'];
    const wsSin = XLSX.read(renderizarXlsx(sinFoto), { type: 'buffer' }).Sheets['Partidas'];

    expect(wsCon[`${colFoto}2`].l?.Target).toBe('https://x/y/a.png');
    expect(wsSin[`${colFoto}2`].l).toBeUndefined();
  });
});
