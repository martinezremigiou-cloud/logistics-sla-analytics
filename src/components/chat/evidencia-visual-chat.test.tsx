import { describe, it, expect, vi } from "vitest";
import { CONTACTOS, DESTINO } from "@/lib/contactos";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paginaDeEvidencia, cssCompilado, type BloqueDeEvidencia } from "@/components/proyectos/evidencia-visual";
import { BurbujaChat, type Mensaje } from "./burbuja-chat";
import { INTENCIONES, preguntaSobreSku, sugerencias } from "@/lib/chat/intenciones";
import { MARCADOR_ENTRADA } from "@/lib/chat/voz";
import { SeleccionFija } from "@/components/providers/seleccion-provider";
import { SeleccionFlotante } from "@/components/seleccion/seleccion-flotante";
import {
  tarjetaDisponibilidad,
  tarjetaPipeline,
  tarjetaDocumental,
  type Tarjeta,
} from "@/lib/chat/tarjeta";
import { separarFamilias } from "@/lib/familias";
import type { EmbarquesResponse, SkuDetalle } from "@/types/api";

// ============================================================
// [INV-B10] La evidencia visual del chat. Reusa el arnés de B8.2/B9/B9.1 tal
// cual: iframes con viewport real, los dos anchos, los dos temas, el CSS del
// build incrustado.
//
//   npm run build && EVIDENCIA_VISUAL=1 npx vitest run src/components/chat/evidencia-visual-chat.test.tsx
//
// ────────────────────────────────────────────────────────────
// ESTA VEZ NO ES EL TRÁMITE BONITO DEL FINAL, Y HAY UNA MEDICIÓN DETRÁS.
//
// Al escribir la burbuja usé tres clases que **no existen** en la paleta:
// `bg-surface-2`, `border-warn-border` y `text-good`. Los tokens reales son
// `surface-input`, `warn` y `success`.
//
// `tsc` pasó. La suite pasó. El build pasó. **Los tres.** Tailwind no se queja
// de una clase inventada: la omite, y el elemento sale sin estilo — que se lee
// como un descuido de diseño y no como un error.
//
// O sea que esta página es **el único sitio del proyecto donde un token
// inventado se caza**. Se mira con esa consciencia.
//
// (Los tres se corrigieron antes de generar esto; la lección es que ningún
// instrumento automático los vio.)
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTA PÁGINA NO RETRATA, y va dicho aquí y en ella: el «pensando…» que
// dura 1,6-3,7 s, el foco de la caja de texto y el scroll automático al último
// mensaje. Los tres necesitan tiempo o DOM vivo, y `renderToStaticMarkup` no
// corre ningún efecto. Se ven en el navegador.
// ============================================================
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CORTE_STOCK = "2026-03-10T15:00:00.000Z";
const CORTE_ADUANA = "2026-03-14T18:00:00.000Z";

/**
 * El fixture es un PEOR CASO inventado, no uno cómodo: `KL2722` es un SKU con muchas
 * reservas, está **sobre-reservado** con disponible negativo, y
 * tiene descuadre. Las tres notas se apilan, que es donde la tarjeta puede
 * romperse en 390 px.
 */
function detalleKL2722(): SkuDetalle {
  const familia = "CANDADOS";
  return {
    sku: "KL2722",
    marca: "BRAND1",
    marca_excluida: false,
    familia_efectiva: familia,
    familias_efectivas: separarFamilias(familia),
    descr_efectiva: "Series2 KEY 4000",
    original: { familia, descr: "Series2 KEY 4000" },
    stock: [{ almacen: "NORTH", cantidad: 1214 }],
    total: 1214,
    reservado: 1287,
    disponible: -73,
    sobre_reservado: true,
    reserva_descuadre: true,
    reservas: Array.from({ length: 16 }, (_, i) => ({
      kam: i % 3 === 0 ? null : `H. Lara ${i}`,
      cliente: ["RETAILER9", "RETAILER1", "RETAILER42", "RETAILER21"][i % 4]!,
      cantidad: (i + 1) * 7,
      motivo: i % 2 === 0 ? "Proyecto rollout Q3" : null,
      fecha: "2026-08-01",
    })),
    embarques: [],
    piezas_en_camino: 0,
    piezas_historial: 0,
    imagen_url: null,
    snapshot: { stock: null, aduana: null },
    decidido_en_bandeja: { marca: false },
  } as SkuDetalle;
}

function respuestaPipeline(): EmbarquesResponse {
  return {
    snapshot: { id: "s", created_at: CORTE_ADUANA, filas: null, archivo: null, vigente: true },
    items: Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      sku: `ZKT${520 + i}-W`,
      oc_po: null,
      proveedor: null,
      referencia: null,
      factura: null,
      pais_origen: null,
      piezas: (i + 1) * 130,
      fw: null,
      tipo_importacion: null,
      fecha_recoleccion: null,
      etd: null,
      eta: "2026-09-09",
      fecha_llegada: null,
      fecha_disponibilidad: null,
      estatus: "En Aduana",
      estatus_orden: 4,
      proyecto: null,
      observaciones: null,
      is_historial: false,
      retrasado: i % 5 === 0,
      descripcion: "Base de seguridad",
    })),
    page: 1,
    pageSize: 50,
    total: 12,
    totalPages: 1,
    resumen: { embarques: 12, piezas: 9418, activos: 61, historial: 0, piezas_activas: 9418, retrasados: 3 },
    facetas: {} as never,
  } as EmbarquesResponse;
}

const tarjetaDisp: Tarjeta = tarjetaDisponibilidad(detalleKL2722(), CORTE_STOCK);
const tarjetaPipe: Tarjeta = tarjetaPipeline(respuestaPipeline());

const CONVERSACION: Mensaje[] = [
  { rol: "usuario", texto: "¿cuánto hay de KL2722 y quién lo tiene reservado?" },
  { rol: "asistente", respuesta: { tipo: "tarjeta", tarjeta: tarjetaDisp } },
  { rol: "usuario", texto: "¿Qué hay en aduana?" },
  { rol: "asistente", respuesta: { tipo: "tarjeta", tarjeta: tarjetaPipe } },
];

const NO_SE: Mensaje[] = [
  { rol: "usuario", texto: "¿cuánto cuesta el SUJ500-F?" },
  {
    rol: "asistente",
    respuesta: { tipo: "no_se", mensaje: "No sé contestar eso.", sabeHacer: INTENCIONES.map((i) => i.descripcion) },
  },
];

/** Medido: «Series11» da muchas coincidencias por `listInventory`. Se ofrecen 8. */
const AMBIGUO: Mensaje[] = [
  { rol: "usuario", texto: "cuánto hay de los Series11" },
  {
    rol: "asistente",
    respuesta: {
      tipo: "aclarar",
      motivo: "ambiguo",
      intencion: "disponibilidad",
      mensaje: "Hay 11 SKU que coinciden con «Series11». ¿Cuál de estos?",
      candidatos: [
        { sku: "0861-5844-9317", descripcion: "Series11 AM Floor System" },
        { sku: "0170-7331-8709", descripcion: "Series11 AM Floor System XL" },
        { sku: "5375-9213-2030", descripcion: "Series11 AM Wall Mount" },
        { sku: "1534-3518-6639", descripcion: "Series11 Sensor Kit" },
      ],
    },
  },
];

/**
 * **El SKU pelado — el control que este arreglo agrega.**
 *
 * Es la entrada más frecuente de todas: es literalmente la que pide el marcador
 * de posición del campo («Pregunta por un SKU…» — retirado en CHAT-B2 por
 * el QA manual: el bloque existe para que NO haya que preguntar por SKU), y
 * hasta en el QA manual
 * contestaba «No sé contestar eso». La regla que faltaba era la GEMELA de la
 * que ya estaba: si que falte el SKU no convierte la pregunta en `ninguna`,
 * que falte el VERBO no convierte el SKU en `ninguna`.
 *
 * Este escenario existe por P24: el camino nuevo estaba verde en el enrutador,
 * verde en el servicio y verde en el tipo, y **ninguna prueba echaba de menos
 * el único sitio donde un humano lo toca**.
 */
const ELEGIR: Mensaje[] = [
  { rol: "usuario", texto: "KL2722" },
  {
    rol: "asistente",
    respuesta: { tipo: "elegir_intencion", mensaje: "¿Qué quieres saber de KL2722?", sku: "KL2722" },
  },
];

/**
 * [INV-B11] LA TARJETA DOCUMENTAL — la séptima intención, y la única que CITA.
 *
 * Es el único escenario con `texto` verbatim, y lo que hay que mirar es
 * distinto de todo lo demás: **que la tabla de la ficha siga leyéndose como
 * tabla**. En markdown una tabla son renglones de `|` alineados por saltos de
 * línea; aplastada a un párrafo deja de significar. Por eso el texto va
 * `whitespace-pre-wrap` y en monoespaciada.
 *
 * El fixture es la ficha REAL de Series2, recortada, con su tabla de variantes
 * dentro — que es justo el caso D2 del conjunto de evaluación.
 */
const FICHA_DOC: Tarjeta = tarjetaDocumental({
  sku: "KYA2490",
  familia: "VXQ",
  titulo: "Series2",
  fuentePdf: "Corpus/Brand1/Series2/Series_30.pdf",
  commitSha: "local-sin-git",
  revisada: false,
  trozos: [
    {
      orden: 0,
      rutaSeccion: "Series2 > Características principales",
      texto: [
        "Series2 es la plataforma de seguridad para dispositivos de mano de Brand1.",
        "",
        "| Modelo | Cable series20 | Nivel seguridad | Analítica |",
        "|--------|---------------|-----------------|-----------|",
        "| Veb08 | 28\" | Estándar | No |",
        "| Rxz57 | 28\" | Reforzada | Si |",
        "| Cwr96 | 22\" | Alta | Si |",
      ].join("\n"),
    },
  ],
});

const DOCUMENTAL: Mensaje[] = [
  { rol: "usuario", texto: "¿Qué dice la ficha del KYA2490?" },
  { rol: "asistente", respuesta: { tipo: "tarjeta", tarjeta: FICHA_DOC } },
];

/**
 * [INV-B11] LAS DOS AUSENCIAS, JUNTAS Y CON DISTINTA PIEL.
 *
 * Es el escenario que justifica O4 entero. Las dos dicen «no hay ficha» y
 * **una es culpa nuestra**:
 *
 *   arriba  · causaNuestra=true  → color de aviso, como el fallo de transporte
 *   abajo   · causaNuestra=false → neutro, el sistema funcionó
 *
 * Pintarlas igual habría tirado el bloque anterior en la última capa. Van en
 * el MISMO escenario a propósito: la diferencia solo se ve comparándolas.
 */
const SIN_FICHA: Mensaje[] = [
  { rol: "usuario", texto: "¿Cómo funciona el 6731-9447-2430?" },
  {
    rol: "asistente",
    respuesta: {
      tipo: "sin_documentacion",
      mensaje: "Todavía no tengo asociada una ficha a la familia «SERIES 26». Es un pendiente nuestro.",
      causaNuestra: true,
      escalada: DESTINO.sin_puente,
    },
  },
  { rol: "usuario", texto: "¿Y del KL2722?" },
  {
    rol: "asistente",
    respuesta: {
      tipo: "sin_documentacion",
      mensaje: "La familia «CANDADOS» no tiene ficha de producto.",
      causaNuestra: false,
      escalada: DESTINO.sin_ficha_confirmado,
    },
  },
  // [INV-B11] O6-adenda · EL TERCER TURNO EXISTE PARA QUE EL MAPA SE VEA
  // TRABAJANDO. Los dos de arriba terminan en la misma persona, asi que solos
  // no distinguen "hay un mapa" de "hay un contacto horneado". Este acaba en
  // OTRA: el SKU no tiene familia, y eso es calidad del Excel de inventario.
  { rol: "usuario", texto: "¿y la ficha del 7467-7050-27?" },
  {
    rol: "asistente",
    respuesta: {
      tipo: "sin_documentacion",
      mensaje: "El SKU 7467-7050-27 no tiene familia asignada, así que no puedo llegar a su ficha.",
      causaNuestra: false,
      escalada: DESTINO.sin_familia,
    },
  },
];

const FALLO: Mensaje[] = [
  { rol: "usuario", texto: "¿cuándo llega el SUJ500-F?" },
  {
    rol: "fallo",
    fallo: {
      mensaje: "No pude consultar al asistente en este momento. Vuelve a intentarlo.",
      reintentable: true,
      consumioCuota: true,
      // Sin contacto: aqui la respuesta correcta es reintentar, y ya la da el
      // mensaje. Dos instrucciones a la vez para un tropiezo pasajero.
      escalada: null,
    },
  },
];

const TOPE: Mensaje[] = [
  { rol: "usuario", texto: "¿qué hay en aduana?" },
  {
    rol: "fallo",
    fallo: {
      mensaje: "Llegaste al máximo de 30 preguntas por hora. Vuelve a intentarlo más tarde.",
      reintentable: false,
      consumioCuota: false,
      // Tampoco: el techo no es una falla, es el limite funcionando. Mandar a
      // alguien a escribir un correo por esto seria ruido con nombre y apellido.
      escalada: null,
    },
  },
];

/** El fallo que SI tiene dueno: insistir no sirve y el problema es del portal. */
const FALLO_DEL_PORTAL: Mensaje[] = [
  { rol: "usuario", texto: "¿qué dice la ficha del KYA2490?" },
  {
    rol: "fallo",
    fallo: {
      mensaje: "El asistente no está configurado en este servidor.",
      reintentable: false,
      consumioCuota: false,
      escalada: "software",
    },
  },
];

/** La burbuja es `fixed`; se le da un marco con alto para que el iframe la muestre. */
function marco(nodo: React.ReactNode) {
  return <div className="relative h-[560px] w-full bg-surface-app">{nodo}</div>;
}

export function bloques(): BloqueDeEvidencia[] {
  return [
    {
      titulo: "Cerrada · el único estado que el 100 % de la gente ve primero",
      nota:
        "Abajo a la derecha, sobre cualquier pantalla de `(app)`. Lo que hay que mirar es que no tape nada: en 390 px " +
        "convive con la barra inferior de navegación, y por eso va a `bottom-5` y no pegada al borde.",
      html: renderToStaticMarkup(marco(<BurbujaChat />)),
      alto: 600,
    },
    {
      titulo: "Abierta · el zero-state",
      nota:
        "Las seis sugerencias salen DEL CATÁLOGO: una que el sistema no supiera contestar es irrepresentable, no hay " +
        "dónde escribirla. Y un clic en cualquiera NO llama al modelo — la tarjeta aparece de inmediato, mientras que " +
        "escribir tarda 1,6-3,7 s medidos.",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true }} />)),
      alto: 600,
    },
    {
      titulo: "Con conversación · el PEOR caso real del catálogo",
      nota:
        "`KL2722` es el SKU con más reservas (16), sobre-reservado, con disponible −73 y con descuadre. Las TRES notas " +
        "se apilan. Lo que hay que mirar: que el número que contesta la pregunta no se pierda entre los otros, que la " +
        "lista corte en 10 y lo DIGA, y que el corte al pie se lea — es la regla #3 dentro de una conversación.",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true, mensajes: CONVERSACION }} />)),
      alto: 640,
    },
    {
      titulo: "El «no sé» · enumerando las seis",
      nota:
        "Decir «no sé» a secas deja al usuario adivinando contra un catálogo cerrado, que es la peor manera de " +
        "descubrirlo. La lista sale de la misma fuente que las sugerencias, así que no puede quedarse corta.",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true, mensajes: NO_SE }} />)),
      alto: 620,
    },
    {
      titulo: "Desambiguación · 11 coincidencias, 8 botones",
      nota:
        "Medido: «Series11» da 11 por `listInventory`. Elegir por el usuario sería adivinar. Y elegir un candidato NO " +
        "vuelve a pasar por el modelo: la respuesta trae la intención pendiente.",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true, mensajes: AMBIGUO }} />)),
      alto: 620,
    },
    {
      titulo: "Un SKU a secas · no se le niega, se le pregunta",
      nota:
        "Escribir `KL2722` y nada más es la entrada que el propio marcador de posición pide, y hasta en el QA manual " +
        "contestaba «No sé contestar eso». Adivinar la intención sería peor que preguntar: «disponibilidad» y " +
        "«llegada» dan números DISTINTOS del mismo SKU. Los botones salen de las intenciones que declaran " +
        "`requiereSku`, así que una opción huérfana es irrepresentable — y el clic NO llama al modelo.",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true, mensajes: ELEGIR }} />)),
      alto: 600,
    },
    {
      titulo: "La ficha técnica · la séptima intención, y la única que CITA",
      nota:
        "Lo que hay que mirar es **que la tabla se lea como tabla**, con sus encabezados. Es el invariante de O3 " +
        "en su última capa: todo O3 protege que una tabla no se parta, y pintarla como un párrafo la parte igual, " +
        "un paso más adelante. La decisión de renderizar cambió con la medición — mostrarla como texto con barras " +
        "se parece MENOS al documento que la renderizada, y el autor escribió una tabla. La verificabilidad la " +
        "carga la CITA de abajo (los PDF de origen), no los asteriscos. " +
        "Y el markdown se pinta con elementos de React, nunca con HTML: un `<script>` en una ficha sale como texto.",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true, mensajes: DOCUMENTAL }} />)),
      alto: 640,
    },
    {
      titulo: "Las tres ausencias · de quién es el hueco, y a quién se le escribe",
      nota:
        "El escenario que justifica O4 entero, ahora con la adenda encima. Las tres dicen «no hay ficha» y **la " +
        "primera es un pendiente nuestro**: va en color de aviso, como el fallo de transporte; las otras, neutras. " +
        "Pintarlas igual habría tirado el bloque anterior en la última capa. " +
        "**Y lo nuevo:** cada una trae a quién escribirle, resuelto por el servidor desde el estado exacto. Las dos " +
        "primeras acaban en Hugo (documentación de producto) y la tercera en Paula — el SKU no tiene familia, y " +
        "eso es calidad del Excel de inventario. Ese tercer turno está aquí a propósito: sin él, dos contactos " +
        "iguales no distinguen «hay un mapa» de «hay un contacto horneado».",
      html: renderToStaticMarkup(marco(<BurbujaChat inicial={{ abierta: true, mensajes: SIN_FICHA }} />)),
      alto: 760,
    },
    {
      titulo: "El saludo · visible y descartado, uno al lado del otro",
      nota:
        "Adenda de O6. **Una vez por sesión, y no negociable** — se fijó así porque un aviso que sale cada " +
        "vez que entras al catálogo es ruido en una semana. Izquierda: la primera vez. Derecha: después de cerrarlo, " +
        "que es lo que ve el 100 % de las visitas siguientes. " +
        "Lo que hay que mirar: **no tapa la burbuja, se para encima de ella**, y no es un diálogo — no roba el foco " +
        "ni impide hacer clic en nada. El testigo vive en `sessionStorage` y no en `localStorage`: en una máquina " +
        "compartida, con `localStorage` el segundo KAM no vería el saludo nunca porque el primero ya lo cerró.",
      html: renderToStaticMarkup(
        <div className="flex gap-3">
          <div className="relative h-[220px] flex-1 overflow-hidden rounded-lg bg-surface-app">
            <BurbujaChat inicial={{ abierta: false, saludo: true }} />
          </div>
          <div className="relative h-[220px] flex-1 overflow-hidden rounded-lg bg-surface-app">
            <BurbujaChat inicial={{ abierta: false, saludo: false }} />
          </div>
        </div>,
      ),
      alto: 260,
    },
    {
      titulo: "LOS TRES ESTADOS A LA VEZ · el que nadie dibuja",
      nota:
        "Selección activa **+** chat abierto **+** sin sidebar. Se pidió por nombre porque es el estado que " +
        "rompe y el que ningún mapa incluye. Lo que hay que mirar: la Selección ancla a la IZQUIERDA y el " +
        "asistente a la DERECHA — con esa regla la colisión no se evita, se vuelve irrepresentable. " +
        "Y la excepción declarada: bajo 768 px el chat abierto ocupa el ancho entero y tapa la píldora, **sin " +
        "cerrarla**. Vuelve al cerrar el chat, con la selección intacta — tapar es recuperable, parecer destruido no.",
      html: renderToStaticMarkup(
        <SeleccionFija seleccion={{ items: [{ sku: "KL2722", cantidad: 12 }, { sku: "SUJ500-F", cantidad: 3 }] }}>
          <div className="relative h-[560px] w-full bg-surface-app">
            <SeleccionFlotante />
            <BurbujaChat inicial={{ abierta: true, mensajes: CONVERSACION }} />
          </div>
        </SeleccionFija>,
      ),
      alto: 600,
    },
    {
      titulo: "Los TRES fallos · y solo uno tiene a quién escribirle",
      nota:
        "Arriba, fallo de transporte: color y icono propios, «no es que no entendiera: no pude consultar», y —porque " +
        "el techo se cobra antes de llamar al modelo— «contó para tu límite». En medio, el techo alcanzado: NO dice " +
        "que contó, porque no cobró nada nuevo. Decirlo en los dos habría sido más simple y falso en uno. " +
        "**Abajo, el único que escala:** el servidor sin llave. Los tres son fallos y solo uno manda a escribir un " +
        "correo — la escalada NO se deriva de «no se puede reintentar», porque el techo tampoco se reintenta y " +
        "mandar a alguien a reportar su propio límite sería ruido con nombre y apellido.",
      html: renderToStaticMarkup(
        <div className="relative h-[640px] w-full bg-surface-app">
          <div className="absolute inset-x-3 top-3 sm:inset-x-auto sm:right-6 sm:w-[380px]">
            {renderToStaticMarkup(<div />) && null}
          </div>
          <BurbujaChat inicial={{ abierta: true, mensajes: [...FALLO, ...TOPE, ...FALLO_DEL_PORTAL] }} />
        </div>,
      ),
      alto: 760,
    },
  ];
}

describe("[INV-B10] evidencia visual del chat", () => {
  // ============================================================
  // ANTI-VACUIDAD (P17). Un `renderToStaticMarkup` que devuelve "" produce una
  // página con sus rótulos puestos y los marcos en blanco: se ve completa y no
  // muestra nada. Ya pasó en INV-B8.2 con un `Dialog` de radix.
  // ============================================================
  it("ningún escenario sale vacío, y cada uno contiene lo que dice retratar", () => {
    const b = bloques();
    expect(b.length).toBeGreaterThanOrEqual(10);
    for (const x of b) expect(x.html.length, `«${x.titulo}» salió vacío`).toBeGreaterThan(300);

    // ────────────────────────────────────────────────────────
    // SE BUSCA POR TÍTULO, NO POR ÍNDICE.
    //
    // Estaba con indices —b[5], b[6]…— y al agregar dos escenarios en medio TODAS
    // las aserciones pasaron a mirar el bloque de al lado. La prueba se puso
    // roja —bien— pero por la razón equivocada: decía que faltaba «no pude
    // consultar» en un bloque que nunca lo tuvo.
    //
    // Es el mismo fixture que se pudre que los SKU escritos a mano en el
    // humo: **una referencia posicional envejece con el archivo**.
    // ────────────────────────────────────────────────────────
    const porTitulo = (frag: string) => {
      const x = b.find((y) => y.titulo.includes(frag));
      expect(x, ).toBeDefined();
      return x!.html;
    };
    const cerrada = porTitulo("Cerrada");
    expect(cerrada).toContain("Abrir el asistente");
    // Y NO el panel: si el estado sembrado se colara, este bloque mentiría.
    expect(cerrada).not.toContain(MARCADOR_ENTRADA);

    const zero = porTitulo("zero-state");
    // [INV-B11] O6 · contra `sugerencias()`, que es lo que la burbuja pinta.
    // `capacidades` vive en el catálogo pero NO en el zero-state: el zero-state
    // ES su respuesta, y un chip que la pidiera sería circular.
    for (const s of sugerencias()) expect(zero, `falta «${s.intencion}»`).toContain(s.texto);
    expect(zero, "`capacidades` volvió al zero-state, que es su propia respuesta").not.toContain(
      "¿Qué puedes hacer?",
    );

    const conv = porTitulo("Con conversación");
    expect(conv).toContain("-73"); // el disponible negativo, exacto
    expect(conv).toContain("sobre-reservado");
    expect(conv).toContain("Se muestran 10 de 16"); // el corte declarado
    expect(conv).toContain("corte 10 mar 2026"); // la procedencia

    const noSe = porTitulo("El «no sé»");
    for (const i of INTENCIONES) expect(noSe).toContain(i.descripcion);

    const amb = porTitulo("Desambiguación");
    expect(amb).toContain("0861-5844-9317");
    expect(amb).toContain("11 SKU");

    // El SKU pelado. Se comprueba por el CATÁLOGO y no contra tres cadenas
    // escritas a mano: si mañana una intención cambia de `requiereSku`, esta
    // prueba lo sigue; una lista copiada se quedaría atrás en silencio.
    const elegir = porTitulo("Un SKU a secas");
    expect(elegir).toContain("¿Qué quieres saber de KL2722?");
    const conSku = INTENCIONES.filter((i) => i.requiereSku);
    const sinSku = INTENCIONES.filter((i) => !i.requiereSku);
    expect(conSku.length, "el catálogo dejó de tener intenciones de SKU").toBeGreaterThan(0);
    expect(sinSku.length, "el catálogo dejó de tener intenciones sin SKU").toBeGreaterThan(0);
    for (const i of conSku) {
      const pregunta = preguntaSobreSku(i, "KL2722");
      expect(pregunta, `«${i.id}» requiere SKU pero no sabe preguntarse sobre uno`).not.toBeNull();
      expect(elegir, `falta el botón de «${i.id}»`).toContain(pregunta!);
      // El botón NO dice «un SKU» teniendo el SKU delante: ése era el motivo de
      // que `descripcion` no sirviera de etiqueta.
      expect(elegir, `el botón de «${i.id}» sigue diciendo «un SKU»`).not.toContain(i.descripcion);
    }
    // Y las otras NO: ofrecer «qué hay en camino» junto a un SKU sería ofrecer
    // una consulta que ignora lo único que el usuario escribió.
    for (const i of sinSku) expect(elegir, `sobra el botón de «${i.id}»`).not.toContain(i.descripcion);

    // ────────────────────────────────────────────────────────
    // [INV-B11] LA TABLA DE LA FICHA SE PINTA COMO TABLA.
    //
    // Es el invariante de O3 en su última capa. Todo O3 protege que una tabla
    // no se parta al trocear; pintarla como un párrafo la parte igual, un paso
    // más adelante — y el usuario recibiría «Cwr96 22" Alta» sin saber cuál
    // columna es cuál.
    // ────────────────────────────────────────────────────────
    const doc = porTitulo("La ficha técnica");
    expect(doc, "la tabla de la ficha no se pintó como tabla").toContain("<table");
    expect(doc, "la tabla salió sin encabezados").toContain("<th");
    expect(doc).toContain("Nivel seguridad");
    // Y el markdown NO llega crudo: ni asteriscos de negrita ni barras sueltas.
    expect(doc, "el markdown llegó crudo al usuario").not.toContain("|--------|");
    expect(doc, "quedó un wikilink sin resolver").not.toContain("[[");

    // ────────────────────────────────────────────────────────
    // [INV-B11] O6 · LOS TRES ESTADOS A LA VEZ.
    //
    // Se declaró obligatorio, y la razón es la lección de hoy: **si la
    // evidencia no tiene un escenario con selección activa Y chat abierto,
    // contar solapes da 0 y ese 0 no significa nada.** Es el troceador que no
    // troceaba, en el arnés visual.
    // ────────────────────────────────────────────────────────
    const tres = porTitulo("LOS TRES ESTADOS");
    expect(tres, "la Selección no se pintó: el escenario sería vacuo").toContain("Selección");
    expect(tres, "el asistente no se pintó: el escenario sería vacuo").toContain(MARCADOR_ENTRADA);
    // Y la regla espacial, visible en el marcado: la Selección a la izquierda.
    expect(tres, "la Selección volvió a reclamar la esquina derecha").toContain("md:left-6");

    // [INV-B11] O6-adenda · el saludo, en sus DOS estados.
    const saludo = porTitulo("El saludo");
    expect(saludo, "el estado visible salió vacío: el escenario sería vacuo").toContain("¿Buscas algo de un SKU?");
    // Y que el estado descartado sea DISTINTO: si los dos pintaran el saludo,
    // la línea de arriba pasaría igual y la evidencia mentiría por partida
    // doble. Uno y solo uno.
    expect(
      saludo.split("¿Buscas algo de un SKU?").length - 1,
      "el saludo apareció en los dos paneles, o en ninguno: la comparación no dice nada",
    ).toBe(1);
    expect(saludo, "la burbuja no se pintó: no se puede juzgar si el saludo la tapa").toContain("Abrir el asistente");

    const fallos = porTitulo("Los TRES fallos");
    expect(fallos).toContain("no pude consultar");
    expect(fallos).toContain("Contó para tu límite");
    // [INV-B11] O6-adenda · SOLO UNO ESCALA, y eso se comprueba contando.
    // «Aparece el correo» pasaria igual si apareciera en los tres; lo que hay
    // que fijar es que NO aparece en los otros dos.
    // Se cuenta el `mailto:` y no el correo pelado: el correo aparece DOS veces
    // por escalada (el `href` y el texto del enlace), asi que contarlo daria el
    // doble y el numero no significaria nada. Un `mailto:` = una escalada.
    expect(
      fallos.split(`mailto:${CONTACTOS.software.correo}`).length - 1,
      "la escalada se coló en un fallo que no la lleva, o desapareció del que sí",
    ).toBe(1);

    // Y en las ausencias, el mapa trabajando: DOS personas distintas.
    const ausencias = porTitulo("Las tres ausencias");
    expect(ausencias, "falta el contacto de documentación de producto").toContain(CONTACTOS.producto.correo);
    expect(ausencias, "falta el contacto del archivo de inventario").toContain(CONTACTOS.inventario.correo);
    // El control negativo: los que NO tocan a esta pantalla no aparecen. Sin
    // esto, una escalada que pintara los cuatro contactos siempre pasaría.
    expect(ausencias, "apareció un contacto que este escenario no debería producir").not.toContain(
      CONTACTOS.embarques.correo,
    );
  });

  // ============================================================
  // LOS DOS CAMPOS QUE HABLAN DE LO MISMO, ATADOS.
  //
  // `requiereSku` dice «para contestar esto hace falta un SKU resuelto» y lo usa
  // el servicio; `preguntaSobreSku` dice «así se pregunta esto de un SKU» y lo
  // usa la burbuja. Son dos campos sobre la misma propiedad del catálogo, y
  // nada en el tipo impide que se separen: una intención nueva con
  // `requiereSku: true` y `preguntaSobreSku: null` compila, y su botón
  // **desaparece en silencio** — el usuario perdería una opción sin que nada
  // se pusiera rojo.
  // ============================================================
  it("toda intención que requiere SKU sabe preguntarse sobre uno, y solo ésas", () => {
    for (const i of INTENCIONES) {
      expect(i.requiereSku, `«${i.id}» tiene los dos campos desacoplados`).toBe(i.preguntaSobreSku !== null);
      if (i.preguntaSobreSku !== null) {
        expect(i.preguntaSobreSku, `«${i.id}» no tiene dónde poner el SKU`).toContain("{sku}");
        expect(preguntaSobreSku(i, "KL2722"), `«${i.id}» dejó el hueco sin sustituir`).not.toContain("{sku}");
      }
    }
  });

  // ============================================================
  // LOS SKU DE UNA LISTA ENLAZAN — y los que no son SKU, no.
  //
  // Sale del QA manual: la tarjeta listaba SKU sin poder hacer clic, rompiendo
  // una convención que el resto del portal ya respeta. La mitad que importa es
  // la SEGUNDA: el renglón de `disponibilidad` lleva un CLIENTE en `principal`,
  // y deducir el enlace de la forma del texto habría producido
  // `/catalogo/RETAILER9`. Por eso el enlace se declara y no se adivina.
  // ============================================================
  it("enlaza a la ficha los renglones que declaran un SKU, y solo ésos", () => {
    const conv = bloques()[2]!.html;

    // La tarjeta de pipeline: sus renglones SÍ declaran SKU.
    expect(tarjetaPipe.lista[0]!.sku, "el fixture dejó de declarar SKU").toBeTruthy();
    for (const l of tarjetaPipe.lista) {
      expect(conv, `«${l.principal}» no enlaza`).toContain(`/catalogo/${l.sku}`);
    }

    // La de disponibilidad: sus renglones son CLIENTES y no declaran SKU.
    for (const l of tarjetaDisp.lista) {
      expect(l.sku, `«${l.principal}» no debería declarar SKU`).toBeUndefined();
    }
    // Y no basta con que los SKU enlacen: hay que comprobar que un CLIENTE no.
    // Los nombres salen del propio fixture, así que cambiarlo no deja la guarda
    // apuntando a un cliente que ya no existe —que pasaría en verde sin mirar nada.
    for (const r of detalleKL2722().reservas) {
      expect(conv, "se coló un enlace a un cliente").not.toContain("/catalogo/" + r.cliente);
    }
  });

  // ============================================================
  // EL TOKEN INVENTADO. `tsc`, la suite y el build pasan sobre `bg-surface-2`,
  // que no existe: Tailwind lo omite y el elemento sale sin estilo. Esta guarda
  // es barata y cierra el hueco por el que se colaron tres.
  //
  // LO QUE NO ES: no valida la paleta entera ni entiende Tailwind. Compara las
  // clases usadas contra los nombres que `tailwind.config.ts` declara, para las
  // familias de color del proyecto. Una clase de otra familia se le escapa.
  // ============================================================
  it("no usa ninguna clase de color que no exista en la paleta", () => {
    const config = readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8");
    const fuentes = ["burbuja-chat.tsx", "tarjeta-chat.tsx"].map((f) =>
      readFileSync(join(process.cwd(), "src/components/chat", f), "utf8"),
    );

    const usados = new Set<string>();
    for (const src of fuentes) {
      for (const m of Array.from(src.matchAll(/\b(?:bg|text|border|ring)-((?:surface|ink|line|brand|warn|success|danger|info)(?:-[a-z0-9]+)?)/g))) {
        usados.add(m[1]!);
      }
    }
    expect(usados.size, "no se extrajo ninguna clase: el detector está roto").toBeGreaterThan(8);

    /** El cuerpo `{...}` que `tailwind.config.ts` declara para una familia. */
    const bloqueDe = (familia: string): string | null => {
      const m = config.match(new RegExp(String.raw`\b${familia}:\s*\{([^}]*)\}`));
      return m ? m[1]! : null;
    };

    const inventadas = Array.from(usados).filter((clase) => {
      const [familia, sufijo] = clase.split("-");
      const bloque = bloqueDe(familia!);
      if (bloque === null) return true;
      if (!sufijo) return false;
      // DENTRO de su familia, no en todo el archivo: `2:` existe bajo `ink`, y
      // eso hacia pasar a `surface-2`, que no existe.
      return !new RegExp(String.raw`\b${sufijo}:`).test(bloque);
    });

    expect(inventadas, "clases de color que la paleta no declara").toEqual([]);
  });

  it("con EVIDENCIA_VISUAL=1 escribe la página de revisión visual", () => {
    if (process.env.EVIDENCIA_VISUAL !== "1") {
      expect(paginaDeEvidencia("prueba", bloques(), "/* css */")).toContain("<!doctype html>");
      return;
    }

    const salida = join(process.cwd(), ".evidencia", "chat");
    mkdirSync(salida, { recursive: true });
    const css = cssCompilado();
    const pagina = paginaDeEvidencia("El asistente", bloques(), css);
    writeFileSync(join(salida, "evidencia-visual.html"), pagina);

    expect(css.length, "el CSS compilado salió vacío: ¿corriste `npm run build`?").toBeGreaterThan(10_000);
    expect(pagina, "el CSS no quedó incrustado").toContain("--mx-bg");
    expect(pagina, "quedó un enlace a un archivo externo").not.toMatch(/<link[^>]+stylesheet/);
  });
});
