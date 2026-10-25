import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PanelCampana, IconoCampana } from "./panel-campana";
import type { CampanaResponse } from "@/types/avisos";

/**
 * El DTO se construye con el tipo COMPARTIDO entre la ruta y el cliente
 * (`CampanaResponse`, que el servicio reexporta como `CampanaDTO`). No es un
 * doble inventado por el test: si la ruta cambiara de forma, esto no compila.
 * Es la lección de INV-B8.2 — un mock que inventa la forma no prueba el
 * consumidor, confirma el error.
 */
function datos(over: Partial<CampanaResponse> = {}): CampanaResponse {
  return {
    pulso: { movimientos: [], llegadas: [], enCamino: { skus: 0, piezas: 0, etapasOcupadas: 0 } },
    avisos: [],
    nuevos: 0,
    seguidos: 0,
    preferencias: {
      av_estatus: false,
      av_disponible: false,
      av_reservado: false,
      av_llegada: true,
      preguntar_por_sku: false,
      visto_hasta: null,
      boletin_correo: true,
    },
    ultimas: [
      { fuente: "stock", ultima: "2026-08-12T22:53:00.000Z" },
      { fuente: "aduana", ultima: "2026-08-14T16:00:00.000Z" },
    ],
    calladas: [],
    correoCallado: null,
    ...over,
  };
}

describe("[INV-B9] PanelCampana", () => {
  // ============================================================
  // ZERO-STATE: quien no sigue nada tiene que ver algo útil Y entender CÓMO
  // seguir su primer SKU. Un panel vacío que solo dice «no hay nada» deja al
  // usuario sin saber que la función existe.
  // ============================================================
  it("sin seguimientos explica cómo seguir el primero, con enlace al catálogo", () => {
    render(<PanelCampana datos={datos()} />);
    expect(screen.getByText("Todavía no sigues ningún SKU.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "catálogo" })).toHaveAttribute("href", "/catalogo");
  });

  it("con seguimientos pero sin movimiento lo dice con el número, no en blanco", () => {
    render(<PanelCampana datos={datos({ seguidos: 12 })} />);
    expect(screen.getByText(/Sigues 12 SKU y ninguno se movió/)).toBeInTheDocument();
  });

  // ============================================================
  // «De tus 30 SKU, N se movieron» — el resumen acordado, con el detalle
  // debajo. Nunca una lista de eventos crudos.
  // ============================================================
  it("encabeza con el RESUMEN y luego el detalle", () => {
    render(
      <PanelCampana
        datos={datos({
          seguidos: 30,
          avisos: [
            { perfil_id: "p", tipo: "llegada", sku: "SUJ500-F", de: "0", a: "40", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
            { perfil_id: "p", tipo: "estatus", sku: "JE016-YD", de: "En Aduana", a: "En Almacén North", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/De tus 30 SKU,/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Ya llegó")).toBeInTheDocument();
    expect(screen.getByText("En Almacén North")).toBeInTheDocument();
    // Cada SKU enlaza a su ficha: el aviso sin destino obliga a buscarlo a mano.
    expect(screen.getByRole("link", { name: "SUJ500-F" })).toHaveAttribute("href", "/catalogo/SUJ500-F");
  });

  // ============================================================
  // UN RENGLÓN POR SKU, NO POR AVISO — y esta prueba existe porque el gate del
  // grano se puso ROJO. Con los cuatro avisos encendidos, la historia real
  // produce **muchos más avisos que SKU** en una recarga completa de stock: tantos
  // renglones es la lista de eventos que el brief prohíbe. Se arregló
  // agrupando en el panel, no aflojando la prueba.
  // ============================================================
  it("dos avisos del MISMO SKU son UN renglón, con sus dos etiquetas", () => {
    const { container } = render(
      <PanelCampana
        datos={datos({
          seguidos: 1,
          avisos: [
            { perfil_id: "p", tipo: "estatus", sku: "SUJ500-F", de: "En Aduana", a: "En Almacén North", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
            { perfil_id: "p", tipo: "reservado", sku: "SUJ500-F", de: "19", a: "15", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
          ],
        })}
      />,
    );
    // Un solo <li> en la lista de seguidos, con las dos etiquetas dentro.
    expect(container.querySelectorAll("section:nth-of-type(2) li")).toHaveLength(1);
    expect(screen.getByText("Cambió de etapa · Cambió el reservado")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "SUJ500-F" })).toHaveLength(1);
    // Y el encabezado cuenta SKU, no avisos: es la misma cifra que renglones.
    expect(screen.getByText(/De tus 1 SKU,/)).toBeInTheDocument();
  });

  it("el pulso es MOVIMIENTO: etapas que avanzaron, llegadas y lo que viene", () => {
    render(
      <PanelCampana
        datos={datos({
          pulso: {
            movimientos: [{ sku: "FZ6661N5", de: "En Aduana", a: "En Almacén North" }],
            llegadas: ["A-1", "B-2"],
            enCamino: { skus: 41, piezas: 9_640, etapasOcupadas: 3 },
          },
        })}
      />,
    );
    expect(screen.getByText(/1 SKU avanzaron de etapa/)).toBeInTheDocument();
    expect(screen.getByText(/2 SKU llegaron/)).toBeInTheDocument();
    expect(screen.getByText(/41 SKU en camino/)).toBeInTheDocument();
    expect(screen.getByText(/3 etapas ocupadas/)).toBeInTheDocument();
  });

  // ============================================================
  // La línea que contesta «¿por qué no he visto nada?». Sin ella, una campana
  // vacía no distingue «no pasó nada» de «el dato dejó de llegar» — que es la
  // trampa de `contar_pendientes()` y la falla que ya ocurrió dos veces.
  // ============================================================
  it("siempre dice cuándo cargó cada fuente, aunque no haya nada más", () => {
    render(<PanelCampana datos={datos()} />);
    expect(screen.getByText("stock")).toBeInTheDocument();
    expect(screen.getByText("aduana")).toBeInTheDocument();
  });

  it("una fuente que nunca cargó lo dice, en vez de un hueco", () => {
    render(<PanelCampana datos={datos({ ultimas: [{ fuente: "stock", ultima: null }] })} />);
    expect(screen.getByText(/sin cargas todavía/)).toBeInTheDocument();
  });

  // ============================================================
  // LA LÍNEA DE ADMIN. Ventas nunca llega aquí porque el servidor devuelve
  // `calladas` vacío para cualquier rol que no sea admin — este componente solo
  // pinta lo que recibe.
  // ============================================================
  it("pinta la línea de fuente callada cuando viene, nombrando la otra fuente", () => {
    render(
      <PanelCampana datos={datos({ calladas: [{ fuente: "stock", dias: 7, otra: "aduana", diasOtra: 1 }] })} />,
    );
    expect(screen.getByText(/lleva 7 días sin traer nada nuevo/)).toBeInTheDocument();
    // Nombrar la otra fuente hace el silencio NOTABLE. No dice de qué es.
    expect(screen.getByText(/aduana sí trajo hace 1/)).toBeInTheDocument();

    // ============================================================
    // Y NO AFIRMA UNA AVERÍA. Corregido tras medir: el ETL no
    // escribe snapshot cuando el hash no cambió (`runEtl.ts:549`), así que
    // «corrió y no había nada» y «no corrió» dejan la MISMA evidencia. La
    // línea decía «sin cargar», que es una de las dos.
    // ============================================================
    expect(screen.queryByText(/sin cargar/)).not.toBeInTheDocument();
    expect(screen.getByText(/no los\s+distingue/)).toBeInTheDocument();
  });

  it("sin línea de admin no se pinta nada de eso — es lo que ve ventas", () => {
    render(<PanelCampana datos={datos()} />);
    expect(screen.queryByText(/sin cargar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no confirma un envío/)).not.toBeInTheDocument();
  });

  // ============================================================
  // [INV-B9.1] La segunda línea de admin: el canal de correo callado. n8n puede
  // dejar de llamar sin que nada se note — es la falla de la ingesta que
  // dejó de llamar durante horas, en el canal nuevo.
  // ============================================================
  it("avisa cuando el correo lleva demasiado sin confirmar un envío", () => {
    render(<PanelCampana datos={datos({ correoCallado: { dias: 15, ultimo: "2026-08-01T12:00:00.000Z" } })} />);
    expect(screen.getByText(/no confirma un envío desde hace/)).toBeInTheDocument();
    expect(screen.getByText(/15 días/)).toBeInTheDocument();
  });

  it("y NO la pinta cuando el canal está sano — un aviso permanente se aprende a ignorar", () => {
    render(<PanelCampana datos={datos({ correoCallado: null })} />);
    expect(screen.queryByText(/no confirma un envío/)).not.toBeInTheDocument();
  });
});

describe("[INV-B9] IconoCampana", () => {
  it("sin nada nuevo no hay badge: un cero pintado es ruido", () => {
    const { container } = render(<IconoCampana nuevos={0} />);
    expect(container.textContent).toBe("");
  });

  it("con novedades pinta el número, mismo patrón que el badge de Pendientes", () => {
    render(<IconoCampana nuevos={3} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("no deja que el badge crezca sin límite", () => {
    render(<IconoCampana nuevos={1234} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});
