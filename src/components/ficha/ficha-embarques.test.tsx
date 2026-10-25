import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FichaEmbarques } from "./ficha-embarques";
import type { SkuEmbarqueItem } from "@/types/api";

function embarque(overrides: Partial<SkuEmbarqueItem> = {}): SkuEmbarqueItem {
  return {
    id: "e1",
    oc_po: "OC-100",
    proveedor: "PROVEEDOR SA",
    referencia: null,
    factura: null,
    pais_origen: "CN",
    piezas: 500,
    fw: null,
    tipo_importacion: "MARITIMA",
    fecha_recoleccion: null,
    etd: null,
    eta: "2026-06-01",
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus: "En Aduana",
    estatus_orden: 7,
    proyecto: null,
    observaciones: null,
    is_historial: false,
    retrasado: false,
    ...overrides,
  };
}

// Fixture estilo BQW1232: un embarque activo "En Aduana" + uno histórico ya recibido
// (estatus real "Producto Disponible" — el DTO lo trae, pero el card de Historial NO
// muestra el chip de estatus por spec, solo proveedor/piezas/fecha/observaciones).
const ACTIVO = embarque({
  id: "e-activo",
  oc_po: "OC-ADH-1",
  proveedor: "NAVIERA PACIFICO",
  estatus: "En Aduana",
  is_historial: false,
  retrasado: true,
});
const HISTORICO = embarque({
  id: "e-historico",
  oc_po: "OC-ADH-0",
  proveedor: "NAVIERA ATLANTICO",
  estatus: "Producto Disponible",
  is_historial: true,
  retrasado: false,
  fecha_llegada: "2026-05-20",
  fecha_disponibilidad: "2026-05-22T15:00:00.000Z",
  observaciones: "Caja dañada en tránsito",
});

describe("FichaEmbarques", () => {
  it("split correcto: activos en 'Embarques entrantes', históricos en 'Historial'", () => {
    render(<FichaEmbarques embarques={[ACTIVO, HISTORICO]} piezasHistorial={300} />);

    const entrantes = screen.getByRole("region", { name: "Embarques entrantes" });
    expect(within(entrantes).getByText("En Aduana")).toBeInTheDocument();
    expect(within(entrantes).getByText("NAVIERA PACIFICO", { exact: false })).toBeInTheDocument();
    expect(within(entrantes).queryByText("NAVIERA ATLANTICO", { exact: false })).not.toBeInTheDocument();

    const historial = screen.getByRole("region", { name: "Historial" });
    expect(within(historial).getByText("NAVIERA ATLANTICO")).toBeInTheDocument();
    expect(within(historial).queryByText("En Aduana")).not.toBeInTheDocument();
    expect(within(historial).queryByText("NAVIERA PACIFICO")).not.toBeInTheDocument();
  });

  it("badge 'Retraso' solo aparece cuando retrasado:true", () => {
    render(<FichaEmbarques embarques={[ACTIVO]} piezasHistorial={0} />);
    expect(screen.getByText("Retraso")).toBeInTheDocument();
  });

  it("badge 'Retraso' ausente cuando retrasado:false", () => {
    const puntual = embarque({ id: "e-puntual", is_historial: false, retrasado: false });
    render(<FichaEmbarques embarques={[puntual]} piezasHistorial={0} />);
    expect(screen.queryByText("Retraso")).not.toBeInTheDocument();
  });

  it("observaciones no vacías muestran nota 'Nota: ...' en el historial", () => {
    render(<FichaEmbarques embarques={[HISTORICO]} piezasHistorial={300} />);
    expect(screen.getByText(/Nota:/)).toBeInTheDocument();
    expect(screen.getByText(/Caja dañada en tránsito/)).toBeInTheDocument();
  });

  it("observaciones null NO muestra nota", () => {
    const sinNota = embarque({ id: "e-sin-nota", is_historial: true, observaciones: null });
    render(<FichaEmbarques embarques={[sinNota]} piezasHistorial={0} />);
    expect(screen.queryByText(/Nota:/)).not.toBeInTheDocument();
  });

  it("piezas null muestra '—' tanto en activos como en historial", () => {
    const activoSinPiezas = embarque({ id: "e-act-np", is_historial: false, piezas: null });
    const historicoSinPiezas = embarque({ id: "e-hist-np", is_historial: true, piezas: null });
    render(<FichaEmbarques embarques={[activoSinPiezas, historicoSinPiezas]} piezasHistorial={0} />);

    expect(screen.getByTestId("embarque-piezas-e-act-np")).toHaveTextContent("—");
    expect(screen.getByTestId("embarque-piezas-e-hist-np")).toHaveTextContent("—");
  });

  it("oc_po null muestra '—'", () => {
    const sinOc = embarque({ id: "e-sin-oc", is_historial: false, oc_po: null });
    render(<FichaEmbarques embarques={[sinOc]} piezasHistorial={0} />);
    const entrantes = screen.getByRole("region", { name: "Embarques entrantes" });
    expect(within(entrantes).getByText("—")).toBeInTheDocument();
  });

  it("vacío: 'Sin embarques en camino.' y 'Sin historial registrado.'", () => {
    render(<FichaEmbarques embarques={[]} piezasHistorial={0} />);
    expect(screen.getByText("Sin embarques en camino.")).toBeInTheDocument();
    expect(screen.getByText("Sin historial registrado.")).toBeInTheDocument();
  });

  it("footer discreto del historial: 'Histórico recibido: {piezas_historial} pz'", () => {
    render(<FichaEmbarques embarques={[]} piezasHistorial={1234} />);
    expect(screen.getByText("Histórico recibido: 1,234 pz")).toBeInTheDocument();
  });
});
