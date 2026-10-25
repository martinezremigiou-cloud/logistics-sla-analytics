import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BotonSeguir } from "./boton-seguir";
import { SeguimientoFijo, PREFERENCIAS_POR_OMISION } from "@/components/providers/seguimiento-provider";
import type { AvisosSku } from "@/types/avisos";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SOLO_LLEGADA: AvisosSku = {
  av_estatus: false,
  av_disponible: false,
  av_reservado: false,
  av_llegada: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("[INV-B9] BotonSeguir", () => {
  it("SIN provider no se pinta: la degradación es «no hay botón», no «la página se cae»", () => {
    const { container } = render(<BotonSeguir sku="SUJ500-F" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("anuncia el estado con `aria-pressed`, sin que el nombre del botón se mueva bajo el foco", () => {
    const { rerender } = render(
      <SeguimientoFijo seguidos={{}}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button")).toHaveAccessibleName("Seguir SUJ500-F para recibir avisos");

    rerender(
      <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button")).toHaveAccessibleName("Dejar de seguir SUJ500-F");
  });

  it("normaliza el SKU: `suj500-f` y `SUJ500-F` son el mismo", () => {
    render(
      <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }}>
        <BotonSeguir sku="suj500-f" />
      </SeguimientoFijo>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  // ============================================================
  // El botón vive DENTRO de una fila que es un enlace a la ficha. Sin frenar el
  // evento, seguir un SKU navegaría fuera del catálogo — y perder el lugar es
  // justo lo que estas dos superficies existen para evitar.
  // ============================================================
  it("no deja que el clic llegue al enlace de la fila", () => {
    const alNavegar = vi.fn();
    render(
      <SeguimientoFijo seguidos={{}}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a href="#ficha" onClick={alNavegar}>
          <BotonSeguir sku="JE016-YD" />
        </a>
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(alNavegar).not.toHaveBeenCalled();
  });

  // ============================================================
  // El arreglo al riesgo señalado: seguir 30 SKU no puede ser responder 30 veces
  // la misma pregunta.
  // ============================================================
  it("con el DEFAULT (`preguntar_por_sku: false`) seguir es UN clic y NO abre ninguna ventana", () => {
    render(
      <SeguimientoFijo seguidos={{}} preferencias={PREFERENCIAS_POR_OMISION}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(PREFERENCIAS_POR_OMISION.preguntar_por_sku).toBe(false);
  });

  it("solo abre la ventana quien pidió que le preguntaran", async () => {
    render(
      <SeguimientoFijo seguidos={{}} preferencias={{ ...PREFERENCIAS_POR_OMISION, preguntar_por_sku: true }}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText("SUJ500-F")).toBeInTheDocument();
  });

  it("dejar de seguir NO pregunta nada, aunque esté encendido el preguntar", () => {
    render(
      <SeguimientoFijo
        seguidos={{ "SUJ500-F": SOLO_LLEGADA }}
        preferencias={{ ...PREFERENCIAS_POR_OMISION, preguntar_por_sku: true }}
      >
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("la variante de la ficha dice «Avisarme»; la de la tabla, «Seguir»", () => {
    const { rerender } = render(
      <SeguimientoFijo seguidos={{}}>
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Avisarme");

    rerender(
      <SeguimientoFijo seguidos={{}}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("Seguir");
  });
});

// ============================================================
// [INV-B9.1] EL CAMINO PARA ENCENDER EL CORREO DE UN SKU QUE YA SE SIGUE.
//
// El hueco venía de B9 y este bloque lo hizo visible: con el default
// —`preguntar_por_sku: false`— la ventana de preferencias NO se abre nunca, así
// que el interruptor de correo, que vive dentro, quedaba inalcanzable para todo
// SKU ya seguido. Sin este segundo control, la función existiría en la base y
// en el servicio y no habría manera de usarla desde la interfaz.
// ============================================================
describe("[INV-B9.1] BotonSeguir · editar los avisos de un SKU ya seguido", () => {
  const CON_CORREO = { ...SOLO_LLEGADA, av_correo: true };

  it("en la FICHA, un SKU ya seguido ofrece «Avisos» para reabrir la ventana", async () => {
    render(
      <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }} preferencias={PREFERENCIAS_POR_OMISION}>
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar los avisos de SUJ500-F" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByLabelText("También por correo")).toBeInTheDocument();
  });

  // ============================================================
  // No aparece en la tabla ni en el grid A PROPÓSITO: un segundo botón por
  // renglón, sobre 50 filas y junto al de Selección, cuesta densidad para una
  // acción que casi nadie repite. Mismo argumento con el que INV-B8.2 puso el
  // botón de Selección en la ficha.
  // ============================================================
  it("NO aparece en la tabla ni en el grid: ahí solo está el de seguir", () => {
    render(
      <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Editar los avisos de SUJ500-F" })).not.toBeInTheDocument();
  });

  it("y tampoco en la ficha si el SKU NO se sigue: no hay avisos que editar", () => {
    render(
      <SeguimientoFijo seguidos={{}}>
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    expect(screen.queryByRole("button", { name: "Editar los avisos de SUJ500-F" })).not.toBeInTheDocument();
  });

  it("la ventana abre YA RELLENADA con lo que el SKU tiene, no con las preferencias", async () => {
    render(
      <SeguimientoFijo
        seguidos={{ "SUJ500-F": { av_estatus: true, av_disponible: false, av_reservado: false, av_llegada: false } }}
        preferencias={PREFERENCIAS_POR_OMISION}
      >
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar los avisos de SUJ500-F" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    // Lo del SKU (`estatus`), no lo de las preferencias (`llegada`).
    expect(screen.getByLabelText("Cambió de etapa")).toBeChecked();
    expect(screen.getByLabelText("Ya llegó")).not.toBeChecked();
    expect(PREFERENCIAS_POR_OMISION.av_llegada).toBe(true);
  });

  it("al editar, el botón dice «Guardar»: «Seguir este SKU» mentiría sobre algo que ya se sigue", async () => {
    render(
      <SeguimientoFijo seguidos={{ "SUJ500-F": CON_CORREO }} preferencias={PREFERENCIAS_POR_OMISION}>
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar los avisos de SUJ500-F" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Seguir este SKU" })).not.toBeInTheDocument();
  });

  // ============================================================
  // P7 — INTERFAZ FANTASMA, y aquí es donde importa: al editar, el llamador
  // ignora «usar esto para los siguientes». Si el interruptor se pintara,
  // afirmaría un efecto que no ocurre.
  // ============================================================
  it("al editar NO se ofrece «usar esto para los siguientes»: no se tocan las preferencias", async () => {
    render(
      <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }} preferencias={PREFERENCIAS_POR_OMISION}>
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar los avisos de SUJ500-F" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.queryByLabelText("Usar esto para los siguientes")).not.toBeInTheDocument();
  });

  it("al ALTA sí se ofrece: ahí el default sí se está declarando", async () => {
    render(
      <SeguimientoFijo seguidos={{}} preferencias={{ ...PREFERENCIAS_POR_OMISION, preguntar_por_sku: true }}>
        <BotonSeguir sku="SUJ500-F" variante="completo" />
      </SeguimientoFijo>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Seguir SUJ500-F para recibir avisos" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByLabelText("Usar esto para los siguientes")).toBeInTheDocument();
  });

  // ============================================================
  // Que el correo esté encendido se ve SIN ABRIR NADA. Sin esta marca, el único
  // modo de saber si un SKU además te busca por correo sería abrir la ventana
  // de cada uno — y con 30 SKU eso es no saberlo.
  // ============================================================
  it("un SKU con correo encendido lo enseña en el botón; uno sin correo, no", () => {
    const { rerender } = render(
      <SeguimientoFijo seguidos={{ "SUJ500-F": CON_CORREO }}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.getByLabelText("con aviso por correo")).toBeInTheDocument();

    rerender(
      <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.queryByLabelText("con aviso por correo")).not.toBeInTheDocument();
  });

  it("y no lo enseña en un SKU que no se sigue, aunque la marca sea del mismo tamaño", () => {
    render(
      <SeguimientoFijo seguidos={{ "OTRO-SKU": CON_CORREO }}>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoFijo>,
    );
    expect(screen.queryByLabelText("con aviso por correo")).not.toBeInTheDocument();
  });
});
