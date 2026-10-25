import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CargaDropzone } from "./carga-dropzone";

function archivo(nombre: string, tipo: string, tamanoBytes: number): File {
  const file = new File([new Uint8Array(tamanoBytes)], nombre, { type: tipo });
  return file;
}

function seleccionar(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("CargaDropzone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("archivo de tipo inválido: muestra mensaje inline y no habilita Subir", () => {
    render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
    seleccionar(archivo("doc.pdf", "application/pdf", 1000));
    expect(screen.getByRole("alert")).toHaveTextContent("Formato no válido. Usa PNG, JPG o WEBP.");
    expect(screen.queryByRole("button", { name: "Subir" })).not.toBeInTheDocument();
  });

  it("archivo mayor a 2MB: muestra mensaje inline de tamaño", () => {
    render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
    seleccionar(archivo("grande.png", "image/png", 3 * 1024 * 1024));
    expect(screen.getByRole("alert")).toHaveTextContent("El archivo pesa más de 2 MB.");
  });

  it("archivo válido: muestra preview con nombre/peso y botones Subir/Elegir otra", () => {
    render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
    seleccionar(archivo("foto.png", "image/png", 1024 * 500));

    expect(screen.getByText("foto.png")).toBeInTheDocument();
    expect(screen.getByText("0.49 MB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elegir otra" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sin imagen previa: Subir llama directo a POST /api/imagenes (sin AlertDialog)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sku: "A-1", imagen_url: "https://x/a1.png" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onUploaded = vi.fn();
    render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={onUploaded} />);
    seleccionar(archivo("foto.png", "image/png", 1000));

    fireEvent.click(screen.getByRole("button", { name: "Subir" }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/imagenes");
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("sku")).toBe("A-1");
    expect(screen.queryByRole("button", { name: "Subir" })).not.toBeInTheDocument();
  });

  it("con imagen previa: Subir pide confirmación en AlertDialog antes de llamar a la API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sku: "A-1", imagen_url: "https://x/a1.png" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CargaDropzone sku="A-1" tieneImagen={true} onUploaded={vi.fn()} />);
    seleccionar(archivo("foto.png", "image/png", 1000));

    fireEvent.click(screen.getByRole("button", { name: "Subir" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reemplazar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(dialogo).not.toBeVisible();
  });

  it("error de red al subir: panel EstadoError con Reintentar", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
    seleccionar(archivo("foto.png", "image/png", 1000));

    fireEvent.click(screen.getByRole("button", { name: "Subir" }));
    expect(await screen.findByText("No se pudo subir la imagen. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("Elegir otra limpia la selección y vuelve al estado idle", () => {
    render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
    seleccionar(archivo("foto.png", "image/png", 1000));
    fireEvent.click(screen.getByRole("button", { name: "Elegir otra" }));

    expect(screen.queryByText("foto.png")).not.toBeInTheDocument();
    expect(screen.getByText(/Arrastra una imagen/)).toBeInTheDocument();
  });

  describe("revocación de blob: URLs (fuga de memoria)", () => {
    let revokeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    });

    afterEach(() => {
      revokeSpy.mockRestore();
    });

    // NOTA: mientras hay un archivo elegido, el dropzone/`<input>` se
    // desmonta (`{!archivo && (<label>...<input/></label>)}`), así que
    // `archivo`/`previewUrl` solo pueden pasar de null → valor a través de
    // `elegirArchivo` — nunca de valor → valor directo. El guard "revocar lo
    // anterior antes de crear lo nuevo" dentro de `elegirArchivo` es
    // defensivo (protege ese invariante si la UI cambia) y no es alcanzable
    // por esta vía; se cubre igual por los casos reachable de abajo.

    it("'Elegir otra' revoca el preview activo", () => {
      render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
      seleccionar(archivo("foto.png", "image/png", 1000));
      const previewUrl = (screen.getByRole("img") as HTMLImageElement).src;

      fireEvent.click(screen.getByRole("button", { name: "Elegir otra" }));

      expect(revokeSpy).toHaveBeenCalledWith(previewUrl);
    });

    it("una subida exitosa revoca el preview (limpiar() corre tras el upload)", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ sku: "A-1", imagen_url: "https://x/a1.png" }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
      seleccionar(archivo("foto.png", "image/png", 1000));
      const previewUrl = (screen.getByRole("img") as HTMLImageElement).src;

      fireEvent.click(screen.getByRole("button", { name: "Subir" }));

      await waitFor(() => expect(revokeSpy).toHaveBeenCalledWith(previewUrl));
    });

    it("desmontar el componente con un preview activo lo revoca (red de seguridad del useEffect)", () => {
      const { unmount } = render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
      seleccionar(archivo("foto.png", "image/png", 1000));
      const previewUrl = (screen.getByRole("img") as HTMLImageElement).src;
      unmount();

      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).toHaveBeenCalledWith(previewUrl);
    });

    it("desmontar sin selección activa no llama a revokeObjectURL", () => {
      const { unmount } = render(<CargaDropzone sku="A-1" tieneImagen={false} onUploaded={vi.fn()} />);
      unmount();

      expect(revokeSpy).not.toHaveBeenCalled();
    });
  });
});
