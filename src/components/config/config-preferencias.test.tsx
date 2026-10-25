import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfigPreferencias } from "./config-preferencias";

const setThemeMock = vi.fn();
let resolvedThemeMock = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: resolvedThemeMock, setTheme: setThemeMock }),
}));

const updateUserMock = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({ auth: { updateUser: updateUserMock } }),
}));

function llenarPasswords(nueva: string, confirmar: string) {
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), { target: { value: nueva } });
  fireEvent.change(screen.getByLabelText("Confirmar contraseña"), { target: { value: confirmar } });
  fireEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
}

describe("ConfigPreferencias", () => {
  afterEach(() => {
    setThemeMock.mockClear();
    updateUserMock.mockReset();
    resolvedThemeMock = "light";
  });

  it("el switch de modo oscuro refleja resolvedTheme y llama a setTheme al alternar", async () => {
    resolvedThemeMock = "dark";
    render(<ConfigPreferencias />);

    const swtch = await screen.findByRole("switch", { name: "Modo oscuro" });
    await waitFor(() => expect(swtch).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(swtch);
    expect(setThemeMock).toHaveBeenCalledWith("light");
  });

  it("contraseña corta (<8) muestra error inline y no llama a updateUser", () => {
    render(<ConfigPreferencias />);
    llenarPasswords("corta1", "corta1");
    expect(screen.getByRole("alert")).toHaveTextContent("La contraseña debe tener al menos 8 caracteres.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("contraseñas que no coinciden muestran error inline y no llaman a updateUser", () => {
    render(<ConfigPreferencias />);
    llenarPasswords("clave-larga-1", "clave-larga-2");
    expect(screen.getByRole("alert")).toHaveTextContent("Las contraseñas no coinciden.");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("éxito: llama a updateUser con la nueva contraseña y limpia el formulario", async () => {
    updateUserMock.mockResolvedValueOnce({ error: null });
    render(<ConfigPreferencias />);
    llenarPasswords("clave-larga-1", "clave-larga-1");

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ password: "clave-larga-1" }));
    await waitFor(() => expect((screen.getByLabelText("Nueva contraseña") as HTMLInputElement).value).toBe(""));
  });

  it("error de Supabase: no limpia el formulario", async () => {
    updateUserMock.mockResolvedValueOnce({ error: { message: "boom" } });
    render(<ConfigPreferencias />);
    llenarPasswords("clave-larga-1", "clave-larga-1");

    await waitFor(() => expect(updateUserMock).toHaveBeenCalled());
    expect((screen.getByLabelText("Nueva contraseña") as HTMLInputElement).value).toBe("clave-larga-1");
  });
});
