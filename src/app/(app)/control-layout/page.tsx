import { notFound } from "next/navigation";
import { NOMBRE_PRODUCTO } from "@/config/producto";

// ============================================================
// [2.0.1-A] O0 · /control-layout — el CONTROL POSITIVO PLANTADO del
// layout-check (B11-1). NO es una pantalla del producto: es la página que
// el instrumento DEBE denunciar para ganarse el derecho de absolver a las
// demás — sin ella, «0 desbordes» es el troceador que no troceaba (P19:
// cada aserción necesita su propio estado que la ponga en roja).
//
// POR QUÉ VIVE DENTRO DE (app) y no como ruta suelta: el `<nav>` que A2
// vigila lo monta el shell, y esta página hereda el shell entero — así el
// control ejercita el MISMO pipeline (build de producción, middleware,
// layout, CSS global) que las páginas reales, no una maqueta aparte.
//
// POR QUÉ NO ESTÁ EN NAV_ITEMS: no es un destino de usuario; enlazarla
// sería el reverso de P7 (prometer en la navegación un instrumento).
//
// GATE DE ENTORNO: fuera de una corrida del layout-check la ruta es un
// 404. `next start` del arnés arranca con LAYOUT_CHECK=1; en producción
// real la variable no existe y esta página no se sirve. El modo de fallo
// es el correcto: si el arnés olvidara la variable, el control no se
// denuncia y el veredicto sale 2 (SIN VEREDICTO) — nunca un verde falso.
// (El layout de (app) es force-dynamic, así que esta lectura de entorno
// es de REQUEST, no de build.)
//
// LOS TRES PLANTADOS — uno por aserción, cada uno con su marca
// `data-plantado` para que el veredicto exija que caiga POR SU RAZÓN:
//   a1 · un SKU real de los largos en una caja de 27 px con overflow
//        hidden — la firma exacta del riel de B11 av.10.
//   a2 · un <nav> visible con un enlace dentro, aplastado a 0 px — la
//        firma exacta del panel que aplastó la navegación.
//   a3 · dos flotantes fijos cuyos BOTONES se traslapan — la colisión
//        que O6 volvió irrepresentable en el producto, representada aquí
//        a propósito.
// Y EL PAR PERMITIDO (`data-solape-permitido="control-permitido"`): dos
// flotantes que SÍ se traslapan y NO deben denunciarse — prueba de que
// la excepción declarada por nombre está ACOTADA (se ejerce aquí y solo
// aquí; el veredicto exige verla ejercida, P25-B) sin volverse un hoyo.
// ============================================================

export const dynamic = "force-dynamic";

export const metadata = { title: `Control de layout · ${NOMBRE_PRODUCTO}` };

export default function ControlLayoutPage() {
  if (process.env.LAYOUT_CHECK !== "1") {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Control de layout</h1>
      <p className="max-w-prose text-[13px] text-muted-foreground">
        Página-instrumento del <code>layout-check</code> (B11-1). Planta defectos de layout a propósito — un truncado
        ilegible, una navegación aplastada, un solape de flotantes, un control tapado y un enlace recortado por su
        ancestro — que el script <strong>debe</strong> denunciar, más dos fantasmas y un solape permitido que{" "}
        <strong>no</strong> debe denunciar. Si estás viendo esto fuera de una
        corrida de <code>npm run layout-check</code>, algo arrancó el servidor con <code>LAYOUT_CHECK=1</code> sin ser
        el arnés.
      </p>

      {/* a1 · el riel de B11 av.10: 27 px para un SKU que necesita ~200. */}
      <p className="text-[13px] text-ink-2">
        Truncado plantado:{" "}
        <span
          data-plantado="a1"
          style={{ display: "inline-block", width: 27, overflow: "hidden", whiteSpace: "nowrap", verticalAlign: "bottom" }}
          className="font-mono text-[12px] font-semibold text-ink"
        >
          DN-HN73 BOTTLE TAG 58KHZ
        </span>
      </p>

      {/* a2 · la navegación aplastada: visible (sin display:none), con un
          enlace real dentro, y 0 px de alto. */}
      <nav data-plantado="a2" aria-label="Control: navegación aplastada" style={{ height: 0, overflow: "hidden" }}>
        <a href="/control-layout" className="text-[13px]">
          Enlace dentro de la navegación aplastada
        </a>
      </nav>

      {/* a3 · dos flotantes fijos con sus botones traslapados (los botones
          llenan su contenedor: el traslape es de CONTROLES, no de cajas
          vacías). Lejos de las esquinas donde viven los flotantes reales
          del shell (burbuja del chat abajo-derecha, píldora abajo-izquierda,
          BottomNav abajo) para no fabricar pares con ellos. */}
      <div data-plantado="a3" style={{ position: "fixed", top: "40%", left: 8, width: 120, height: 40, zIndex: 10 }}>
        <button type="button" style={{ width: "100%", height: "100%" }} className="rounded-md border border-line bg-surface text-[12px]">
          Plantado A
        </button>
      </div>
      <div data-plantado="a3" style={{ position: "fixed", top: "40%", left: 48, width: 120, height: 40, zIndex: 11 }}>
        <button type="button" style={{ width: "100%", height: "100%" }} className="rounded-md border border-line bg-surface text-[12px]">
          Plantado B
        </button>
      </div>

      {/* a4 · UN CONTROL TAPADO: el botón de abajo está entero (su caja no se
          recorta, nada lo desborda) y aun así NADIE puede pulsarlo, porque otro
          flotante opaco se planta encima de su centro. Es la firma exacta de H4
          —el saludo del asistente sobre la píldora de Selección— y la razón de
          que A4 exista: A3 mira cajas, A4 pregunta al navegador quién recibe el
          toque. Sin este plantado, A4 sería una guarda que nunca demostró poder
          denunciar (P19). */}
      <div data-plantado="a4" style={{ position: "fixed", top: "28%", left: 8, width: 140, height: 40, zIndex: 10 }}>
        <button type="button" style={{ width: "100%", height: "100%" }} className="rounded-md border border-line bg-surface text-[12px]">
          Tapado (a4)
        </button>
      </div>
      <div
        aria-hidden="true"
        style={{ position: "fixed", top: "28%", left: 8, width: 140, height: 40, zIndex: 12, background: "var(--mx-surface-3)" }}
      />

      {/* ============================================================
          a5 · RECORTADO POR UN ANCESTRO, y SOLO con el sidebar EXPANDIDO.
          [C-DASH·13]

          La firma exacta del defecto que A1c viene a cazar: a 390 px TRES de los
          seis bloques del riel del tablero caían fuera de la pantalla —el `<nav>`
          va con `overflow-x: visible`, así que quien recortaba era `main`— y
          ninguna aserción podía verlo. Ese defecto YA ESTÁ ARREGLADO, y por eso
          este plantado es obligatorio: sin un sujeto vivo, un verde de A1c no
          distingue «no hay nada recortado» de «el predicado es ciego».

          Y ADEMÁS LLEVA EL EJE DEL SIDEBAR DENTRO, que es lo que se exigió al
          autorizar tocar el arnés: el contenedor mide `460px` menos el ancho real
          del `<aside>`, así que

            expandido  →  460 − 230 = 230 px  ·  el enlace [280, 420] queda ENTERO fuera ⇒ DENUNCIA
            colapsado  →  460 −   0 = 460 px  ·  el enlace cabe                        ⇒ CALLA

          Las dos direcciones, y la segunda es la que hace al control no-vacuo: un
          predicado que denunciara SIEMPRE pasaría la primera con nota. El
          veredicto exige las dos y además que los DOS regímenes se hayan medido
          de verdad en la corrida (`calladoEnEstado` en `veredicto.ts`).

          El contenedor mide 230 px en su caso más estrecho, por encima del umbral
          de legibilidad de A1a (48), así que A1a lo CUENTA y no lo denuncia: cada
          plantado cae por SU aserción y no por la de al lado.
          ============================================================ */}
      <div
        data-plantado="a5"
        style={{ position: "relative", height: 40, width: "calc(460px - var(--mx-sidebar-w, 230px))", overflowX: "hidden" }}
        className="rounded-md border border-line"
      >
        <a
          href="/control-layout"
          style={{ position: "absolute", left: 280, top: 8, width: 140, whiteSpace: "nowrap" }}
          className="text-[12px] text-info"
        >
          Enlace recortado (a5)
        </a>
      </div>

      {/* a5-fantasma · CONTRATO INVERTIDO de A1c: este enlace ASOMA de su
          contenedor pero NO del todo, así que sigue alcanzable y NO debe
          denunciarse — se cuenta en `asomanParcialmente`.

          Es el control que demuestra que A1c SEPARA (P20): sin él, un predicado
          que denunciara cualquier asomo pasaría el control de a5 con nota y
          llenaría de ruido cada pantalla con un borde. El enlace vive en
          [150, 290] dentro de un contenedor de 200: cruza el borde y su mitad
          izquierda sigue en pantalla. */}
      <div
        data-plantado="a5-fantasma"
        style={{ position: "relative", height: 40, width: 200, overflowX: "hidden" }}
        className="rounded-md border border-line"
      >
        <a
          href="/control-layout"
          style={{ position: "absolute", left: 150, top: 8, width: 140, whiteSpace: "nowrap" }}
          className="text-[12px] text-info"
        >
          Asoma a medias
        </a>
      </div>

      {/* a3-fantasma · CONTRATO INVERTIDO: este par NO debe denunciarse.
          Es el control que demuestra que A3 SEPARA (P20), y nació de un
          defecto real del propio instrumento: sus dos primeros hallazgos de
          solape (H2/H3) eran rects de controles scrolleados fuera de vista
          dentro de un `overflow-y: auto` — cajas geométricas que ningún dedo
          alcanza. El botón de aquí abajo vive a 120 px del techo de su
          contenedor, que solo muestra 40: su rect cruza al vecino, su área
          tocable no existe. Si el veredicto lo ve denunciado, el instrumento
          volvió a medir la representación en vez de la cosa → SIN VEREDICTO,
          no rojo. */}
      <div
        data-plantado="a3-fantasma"
        style={{ position: "fixed", top: "15%", left: 8, width: 120, height: 40, overflow: "auto", zIndex: 10 }}
      >
        <div style={{ height: 300, paddingTop: 120 }}>
          <button type="button" style={{ width: "100%", height: 40 }} className="rounded-md border border-line bg-surface text-[12px]">
            Fantasma (fuera de vista)
          </button>
        </div>
      </div>
      <div style={{ position: "fixed", top: "calc(15% + 120px)", left: 8, width: 120, height: 40, zIndex: 11 }}>
        <button type="button" style={{ width: "100%", height: "100%" }} className="rounded-md border border-line bg-surface text-[12px]">
          Vecino del fantasma
        </button>
      </div>

      {/* El par PERMITIDO: mismo traslape, con la marca declarada por
          nombre en UNO de los dos (basta uno: la excepción cubre el par).
          El veredicto exige que este nombre aparezca como ejercido Y que
          ningún nombre fuera de la lista registrada aparezca jamás. */}
      <div
        data-solape-permitido="control-permitido"
        style={{ position: "fixed", top: "60%", left: 8, width: 120, height: 40, zIndex: 10 }}
      >
        <button type="button" style={{ width: "100%", height: "100%" }} className="rounded-md border border-line bg-surface text-[12px]">
          Permitido A
        </button>
      </div>
      <div style={{ position: "fixed", top: "60%", left: 48, width: 120, height: 40, zIndex: 11 }}>
        <button type="button" style={{ width: "100%", height: "100%" }} className="rounded-md border border-line bg-surface text-[12px]">
          Permitido B
        </button>
      </div>
    </div>
  );
}
