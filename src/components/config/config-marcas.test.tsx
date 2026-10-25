import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConfigMarcas } from "./config-marcas";
import type { EstadoGobierno, MarcaGobierno } from "@/lib/marcas/gobierno";

function marca(over: Partial<MarcaGobierno> = {}): MarcaGobierno {
  return {
    nombre: "BRAND1",
    excluida: false,
    motivo: null,
    por: null,
    en: null,
    creadaEn: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function estado(over: Partial<EstadoGobierno> = {}): EstadoGobierno {
  return { excluidas: [], sinDecidir: [], total: 17, ...over };
}

/** Sirve una respuesta de /api/marcas. `status >= 400` para el camino de fallo. */
function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status < 400,
        status,
        json: () => Promise.resolve(body),
      } as Response),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const VERTICAL = marca({
  nombre: "VERTICAL",
  excluida: true,
  motivo: "Son inventario real pero no se cotizan desde el portal.",
  por: "PO · Ivan Ruiz · via VERT-B2",
  en: "2026-09-21T21:57:54.000Z",
});

describe("ConfigMarcas · lo excluido, con su autoría", () => {
  it("enseña la marca excluida CON quién y cuándo, y su motivo", async () => {
    stubFetch(estado({ excluidas: [VERTICAL] }));
    render(<ConfigMarcas />);

    await waitFor(() => expect(screen.getByText("VERTICAL")).toBeInTheDocument());
    expect(screen.getByText(/PO · Ivan Ruiz/)).toBeInTheDocument();
    expect(screen.getByText(/no se cotizan desde el portal/)).toBeInTheDocument();
  });

  // El denominador SIEMPRE a la vista: «ninguna excluida» sin decir de cuántas
  // es una afirmación sin universo.
  it("sin ninguna excluida lo dice CON su universo, no a secas", async () => {
    stubFetch(estado({ excluidas: [], total: 17 }));
    render(<ConfigMarcas />);

    await waitFor(() => expect(screen.getByText(/Ninguna marca está excluida/)).toBeInTheDocument());
    expect(screen.getByText(/las 17 marcas del vocabulario/)).toBeInTheDocument();
  });

  // El CHECK de la 0039 vuelve ese estado inexpresable en la base: si aparece,
  // no es un campo vacío, es un síntoma — y se dice en vez de pintar un «—».
  it("una excluida SIN autoría se denuncia como síntoma, no se pinta como hueco", async () => {
    stubFetch(estado({ excluidas: [marca({ nombre: "RARA", excluida: true })] }));
    render(<ConfigMarcas />);

    await waitFor(() => expect(screen.getByText(/sin autoría registrada/)).toBeInTheDocument());
  });
});

describe("ConfigMarcas · la alarma de marca nueva", () => {
  // EL ANTIPATRÓN QUE SE EVITA: una alarma que suena siempre es una alarma
  // apagada. Nace en CERO por el centinela de la 0039.
  it("sin marcas nuevas: cuenta 0 y explica POR QUÉ existe la cuenta", async () => {
    stubFetch(estado({ sinDecidir: [] }));
    render(<ConfigMarcas />);

    await waitFor(() =>
      expect(screen.getByLabelText("0 marcas nuevas sin decisión")).toBeInTheDocument(),
    );
    expect(screen.getByText(/Una marca nueva entra sola en la ingesta/)).toBeInTheDocument();
  });

  it("con marcas nuevas: las NOMBRA, con su fecha, y dice que mientras tanto SÍ se listan", async () => {
    const nueva = marca({ nombre: "RECIEN", creadaEn: "2026-09-21T10:00:00.000Z" });
    stubFetch(estado({ sinDecidir: [nueva] }));
    render(<ConfigMarcas />);

    await waitFor(() =>
      expect(screen.getByLabelText("1 marcas nuevas sin decisión")).toBeInTheDocument(),
    );
    expect(screen.getByText("RECIEN")).toBeInTheDocument();
    // Lo que hace accionable la alarma: decir qué está pasando MIENTRAS nadie
    // decide. Una alarma que sólo cuenta no dice qué se está perdiendo.
    expect(screen.getByText(/Mientras tanto SÍ se listan, por omisión/)).toBeInTheDocument();
  });
});

describe("ConfigMarcas · los estados que no son «hay dato»", () => {
  // ⚠ P4/P12: un fallo de lectura NO puede pintarse como «ninguna excluida».
  // Son dos cosas opuestas y aquí se separan explícitamente.
  it("si la lectura falla NO dice «ninguna excluida»: dice que no se pudo leer", async () => {
    stubFetch({ error: "internal_error", message: "algo tronó" }, 500);
    render(<ConfigMarcas />);

    await waitFor(() => expect(screen.getByText("algo tronó")).toBeInTheDocument());
    expect(screen.queryByText(/Ninguna marca está excluida/)).not.toBeInTheDocument();
    expect(screen.queryByText(/marcas nuevas sin decisión/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  // ⚠ ESTE CASO LO ENCONTRÓ UN ROJO, no un diseño: con un cuerpo de otra forma
  // el panel LANZABA y se llevaba la pestaña entera. Una pantalla de gobierno
  // que desaparece es peor que una que dice que no pudo mirar.
  it("un cuerpo 200 con OTRA forma no revienta la pestaña, y NO se lee como «vacío»", async () => {
    stubFetch({ items: [] });
    render(<ConfigMarcas />);

    await waitFor(() => expect(screen.getByText(/no tiene la forma esperada/)).toBeInTheDocument());
    // La distinción que sostiene todo: «no se pudo leer» ≠ «no hay nada excluido».
    expect(screen.queryByText(/Ninguna marca está excluida/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/marcas nuevas sin decisión/)).not.toBeInTheDocument();
  });

  it("el encabezado y la explicación de la regla están SIEMPRE, también mientras carga", () => {
    stubFetch(estado());
    render(<ConfigMarcas />);

    expect(screen.getByText("Marcas excluidas del catálogo")).toBeInTheDocument();
    expect(screen.getByText(/lo que se excluye es la vista del catálogo/)).toBeInTheDocument();
  });
});
