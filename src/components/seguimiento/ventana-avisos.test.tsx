import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VentanaAvisos } from "./ventana-avisos";
import { PREFERENCIAS_POR_OMISION } from "@/components/providers/seguimiento-provider";
import type { AvisosSku } from "@/types/avisos";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function pintar(over: Partial<React.ComponentProps<typeof VentanaAvisos>> = {}) {
  const props = {
    sku: "SUJ500-F",
    open: true,
    onOpenChange: vi.fn(),
    inicial: PREFERENCIAS_POR_OMISION as AvisosSku,
    onConfirmar: vi.fn(async () => true),
    ...over,
  };
  render(<VentanaAvisos {...props} />);
  return props;
}

describe("[INV-B9] VentanaAvisos", () => {
  // ============================================================
  // El default sale de una MEDICIÓN, no de una intuición: «ya llegó» es el
  // evento más raro de los cuatro (muy por debajo del de disponible), y por
  // eso es el único que deja a la campana significando algo cuando suena.
  // ============================================================
  it("arranca con «Ya llegó» encendido y los otros tres apagados", () => {
    pintar();
    expect(screen.getByLabelText("Ya llegó")).toBeChecked();
    expect(screen.getByLabelText("Cambió de etapa")).not.toBeChecked();
    expect(screen.getByLabelText("Cambió el disponible")).not.toBeChecked();
    expect(screen.getByLabelText("Cambió el reservado")).not.toBeChecked();
  });

  it("cada opción explica QUÉ la dispara: la ventana tiene que explicarse sola", () => {
    pintar();
    expect(screen.getByText("Pasó de no haber a haber.")).toBeInTheDocument();
    expect(screen.getByText("Se movió de etapa. Cualquiera.")).toBeInTheDocument();
  });

  it("«usar esto para los siguientes» viene MARCADO — es el arreglo a las 30 configuraciones", () => {
    pintar();
    expect(screen.getByLabelText("Usar esto para los siguientes")).toBeChecked();
  });

  it("manda al confirmar lo elegido, y avisa que se use como default", async () => {
    const props = pintar();
    fireEvent.click(screen.getByLabelText("Cambió de etapa"));
    fireEvent.click(screen.getByRole("button", { name: "Seguir este SKU" }));

    await waitFor(() => expect(props.onConfirmar).toHaveBeenCalledOnce());
    expect(props.onConfirmar).toHaveBeenCalledWith(
      { av_estatus: true, av_disponible: false, av_reservado: false, av_llegada: true },
      false,
      true,
    );
  });

  it("desmarcar «usar para los siguientes» lo dice al confirmar", async () => {
    const props = pintar();
    fireEvent.click(screen.getByLabelText("Usar esto para los siguientes"));
    fireEvent.click(screen.getByRole("button", { name: "Seguir este SKU" }));
    await waitFor(() =>
      expect(props.onConfirmar).toHaveBeenCalledWith(expect.anything(), expect.anything(), false),
    );
  });

  // ============================================================
  // «Todo» NO es un quinto valor: es un atajo que enciende las cuatro. Un
  // quinto valor sería un estado que significa dos cosas.
  // ============================================================
  it("«Todo» enciende las cuatro, y vuelve a lo esencial", () => {
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    for (const etiqueta of ["Ya llegó", "Cambió de etapa", "Cambió el disponible", "Cambió el reservado"]) {
      expect(screen.getByLabelText(etiqueta)).toBeChecked();
    }
    fireEvent.click(screen.getByRole("button", { name: "Solo lo esencial" }));
    expect(screen.getByLabelText("Ya llegó")).toBeChecked();
    expect(screen.getByLabelText("Cambió el reservado")).not.toBeChecked();
  });

  it("sin ninguna opción no se puede confirmar, y lo dice", () => {
    pintar();
    fireEvent.click(screen.getByLabelText("Ya llegó"));
    expect(screen.getByRole("button", { name: "Seguir este SKU" })).toBeDisabled();
    expect(screen.getByText(/Elige al menos una cosa/)).toBeInTheDocument();
  });

  it("si el guardado falla, la ventana NO se cierra: cerrarla afirmaría un seguimiento que no existe", async () => {
    const props = pintar({ onConfirmar: vi.fn(async () => false) });
    fireEvent.click(screen.getByRole("button", { name: "Seguir este SKU" }));
    await waitFor(() => expect(props.onConfirmar).toHaveBeenCalled());
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("si el guardado sale bien, se cierra", async () => {
    const props = pintar();
    fireEvent.click(screen.getByRole("button", { name: "Seguir este SKU" }));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  // ============================================================
  // [INV-B9.1] EL INTERRUPTOR DE CORREO.
  //
  // Nace APAGADO y eso es una decisión, no un descuido: el correo se PIDE. La
  // campana la abre quien quiere; el correo va a buscar a la persona. Encender
  // por omisión el canal que persigue sería decidir por el vendedor justo lo
  // que este bloque decidió no decidir.
  // ============================================================
  it("«También por correo» nace APAGADO: el correo se pide", () => {
    pintar();
    expect(screen.getByLabelText("También por correo")).not.toBeChecked();
  });

  it("encenderlo viaja como el SEGUNDO argumento, separado de los cuatro avisos", async () => {
    const onConfirmar = vi.fn(async () => true);
    pintar({ onConfirmar });
    fireEvent.click(screen.getByLabelText("También por correo"));
    fireEvent.click(screen.getByRole("button", { name: "Seguir este SKU" }));

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledOnce());
    const [avisos, avCorreo] = onConfirmar.mock.calls[0] as unknown as [AvisosSku, boolean, boolean];
    expect(avCorreo).toBe(true);
    // El canal NO se cuela dentro del objeto de avisos: `av_correo` no es «qué
    // me importa» sino «por dónde me buscas», y el schema los separa igual.
    expect(avisos).not.toHaveProperty("av_correo");
  });

  it("reabrir en EDICIÓN respeta el correo que ya estaba encendido", () => {
    pintar({ correoInicial: true });
    expect(screen.getByLabelText("También por correo")).toBeChecked();
  });

  // ============================================================
  // «Nunca sin campana»: el correo es un SEGUNDO nivel sobre lo de arriba, no
  // un canal paralelo. Sin ningún aviso encendido no hay nada que mandar, así
  // que el interruptor no puede quedar accesible afirmando que sí.
  // ============================================================
  it("sin ningún aviso encendido, el correo no se puede activar", () => {
    pintar();
    fireEvent.click(screen.getByLabelText("Ya llegó"));
    expect(screen.getByLabelText("También por correo")).toBeDisabled();
  });

  // ============================================================
  // P7 — INTERFAZ FANTASMA. Al editar, el llamador IGNORA «usar esto para los
  // siguientes» a propósito: afinar un SKU no declara un default. Pintar el
  // interruptor de todos modos sería un control encendido que no hace nada.
  // ============================================================
  it("al EDITAR no se pinta «usar esto para los siguientes»: no haría nada", () => {
    pintar({ mostrarUsarSiempre: false });
    expect(screen.queryByLabelText("Usar esto para los siguientes")).not.toBeInTheDocument();
    // Y lo demás sigue estando: no se escondió media ventana.
    expect(screen.getByLabelText("Ya llegó")).toBeInTheDocument();
    expect(screen.getByLabelText("También por correo")).toBeInTheDocument();
  });
});
