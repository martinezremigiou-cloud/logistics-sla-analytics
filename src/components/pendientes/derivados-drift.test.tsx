// ============================================================
// [2.0.1-A · D2] derivados-drift.test.tsx
//
// Lo que estas pruebas protegen, por orden de importancia:
//   1. Que `null` NO se lea como cero. Es la línea entre «no hay nada roto» y
//      «no pude mirar», y es el patrón P4 de este repo (el fail-open silencioso).
//   2. Que el titular del puente sea el CAMINO y no la tabla (P27).
//   3. Que el rótulo de un renombre diga PROBABLE, porque el dato no da para
//      más: en este sistema renombrar y fusionar dejan la misma huella.
// ============================================================
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DerivadosDrift } from "./derivados-drift";
import type { DriftFamiliasVista, TestigoPuentesVista } from "@/types/api";

const DRIFT: DriftFamiliasVista = {
  ventanaDias: 40,
  totalReasignaciones: 131,
  corridas: [
    {
      snapshotId: "snap-1",
      detectadoEn: "2026-05-12T18:00:00.000Z",
      reasignaciones: 58,
      altas: ["SERIES 32"],
      vaciadas: [{ nombre: "SERIES 31", teniaPuente: true }],
      movimientos: [{ de: "SERIES 31", a: "SERIES 32", n: 11 }],
      renombresProbables: [{ de: "SERIES 31", a: "SERIES 32", n: 11 }],
      propuestasPuente: [{ de: "SERIES 31", a: "SERIES 32", n: 11, ficha: "fichas/series-31.md" }],
    },
  ],
};

// Fixture inventado con la forma del caso: casi todas las filas del puente sin camino y
// `documentosAlcanzablesPorSku` = filasTotales − filasSinCamino (33 − 29 = 4).
const PUENTES: TestigoPuentesVista = {
  filasSinCamino: 29,
  filasTotales: 33,
  documentosAlcanzablesPorSku: 4,
  sinCamino: ["SERIES 33", "SERIES 34", "SERIES 35"],
};

describe("[2.0.1-A · D2] DerivadosDrift", () => {
  it("pinta la corrida con su fecha, su conteo y el movimiento concreto", () => {
    render(<DerivadosDrift drift={DRIFT} puentes={PUENTES} />);
    expect(screen.getByText(/2026-05-12 · 58 SKU reclasificados/)).toBeInTheDocument();
    expect(screen.getByText(/SERIES 31 → SERIES 32/)).toBeInTheDocument();
    expect(screen.getByText(/1 familia\(s\) se quedaron sin SKU/)).toBeInTheDocument();
  });

  it("dice «Parece un renombre», no «renombre»: el dato no distingue renombre de fusión", () => {
    render(<DerivadosDrift drift={DRIFT} puentes={PUENTES} />);
    expect(screen.getByText(/Parece un renombre/)).toBeInTheDocument();
  });

  it("la propuesta de ficha se PROPONE y declara que la decide una persona", () => {
    render(<DerivadosDrift drift={DRIFT} puentes={PUENTES} />);
    expect(screen.getByText(/lo decide una persona/)).toBeInTheDocument();
  });

  it("el titular del puente son DOCUMENTOS alcanzables, no filas de la tabla (P27)", () => {
    render(<DerivadosDrift drift={DRIFT} puentes={PUENTES} />);
    expect(screen.getByText("Fichas alcanzables por SKU (4)")).toBeInTheDocument();
    // Y las filas aparecen, pero como detalle: 29 de 33 sin camino.
    expect(screen.getByText(/29/)).toBeInTheDocument();
  });

  it("null NO es cero: dice que no se pudo derivar, y no enseña un conteo tranquilizador", () => {
    render(<DerivadosDrift drift={null} puentes={null} />);
    expect(screen.getByText("No se pudo derivar el movimiento de familias en esta lectura.")).toBeInTheDocument();
    expect(screen.getByText("No se pudo derivar el estado del puente documental.")).toBeInTheDocument();
    // Ningún conteo en los titulares: sin dato no hay número que enseñar.
    expect(screen.getByText("Familias que se movieron")).toBeInTheDocument();
    expect(screen.getByText("Fichas alcanzables por SKU")).toBeInTheDocument();
  });

  it("cero medido SÍ es cero, y se dice con palabras distintas a las de «no pude mirar»", () => {
    render(
      <DerivadosDrift
        drift={{ ventanaDias: 40, totalReasignaciones: 0, corridas: [] }}
        puentes={{ filasSinCamino: 0, filasTotales: 12, documentosAlcanzablesPorSku: 12, sinCamino: [] }}
      />,
    );
    expect(screen.getByText(/Ninguna carga movió familias en los últimos 40 días/)).toBeInTheDocument();
    expect(screen.queryByText(/No se pudo derivar/)).not.toBeInTheDocument();
  });

  it("undefined se trata como null y NO revienta el render (JSON de un servidor viejo)", () => {
    // Lo cazó un fixture previo a este objetivo: `undefined` caía en la rama
    // del objeto y explotaba con «Cannot read properties of undefined». Durante
    // un despliegue, un cliente nuevo SÍ puede recibir una respuesta sin estos
    // campos, así que no es un caso de laboratorio.
    render(<DerivadosDrift drift={undefined as never} puentes={undefined as never} />);
    expect(screen.getByText("No se pudo derivar el movimiento de familias en esta lectura.")).toBeInTheDocument();
  });

  it("no ofrece acciones: aquí no se resuelve nada, se ve (mismo contrato que los descuadres)", () => {
    render(<DerivadosDrift drift={DRIFT} puentes={PUENTES} />);
    expect(screen.queryByRole("button", { name: /confirmar|descartar|resolver/i })).not.toBeInTheDocument();
  });
});
