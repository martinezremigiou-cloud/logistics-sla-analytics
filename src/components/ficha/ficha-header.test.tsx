import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FichaHeader } from "./ficha-header";
import type { SkuReservaItem, SkuSnapshotInfo, SkuStockItem } from "@/types/api";

function snapshotInfo(overrides: Partial<SkuSnapshotInfo> = {}): SkuSnapshotInfo {
  return { id: "snap-1", created_at: "2026-07-10T00:00:00.000Z", filas: 900, archivo: "stock.xlsx", vigente: true, ...overrides };
}

const BASE_PROPS = {
  sku: "A-1",
  marca: "BRAND1",
  familiaEfectiva: "CANDADOS" as string | null,
  descrEfectiva: "Descripción A" as string | null,
  total: 10,
  disponible: 8,
  sobreReservado: false,
  stock: [{ almacen: "NORTH", cantidad: 10 }] as SkuStockItem[],
  reservas: [] as SkuReservaItem[],
  snapshotStock: null as SkuSnapshotInfo | null,
  marcaExcluida: false,
};

describe("FichaHeader", () => {
  it("breadcrumb: familia null muestra 'Sin familia' dentro del nav 'Ruta'", () => {
    render(<FichaHeader {...BASE_PROPS} familiaEfectiva={null} />);
    const nav = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(nav).getByText("Sin familia")).toBeInTheDocument();
  });

  it("breadcrumb: familia presente muestra su nombre dentro del nav", () => {
    render(<FichaHeader {...BASE_PROPS} />);
    const nav = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(nav).getByText("BRAND1")).toBeInTheDocument();
    expect(within(nav).getByText("CANDADOS")).toBeInTheDocument();
  });

  it("muestra el chip de llave única", () => {
    render(<FichaHeader {...BASE_PROPS} />);
    expect(screen.getByText("llave única · no editable")).toBeInTheDocument();
  });

  it("disponible negativo: clase warn en el número grande y pill 'Sobre-reservado'", () => {
    render(<FichaHeader {...BASE_PROPS} disponible={-5} sobreReservado={true} />);
    const numero = screen.getByText("-5");
    expect(numero.className).toContain("text-warn");
    expect(screen.getByText("Sobre-reservado")).toBeInTheDocument();
  });

  it("disponible en cero: tono muted; disponible positivo: tono success", () => {
    const { rerender } = render(<FichaHeader {...BASE_PROPS} disponible={0} total={0} />);
    expect(screen.getByText("0").className).toContain("text-ink-muted");

    rerender(<FichaHeader {...BASE_PROPS} disponible={8} />);
    expect(screen.getByText("8").className).toContain("text-success");
  });

  it("badge 'Solo en WEST' presente cuando todo el stock con cantidad>0 está en WEST", () => {
    render(<FichaHeader {...BASE_PROPS} stock={[{ almacen: "WEST", cantidad: 5 }]} />);
    expect(screen.getByText("Solo en WEST")).toBeInTheDocument();
  });

  it("badge 'Solo en WEST' ausente cuando hay stock positivo también en otro almacén", () => {
    render(
      <FichaHeader
        {...BASE_PROPS}
        stock={[
          { almacen: "WEST", cantidad: 5 },
          { almacen: "NORTH", cantidad: 2 },
        ]}
      />,
    );
    expect(screen.queryByText("Solo en WEST")).not.toBeInTheDocument();
  });

  it("badge 'Solo en WEST' ausente sin stock", () => {
    render(<FichaHeader {...BASE_PROPS} stock={[]} />);
    expect(screen.queryByText("Solo en WEST")).not.toBeInTheDocument();
  });

  it("banner de baja presente cuando snapshot.stock.vigente es false", () => {
    render(<FichaHeader {...BASE_PROPS} snapshotStock={snapshotInfo({ vigente: false })} />);
    expect(screen.getByText("Este producto ya no viene en el último archivo de inventario.")).toBeInTheDocument();
  });

  it("banner de baja ausente cuando snapshot.stock.vigente es true", () => {
    render(<FichaHeader {...BASE_PROPS} snapshotStock={snapshotInfo({ vigente: true })} />);
    expect(screen.queryByText("Este producto ya no viene en el último archivo de inventario.")).not.toBeInTheDocument();
  });

  it("banner de baja ausente cuando no hay snapshot de stock (null)", () => {
    render(<FichaHeader {...BASE_PROPS} snapshotStock={null} />);
    expect(screen.queryByText("Este producto ya no viene en el último archivo de inventario.")).not.toBeInTheDocument();
  });

  // ============================================================
  // [VERT-B2] EL CINTILLO ACUMULA.
  //
  // Hasta este bloque era un `&&` suelto: un aviso, sin sitio para el segundo.
  // Y los dos se solapan de verdad, no en teoría: medido contra un corte
  // real, casi todos los SKU remanentes son marca VERTICAL — para casi todas
  // esas fichas, las dos cosas son ciertas a la vez.
  // ============================================================
  const AVISO_MARCA = /no se lista en el catálogo por una regla/;
  const AVISO_BAJA = "Este producto ya no viene en el último archivo de inventario.";

  it("marca excluida: lo DECLARA (y nombra la marca), sin dejar de servir la ficha", () => {
    render(<FichaHeader {...BASE_PROPS} marca="VERTICAL" marcaExcluida />);
    expect(screen.getByText(AVISO_MARCA)).toBeInTheDocument();
    // La ficha se sirve igual: el aviso acompaña, no reemplaza (C-3).
    expect(screen.getByRole("navigation", { name: "Ruta" })).toBeInTheDocument();
  });

  it("marca NO excluida: no inventa el aviso", () => {
    render(<FichaHeader {...BASE_PROPS} marcaExcluida={false} />);
    expect(screen.queryByText(AVISO_MARCA)).not.toBeInTheDocument();
  });

  // ⚠ ÉSTE ES EL QUE VIGILA. Con el `&&` suelto de antes, el segundo aviso no
  // tenía dónde ponerse: este caso es el que se pone rojo si alguien vuelve a
  // colapsar la lista en un único bloque condicional.
  it("los DOS a la vez (14 de los 18 remanentes son VERTICAL): se acumulan, no se pisan", () => {
    render(
      <FichaHeader
        {...BASE_PROPS}
        marca="VERTICAL"
        marcaExcluida
        snapshotStock={snapshotInfo({ vigente: false })}
      />,
    );
    expect(screen.getByText(AVISO_MARCA)).toBeInTheDocument();
    expect(screen.getByText(AVISO_BAJA)).toBeInTheDocument();
  });

  it("botón 'Ver en Embarques' apunta a /embarques?sku=<sku> (encodeURIComponent)", () => {
    render(<FichaHeader {...BASE_PROPS} sku="A/1" />);
    const link = screen.getByRole("link", { name: "Ver en Embarques" });
    expect(link).toHaveAttribute("href", "/embarques?sku=A%2F1");
  });

  it("chip 'N reservas · M clientes' solo aparece si hay reservas, contando clientes únicos", () => {
    const { rerender } = render(<FichaHeader {...BASE_PROPS} reservas={[]} />);
    expect(screen.queryByText(/reservas ·/)).not.toBeInTheDocument();

    const reservas: SkuReservaItem[] = [
      { kam: "LUCAS", cliente: "RETAILER64", cantidad: 5, motivo: null, fecha: "2026-07-01" },
      { kam: "LUCAS", cliente: "RETAILER64", cantidad: 2, motivo: null, fecha: "2026-07-02" },
      { kam: null, cliente: "RETAILER80", cantidad: 1, motivo: null, fecha: "2026-07-03" },
    ];
    rerender(<FichaHeader {...BASE_PROPS} reservas={reservas} />);
    expect(screen.getByText("3 reservas · 2 clientes")).toBeInTheDocument();
  });

  it("descr_efectiva null muestra '—'", () => {
    render(<FichaHeader {...BASE_PROPS} descrEfectiva={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("muestra 'de {total} total'", () => {
    render(<FichaHeader {...BASE_PROPS} total={10} disponible={8} />);
    expect(screen.getByText("de 10 total")).toBeInTheDocument();
  });

  it("chip de color: sin color (default) muestra 'Sin color' con dot hueco", () => {
    render(<FichaHeader {...BASE_PROPS} />);
    expect(screen.getByText("Sin color")).toBeInTheDocument();
  });

  it("chip de color: con color muestra el nombre y un dot con el token --mx-tag-{slug}", () => {
    render(<FichaHeader {...BASE_PROPS} color="azul" />);
    const chip = screen.getByText("Azul");
    expect(chip).toBeInTheDocument();
    expect(screen.queryByText("Sin color")).not.toBeInTheDocument();
    const dot = chip.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain("bg-[var(--mx-tag-azul)]");
  });

  it("chip de color: slug desconocido se degrada a 'Sin color' sin lanzar", () => {
    render(<FichaHeader {...BASE_PROPS} color="no-existe" />);
    expect(screen.getByText("Sin color")).toBeInTheDocument();
  });

  it("chip de tecnología: con valor muestra el nombre (B-PARCHE F4)", () => {
    render(<FichaHeader {...BASE_PROPS} tecnologia="RFID" />);
    expect(screen.getByText("RFID")).toBeInTheDocument();
  });

  it("chip de tecnología: null (o ausente) muestra 'Sin tecnología'", () => {
    render(<FichaHeader {...BASE_PROPS} tecnologia={null} />);
    expect(screen.getByText("Sin tecnología")).toBeInTheDocument();
  });
});
