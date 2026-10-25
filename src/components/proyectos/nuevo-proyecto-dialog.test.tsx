import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { NuevoProyectoDialog } from "./nuevo-proyecto-dialog";
import type { ProyectoResumen } from "@/types/proyectos";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("NuevoProyectoDialog", () => {
  it("Crear proyecto deshabilitado sin título", () => {
    render(<NuevoProyectoDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Crear proyecto" })).toBeDisabled();
  });

  it("POST /api/proyectos con los campos llenos; los vacíos NO viajan (quedan undefined, no strings vacíos)", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ titulo: "Rollout Retailer 42" });
      return new Response(JSON.stringify({ id: "1", folio: "PRJ-002" } satisfies Partial<ProyectoResumen>), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onCreated = vi.fn();
    render(<NuevoProyectoDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Rollout Retailer 42" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/proyectos", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "1", folio: "PRJ-002" }));
  });

  it("envía tipo/intención/descripción/notas/fecha cuando se llenan", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        titulo: "Apertura Retailer1 Store1",
        descripcion: "Nueva tienda.",
        notas: "Ojo con el EAS.",
        fecha: "2026-05-18",
        tipo: "Apertura",
        intencion: "Referencia",
      });
      return new Response(JSON.stringify({ id: "2" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NuevoProyectoDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Apertura Retailer1 Store1" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "Apertura" } });
    fireEvent.change(screen.getByLabelText("Intención"), { target: { value: "Referencia" } });
    fireEvent.change(screen.getByLabelText("Fecha objetivo"), { target: { value: "2026-05-18" } });
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "Nueva tienda." } });
    fireEvent.change(screen.getByLabelText("Notas"), { target: { value: "Ojo con el EAS." } });
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("error del API (p.ej. 403 forbidden): toast.error con el mensaje curado, NO llama onCreated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "forbidden", message: "Tu rol no permite esta acción sobre proyectos." }), { status: 403 })),
    );
    const onCreated = vi.fn();
    render(<NuevoProyectoDialog open onOpenChange={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tu rol no permite esta acción sobre proyectos."));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("Cancelar limpia el formulario (onOpenChange(false) + reset del estado local)", () => {
    const onOpenChange = vi.fn();
    render(<NuevoProyectoDialog open onOpenChange={onOpenChange} onCreated={vi.fn()} />);
    const titulo = screen.getByLabelText("Título") as HTMLInputElement;
    fireEvent.change(titulo, { target: { value: "Borrador" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // `open` sigue en `true` en este test (el padre decide si desmonta el
    // diálogo); el reset del estado local es independiente de eso.
    expect(titulo.value).toBe("");
  });
});
