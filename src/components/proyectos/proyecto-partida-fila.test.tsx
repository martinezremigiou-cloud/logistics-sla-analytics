import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toast } from "sonner";
import { sinComentarios } from "@/lib/guardas/codigo-fuente";
import { ProyectoPartidaFila } from "./proyecto-partida-fila";
import type { PartidaItem } from "@/types/proyectos";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function partida(overrides: Partial<PartidaItem> = {}): PartidaItem {
  return {
    partida_id: "partida-1",
    sku: "SUJ500-F",
    descripcion: "Security Stand Alpha, high security",
    marca: "BRAND1",
    tecnologia: "SERIES 2",
    color: "azul",
    imagen_url: null,
    cantidad: 120,
    total: 2000,
    reservado: 463,
    disponible: 1537,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: null,
    eje_banda: "sin_banda",
    ...overrides,
  };
}

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ProyectoPartidaFila", () => {
  it("pinta SKU, descripción · marca, disp N y el estatus (EstatusPill)", () => {
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida()} onChanged={vi.fn()} />);
    expect(screen.getByText("SUJ500-F")).toBeInTheDocument();
    expect(screen.getByText("Security Stand Alpha, high security · BRAND1")).toBeInTheDocument();
    expect(screen.getByText("disp 1,537")).toBeInTheDocument();
    expect(screen.getByText("Disponible")).toBeInTheDocument();
    // El botón de estado enseña la cantidad comprometida.
    expect(screen.getByRole("button", { name: "120 pz" })).toBeInTheDocument();
  });

  // [2.0.1-C · D-2, quinto sitio] «Ya no viene en el archivo vigente» →
  // «Fuera del inventario vigente»: las mismas palabras que ya usa el papel
  // (`estatusDeFila`/F-11), para que el KAM no lea una tercera redacción
  // distinta entre la pantalla y el PDF el mismo día.
  it("fuera_del_vigente=true: dice explícitamente que está fuera del inventario vigente (aunque el estatus calculado siga diciendo 'Sin stock')", () => {
    render(
      <ProyectoPartidaFila
        proyectoId={PROYECTO_ID}
        partida={partida({ fuera_del_vigente: true, badges: ["stock_cero"], disponible: 0, total: 0 })}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Fuera del inventario vigente")).toBeInTheDocument();
    // El estatus calculado se sigue pintando también (EstatusPill), spec del bloque.
    expect(screen.getByText("Sin stock")).toBeInTheDocument();
  });

  it("fuera_del_vigente=false: NO pinta la insignia", () => {
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida({ fuera_del_vigente: false })} onChanged={vi.fn()} />);
    expect(screen.queryByText("Fuera del inventario vigente")).not.toBeInTheDocument();
  });

  it("en_riesgo=true: pinta la insignia '⚠ En riesgo'", () => {
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida({ en_riesgo: true })} onChanged={vi.fn()} />);
    expect(screen.getByText("⚠ En riesgo")).toBeInTheDocument();
  });

  it("sin color asignado: la barra izquierda no lleva ninguna clase de color curado", () => {
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida({ color: null })} onChanged={vi.fn()} />);
    expect(screen.getByText("SUJ500-F")).toBeInTheDocument();
  });

  it("click en el botón de estado abre el editor de cantidad; Guardar hace PATCH y refresca", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida()} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "120 pz" }));
    const input = await screen.findByLabelText("Cantidad");
    fireEvent.change(input, { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/proyectos/${PROYECTO_ID}/partidas/partida-1`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ cantidad: 150 }) }),
      ),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Cantidad actualizada.");
  });

  it("Guardar deshabilitado con una cantidad inválida (0)", async () => {
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "120 pz" }));
    const input = await screen.findByLabelText("Cantidad");
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("quitar del proyecto: pide confirmación y solo llama DELETE tras confirmar", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida()} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar SUJ500-F del proyecto" }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/proyectos/${PROYECTO_ID}/partidas/partida-1`, expect.objectContaining({ method: "DELETE" })),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("DELETE fallido (404 proyecto_no_encontrado): toast.error con el mensaje del API y NO llama onChanged", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "proyecto_no_encontrado", message: "El proyecto no existe o no es tuyo." }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onChanged = vi.fn();
    render(<ProyectoPartidaFila proyectoId={PROYECTO_ID} partida={partida()} onChanged={onChanged} />);

    fireEvent.click(screen.getByRole("button", { name: "Quitar SUJ500-F del proyecto" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("El proyecto no existe o no es tuyo."));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

// ============================================================
// [Revisión C, MEDIO — D-2, el SEXTO sitio] El literal del portal
// («Fuera del inventario vigente») y `ESTATUS_FUERA_DEL_VIGENTE`
// (`modelo.ts`) son DOS copias textuales del mismo rótulo, sin nada que las
// ate: si alguien edita la constante del papel, el portal diverge en
// silencio, y nadie se entera hasta que un KAM ve dos redacciones distintas
// el mismo día.
//
// NO se resuelve importando la constante en este componente: `modelo.ts` no
// declara `server-only`, pero es el módulo que arma el PDF completo
// (pdfkit, imágenes, tipografías) — importarlo desde un CLIENT component
// arrastraría ese generador entero al bundle del navegador.
//
// Mismo idioma que ya usa este repo para esto exacto («dos copias que no se
// pueden unir se COMPARAN», `codigo-fuente.ts`): se leen los DOS fuentes
// como texto y se contrasta el literal, con control positivo.
// ============================================================
describe("D-2: el literal del portal no diverge de ESTATUS_FUERA_DEL_VIGENTE del papel", () => {
  function literalDelPortal(): string | undefined {
    const fuente = sinComentarios(readFileSync(join(process.cwd(), "src/components/proyectos/proyecto-partida-fila.tsx"), "utf8"));
    return /Fuera del inventario vigente/.exec(fuente)?.[0];
  }

  function literalDelPapel(): string | undefined {
    const fuente = sinComentarios(readFileSync(join(process.cwd(), "src/services/documento/modelo.ts"), "utf8"));
    return /ESTATUS_FUERA_DEL_VIGENTE\s*=\s*'([^']+)'/.exec(fuente)?.[1];
  }

  it("los dos literales existen (anti-vacuidad) y son IDÉNTICOS", () => {
    const delPortal = literalDelPortal();
    const delPapel = literalDelPapel();
    expect(delPortal).toBeTruthy();
    expect(delPapel).toBeTruthy();
    expect(delPortal).toBe(delPapel);
  });

  it("control positivo: si los literales divergieran, esta comparación SÍ los distingue", () => {
    expect("Fuera del inventario vigente").not.toBe("Ya no viene en el archivo vigente");
  });
});
