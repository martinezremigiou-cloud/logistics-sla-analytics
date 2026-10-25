// ============================================================
// [INV-B9.1] correo-plantilla.test.ts
//
// La mitad de este archivo prueba CONTENIDO y la otra mitad prueba que el HTML
// siga siendo el que Outlook entiende. La segunda mitad es la que importa a
// largo plazo: el contenido se nota roto al leerlo, pero un `display:flex` que
// se cuela en un `style=` se ve perfecto en el navegador de quien lo escribió y
// llega desarmado al único cliente donde va a abrirse.
//
// Es un problema medido, no imaginado: la plantilla de
// otro flujo de la misma instancia trae
// `linear-gradient` y `display:flex`.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  cuerpoDeCorreo,
  asuntoDeCorreo,
  agruparPorSku,
  escaparHtml,
  type OpcionesCorreo,
  COPY,
} from './correo-plantilla';
import type { Aviso, Pulso } from './avisos';
import type { CorreoArmado } from './correo';
import { NOMBRE_PRODUCTO } from '@/config/producto';

const VENTANA = { desde: '2026-08-10T06:00:00.000Z', hasta: '2026-08-17T06:00:00.000Z' };

const aviso = (over: Partial<Aviso> = {}): Aviso => ({
  perfil_id: 'p1',
  tipo: 'llegada',
  sku: 'SUJ500-F',
  de: null,
  a: '12',
  detectado_en: '2026-08-14T18:00:00.000Z',
  snapshot_id: 's1',
  ...over,
});

const correo = (over: Partial<CorreoArmado> = {}): CorreoArmado => ({
  perfil_id: 'p1',
  correo: 'kam@example.com',
  avisos: [aviso()],
  incluyePulso: true,
  ...over,
});

const PULSO_VACIO: Pulso = { movimientos: [], llegadas: [], enCamino: { skus: 0, piezas: 0, etapasOcupadas: 0 } };

const PULSO: Pulso = {
  movimientos: [{ sku: 'FZ6661N5', de: 'En Aduana', a: 'En Almacén North' }],
  llegadas: ['JE016-YD'],
  enCamino: { skus: 14, piezas: 3200, etapasOcupadas: 4 },
};

/**
 * [C-5] El orden del catálogo. Es lo ÚNICO que permite distinguir un avance de
 * una vuelta atrás: `Aviso.de`/`.a` son nombres de etapa, no números. Son los
 * 11 de `estatus_catalogo`.
 */
const ORDEN: ReadonlyMap<string, number> = new Map([
  ['Producto Solicitado', 1],
  ['En Preparación', 2],
  ['En Recolección', 3],
  ['En Almacén FW', 4],
  ['En Tránsito Aéreo', 5],
  ['En Tránsito Marítimo', 6],
  ['En Aduana', 7],
  ['En Tránsito Terrestre', 8],
  ['En Almacén Fiscal', 9],
  ['En Almacén North', 10],
  ['Producto Disponible', 11],
]);

/** [C-5] El ESTADO de ahora (cifras de ejemplo). NO es `Pulso`. */
const CATALOGO = { total: 500, disponibles: 310, conReserva: 90 };

const pintar = (c: CorreoArmado = correo(), p: Pulso = PULSO, o: OpcionesCorreo = {}) =>
  cuerpoDeCorreo(c, p, VENTANA, o);

// ============================================================
// LAS REGLAS DEL MOTOR DE WORD. Ninguna de éstas es preferencia de estilo: son
// construcciones que Outlook de escritorio ignora en silencio, y un correo
// maquetado con ellas llega como una columna de texto desarmada.
// ============================================================
describe('[INV-B9.1] la plantilla sobrevive a Outlook', () => {
  const PROHIBIDO: [string, RegExp][] = [
    ['flexbox', /display\s*:\s*(inline-)?flex/i],
    ['grid', /display\s*:\s*(inline-)?grid/i],
    ['gradientes', /linear-gradient|radial-gradient/i],
    ['variables CSS', /var\(\s*--/],
    ['position', /position\s*:\s*(absolute|fixed|sticky)/i],
    ['hojas de estilo', /<style[\s>]|<link[\s>]/i],
    ['imágenes remotas', /<img[\s>]/i],
    ['scripts', /<script[\s>]/i],
  ];

  for (const [nombre, patron] of PROHIBIDO) {
    it(`no usa ${nombre}`, () => {
      // Se prueba sobre el correo MÁS COMPLETO: si una construcción prohibida
      // vive en una rama que este caso no toca, no la detectaríamos.
      expect(pintar(correo(), PULSO, { urlPortal: 'https://portal.example.com' })).not.toMatch(patron);
    });
  }

  it('maqueta con <table>, no con <div>: la estructura tiene que ser tabla', () => {
    const html = pintar();
    expect(html).toMatch(/^<table/);
    expect((html.match(/<table/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('el ancho es fijo en 600 px, el único que sobrevive en todos los clientes', () => {
    expect(pintar()).toContain('width:600px');
  });

  it('los colores van en literal: `var()` no existe en un correo', () => {
    expect(pintar()).toContain('#2E78C7');
  });
});

// ============================================================
// LA ESCAPADA. El SKU, las etapas y los valores salen de dos Excel que captura
// gente. Que hoy no haya un `&` en ninguno no es una defensa: es una medición
// de hoy sobre un dato que se recarga cada semana.
// ============================================================
describe('[INV-B9.1] escapado', () => {
  it('escapa los cinco caracteres que rompen HTML', () => {
    expect(escaparHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('escapa primero el `&`: si no, `&lt;` se volvería `&amp;lt;`', () => {
    expect(escaparHtml('&<')).toBe('&amp;&lt;');
  });

  it('un SKU con `<` no puede inyectar etiquetas en el correo', () => {
    const html = pintar(correo({ avisos: [aviso({ sku: '<script>alerta()</script>' })] }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('una etapa con `&` sale escapada', () => {
    const html = pintar(
      correo({ avisos: [aviso({ tipo: 'estatus', de: 'Aduana & Fiscal', a: 'Almacén' })] }),
    );
    expect(html).toContain('Aduana &amp; Fiscal');
  });

  it('la URL del portal también se escapa antes de entrar en el href', () => {
    const html = pintar(correo(), PULSO, { urlPortal: 'https://x.example.com/"><script>' });
    expect(html).not.toContain('"><script>');
  });
});

describe('[INV-B9.1] agruparPorSku · un renglón por SKU, no por aviso', () => {
  // La corrección que el gate del grano forzó en el panel (P23): un SKU con dos
  // señales es UNA novedad para un humano, no dos.
  it('dos avisos del mismo SKU son UN renglón con dos señales', () => {
    const filas = agruparPorSku([
      aviso({ tipo: 'llegada' }),
      aviso({ tipo: 'estatus', de: 'En Aduana', a: 'En Almacén North' }),
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]!.senales).toHaveLength(2);
  });

  it('ordena las señales por prioridad de lectura: primero lo que se puede prometer', () => {
    const filas = agruparPorSku([aviso({ tipo: 'reservado' }), aviso({ tipo: 'llegada' })]);
    expect(filas[0]!.senales.map((s) => s.tipo)).toEqual(['llegada', 'reservado']);
  });

  // ============================================================
  // DETERMINISTA POR ORDEN. Un correo que cambia el orden de sus renglones
  // entre reintentos haría imposible comprobar que se mandó lo mismo — y esa
  // comprobación es justo lo que `correo.service.ts` promete.
  // ============================================================
  it('el orden de los SKU no depende del orden de llegada de los avisos', () => {
    const a = agruparPorSku([aviso({ sku: 'ZZZ-1' }), aviso({ sku: 'AAA-1' })]);
    const b = agruparPorSku([aviso({ sku: 'AAA-1' }), aviso({ sku: 'ZZZ-1' })]);
    expect(a.map((f) => f.sku)).toEqual(['AAA-1', 'ZZZ-1']);
    expect(a).toEqual(b);
  });

  it('el mismo correo pintado dos veces da EL MISMO HTML, byte por byte', () => {
    const c = correo({ avisos: [aviso({ sku: 'ZZZ-1' }), aviso({ sku: 'AAA-1' })] });
    expect(pintar(c)).toBe(pintar(c));
  });
});

describe('[INV-B9.1] los dos bloques', () => {
  it('«Lo tuyo» va PRIMERO: quien abre quiere saber si le toca hacer algo', () => {
    const html = pintar();
    expect(html.indexOf('LO TUYO')).toBeGreaterThan(-1);
    expect(html.indexOf('LO TUYO')).toBeLessThan(html.indexOf('LO DE TODOS'));
  });

  // ============================================================
  // P17 CON TRAJE DE CORREO: un bloque que se pinta vacío con su título puesto
  // afirma que se miró y no había nada, cuando lo que pasó es que no aplicaba.
  // ============================================================
  it('sin avisos personales, «Lo tuyo» NO se pinta con el título vacío', () => {
    const html = pintar(correo({ avisos: [] }));
    expect(html).not.toContain('LO TUYO');
    expect(html).toContain('LO DE TODOS');
  });

  it('sin boletín, «Lo de todos» no se pinta aunque el pulso traiga cosas', () => {
    const html = pintar(correo({ incluyePulso: false }), PULSO);
    expect(html).toContain('LO TUYO');
    expect(html).not.toContain('LO DE TODOS');
  });

  it('con el boletín encendido pero el pulso vacío, tampoco se pinta', () => {
    const html = pintar(correo({ incluyePulso: true }), PULSO_VACIO);
    expect(html).not.toContain('LO DE TODOS');
  });

  // ============================================================
  // [C-5] EL BLOQUE GENERAL YA NO LISTA SKU, Y ES EL ARREGLO DE A-2.
  //
  // Antes pintaba 8 SKU alfabéticos. C-4 midió que esos 8 eran los de la
  // transición MENOS frecuente mientras la mayoría de los SKU quedaba
  // invisible: un tope alfabético gasta su presupuesto en lo más raro.
  // Ahora agrupa por TRANSICIÓN y cuenta — el sesgo desaparece porque ya no hay
  // muestra que sesgar.
  // ============================================================
  it('el bloque general CUENTA por transición en vez de listar 8 alfabéticos', () => {
    const html = pintar(correo(), PULSO, { ordenDeEtapa: ORDEN });
    expect(html).toContain('avanzaron de etapa');
    expect(html).toContain('en misma etapa');
    // el SKU de un movimiento ya NO se imprime: se cuenta
    expect(html).not.toContain('FZ6661N5');
  });

  it('sin el mapa de orden NO reparte a ojo: dice el total y se declara', () => {
    const html = pintar(correo(), PULSO);
    expect(html).toContain('cambiaron de etapa');
    expect(html).not.toContain('avanzaron de etapa');
  });

  it('lo que viene en camino sigue dicho, con su marca de tiempo', () => {
    const html = pintar();
    expect(html).toContain('3,200'); // piezas, con separador es-MX
    expect(html).toContain('ahora mismo');
  });

  // ============================================================
  // [C-5] A-3 · LOS DOS UNIVERSOS SE NOMBRAN.
  //
  // «Cambiaron de etapa» es un DELTA de la ventana; «en camino» y «están
  // disponibles» son el ESTADO de ahora. Con datos reales valían cifras
  // distintas con intersección CERO; que algún día coincidan es un accidente que enseña al
  // lector que son lo mismo. La marca temporal es lo que los separa.
  // ============================================================
  it('distingue el DELTA de la ventana del ESTADO de ahora', () => {
    const html = pintar(correo(), PULSO, { ordenDeEtapa: ORDEN, catalogo: CATALOGO });
    expect(html).toContain('esta semana');
    expect(html).toContain('ahora mismo');
    expect(html.indexOf('esta semana')).toBeLessThan(html.indexOf('ahora mismo'));
  });

  it('el estado del catálogo dice su denominador y que los conjuntos se solapan', () => {
    const html = pintar(correo(), PULSO, { catalogo: CATALOGO });
    expect(html).toContain('SKU con piezas disponibles');
    expect(html).toContain('SKU con reserva activa');
    expect(html).toContain('De 500 SKU en catálogo');
    expect(html).toContain('Un SKU puede estar en los dos');
  });

  it('la ventana se dice en la cabecera, en zona México', () => {
    // 2026-08-10T06:00Z son las 00:00 del 10 de agosto en México: si se
    // renderizara en UTC diría el mismo día por casualidad, pero un `hasta` de
    // las 18:00 CDMX se iría al día siguiente. La zona es del dato, no del runtime.
    expect(pintar()).toMatch(/Novedades del .*ago.* al .*ago/);
  });
});

// ============================================================
// NO TRUNCAR CALLADO. Cortar en silencio haría que el correo afirmara que eso
// fue todo lo que pasó — y es exactamente la clase de mentira por omisión que
// este proyecto viene persiguiendo.
// ============================================================
describe('[INV-B9.1] el tope del bloque general se DECLARA', () => {
  const muchos: Pulso = {
    movimientos: Array.from({ length: 12 }, (_, i) => ({
      sku: `SKU-${String(i).padStart(2, '0')}`,
      de: 'A',
      a: 'B',
    })),
    llegadas: Array.from({ length: 11 }, (_, i) => `LLEG-${String(i).padStart(2, '0')}`),
    enCamino: { skus: 1, piezas: 1, etapasOcupadas: 1 },
  };

  it('las llegadas dicen cuántas se quedaron fuera, y no cortan en silencio', () => {
    const html = pintar(correo(), muchos);
    expect(html).toContain('y 3 más'); // 11 llegadas − 8
  });

  it('los movimientos ya no truncan: se cuentan, así que no hay resto que esconder', () => {
    const html = pintar(correo(), muchos, { ordenDeEtapa: ORDEN });
    expect(html).not.toContain('y 4 más'); // 12 − 8, el recorte que ya no existe
  });

  it('con pocos, no inventa un «y 0 más»', () => {
    expect(pintar(correo(), PULSO)).not.toContain('y 0 más');
  });

  // ============================================================
  // [C-5] GATE NUEVO 1 · «LO TUYO» SÍ SE ACOTA, Y LO DICE.
  //
  // ESTE TEST REVIERTE UNA DECISIÓN ANTERIOR, y hay que decirlo: antes afirmaba
  // que «Lo tuyo» NO se acotaba, «porque son los que la persona eligió seguir».
  // C-4 midió por qué eso no se sostiene: `bloqueTuyo` no tenía un solo
  // `.slice(`, `MAX_SEGUIMIENTOS` vale 200, y el cliente recorta el cuerpo mucho
  // antes — **y al recortar cae el pie, que es el único `<a>` del correo**. El
  // lector se queda sin la palanca para apagarlo, y un boletín que no se puede
  // apagar se marca como spam.
  //
  // Firmado el 13-sep sobre artefact renderizado.
  // ============================================================
  it('«Lo tuyo» se acota y DICE cuántos quedaron fuera', () => {
    const muchosMios = Array.from({ length: 26 }, (_, i) =>
      aviso({ sku: `MIO-${String(i).padStart(2, '0')}` }),
    );
    const html = pintar(correo({ avisos: muchosMios }), PULSO, { urlPortal: 'https://p.example.com' });
    expect(html).toContain('MIO-00');
    expect(html).toContain('MIO-24');
    expect(html).not.toContain('MIO-25'); // el 26.º queda fuera
    expect(html).toContain('y 1 más');
    expect(html).toContain('ver todos en el portal');
  });

  it('debajo del tope no recorta ni anuncia un resto', () => {
    const pocos = Array.from({ length: 5 }, (_, i) => aviso({ sku: `MIO-${i}` }));
    const html = pintar(correo({ avisos: pocos }));
    expect(html).toContain('MIO-4');
    expect(html).not.toContain('ver todos en el portal');
  });
});

// ============================================================
// [C-5] GATE NUEVO 2 · MODO OSCURO.
//
// Outlook y Gmail invierten colores. Invierten LO QUE ENCUENTRAN: si un
// elemento declara texto y no fondo, el fondo se invierte y el texto no —
// negro sobre negro. C-4 midió el estado anterior: muchos `style` con color de
// texto y **ninguno con los dos**.
//
// LAS DOS DEFENSAS HABITUALES ESTÁN VETADAS AQUÍ, y por eso este gate existe:
// `<meta name="color-scheme">` exige un `<head>` que este fragmento no tiene, y
// una `@media (prefers-color-scheme)` exige `<style>`, que el detector #6
// prohíbe. Declarar el par en cada elemento es la única que sobrevive al gate.
// ============================================================
describe('[CORREO·C-5] el correo sobrevive al modo oscuro', () => {
  /** Un `color:` de verdad, no el final de `background-color:`. */
  const TIENE_TINTA = /(^|;)\s*color\s*:/;
  const TIENE_FONDO = /background-color\s*:/;

  const estilos = (html: string): string[] =>
    Array.from(html.matchAll(/style="([^"]*)"/g)).map((m) => m[1]!);

  it('todo elemento que declara color de TEXTO declara también su FONDO', () => {
    const html = pintar(correo({ avisos: [aviso(), aviso({ sku: 'B', tipo: 'estatus', de: 'En Aduana', a: 'En Preparación' })] }), PULSO, {
      urlPortal: 'https://p.example.com',
      ordenDeEtapa: ORDEN,
      catalogo: CATALOGO,
      cifras: new Map([['SUJ500-F', { disponible: 12, reservado: 0 }]]),
      proyectos: { proyectos: 3, partidas: 9 },
      preencabezado: 'Tres SKU tuyos se movieron',
    });
    const huerfanos = estilos(html).filter((e) => TIENE_TINTA.test(e) && !TIENE_FONDO.test(e));
    expect(huerfanos, 'elementos con texto y sin fondo: se invierten a medias').toEqual([]);
  });

  it('el control: hay suficientes estilos con color como para que la prueba NO sea vacua (P17)', () => {
    const conTinta = estilos(pintar()).filter((e) => TIENE_TINTA.test(e));
    expect(conTinta.length).toBeGreaterThan(10);
  });
});

// ============================================================
// [C-5] LA CIFRA DEL RENGLÓN, Y EL CASO QUE EL DISEÑO NO ANTICIPÓ.
//
// `disponible` puede salir NEGATIVO: es `sobre_reservado` —hay más apartado que
// existencias—, y son **una fracción pequeña de los SKU del vigente**. Al
// renderizar el correo real aparecieron seis en el bloque personal.
//
// Se pinta el número real. Redondearlo a 0 mentiría sobre el inventario y
// esconderlo dejaría al KAM prometiendo piezas comprometidas.
// ============================================================
describe('[CORREO·C-5] la cifra del renglón', () => {
  const conCifra = (disponible: number) =>
    pintar(correo(), PULSO_VACIO, { cifras: new Map([['SUJ500-F', { disponible, reservado: 0 }]]) });

  it('un disponible NEGATIVO se pinta tal cual, no se redondea a cero', () => {
    const html = conCifra(-30);
    expect(html).toContain('-30');
    expect(html).toContain('disponible');
  });

  it('sin cifra para ese SKU, la celda no se pinta: un 0 se leería como «no hay»', () => {
    const html = pintar(correo(), PULSO_VACIO, { cifras: new Map() });
    expect(html).not.toContain('>disponible<');
  });

  // ----------------------------------------------------------
  // [C-12] EL COPY FIRMADO DEL SOBRE-RESERVADO.
  //
  // Hasta hoy el ámbar decía «esto es una excepción» sin decir CUÁL. **Un color
  // no es un rótulo**, y un lector de pantalla no lo lee siquiera.
  //
  // La aserción se ata a `COPY.sobreReservado` y NO a la cadena literal: si el
  // copy cambia, esta prueba lo sigue: un gate escrito con la frase vieja
  // se quedaría vigilando un texto que ya no existe y seguiría en verde.
  //
  // Y se exige que vaya EN EL MISMO ELEMENTO EN ÁMBAR, no suelto en el correo:
  // la deuda no era «que aparezca la palabra», era «que la cifra tenga rótulo».
  // ----------------------------------------------------------
  const ROTULO_EN_AMBAR = new RegExp(
    `<div[^>]*color:#8A5A12[^>]*>${COPY.sobreReservado}</div>`,
  );

  it('un disponible NEGATIVO lleva el copy firmado, y va en ámbar junto a la cifra', () => {
    const html = conCifra(-30);
    expect(html).toMatch(ROTULO_EN_AMBAR);
  });

  it('un disponible POSITIVO no lo lleva: el rótulo nombra la excepción, no el caso normal', () => {
    expect(conCifra(12)).not.toContain(COPY.sobreReservado);
  });

  it('un disponible CERO tampoco: cero no es sobre-reservado', () => {
    expect(conCifra(0)).not.toContain(COPY.sobreReservado);
  });
});

// ============================================================
// [C-17] LA CIFRA DE «LO TUYO» Y EL SUSTANTIVO QUE LA NOMBRA.
//
// El rotulo decia «N SKU que sigues» y la cifra es `filas.length`: **los SKU que
// van EN ESTE CORREO**. Medido sobre el perfil de prueba: sigue más SKU de los
// que van en el correo, y el correo dijo la cifra de los que van. Numero correcto, sustantivo equivocado.
//
// Y el gate no vigila una frase: vigila UNA RAZON.
//
//   `cuerpoDeCorreo` NO RECIBE cuantos SKU sigue nadie. No hay parametro, no hay
//   opcion, no hay forma de saberlo desde aqui. ⇒ **cualquier rotulo que afirme
//   la posesion es inverificable POR CONSTRUCCION**, no por descuido.
//
// Por eso la lista de abajo es de formas de AFIRMAR POSESION, no la cadena vieja:
// si manana alguien escribe «tus SKU seguidos», el gate lo caza igual.
// ============================================================
describe('[CORREO·C-17] la cifra de «lo tuyo» dice lo que cuenta', () => {
  const dos = correo({
    avisos: [aviso({ sku: 'AAA-1' }), aviso({ sku: 'ZZZ-9' })],
  });

  const POSESION_INVERIFICABLE = [
    /SKU que sigues/i,
    /SKU seguidos/i,
    /que sigues/i,
  ];

  it('nombra lo que la cifra cuenta, y con el copy de COPY —no con una cadena suelta', () => {
    const html = pintar(dos, PULSO_VACIO);
    expect(html).toContain(`2 ${COPY.skusConNovedad}`);
  });

  for (const patron of POSESION_INVERIFICABLE) {
    it(`no afirma posesion: ${patron.source}`, () => {
      // Sobre el correo MAS COMPLETO: si la frase vive en una rama que este caso
      // no toca, no la veriamos (P17).
      const html = pintar(dos, PULSO, { urlPortal: 'https://p.example.com', proyectos: { proyectos: 3, partidas: 7 } });
      expect(html).not.toMatch(patron);
    });
  }

  // Control de NO VACUIDAD: si la cabecera de «lo tuyo» dejara de pintarse, las
  // tres pruebas de arriba pasarian sin vigilar nada.
  it('y la cabecera de «lo tuyo» existe: sin esto, lo de arriba seria vacuo', () => {
    expect(pintar(dos, PULSO_VACIO)).toContain('LO TUYO');
  });

  // Los vecinos SI cuentan posesion, y esta medido: salen de `proyectos.propietario`
  // en `leerProyectosPorPerfil`. Se fija para que nadie los "arregle" por simetria.
  it('«proyecto» y «partida» SI cuentan lo que se posee, y no cambian', () => {
    const html = pintar(dos, PULSO_VACIO, { proyectos: { proyectos: 3, partidas: 7 } });
    expect(html).toContain('3 proyectos');
    expect(html).toContain('7 partidas');
  });
});

// ============================================================
// [C-5] LA CABECERA DE «LO TUYO». Un «1 proyectos» le quita crédito a todo lo
// que hay debajo, y este correo se va a leer entero.
// ============================================================
describe('[CORREO·C-5] la cabecera de «Lo tuyo»', () => {
  const conProyectos = (proyectos: number, partidas: number) =>
    pintar(correo(), PULSO_VACIO, { proyectos: { proyectos, partidas } });

  it('concuerda el singular', () => {
    const html = conProyectos(1, 1);
    expect(html).toContain('1 proyecto &middot;');
    expect(html).toContain('1 partida<');
  });

  it('concuerda el plural', () => {
    expect(conProyectos(3, 9)).toContain('3 proyectos');
  });

  it('sin proyectos no pinta un «0 proyectos»', () => {
    const html = conProyectos(0, 0);
    expect(html).not.toContain('proyecto');
    // [C-17] Antes esta línea clavaba «SKU que sigues», y con ella sostenía la
    // etiqueta falsa: **un gate puede conservar un defecto en vez de cazarlo.**
    // Se ata a `COPY`, que es donde vive el copy firmado.
    expect(html).toContain(COPY.skusConNovedad);
  });

  // ============================================================
  // EL CASO QUE LA RUTA PRODUCE DE VERDAD, y es distinto del `0`.
  //
  // `proyectosPorPerfil.get(perfil_id)` devuelve **`undefined`** para quien no
  // tiene ninguno — no `{proyectos: 0}`. Probar solo el `0` habría dejado sin
  // cubrir el único camino que ocurre en producción.
  //
  // Y no es un detalle: `proyectos.propietario` es LA CUENTA QUE LO CREÓ, no un
  // KAM asignado. Medido en producción: **ningún** proyecto era de un perfil
  // con rol `kam`. O sea que hoy ESTE es el caso de todos los KAM, siempre.
  // Ver `docs/known-limitations.md` (PROYECTO-ACTIVO-NO-EXISTE).
  // ============================================================
  it('con `proyectos` AUSENTE —el caso de todo KAM hoy— el bloque no aparece', () => {
    const html = pintar(correo(), PULSO_VACIO, {});
    expect(html).not.toContain('proyecto');
    expect(html).not.toContain('partida');
    expect(html).toContain(COPY.skusConNovedad);   // [C-17] ver la nota de arriba
  });

  // `proyectos` NO tiene columna de estado: «activo» no existe en la base.
  // Decirlo sería afirmar de más sobre un conteo que incluye todo.
  it('NO dice «activos»: la base no sabe qué es un proyecto activo', () => {
    expect(conProyectos(3, 9)).not.toContain('activos');
  });
});

// ============================================================
// [C-5] GATE NUEVO 3 · EL PIE LLEVA LA PALANCA, NO LA NOMBRA.
//
// C-4 lo midió: el único `<a>` del correo apuntaba a `/catalogo`, y
// «Configuración» era TEXTO PLANO — cuando `/config` es la única página que
// apaga el boletín. Un boletín que nombra dónde apagarse sin enlazarlo es un
// boletín que se apaga marcándolo como spam.
// ============================================================
describe('[CORREO·C-5] el pie', () => {
  // La aserción ata el HREF AL TEXTO, y no es un detalle de estilo: la primera
  // versión de esta prueba solo pedía que `/config` apareciera en algún href, y
  // el control por mutación la encontró VACUA — quitar el enlace de «Ajustar
  // mis avisos» la dejaba verde, porque «Dejar de recibir» apunta al mismo
  // sitio. Un gate que se satisface con que OTRO enlace exista no vigila el que
  // dice vigilar.
  const ANCLA = (texto: string) =>
    new RegExp(`<a href="https://p\\.example\\.com/config"[^>]*>${texto}</a>`);

  it('las DOS palancas de /config son enlaces, no texto que las nombra', () => {
    const html = pintar(correo(), PULSO, { urlPortal: 'https://p.example.com' });
    expect(html).toMatch(ANCLA('Ajustar mis avisos'));
    expect(html).toMatch(ANCLA('Dejar de recibir'));
  });

  it('«Abrir el portal» va al catálogo, no a configuración', () => {
    const html = pintar(correo(), PULSO, { urlPortal: 'https://p.example.com' });
    expect(html).toMatch(/<a href="https:\/\/p\.example\.com\/catalogo"[^>]*>Abrir el portal<\/a>/);
  });

  it('sin urlPortal degrada a texto y NO deja un href roto', () => {
    const html = pintar(correo(), PULSO, {});
    expect(html).not.toContain('href="undefined');
    expect(html).toContain('Configuración');
  });
});

// ============================================================
// [C-5] EL PREENCABEZADO.
//
// Sin él, Outlook enseña junto al asunto las primeras palabras del cuerpo —que
// eran «Logistics SLA Analytics Novedades del…», o sea el remitente repetido—.
// Va DENTRO de la primera celda y no antes de la tabla: el gate afirma que el
// HTML empieza en `<table` y ese gate no se relaja.
// ============================================================
describe('[CORREO·C-5] el preencabezado', () => {
  it('se pinta oculto y no rompe la regla de empezar en <table', () => {
    const html = pintar(correo(), PULSO, { preencabezado: 'Once SKU tuyos se movieron' });
    expect(html).toMatch(/^<table/);
    expect(html).toContain('Once SKU tuyos se movieron');
    expect(html).toContain('mso-hide:all');
    expect(html.indexOf('Once SKU')).toBeLessThan(html.indexOf(NOMBRE_PRODUCTO));
  });

  it('ausente, no deja un hueco', () => {
    expect(pintar()).not.toContain('mso-hide:all');
  });
});

// ============================================================
// [C-5] AVANCE vs MISMA ETAPA — el copy acordado.
//
// «Retroceso» NO existe en este correo, y la razón es ésta: acusa al
// archivo plano de un error que no cometió. Y NUNCA «sigue en X»: el SKU no
// seguía ahí, VOLVIÓ. «Sigue» afirmaría algo que no pasó.
// ============================================================
describe('[CORREO·C-5] el sentido de una etapa', () => {
  const conEtapa = (de: string, a: string, o: OpcionesCorreo = {}) =>
    pintar(correo({ avisos: [aviso({ tipo: 'estatus', de, a })] }), PULSO_VACIO, o);

  it('hacia adelante dice «Avanzó»', () => {
    const html = conEtapa('En Preparación', 'En Almacén FW', { ordenDeEtapa: ORDEN });
    expect(html).toContain('Avanzó');
    expect(html).not.toContain('En misma etapa');
  });

  it('hacia atrás dice «En misma etapa», NUNCA «retroced»', () => {
    const html = conEtapa('En Almacén FW', 'En Preparación', { ordenDeEtapa: ORDEN });
    expect(html).toContain('En misma etapa');
    expect(html.toLowerCase()).not.toContain('retroced');
  });

  it('dice «ahora en X» y NUNCA «sigue en X»', () => {
    const html = conEtapa('En Almacén FW', 'En Preparación', { ordenDeEtapa: ORDEN });
    expect(html).toContain('ahora en');
    expect(html).not.toContain('sigue en');
  });

  it('sin el mapa de orden NO clasifica: cae a la etiqueta neutra', () => {
    const html = conEtapa('En Almacén FW', 'En Preparación');
    expect(html).toContain('Cambió de etapa');
    expect(html).not.toContain('Avanzó');
    expect(html).not.toContain('En misma etapa');
  });

  it('una etapa que el catálogo no conoce tampoco se clasifica', () => {
    const html = conEtapa('En Preparación', 'Etapa Inventada', { ordenDeEtapa: ORDEN });
    expect(html).toContain('Cambió de etapa');
    expect(html).not.toContain('Avanzó');
  });
});

describe('[INV-B9.1] el asunto', () => {
  it('dice el número de SKU, no el de avisos', () => {
    const c = correo({
      avisos: [aviso({ tipo: 'llegada' }), aviso({ tipo: 'estatus', de: 'A', a: 'B' }), aviso({ sku: 'OTRO-1' })],
    });
    // 3 avisos, 2 SKU.
    expect(asuntoDeCorreo(c)).toContain('2');
    expect(asuntoDeCorreo(c)).not.toContain('3');
  });

  it('con un solo SKU lo nombra: es más útil que un número', () => {
    expect(asuntoDeCorreo(correo())).toContain('SUJ500-F');
  });

  it('sin nada personal, el asunto es el del boletín y no promete novedades tuyas', () => {
    const asunto = asuntoDeCorreo(correo({ avisos: [] }));
    expect(asunto).toContain('esta semana');
    expect(asunto).not.toMatch(/tus SKU/);
  });
});

describe('[INV-B9.1] el pie', () => {
  it('con URL, enlaza al portal', () => {
    expect(pintar(correo(), PULSO, { urlPortal: 'https://portal.example.com' })).toContain(
      'https://portal.example.com/catalogo',
    );
  });

  // Un enlace a `undefined/catalogo` sería peor que no tener enlace.
  it('sin URL, degrada a texto y NO deja un href roto', () => {
    const html = pintar();
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('<a href');
  });
});
