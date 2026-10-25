import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "./login-form";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let nextParam: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
  useSearchParams: () => ({ get: (key: string) => (key === "next" ? nextParam : null) }),
}));

const signInWithPasswordMock = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithPassword: signInWithPasswordMock } }),
}));

function llenarYEnviar(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Correo"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: password } });
  fireEvent.submit(screen.getByRole("button", { name: "Iniciar sesión" }).closest("form") as HTMLFormElement);
}

describe("LoginForm", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    signInWithPasswordMock.mockReset();
    nextParam = null;
  });

  it("pinta labels visibles Correo/Contraseña con autoComplete correcto", () => {
    render(<LoginForm />);

    const email = screen.getByLabelText("Correo");
    const password = screen.getByLabelText("Contraseña");
    expect(email).toHaveAttribute("autoComplete", "username");
    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("autoComplete", "current-password");
    expect(password).toHaveAttribute("type", "password");
  });

  it("el botón-ojo alterna el tipo del password y su aria-label", () => {
    render(<LoginForm />);

    const boton = screen.getByRole("button", { name: "Mostrar contraseña" });
    fireEvent.click(boton);

    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBeInTheDocument();
  });

  it("submit llama a signInWithPassword con el email y password capturados", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ error: null });
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-secreta");

    await waitFor(() => expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "kam@example.com", password: "clave-secreta" }));
  });

  it("muestra 'Ingresando…' y deshabilita el formulario mientras está en curso", async () => {
    let resolver!: (v: { error: null }) => void;
    signInWithPasswordMock.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve; }));
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-secreta");

    expect(await screen.findByText("Ingresando…")).toBeInTheDocument();
    expect(screen.getByLabelText("Correo")).toBeDisabled();
    expect(screen.getByLabelText("Contraseña")).toBeDisabled();

    resolver({ error: null });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it("credenciales inválidas → alert único genérico (nunca distingue campo)", async () => {
    signInWithPasswordMock.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-mala");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Credenciales incorrectas. Verifica tu correo y contraseña.");
    expect(screen.getByLabelText("Correo")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Correo")).toHaveAttribute("aria-describedby", "login-error");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("error de red (excepción) → mensaje distinto de conectividad", async () => {
    signInWithPasswordMock.mockRejectedValueOnce(new Error("network down"));
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-secreta");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No pudimos verificar tus credenciales. Intenta de nuevo.");
  });

  it("éxito → router.replace a un ?next= interno válido, y router.refresh()", async () => {
    nextParam = "/catalogo";
    signInWithPasswordMock.mockResolvedValueOnce({ error: null });
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-secreta");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/catalogo"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("next externo (https://evil) cae a '/' (whitelist solo paths internos)", async () => {
    nextParam = "https://evil.test";
    signInWithPasswordMock.mockResolvedValueOnce({ error: null });
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-secreta");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
  });

  it("next protocol-relative (//evil) también cae a '/'", async () => {
    nextParam = "//evil.test";
    signInWithPasswordMock.mockResolvedValueOnce({ error: null });
    render(<LoginForm />);

    llenarYEnviar("kam@example.com", "clave-secreta");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
  });
});
