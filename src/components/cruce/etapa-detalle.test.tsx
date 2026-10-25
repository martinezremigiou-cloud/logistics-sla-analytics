import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CruceEmbarqueItem, CruceEtapa } from "@/types/api";
import { EtapaDetalle } from "./etapa-detalle";

function item(overrides: Partial<CruceEmbarqueItem> = {}): CruceEmbarqueItem {
  return {
    id: "e1",
    sku: "A-1",
    descripcion: "Candado industrial",
    oc_po: "OC-1",
    proveedor: "PROV",
    piezas: 100,
    tipo_importacion: "MAR",
    pais_origen: "CN",
    etd: null,
    // Con hora explícita (mediodía UTC) para que el día no se recorra al formatear en huso local (America/Mexico_City).
    eta: "2026-08-01T12:00:00.000Z",
    fecha_llegada: null,
    fecha_disponibilidad: null,
    proyecto: null,
    retrasado: false,
    ...overrides,
  };
}

function etapa(overrides: Partial<CruceEtapa> = {}): CruceEtapa {
  return {
    orden: 7,
    nombre: "En Aduana",
    activos: { embarques: 1, piezas: 100 },
    historial: { embarques: 0, piezas: 0 },
    items: [item()],
    ...overrides,
  };
}

describe("EtapaDetalle", () => {
  it("renderiza cada item: sku, descripción, piezas y ETA", () => {
    render(<EtapaDetalle etapa={etapa()} onFoco={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.getByText("Candado industrial")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("ETA 01 ago 2026")).toBeInTheDocument();
  });

  it("descripcion null → '—'", () => {
    render(<EtapaDetalle etapa={etapa({ items: [item({ descripcion: null })] })} onFoco={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("piezas null → '—'", () => {
    render(<EtapaDetalle etapa={etapa({ items: [item({ piezas: null })] })} onFoco={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("badge Retraso solo cuando retrasado:true", () => {
    render(<EtapaDetalle etapa={etapa({ items: [item({ retrasado: true })] })} onFoco={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Retraso")).toBeInTheDocument();
  });

  it("badge Retraso ausente cuando retrasado:false", () => {
    render(<EtapaDetalle etapa={etapa({ items: [item({ retrasado: false })] })} onFoco={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Retraso")).not.toBeInTheDocument();
  });

  it("clic en el SKU dispara onFoco con ese sku", () => {
    const onFoco = vi.fn();
    render(<EtapaDetalle etapa={etapa()} onFoco={onFoco} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "A-1" }));
    expect(onFoco).toHaveBeenCalledWith("A-1");
  });

  it("clic en Cerrar dispara onClose", () => {
    const onClose = vi.fn();
    render(<EtapaDetalle etapa={etapa()} onFoco={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("etapa sin items: copy exacto de vacío", () => {
    render(<EtapaDetalle etapa={etapa({ items: [] })} onFoco={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("No hay embarques en esta etapa ahora mismo.")).toBeInTheDocument();
  });

  it("línea de origen omite el campo null (solo tipo_importacion, sin pais_origen)", () => {
    render(
      <EtapaDetalle
        etapa={etapa({ items: [item({ tipo_importacion: "MAR", pais_origen: null })] })}
        onFoco={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("MAR")).toBeInTheDocument();
  });

  it("línea de origen ausente cuando ambos campos son null", () => {
    render(
      <EtapaDetalle
        etapa={etapa({ items: [item({ tipo_importacion: null, pais_origen: null })] })}
        onFoco={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("MAR")).not.toBeInTheDocument();
    expect(screen.queryByText("CN")).not.toBeInTheDocument();
  });
});
