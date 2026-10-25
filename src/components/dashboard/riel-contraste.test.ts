import { describe, it, expect } from "vitest";
import { croma, deltaE2000, hexDeToken, razonDeContraste, TEMAS } from "./contraste.testutil";

/**
 * El contraste del riel, recalculado desde el TEMA — no desde una cifra copiada.
 *
 * Este bloque ya aprendió la misma lección dos veces, y por eso este archivo existe:
 *
 * 1. Dibujé el borde del estado apagado con `--mx-muted-3` (1,48:1 sobre blanco),
 *    el mismo defecto que yo mismo le había señalado a «Sin KAM».
 * 2. Al «corregir» una cifra **a mano** me equivoqué de aritmética y declaré 5,48
 *    donde el valor real es 5,62 — P29 aplicado a mí: una cifra sin comando detrás,
 *    usada además para corregir una que estaba bien.
 *
 * El antídoto no es acordarse: es que la cifra **no la escriba nadie**. Los hex se
 * LEEN de `globals.css` y la razón se CALCULA, así que el día que el tema cambie un
 * token esta prueba lo dice en vez de envejecer callada.
 *
 * **La fórmula no está aquí: vive en `contraste.testutil.ts`, y es una sola.** La
 * primera versión de este archivo llevaba su propia copia — dos implementaciones de
 * lo mismo sin nada que las compare, que es exactamente cómo este repo se ganó las
 * cuatro de `piezas_en_camino`.
 *
 * Su límite, dicho: esta tabla afirma que ESAS PAREJAS pasan, no que el componente
 * use esas parejas. Esa otra mitad la sostiene `dashboard-pipeline.test.tsx`, que
 * resuelve la clase que el riel puso de verdad y calcula SU razón. Las dos juntas
 * cierran el círculo; ninguna sola basta (P27).
 */

/**
 * Cada pareja que el riel dibuja, con el piso que le toca y POR QUÉ ese piso.
 * El borde del bloque apagado no es decoración: dice «este grupo existe y está en
 * cero», así que cae bajo 1.4.11 (objeto gráfico, 3:1), no bajo «decorativo».
 */
const PAREJAS = [
  { que: "borde del bloque apagado", fg: "mx-muted", bg: "mx-surface", piso: 3, regla: "1.4.11 objeto gráfico" },
  { que: "cifra e ícono del bloque apagado", fg: "mx-muted", bg: "mx-surface", piso: 4.5, regla: "1.4.3 texto normal" },
  { que: "cifra e ícono del bloque vivo", fg: "mx-surface", bg: "mx-accent", piso: 4.5, regla: "1.4.3 texto normal" },
  { que: "cifra del bloque sin gramática", fg: "mx-text-2", bg: "mx-surface", piso: 4.5, regla: "1.4.3 texto normal" },
  // El rótulo NO vive sobre una superficie: el riel no tiene marco, así que su fondo
  // es el de la app. Medirlo contra `--mx-surface` sería medir otra cosa — y es el
  // error que cometí: di por medido «el estado apagado» habiendo medido solo el borde.
  { que: "rótulo del grupo vivo", fg: "mx-text-2", bg: "mx-bg", piso: 4.5, regla: "1.4.3 texto normal" },
  { que: "rótulo del grupo apagado", fg: "mx-text-3", bg: "mx-bg", piso: 4.5, regla: "1.4.3 texto normal" },
  { que: "cintillo «Embarques» del riel", fg: "mx-text-2", bg: "mx-bg", piso: 4.5, regla: "1.4.3 texto normal" },
  // El anillo de foco porta información, y su offset es el fondo de la app: sin
  // token, Tailwind lo pinta BLANCO y en oscuro el anillo cae a 2,76:1.
  { que: "anillo de foco sobre su offset", fg: "mx-accent", bg: "mx-bg", piso: 3, regla: "1.4.11 objeto gráfico" },
] as const;

/**
 * Los seis tonos del riel, con sus DOS restricciones. [DASH-E · paleta, 13-sep]
 *
 * Un bloque relleno se juzga dos veces y por reglas distintas, y medir solo la
 * primera es cómo se cuela un tono malo:
 *
 * **A · el relleno contra su TINTA** — la cifra va a 12,5 px en negrita, que para
 * WCAG es *texto normal*: 4,5 : 1. La tinta es `--mx-surface`, que se invierte
 * (blanco ↔ casi negro) justo al revés que los tonos, así que la misma pareja vale
 * en los dos temas sin variante `dark:`.
 *
 * **B · el relleno contra el FONDO DE LA APP** — el bloque es un objeto gráfico que
 * porta información, y su borde contra la página cae bajo 1.4.11: 3 : 1. El riel no
 * tiene marco, así que ese fondo es `--mx-bg` y no `--mx-surface`.
 *
 * **Y aquí va la confesión, porque intentar romper B me la enseñó:** con los fondos
 * que el tema tiene HOY, **B está implicada por A y no puede ponerse roja sola**.
 * `--mx-surface` y `--mx-bg` están casi pegados, así que la razón de un mismo tono
 * contra uno y contra otro difiere por un factor fijo —0,9237 en claro, 1,1085 en
 * oscuro— y con A ≥ 4,5 el mínimo posible de B es 4,16. Una guarda que no puede
 * morder es P19, y yo escribí seis.
 *
 * **No se borran: se les cambia el trabajo.** B no vigila los TONOS, vigila los
 * FONDOS. Si alguien mueve `--mx-bg` hacia el medio, B empieza a morder de verdad —
 * y para que eso no pase en silencio, la prueba de abajo afirma el factor mismo y
 * dice, cuando cambia, que B dejó de ser un corolario y pasó a ser una restricción.
 *
 * `--mx-good` **no está aquí, y esa es la historia del tercer token**: da 4,33 : 1
 * con blanco en claro y reprueba A. No se puede oscurecer en sitio porque alimenta
 * `success` (68 usos en el portal) y la tercera serie del radar — repintarlo cambiaría
 * todos los estados de éxito de la app. De ahí `--mx-graf-jade`, que es el mismo
 * matiz (157°, 63 %) 1,5 puntos más hondo.
 */
const TONOS_DEL_RIEL = [
  { grupo: "Importación", token: "mx-navy-ink" },
  { grupo: "Tránsito internacional", token: "mx-info" },
  { grupo: "Aduana", token: "mx-graf-pizarra" },
  { grupo: "Tránsito terrestre", token: "mx-accent" },
  { grupo: "Almacenes", token: "mx-graf-petroleo" },
  { grupo: "Disponible", token: "mx-graf-jade" },
] as const;

describe("contraste del riel de embarques", () => {
  for (const p of PAREJAS) {
    it(`${p.que}: --${p.fg} sobre --${p.bg} pasa ${p.piso}:1 en los DOS temas (${p.regla})`, () => {
      for (const tema of TEMAS) {
        const fg = hexDeToken(p.fg, tema);
        const bg = hexDeToken(p.bg, tema);
        const razon = razonDeContraste(fg, bg);
        expect(razon, `${tema}: ${fg} sobre ${bg} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(p.piso);
      }
    });
  }

  // CONTROL POSITIVO. Sin esto, las pruebas de arriba podrían estar pasando porque
  // la fórmula devuelve algo grande siempre — y no lo sabría nadie.
  it("CONTROL POSITIVO · los tonos que el riel NO puede usar salen reprobados por esta misma fórmula", () => {
    // 1,48:1 — el borde que dibujé primero.
    expect(razonDeContraste(hexDeToken("mx-muted-3", "claro"), hexDeToken("mx-surface", "claro"))).toBeLessThan(3);
    // 2,56:1 — el tono con el que la revisión adversaria rompió la lista negra.
    expect(razonDeContraste(hexDeToken("mx-muted-2", "claro"), hexDeToken("mx-surface", "claro"))).toBeLessThan(3);
    // 4,40:1 — el rótulo apagado antes de mudarlo a `--mx-text-3`.
    expect(razonDeContraste(hexDeToken("mx-muted", "claro"), hexDeToken("mx-bg", "claro"))).toBeLessThan(4.5);
    // 2,76:1 — el anillo de foco contra el offset BLANCO que Tailwind pone por omisión.
    expect(razonDeContraste(hexDeToken("mx-accent", "oscuro"), "#FFFFFF")).toBeLessThan(3);
  });

  for (const t of TONOS_DEL_RIEL) {
    it(`tono de ${t.grupo} (--${t.token}): 4,5:1 con su tinta y 3:1 contra el fondo, en los DOS temas`, () => {
      for (const tema of TEMAS) {
        const relleno = hexDeToken(t.token, tema);
        const conTinta = razonDeContraste(relleno, hexDeToken("mx-surface", tema));
        const conFondo = razonDeContraste(relleno, hexDeToken("mx-bg", tema));
        expect(conTinta, `A · ${tema}: cifra sobre ${relleno} = ${conTinta.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        expect(conFondo, `B · ${tema}: ${relleno} sobre el fondo = ${conFondo.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // El estado de la restricción B, afirmado en vez de supuesto. Mientras esto pase,
  // las seis aserciones «vs fondo» de arriba son un COROLARIO de las «vs tinta», no
  // una comprobación independiente — y decirlo es la diferencia entre una guarda
  // honesta y una que aparenta cubrir el doble de lo que cubre.
  it("la restricción B sigue IMPLICADA por A: si esto cambia, es que los fondos del tema se movieron", () => {
    for (const tema of TEMAS) {
      const sup = hexDeToken("mx-surface", tema);
      const bg = hexDeToken("mx-bg", tema);
      // Un mismo tono contra las dos superficies difiere por un factor fijo, porque
      // las dos están del mismo lado del tono. En claro el tono es oscuro; en oscuro,
      // claro. La razón de razones sale de la definición de WCAG sin tocar el tono.
      const factor = razonDeContraste("#000000", bg) / razonDeContraste("#000000", sup);
      const minimoDeB = 4.5 * (tema === "claro" ? factor : 1 / factor);
      expect(
        minimoDeB,
        `${tema}: con A ≥ 4,5 el mínimo de B es ${minimoDeB.toFixed(2)}. Si baja de 3, B deja de ser corolario y pasa a ser restricción viva — revisa las seis aserciones «vs fondo».`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  // CONTROL POSITIVO de la tabla de arriba: el tono que se pidió oscurecer
  // REPRUEBA por esta misma medición, y por eso existe `--mx-graf-jade`. Sin esta
  // línea, las seis pruebas anteriores podrían estar pasando por complacientes.
  it("CONTROL POSITIVO · --mx-good, el verde SIN oscurecer, reprueba la restricción A en claro", () => {
    const razon = razonDeContraste(hexDeToken("mx-good", "claro"), hexDeToken("mx-surface", "claro"));
    expect(razon).toBeLessThan(4.5); // 4,33:1
    // Y el oscurecido pasa CON MARGEN, no raspando: `--mx-accent` ya vive en 4,54 y
    // un segundo tono sin holgura es el que rompe el próximo retoque del tema.
    expect(razonDeContraste(hexDeToken("mx-graf-jade", "claro"), hexDeToken("mx-surface", "claro"))).toBeGreaterThanOrEqual(4.6);
  });

  it("CONTROL POSITIVO · la fórmula reproduce los dos extremos conocidos de WCAG", () => {
    expect(razonDeContraste("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(razonDeContraste("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

/**
 * La RAMPA de «Reservas por KAM» — E-6. [DASH-E · 15-sep-2026]
 *
 * Seis pasos del mismo matiz. **Tres criterios, y el tercero no es de WCAG:**
 *
 * - **A · relleno vs SU TINTA ≥ 4,5:1.** La cifra va dentro de la burbuja cuando cabe,
 *   así que el relleno es fondo de texto. **La tinta se elige por paso y VOLTEA en el
 *   6.º** — un relleno claro no puede llevar tinta clara, y ese volteo es justo lo que
 *   esta prueba verifica paso por paso en vez de dar por supuesto.
 * - **B · relleno vs superficie Y vs fondo ≥ 3:1** (WCAG 1.4.11). Se exigen **las dos**
 *   a propósito: la tarjeta tiene marco —a diferencia del riel— así que el sujeto real
 *   es `--mx-surface`; pedir también `--mx-bg` quita la discusión sin costar nada.
 * - **ΔL\* de CIELAB ≥ 8 entre pasos consecutivos.** **Elegido, no normativo, y se dice:**
 *   la razón de contraste mide **legibilidad**; «¿se distinguen estos dos tonos?» es otra
 *   pregunta y su métrica es ΔL\*. Medir la distinguibilidad con la razón de contraste
 *   sería usar el instrumento que uno tiene a mano en vez del que mide la cosa (P27).
 */
const RAMPA = [1, 2, 3, 4, 5, 6].map((n) => `mx-graf-verde-${n}`);

/**
 * [DASH-F · D-2] Los DOS criterios que el verde añadió, con sus umbrales DERIVADOS.
 *
 * Se firmó verde sabiendo el riesgo: el sistema ya tiene un verde con
 * significado —`--mx-graf-jade`, «Disponible»— **en la misma pantalla**. Los dos
 * umbrales se calculan aquí, de otros artefactos del repo, en vez de escribirse:
 * una cifra copiada es una segunda verdad sobre el mismo hecho, y este repo ya
 * pagó ese patrón.
 */
/** Los seis del riel, DERIVADOS de la tabla de arriba — no una segunda copia de la lista. */
const TOKENS_DEL_RIEL: string[] = TONOS_DEL_RIEL.map((t) => t.token);
const SIGNIFICADOS_DE_LA_PANTALLA = [...TOKENS_DEL_RIEL, "mx-good", "mx-warn"];
const VIOLETA = [1, 2, 3, 4, 5, 6].map((n) => `mx-graf-violeta-${n}`);

/** Lo que separa al par MÁS PARECIDO de los seis tonos del riel — tonos que ya se aceptaron como distintos. */
function umbralDeSeparacion(): number {
  let min = Infinity;
  for (const tema of TEMAS) {
    for (let i = 0; i < TOKENS_DEL_RIEL.length; i++) {
      for (let j = i + 1; j < TOKENS_DEL_RIEL.length; j++) {
        min = Math.min(min, deltaE2000(hexDeToken(TOKENS_DEL_RIEL[i], tema), hexDeToken(TOKENS_DEL_RIEL[j], tema)));
      }
    }
  }
  return min;
}

/** El croma MÍNIMO de la rampa violeta — la que ya se aceptó como que «se lee violeta». */
function pisoDeCroma(): number {
  return Math.min(...TEMAS.flatMap((tema) => VIOLETA.map((v) => croma(hexDeToken(v, tema)))));
}

/** L* de CIELAB desde la luminancia relativa — la métrica de «se distinguen», no de «se lee». */
function lEstrella(hex: string): number {
  const lineal = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = [1, 3, 5].map((i) => lineal(parseInt(hex.slice(i, i + 2), 16) / 255));
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

describe("la rampa de Reservas por KAM", () => {
  it("son SEIS pasos, y ninguno repite valor dentro de su tema", () => {
    for (const tema of TEMAS) {
      const hex = RAMPA.map((t) => hexDeToken(t, tema));
      expect(hex).toHaveLength(6);
      expect(new Set(hex).size, `${tema}: dos pasos con el mismo hex`).toBe(6);
    }
  });

  RAMPA.forEach((token, i) => {
    it(`paso ${i + 1} (--${token}): pasa A con ALGUNA tinta y B contra superficie y fondo, en los DOS temas`, () => {
      for (const tema of TEMAS) {
        const relleno = hexDeToken(token, tema);

        // A · la tinta se elige POR PASO: se exige que exista una que pase, no una fija.
        const conTexto = razonDeContraste(relleno, hexDeToken("mx-text", tema));
        const conSuperficie = razonDeContraste(relleno, hexDeToken("mx-surface", tema));
        const mejorTinta = Math.max(conTexto, conSuperficie);
        expect(
          mejorTinta,
          `A · ${tema}: ninguna tinta del tema alcanza 4,5:1 sobre ${relleno} (texto ${conTexto.toFixed(2)}, superficie ${conSuperficie.toFixed(2)})`,
        ).toBeGreaterThanOrEqual(4.5);

        // B · contra las DOS superficies.
        for (const fondo of ["mx-surface", "mx-bg"] as const) {
          const razon = razonDeContraste(relleno, hexDeToken(fondo, tema));
          expect(razon, `B · ${tema}: ${relleno} sobre --${fondo} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  });

  it("cada paso se SEPARA del anterior: ΔL* ≥ 8, en los dos temas", () => {
    for (const tema of TEMAS) {
      const ls = RAMPA.map((t) => lEstrella(hexDeToken(t, tema)));
      for (let i = 1; i < ls.length; i++) {
        const d = Math.abs(ls[i] - ls[i - 1]);
        expect(d, `${tema}: pasos ${i} y ${i + 1} difieren solo ΔL* ${d.toFixed(1)}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  // [DASH-F · D-2] EL CRITERIO QUE EL VERDE OBLIGÓ A AÑADIR.
  //
  // Con la rampa violeta esta pregunta no existía: el morado no significaba nada más
  // en el tablero. El verde SÍ — `--mx-graf-jade` es «Disponible» en el Pipeline, en
  // la MISMA pantalla. Se firmó verde sabiendo el riesgo; esto es lo que impide
  // que el riesgo se vuelva un defecto sin que nadie lo note.
  //
  // Y no se mide solo contra jade: se nombró «Disponible» porque es el que vino
  // a la cabeza, pero la condición real es que una burbuja no se lea como NINGÚN otro
  // significado de la pantalla — también el ámbar del faltante y el verde de estado.
  it("ningún paso se confunde con otro SIGNIFICADO de la pantalla: ΔE2000 ≥ el umbral derivado del riel", () => {
    const umbral = umbralDeSeparacion();
    for (const tema of TEMAS) {
      for (const paso of RAMPA) {
        for (const ajeno of SIGNIFICADOS_DE_LA_PANTALLA) {
          const d = deltaE2000(hexDeToken(paso, tema), hexDeToken(ajeno, tema));
          expect(
            d,
            `${tema}: --${paso} está a ΔE2000 ${d.toFixed(1)} de --${ajeno}, y el umbral es ${umbral.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(umbral);
        }
      }
    }
  });

  // CONTROL POSITIVO de la de arriba, con DOS TOKENS REALES del sistema que sí están
  // demasiado cerca: `--mx-good` y `--mx-graf-jade` son el mismo verde a 1,5 puntos de
  // profundidad —el propio archivo lo cuenta más arriba—, así que si uno fuera paso de
  // la rampa, el otro lo tumbaría. Sin esta línea, la prueba podría estar pasando
  // porque ΔE2000 devuelve algo grande siempre.
  it("CONTROL POSITIVO · dos tonos del tema que SÍ se confunden salen reprobados", () => {
    const umbral = umbralDeSeparacion();
    for (const tema of TEMAS) {
      const d = deltaE2000(hexDeToken("mx-good", tema), hexDeToken("mx-graf-jade", tema));
      expect(d, `${tema}: --mx-good y --mx-graf-jade distan ΔE2000 ${d.toFixed(2)}`).toBeLessThan(umbral);
    }
    // Y el caso degenerado: un tono contra sí mismo da 0.
    expect(deltaE2000(hexDeToken("mx-graf-jade", "claro"), hexDeToken("mx-graf-jade", "claro"))).toBeLessThan(umbral);
  });

  // [DASH-F · D-2] «¿se lee como un COLOR o como un gris?» — su métrica es el croma,
  // no la razón de contraste ni ΔL*. Sin este piso, la derivación elegía un paso 1
  // casi negro en claro y casi blanco en oscuro: cumplían contraste y separación, y
  // no se leían como verde. Y «¿el verde se lee como identidad de KAM?» es justo la
  // pregunta que se firma mirando.
  it("cada paso se lee como un COLOR: C* ≥ el croma mínimo que ya se aceptó en la violeta", () => {
    const piso = pisoDeCroma();
    for (const tema of TEMAS) {
      for (const paso of RAMPA) {
        const c = croma(hexDeToken(paso, tema));
        expect(c, `${tema}: --${paso} tiene C* ${c.toFixed(1)} y el piso es ${piso.toFixed(2)}`).toBeGreaterThanOrEqual(piso);
      }
    }
  });

  // CONTROL POSITIVO · el fondo de la app, que es lo MENOS cromático de la pantalla.
  //
  // La primera versión de este control usaba `--mx-muted` «porque es un gris», y salió
  // ROJA: mide C* 14,52 en claro, POR ENCIMA del piso. Los neutros de este tema no son
  // grises — están teñidos de azul, que es lo normal en una paleta con base navy. El
  // supuesto era mío y el token lo desmintió.
  //
  // Y de paso queda dicho el LÍMITE de este criterio, que importa más que el control:
  // el piso lo fija `--mx-graf-violeta-1` en OSCURO (#e5dff6), una lavanda pálida, así
  // que es un piso BAJO. Sirve para lo que se puso —impedir el paso casi negro en claro
  // y casi blanco en oscuro que la derivación elegía sin él— y NO es una garantía de
  // que la rampa se lea vívidamente verde. Eso se juzga mirando, no esta prueba.
  it("CONTROL POSITIVO · el fondo de la app no alcanza el piso de croma", () => {
    const piso = pisoDeCroma();
    for (const tema of TEMAS) {
      expect(croma(hexDeToken("mx-bg", tema)), `${tema}: --mx-bg`).toBeLessThan(piso);
    }
    // Y en claro, la superficie de la tarjeta es blanco puro: C* ~ 0.
    expect(croma(hexDeToken("mx-surface", "claro"))).toBeLessThan(1);
  });

  // La dirección se invierte con el tema, y es deliberado: el rango 1 es el de MÁS
  // contraste contra la tarjeta. En claro eso es el más oscuro; en oscuro, el más claro.
  it("la rampa es MONÓTONA y su dirección se invierte con el tema", () => {
    const claro = RAMPA.map((t) => lEstrella(hexDeToken(t, "claro")));
    const oscuro = RAMPA.map((t) => lEstrella(hexDeToken(t, "oscuro")));

    for (let i = 1; i < 6; i++) {
      expect(claro[i], `claro: el paso ${i + 1} tiene que ser MÁS claro que el ${i}`).toBeGreaterThan(claro[i - 1]);
      expect(oscuro[i], `oscuro: el paso ${i + 1} tiene que ser MÁS oscuro que el ${i}`).toBeLessThan(oscuro[i - 1]);
    }
  });

  it("ningún paso de la rampa es un tono del RIEL", () => {
    for (const tema of TEMAS) {
      const rampa = new Set(RAMPA.map((t) => hexDeToken(t, tema)));
      for (const t of TOKENS_DEL_RIEL) {
        expect(rampa.has(hexDeToken(t, tema)), `${tema}: --${t} es del riel y está en la rampa`).toBe(false);
      }
    }
  });

  // CONTROL POSITIVO · sin esto las pruebas de arriba podrían estar pasando porque la
  // fórmula devuelve algo grande siempre. Se usa un tono REAL del tema que sí reprueba.
  it("CONTROL POSITIVO · un paso con el contraste por debajo del umbral sale reprobado, en cada tema por separado", () => {
    // `--mx-muted-3` sobre la superficie da 1,48:1 en claro y 2,00:1 en oscuro: si se
    // colara como paso, B lo tumbaría. Y `--mx-muted-2` da 2,56 / 3,21.
    for (const tema of TEMAS) {
      expect(razonDeContraste(hexDeToken("mx-muted-3", tema), hexDeToken("mx-surface", tema))).toBeLessThan(3);
    }
    // Y la separación: dos pasos consecutivos del MISMO hex dan ΔL* 0.
    const uno = hexDeToken("mx-graf-verde-1", "claro");
    expect(Math.abs(lEstrella(uno) - lEstrella(uno))).toBeLessThan(8);
  });
});
/**
 * [DASH-F · D-7b] La escala de la tendencia: DOS AZULES Y UN GRIS.
 *
 * D-7 la dejó con tres azules. Se pidió que el valle fuera gris, y el gris no es una
 * preferencia: es lo que queda cuando se descartan los demás **midiendo**. El naranja
 * que se ofrecía ya significa SOBRE-RESERVADO en la tarjeta de al lado —mismo
 * tablero, misma pantalla— y el verde es identidad de KAM y «Disponible» en el riel.
 *
 * **Y eso obliga a declarar una EXENCIÓN, no a saltarse un contrato en silencio.** El
 * piso de croma existe para que un tono se lea como MATIZ; este se elige precisamente
 * por no tenerlo. Así que aquí el piso se invierte a propósito: **se exige que el gris
 * quede POR DEBAJO**, y la separación se le cobra con ΔE2000, que sí ve la diferencia
 * entre un gris y un azul. Una exención comprobada es una exención; una exención escrita
 * al margen es un `skip` con prosa.
 */
describe("[DASH-F · D-7b] la escala de la tendencia: dos azules y un gris", () => {
  const PICO = "mx-graf-azul-pico";
  const VALLE = "mx-graf-gris-valle";
  const MEDIO = "mx-accent";
  const ESCALA = [PICO, MEDIO, VALLE];
  const AZULES = [PICO, MEDIO];

  for (const token of [PICO, VALLE]) {
    it(`--${token}: B · 3:1 contra la superficie Y contra el fondo, en los DOS temas`, () => {
      // **3:1 y no 4,5:1, y la razón importa:** estos tonos RELLENAN barras y recuadros,
      // que son objetos gráficos (WCAG 1.4.11). El 4,5:1 es el umbral del TEXTO, y en
      // estos tonos no se escribe texto: el rótulo de cada nivel vive en su propio
      // `span` con la tinta del tema. Pedir 4,5 aquí sería medir con el instrumento de
      // al lado — y dejaría fuera al gris en claro por una exigencia que no le toca.
      for (const tema of TEMAS) {
        const hex = hexDeToken(token, tema);
        for (const fondo of ["mx-surface", "mx-bg"] as const) {
          const razon = razonDeContraste(hex, hexDeToken(fondo, tema));
          expect(razon, `${tema}: ${hex} sobre --${fondo} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }

  it("los TRES se separan entre sí por ΔL* ≥ 8: si no, dos niveles se leen igual", () => {
    for (const tema of TEMAS) {
      const ls = ESCALA.map((t) => lEstrella(hexDeToken(t, tema)));
      for (let i = 1; i < ls.length; i++) {
        const d = Math.abs(ls[i] - ls[i - 1]);
        expect(d, `${tema}: ${ESCALA[i - 1]} y ${ESCALA[i]} difieren solo ΔL* ${d.toFixed(2)}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("la escala es MONÓTONA y su dirección se invierte con el tema", () => {
    // El pico es el de MÁS contraste contra la tarjeta: en claro el más oscuro, en
    // oscuro el más claro. Es la misma inversión que ya tienen las rampas. Y el valle
    // queda en el extremo de MENOS énfasis, que es lo que la palabra significa: sin esta
    // condición el derivador elegía el gris más oscuro —tiene más margen de contraste— y
    // el valle acababa siendo la barra más pesada del dibujo.
    const claro = ESCALA.map((t) => lEstrella(hexDeToken(t, "claro")));
    const oscuro = ESCALA.map((t) => lEstrella(hexDeToken(t, "oscuro")));
    for (let i = 1; i < 3; i++) {
      expect(claro[i], `claro: ${ESCALA[i]} tiene que ser MÁS claro que ${ESCALA[i - 1]}`).toBeGreaterThan(claro[i - 1]);
      expect(oscuro[i], `oscuro: ${ESCALA[i]} tiene que ser MÁS oscuro que ${ESCALA[i - 1]}`).toBeLessThan(oscuro[i - 1]);
    }
  });

  it("ninguno se confunde con otro SIGNIFICADO de la pantalla: ΔE2000 ≥ el umbral del riel", () => {
    const umbral = umbralDeSeparacion();
    // El acento queda FUERA del conjunto comparado a propósito: es el nivel MEDIO de
    // esta misma escala, y de él los otros dos se separan por ΔL*, que es la métrica de
    // «se distinguen» entre tonos del mismo matiz. Pedirle además ΔE2000 sería medir con
    // el instrumento de al lado.
    //
    // **`--mx-muted` SÍ entra, y entra por el gris.** Es el OTRO gris con significado de
    // la pantalla —«Sin KAM» en el cúmulo— y el conjunto que esta prueba comparaba antes
    // NO lo contenía. Mientras el valle fue azul eso no se notaba; con un valle gris, el
    // único vecino que de verdad puede confundirlo se habría quedado fuera del universo
    // comparado, que es exactamente la forma de P17.
    const ajenos = [...SIGNIFICADOS_DE_LA_PANTALLA.filter((x) => x !== "mx-accent"), ...RAMPA, "mx-muted"];
    for (const tema of TEMAS) {
      for (const token of [PICO, VALLE]) {
        for (const otro of ajenos) {
          const d = deltaE2000(hexDeToken(token, tema), hexDeToken(otro, tema));
          expect(d, `${tema}: --${token} está a ΔE2000 ${d.toFixed(1)} de --${otro}`).toBeGreaterThanOrEqual(umbral);
        }
      }
    }
  });

  it("los dos AZULES se leen como color; el GRIS queda por debajo del piso A PROPÓSITO", () => {
    // La exención, puesta como aserción. Si alguien cambia el gris por un color con
    // matiz, esta prueba se pone roja y le obliga a leer POR QUÉ es gris, en vez de
    // enterarse por la pantalla.
    const piso = pisoDeCroma();
    for (const tema of TEMAS) {
      for (const token of AZULES) {
        expect(croma(hexDeToken(token, tema)), `${tema}: --${token} tiene que leerse como COLOR`).toBeGreaterThanOrEqual(piso);
      }
      const c = croma(hexDeToken(VALLE, tema));
      expect(
        c,
        `${tema}: --${VALLE} tiene C* ${c.toFixed(2)} y para ser gris debe quedar bajo el piso ${piso.toFixed(2)}`,
      ).toBeLessThan(piso);
    }
  });

  it("y el gris PAGA su exención: se separa por ΔE2000 del otro gris y de su propia escala", () => {
    // Lo que el piso de croma dejaba de vigilar, lo vigila esto. `--mx-muted` es «Sin
    // KAM»; si el valle se le acercara, dos cosas distintas dirían lo mismo en la misma
    // pantalla.
    const umbral = umbralDeSeparacion();
    for (const tema of TEMAS) {
      const d = deltaE2000(hexDeToken(VALLE, tema), hexDeToken("mx-muted", tema));
      expect(d, `${tema}: el valle está a ΔE2000 ${d.toFixed(1)} de --mx-muted`).toBeGreaterThanOrEqual(umbral);
      // Y de su propia escala, que es lo que el lector tiene AL LADO.
      for (const azul of AZULES) {
        const e = deltaE2000(hexDeToken(VALLE, tema), hexDeToken(azul, tema));
        expect(e, `${tema}: el valle está a ΔE2000 ${e.toFixed(1)} de --${azul}`).toBeGreaterThanOrEqual(umbral);
      }
    }
  });

  /**
   * CONTROL POSITIVO — y **corrige una afirmación falsa que D-6 dejó escrita**.
   *
   * D-6 dijo que un tono más claro que el acento «no puede cumplir el 3:1 sobre blanco,
   * porque el techo cae en L* 49, justo donde el acento está», y con eso justificó que
   * solo hubiera dos tonos. **Era una cuenta mal hecha.** Aquí se recalcula el techo
   * desde la fórmula, en vez de citarlo: el tercer nivel existe porque el número estaba
   * mal, no porque se haya relajado ningún contrato.
   */
  it("CONTROL POSITIVO · el techo del 3:1 se RECALCULA, y el valle cabe por debajo", () => {
    const luminancia = (hex: string) => {
      const lineal = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const [r, g, b] = [1, 3, 5].map((i) => lineal(parseInt(hex.slice(i, i + 2), 16) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const lDe = (y: number) => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);

    // El techo lo pone el FONDO de la app, que es más oscuro que la superficie y por
    // tanto ata antes.
    const yFondo = luminancia(hexDeToken("mx-bg", "claro"));
    const techo = lDe((yFondo + 0.05) / 3 - 0.05);
    const acento = lEstrella(hexDeToken("mx-accent", "claro"));
    expect(techo, "el techo real del 3:1 contra el fondo").toBeGreaterThan(acento + 8);

    // Y el valle vive entre el acento y ese techo: ni se confunde con el medio ni se sale
    // del contrato. **Por abajo el margen es de 0,006 puntos** —el derivador lo dejó justo
    // en el borde del ΔL* ≥ 8 porque maximizó las OTRAS holguras—, así que mover el acento
    // un punto pone esto rojo. Queda dicho aquí para que ese rojo, el día que salga, se lea.
    const valle = lEstrella(hexDeToken(VALLE, "claro"));
    expect(valle).toBeGreaterThanOrEqual(acento + 8);
    expect(valle).toBeLessThanOrEqual(techo);

    // La mitad que SÍ muerde: un tono por ENCIMA del techo reprueba de verdad.
    const demasiadoClaro = "#A8CCF0";
    expect(lEstrella(demasiadoClaro)).toBeGreaterThan(techo);
    expect(razonDeContraste(demasiadoClaro, hexDeToken("mx-bg", "claro"))).toBeLessThan(3);
  });
});
