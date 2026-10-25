import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { SessionProvider } from "@/components/providers/session-provider";
import { ConfigUsuarios } from "./config-usuarios";

// Mock de sonner (I4): este componente no monta <Toaster/>, así que sin
// mock los toasts no dejan rastro en el DOM. Se espía `toast.error` para
// verificar el mensaje mostrado (contrato del FIX 2: mensaje del server
// cuando exista, genérico si no).
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock de next/navigation (FIX3, ronda 2 → FIX F, ronda 3): el componente
// redirige (ahora con `router.replace`, no `push`) a `/login?next=...`
// cuando el PATCH responde 401 'unauthorized' (sesión expirada).
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const USUARIOS = [
  { id: "u-actor", email: "admin@example.com", rol: "admin" as const, suspendido: false },
  { id: "u-otro", email: "kam@example.com", rol: "kam" as const, suspendido: false },
  { id: "u-suspendido", email: "suspendido@example.com", rol: "kam" as const, suspendido: true },
  // Bloque 7-A: 4to usuario con rol "visitante" — fija el fix del ternario
  // (config-usuarios.tsx:407) que antes etiquetaba CUALQUIER rol
  // distinto de "admin" como "KAM".
  { id: "u-visitante", email: "visitante@example.com", rol: "visitante" as const, suspendido: false },
];

function renderConSesion() {
  return render(
    <SessionProvider sesion={{ id: "u-actor", email: "admin@example.com", rol: "admin" }}>
      <ConfigUsuarios />
    </SessionProvider>,
  );
}

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deferred controlado por el test (FIX D, ronda 3, MEDIO-1): en vez de un
 * `setTimeout` fijo (ventana de aserción atada al reloj — un stall del
 * runner la cierra y pone el test rojo en falso), el test decide
 * EXPLÍCITAMENTE cuándo "termina" el GET pendiente llamando a `resolver()`.
 */
function crearDeferred(): { promise: Promise<void>; resolver: () => void } {
  let resolver!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}

/**
 * Fábrica de `getWaitFor` (FIX D, ronda 3): la carga INICIAL de
 * /api/usuarios resuelve de inmediato; cualquier GET posterior (el
 * refetch que dispara una mutación) queda colgado hasta que el test
 * resuelve `deferred.resolver()` explícitamente.
 */
function esperarSoloEnRefetch(deferred: { promise: Promise<void> }): () => Promise<void> {
  let llamadas = 0;
  return () => (llamadas++ === 0 ? Promise.resolve() : deferred.promise);
}

function stubFetchRouter(overrides: {
  patch?: (id: string, body: unknown) => unknown;
  altaStatus?: number;
  altaBody?: unknown;
  /** Status >=400 para el PATCH de la fila (simula el error de servidor). */
  patchErrorStatus?: number;
  /** Body JSON del error de PATCH (contrato ApiErrorBody: {error, message?}). */
  patchErrorBody?: unknown;
  /** Cuerpo NO-JSON del error de PATCH (p.ej. HTML de la página de error de Next). */
  patchErrorRawBody?: string;
  /**
   * FIX D (ronda 3, MEDIO-1): invocada en CADA GET /api/usuarios; el test
   * controla cuándo cada llamada resuelve (ver `crearDeferred`) — sin
   * depender del reloj real (`setTimeout`) para simular latencia, útil
   * para las regresiones que necesitan un refetch "genuinamente en vuelo"
   * y determinista.
   */
  getWaitFor?: () => Promise<void>;
  /** Latencia real (ms) antes de resolver el PATCH — usado por los tests de FIX2 (botón "…" + disabled mientras procesa). */
  patchDelayMs?: number;
  /**
   * FIX 3 (ronda 4, MEDIO-3): fuerza el GET de REFETCH (la 2a llamada a
   * /api/usuarios en adelante — la disparada por el propio reset, NO la
   * carga inicial) a fallar con este status. Usado por el candado de
   * regresión del bug reportado: si el refetch falla, `useApi` limpia `data`
   * a `null` (ver `use-api.ts`), lo que desmonta la tabla — el único
   * escenario que distingue el fix real (estado de revelado fuera de
   * `<UsuarioFila>`) de un mutante que lo reintroduce ahí.
   */
  getRefetchStatus?: number;
}) {
  let llamadasGet = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url === "/api/usuarios" && method === "GET") {
      llamadasGet += 1;
      if (overrides.getRefetchStatus && llamadasGet > 1) {
        return new Response(JSON.stringify({ error: "internal_error" }), { status: overrides.getRefetchStatus });
      }
      if (overrides.getWaitFor) await overrides.getWaitFor();
      return new Response(JSON.stringify({ items: USUARIOS }), { status: 200 });
    }
    if (url === "/api/usuarios" && method === "POST") {
      return new Response(JSON.stringify(overrides.altaBody ?? {}), { status: overrides.altaStatus ?? 201 });
    }
    const patchMatch = url.match(/^\/api\/usuarios\/(.+)$/);
    if (patchMatch && method === "PATCH") {
      if (overrides.patchDelayMs) await esperar(overrides.patchDelayMs);
      if (overrides.patchErrorStatus) {
        const raw = overrides.patchErrorRawBody ?? JSON.stringify(overrides.patchErrorBody ?? {});
        return new Response(raw, { status: overrides.patchErrorStatus });
      }
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(overrides.patch?.(patchMatch[1], body) ?? { usuario: USUARIOS[1] }), { status: 200 });
    }
    throw new Error(`fetch no manejado: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Abre el DropdownMenu de acciones de una fila (Radix abre por `onPointerDown`, no por `click`). */
function abrirMenuDe(email: string) {
  const boton = screen.getByRole("button", { name: `Acciones para ${email}` });
  fireEvent.pointerDown(boton, { button: 0, ctrlKey: false, pointerId: 1 });
}

/** jsdom no implementa `navigator.clipboard` (I4) — se define solo para el test que la necesita. */
function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("ConfigUsuarios", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("pinta email, pill de rol y pill de estado por fila", async () => {
    stubFetchRouter({});
    renderConSesion();

    expect(await screen.findByText("kam@example.com")).toBeInTheDocument();
    const filaSuspendida = screen.getByText("suspendido@example.com").closest("tr") as HTMLElement;
    expect(within(filaSuspendida).getByText("Suspendido")).toBeInTheDocument();
    const filaActiva = screen.getByText("kam@example.com").closest("tr") as HTMLElement;
    expect(within(filaActiva).getByText("Activo")).toBeInTheDocument();
  });

  it("Bloque 7-A — pinta la pill 'Visitante' para un usuario con ese rol (fix del bug: el ternario viejo lo habría etiquetado como 'KAM')", async () => {
    stubFetchRouter({});
    renderConSesion();

    const filaVisitante = (await screen.findByText("visitante@example.com")).closest("tr") as HTMLElement;
    expect(within(filaVisitante).getByText("Visitante")).toBeInTheDocument();
    expect(within(filaVisitante).queryByText("KAM")).not.toBeInTheDocument();
  });

  it("agregar usuario: éxito muestra la contraseña temporal en el mismo diálogo", async () => {
    const fetchMock = stubFetchRouter({
      altaStatus: 201,
      altaBody: { usuario: { id: "u-nuevo", email: "nuevo@example.com", rol: "kam" }, password_temporal: "Temp1234" },
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Agregar usuario" }));
    fireEvent.change(await screen.findByLabelText("Correo"), { target: { value: "nuevo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/usuarios",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "nuevo@example.com", rol: "kam" }) }),
      ),
    );
    expect(await screen.findByText("Temp1234")).toBeInTheDocument();
    expect(screen.getByText(/No se volverá a mostrar/)).toBeInTheDocument();
  });

  // NOTA: NO se prueba aquí abrir el <Select> de rol interactivamente (click
  // combobox + click option) porque ese <Select> vive DENTRO de un <Dialog>
  // ya abierto (AltaUsuarioDialog) — dos FocusScope de Radix anidados y
  // simultáneamente activos (Dialog + Select) entran en una pelea recursiva
  // de foco al abrir/cerrar el popover que jsdom no modela como un browser
  // real, y termina en "RangeError: Maximum call stack size exceeded"
  // (tumba el worker de Vitest completo, no solo este test). Es una
  // limitación conocida de Radix+jsdom con modales anidados, no un bug de
  // producto: en un browser real no ocurre. La cobertura de que el Select
  // ofrece "Visitante" y de que su value llega como `rol` al POST vive en
  // el test de arriba con rol default "kam" (mismo <Select>, mismo
  // `ROLES.map(...)`) + el test de abajo del `DropdownMenuRadioGroup` de
  // cambio de rol (mismo patrón `ROLES`/`ETIQUETA_ROL`, sin Dialog anidado
  // de por medio) + `tsc --noEmit` (SelectItem value={rolOpcion} solo
  // tipa si rolOpcion es Rol).

  it("agregar usuario: 409 muestra 'Ya existe un usuario con ese correo.'", async () => {
    stubFetchRouter({ altaStatus: 409, altaBody: { error: "usuario_duplicado" } });
    renderConSesion();
    await screen.findByText("kam@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Agregar usuario" }));
    fireEvent.change(await screen.findByLabelText("Correo"), { target: { value: "kam@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe un usuario con ese correo.");
  });

  it("self-guardrail: en la fila del propio actor, las opciones de rol, reset y suspender están deshabilitadas con tooltip", async () => {
    // FIX 2 (ronda 4, MEDIO-2): con `pointer-events:none` en el item
    // deshabilitado (`data-[disabled]:pointer-events-none`), el `title`
    // puesto SOLO en el item no basta — el navegador nunca lo detecta como
    // hit-target, así que el tooltip nativo no aparecería. Se afirma sobre
    // el `<span role="none" title=…>` envolvente (el nodo que SÍ recibe el
    // puntero, ver `ItemGuardarrail`): un futuro que borre ese wrapper (o
    // le quite el `title`) rompe esta aserción, aunque el item siga
    // teniendo el atributo.
    stubFetchRouter({});
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("admin@example.com");
    const kamRadio = await screen.findByRole("menuitemradio", { name: "KAM" });
    expect(kamRadio).toHaveAttribute("aria-disabled", "true");
    expect(kamRadio).toHaveAttribute("title", "No puedes modificar tu propia cuenta.");
    const kamWrapper = kamRadio.closest('[role="none"]');
    expect(kamWrapper).toHaveAttribute("title", "No puedes modificar tu propia cuenta.");

    const reset = screen.getByRole("menuitem", { name: "Restablecer contraseña" });
    expect(reset).toHaveAttribute("aria-disabled", "true");
    expect(reset).toHaveAttribute("title", "No puedes modificar tu propia cuenta.");
    expect(reset.closest('[role="none"]')).toHaveAttribute("title", "No puedes modificar tu propia cuenta.");

    const suspender = screen.getByRole("menuitem", { name: "Suspender acceso" });
    expect(suspender).toHaveAttribute("aria-disabled", "true");
  });

  it("restablecer contraseña: en la fila de otro usuario el item NO está deshabilitado", async () => {
    stubFetchRouter({});
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    const reset = await screen.findByRole("menuitem", { name: "Restablecer contraseña" });
    expect(reset).not.toHaveAttribute("aria-disabled", "true");
  });

  it("fila de otro usuario: cambiar el rol dispara PATCH {accion:'rol',rol}", async () => {
    const fetchMock = stubFetchRouter({ patch: (_id, body) => ({ usuario: { ...USUARIOS[1], ...(body as object) } }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    const adminRadio = await screen.findByRole("menuitemradio", { name: "Admin" });
    expect(adminRadio).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(adminRadio);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/usuarios/u-otro",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ accion: "rol", rol: "admin" }) }),
      ),
    );
  });

  it("Bloque 7-A — el menú de cambio de rol incluye 'Visitante'; elegirlo dispara PATCH {accion:'rol',rol:'visitante'}", async () => {
    const fetchMock = stubFetchRouter({ patch: (_id, body) => ({ usuario: { ...USUARIOS[1], ...(body as object) } }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    const visitanteRadio = await screen.findByRole("menuitemradio", { name: "Visitante" });
    expect(visitanteRadio).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(visitanteRadio);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/usuarios/u-otro",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ accion: "rol", rol: "visitante" }) }),
      ),
    );
  });

  /** Abre el menú, hace click en "Restablecer contraseña" y confirma el AlertDialog previo. */
  async function iniciarYConfirmarReset(email: string) {
    abrirMenuDe(email);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));
  }

  it("restablecer contraseña: requiere confirmar en AlertDialog antes de disparar el PATCH", async () => {
    const fetchMock = stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/kam@example\.com/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/usuarios/u-otro", expect.anything());

    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/usuarios/u-otro",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ accion: "reset_password" }) }),
      ),
    );
    expect(await screen.findByText("Reset99xy")).toBeInTheDocument();
  });

  it("restablecer contraseña: si se cancela la confirmación no se hace ninguna petición", async () => {
    const fetchMock = stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));
    const dialogo = await screen.findByRole("alertdialog");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/usuarios/u-otro", expect.anything());
  });

  it("PATCH con 403 y {error:'forbidden', message:'...'} muestra ESE mensaje en el toast (no el genérico)", async () => {
    stubFetchRouter({
      patchErrorStatus: 403,
      patchErrorBody: { error: "forbidden", message: "No puedes modificar tu propia cuenta desde aquí." },
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No puedes modificar tu propia cuenta desde aquí."));
  });

  // ----------------------------------------------------------------
  // FIX (bug reportado) — un 5xx cuyo cuerpo NO es JSON (página de error HTML
  // de Next, proxy caído, worker muerto) nunca ejecutó nuestro handler: no
  // es un rechazo de negocio. Antes caía al mismo mensaje genérico que un
  // rechazo real ("No se pudo actualizar el usuario."), y se pasaron horas
  // creyendo que había un bug de datos cuando el problema era puramente
  // ambiental (`next dev` huérfano + jest-worker muerto tras él). Ahora un
  // 5xx no-JSON muestra un mensaje que culpa al servidor (no a la acción
  // del admin) y advierte que la operación pudo no haberse aplicado.
  // ----------------------------------------------------------------
  it("PATCH con 500 y cuerpo HTML (no-JSON) muestra el mensaje de fallo de servidor, no el genérico, y menciona el status", async () => {
    stubFetchRouter({
      patchErrorStatus: 500,
      patchErrorRawBody: "<!DOCTYPE html><html><body>Internal Server Error</body></html>",
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "El servidor no respondió correctamente (error 500). La operación pudo no aplicarse: verifica el estado del usuario y vuelve a intentar.",
      ),
    );
  });

  it("PATCH con 503 y cuerpo vacío (no-JSON) muestra el mismo mensaje de fallo de servidor", async () => {
    stubFetchRouter({ patchErrorStatus: 503, patchErrorRawBody: "" });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "El servidor no respondió correctamente (error 503). La operación pudo no aplicarse: verifica el estado del usuario y vuelve a intentar.",
      ),
    );
  });

  it("PATCH con 400 y cuerpo no-JSON mantiene el mensaje genérico (rechazo de negocio, no falla de servidor)", async () => {
    stubFetchRouter({ patchErrorStatus: 400, patchErrorRawBody: "no-es-json" });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar el usuario."));
  });

  // ----------------------------------------------------------------
  // Punto C (ronda de revisión INV-B7B) — `forbidden_origin` ya NO cae al
  // mensaje genérico: la auditoría de seguridad encontró que la allowlist
  // de `Origin` del servidor podría no incluir el dominio real en Vercel,
  // así que es el 403 más probable del primer arranque en producción —
  // sin un mensaje propio, indiagnosticable desde la interfaz.
  // ----------------------------------------------------------------
  it("PATCH con 403 y {error:'forbidden_origin'} muestra un mensaje propio (config del servidor, no jerga, no el genérico) y NO redirige a /login", async () => {
    stubFetchRouter({
      patchErrorStatus: 403,
      patchErrorBody: { error: "forbidden_origin", message: "Origen no permitido para esta operación." },
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "El servidor no reconoce la dirección web desde la que se está usando el portal y bloqueó la acción por seguridad. No es un problema con esta cuenta ni con este usuario: repórtalo al equipo técnico para que revise la configuración del servidor.",
      ),
    );
    // A diferencia de 'unauthorized': no es un problema de sesión, así que reautenticarse no lo arreglaría.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("restablecer contraseña: la descripción advierte además que el usuario suspendido seguirá sin poder entrar", async () => {
    stubFetchRouter({});
    renderConSesion();
    await screen.findByText("suspendido@example.com");

    abrirMenuDe("suspendido@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/seguirá sin poder iniciar sesión/)).toBeInTheDocument();
  });

  it("restablecer contraseña: la descripción NO advierte lo de suspendido para un usuario activo", async () => {
    stubFetchRouter({});
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).queryByText(/seguirá sin poder iniciar sesión/)).not.toBeInTheDocument();
  });

  it("restablecer contraseña: 'Copiar' escribe la temporal al portapapeles (I4)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");
    await screen.findByText("Reset99xy");

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Reset99xy"));
  });

  it("restablecer contraseña: 'Copiar' con clipboard rechazado no lanza (error atrapado)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permiso denegado"));
    stubClipboard(writeText);
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");
    await screen.findByText("Reset99xy");

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Reset99xy"));
  });

  it("agregar usuario: 'Copiar' en el diálogo de éxito escribe la temporal al portapapeles (I4)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    stubFetchRouter({
      altaStatus: 201,
      altaBody: { usuario: { id: "u-nuevo", email: "nuevo@example.com", rol: "kam" }, password_temporal: "Temp1234" },
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Agregar usuario" }));
    fireEvent.change(await screen.findByLabelText("Correo"), { target: { value: "nuevo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await screen.findByText("Temp1234");

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Temp1234"));
  });

  it("suspender: requiere confirmar en AlertDialog antes de disparar el PATCH", async () => {
    const fetchMock = stubFetchRouter({ patch: () => ({ usuario: { ...USUARIOS[1], suspendido: true } }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    const item = await screen.findByRole("menuitem", { name: "Suspender acceso" });
    fireEvent.click(item);

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/no podrá iniciar sesión/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/usuarios/u-otro", expect.anything());

    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/usuarios/u-otro",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ accion: "suspender" }) }),
      ),
    );
  });

  // ----------------------------------------------------------------
  // FIX1 (ronda 2) — regresión del bug reportado: la contraseña temporal
  // revelada NO debe perderse cuando el refetch (que el propio reset
  // dispara) tarda. Reescrito en ronda 3 (FIX D, MEDIO-1): la versión
  // anterior dependía de que el GET resolviera en EXACTAMENTE 150ms —
  // un stall del test runner (CI cargado, GC, etc.) podía cerrar esa
  // ventana de aserción y poner el test rojo en falso pese a que el
  // fix seguía intacto. Aquí el refetch queda colgado hasta que EL TEST
  // resuelve `getDeferred.resolver()` explícitamente: cero dependencia
  // del reloj.
  //
  // Sigue fallando contra el código PRE-ronda-2 (razonamiento; no hace
  // falta re-demostrarlo corriendo ese código viejo): ahí el estado de
  // revelado vivía DENTRO de `<UsuarioFila>`, montado bajo el gate
  // `!loading && data &&` de `ConfigUsuarios`. En cuanto `onChanged()`
  // (el refetch, disparado por el propio reset) ponía `loading=true`,
  // ESE gate desmontaba `<UsuarioFila>` —y con él, el estado con la
  // contraseña— de inmediato, sin esperar a que el GET resolviera. Con
  // el deferred colgado, la aserción CRÍTICA #1 (password visible
  // MIENTRAS el refetch sigue en vuelo) fallaría ahí mismo: el remount
  // ya habría borrado "Reset99xy" del DOM antes de que el test llegara
  // a resolver el deferred.
  it("BUG REPORTADO — regresión (determinista): la contraseña temporal revelada sigue en el DOM DURANTE y DESPUÉS de un refetch cuyo fin controla el test", async () => {
    const getDeferred = crearDeferred();
    const fetchMock = stubFetchRouter({
      getWaitFor: esperarSoloEnRefetch(getDeferred),
      patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }),
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    expect(await screen.findByText("Reset99xy")).toBeInTheDocument();

    // `{ hidden: true }` (ronda 3): el diálogo de revelado YA está abierto
    // en este punto — Radix marca `aria-hidden="true"` en el resto del
    // árbol (comportamiento CORRECTO de accesibilidad mientras hay un
    // modal abierto), así que `getByRole` con su filtro por defecto NO
    // encontraría la tabla. El propósito de esta aserción es otro (probar
    // que NO se remonta), así que se incluye explícitamente.
    //
    // El refetch (disparado por el propio reset) debe estar EN VUELO,
    // colgado esperando al deferred — se confirma vía `aria-busy` (FIX C)
    // en vez de un timeout: sin esto, "en vuelo" sería indemostrable de
    // forma determinista.
    await waitFor(() => expect(screen.getByRole("table", { hidden: true })).toHaveAttribute("aria-busy", "true"));

    // Aserción CRÍTICA #1 (síncrona, sin polling): la contraseña sigue en
    // el DOM MIENTRAS el refetch está genuinamente en vuelo.
    expect(screen.getByText("Reset99xy")).toBeInTheDocument();

    // El test decide EXPLÍCITAMENTE cuándo termina el refetch.
    getDeferred.resolver();
    await waitFor(() => expect(screen.getByRole("table", { hidden: true })).toHaveAttribute("aria-busy", "false"));

    // Aserción CRÍTICA #2 (síncrona): sigue en el DOM DESPUÉS de que el
    // refetch (ya resuelto) reconstruyó los datos de la tabla.
    expect(screen.getByText("Reset99xy")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3); // GET inicial + PATCH + GET refetch
  });

  // ----------------------------------------------------------------
  // FIX 3 (ronda 4, MEDIO-3) — CANDADO DE REGRESIÓN del bug reportado, para
  // el escenario que el test de arriba NO cubre.
  //
  // Demostrado con un mutante por el revisor: si alguien vuelve a mover el
  // estado de revelado a DENTRO de `<UsuarioFila>` (el mecanismo EXACTO
  // del bug original), los demás tests de esta suite siguen en verde,
  // porque FIX C (ronda 3) ya mantiene la tabla montada durante un
  // refetch EXITOSO — ese mutante nunca llega a desmontar `<UsuarioFila>`
  // en ningún test existente, así que nadie lo detecta. Pero ese código
  // seguiría siendo buggy en producción: si el refetch FALLA (500, sesión
  // caída, lo que sea), `useApi` hace `setData(null)` (ver `use-api.ts`),
  // `{data && (...)}` en `ConfigUsuarios` desmonta TODA la tabla —y con
  // ella, `<UsuarioFila>` y cualquier estado que volviera a vivir ahí— y
  // la contraseña se pierde igual, aunque ya nunca se vuelva a mostrar.
  //
  // POR QUÉ el refetch fallido (y no uno exitoso) es el escenario que
  // mata al mutante: un refetch exitoso dispara un nuevo render de la
  // tabla con los MISMOS datos (`<UsuarioFila>` se remonta pero el DOM
  // resultante es indistinguible), así que una aserción "sigue en el DOM
  // después del refetch" pasaría incluso con el mutante SI el remount
  // ocurriera antes de que React pintara el frame vacío — no es
  // determinista. Un refetch que TERMINA EN ERROR, en cambio, deja
  // `data=null` de forma estable (no hay un segundo render que "arregle"
  // el desmontaje): con el fix real (estado en `ConfigUsuarios`) la
  // contraseña sigue ahí pase lo que pase con la tabla; con el mutante
  // (estado en `<UsuarioFila>`), el desmontaje de la tabla SÍ se la lleva.
  // No "simplifiques" este test a un refetch exitoso: dejaría de proteger
  // el bug reportado.
  // ----------------------------------------------------------------
  it("BUG REPORTADO — candado de regresión: si el refetch del reset FALLA, la contraseña temporal revelada sigue en el DOM aunque la tabla se desmonte", async () => {
    stubFetchRouter({
      getRefetchStatus: 500,
      patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }),
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    expect(await screen.findByText("Reset99xy")).toBeInTheDocument();

    // El refetch fallido termina en `data=null`: la tabla se desmonta.
    await waitFor(() => expect(screen.queryByRole("table", { hidden: true })).not.toBeInTheDocument());

    // La contraseña, en cambio, sigue en el DOM: vive en `ConfigUsuarios`
    // (fuera del gate `{data && (...)}` que acaba de desmontar la tabla),
    // no en `<UsuarioFila>`.
    expect(screen.getByText("Reset99xy")).toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // FIX C (ronda 3, MEDIO-2) — el anti-patrón de remount por refetch:
  // la tabla debe seguir en el DOM (mismo nodo, sin remontarse) durante
  // un refetch, marcada `aria-busy`.
  // ----------------------------------------------------------------
  it("FIX C: durante un refetch la tabla sigue en el DOM (no se remonta, mismo nodo) y queda aria-busy", async () => {
    const getDeferred = crearDeferred();
    stubFetchRouter({
      getWaitFor: esperarSoloEnRefetch(getDeferred),
      patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }),
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    const tablaAntes = screen.getByRole("table");
    expect(tablaAntes).toHaveAttribute("aria-busy", "false");

    await iniciarYConfirmarReset("kam@example.com");

    // `{ hidden: true }` (ronda 3): el diálogo de revelado que este mismo
    // reset abre deja el resto del árbol `aria-hidden="true"` (Radix,
    // comportamiento correcto mientras hay un modal abierto) — se incluye
    // explícitamente porque lo que se prueba aquí es OTRA cosa (que la
    // tabla no se remonta), no la accesibilidad del diálogo en sí.
    await waitFor(() => expect(screen.getByRole("table", { hidden: true })).toHaveAttribute("aria-busy", "true"));
    // Identidad referencial preservada: NO es un nodo remontado.
    expect(screen.getByRole("table", { hidden: true })).toBe(tablaAntes);
    expect(screen.getByText("kam@example.com")).toBeInTheDocument();

    getDeferred.resolver();

    await waitFor(() => expect(screen.getByRole("table", { hidden: true })).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByRole("table", { hidden: true })).toBe(tablaAntes);
  });

  // ----------------------------------------------------------------
  // FIX2 (ronda 2) — feedback durante el PATCH: AlertDialogAction ES un
  // DialogClose de Radix (cierra en el click, antes del await). Con
  // e.preventDefault() el diálogo se queda abierto con el botón en
  // progreso hasta que la mutación resuelve.
  // ----------------------------------------------------------------
  it("FIX2: mientras se procesa el reset, 'Confirmar' pasa a 'Restableciendo…' y queda disabled; el AlertDialog no se cierra de inmediato", async () => {
    stubFetchRouter({ patchDelayMs: 50, patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Restablecer contraseña" }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    const botonEnProgreso = await within(dialogo).findByRole("button", { name: "Restableciendo…" });
    expect(botonEnProgreso).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Reset99xy")).toBeInTheDocument();
  });

  it("FIX2: mientras se procesa suspender, 'Confirmar' pasa a 'Suspendiendo…' y queda disabled", async () => {
    stubFetchRouter({ patchDelayMs: 50, patch: () => ({ usuario: { ...USUARIOS[1], suspendido: true } }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    abrirMenuDe("kam@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Suspender acceso" }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    const botonEnProgreso = await within(dialogo).findByRole("button", { name: "Suspendiendo…" });
    expect(botonEnProgreso).toBeDisabled();

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("FIX2: mientras se procesa reactivar (usuario ya suspendido), 'Confirmar' pasa a 'Reactivando…'", async () => {
    stubFetchRouter({ patchDelayMs: 50, patch: () => ({ usuario: { ...USUARIOS[2], suspendido: false } }) });
    renderConSesion();
    await screen.findByText("suspendido@example.com");

    abrirMenuDe("suspendido@example.com");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reactivar acceso" }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" }));

    const botonEnProgreso = await within(dialogo).findByRole("button", { name: "Reactivando…" });
    expect(botonEnProgreso).toBeDisabled();

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  // ----------------------------------------------------------------
  // FIX3 (ronda 2) — mensajes de error por CÓDIGO (no solo `message`).
  // ----------------------------------------------------------------
  it("FIX3→FIX F (ronda 3): PATCH con 401 {error:'unauthorized'} muestra el mensaje de sesión expirada y redirige (router.replace) a /login?next=/config?tab=usuarios", async () => {
    stubFetchRouter({ patchErrorStatus: 401, patchErrorBody: { error: "unauthorized" } });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tu sesión expiró. Inicia sesión de nuevo."));
    // FIX F (ronda 3, MEDIO-6): URL EXACTA (misma convención que el
    // middleware: `/login?next=<pathname>`) y `replace` (no `push`) para
    // no dejar esta página muerta en el historial.
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/login?next=" + encodeURIComponent("/config?tab=usuarios")),
    );
  });

  it("FIX3: PATCH con 400 {error:'invalid_body', message:'...'} muestra ESE mensaje (no el genérico)", async () => {
    stubFetchRouter({ patchErrorStatus: 400, patchErrorBody: { error: "invalid_body", message: "Acción inválida." } });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Acción inválida."));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("FIX3: PATCH con 500 {error:'internal_error'} muestra un mensaje explícito de fallo del servidor", async () => {
    stubFetchRouter({ patchErrorStatus: 500, patchErrorBody: { error: "internal_error" } });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Ocurrió un error en el servidor. Intenta de nuevo más tarde."),
    );
  });

  // ----------------------------------------------------------------
  // FIX H (ronda 3, INFO-2) — agujero de fallo silencioso: PATCH 200
  // sin `password_temporal` (contrato de backend roto) ya no cierra el
  // diálogo de confirmación en silencio.
  // ----------------------------------------------------------------
  it("FIX H: reset_password con 200 pero SIN password_temporal muestra el toast genérico (no falla en silencio)", async () => {
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1] }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar el usuario."));
  });

  // ----------------------------------------------------------------
  // FIX B (ronda 3, MEDIO-3) — el diálogo de revelado de contraseña (ya
  // rotada, irrecuperable en cualquier otro lado) NO debe poder cerrarse
  // por accidente: clic fuera, Escape y la X quedan neutralizados; solo
  // "Listo" cierra.
  // ----------------------------------------------------------------
  it("FIX B: revelado del reset — clic fuera (overlay) NO cierra el diálogo ni pierde la contraseña", async () => {
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");
    await screen.findByText("Reset99xy");

    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Reset99xy")).toBeInTheDocument();
  });

  it("FIX B: revelado del reset — tecla Escape NO cierra el diálogo ni pierde la contraseña", async () => {
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");
    await screen.findByText("Reset99xy");

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Reset99xy")).toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // FIX 1 (ronda 4, MEDIO-1) — la X (`DialogPrimitive.Close`) NO pasa por
  // `onEscapeKeyDown`/`onInteractOutside` (esos solo neutralizan Escape y
  // clic-fuera): dispara `onOpenChange(false)` directo. Antes de este fix
  // ese `onOpenChange` era no-op (revelado) o abortaba con `exito`
  // truthy (alta) — la X quedaba MUERTA. Este test fija que la X SÍ
  // cierra, sin reabrir la puerta a Escape/clic-fuera (verificado por los
  // dos tests de arriba, que siguen verdes).
  // ----------------------------------------------------------------
  it("FIX 1: la X cierra el diálogo de revelado del reset", async () => {
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");
    await screen.findByText("Reset99xy");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.queryByText("Reset99xy")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("FIX B: revelado del reset — 'Listo' SÍ cierra el diálogo", async () => {
    stubFetchRouter({ patch: () => ({ usuario: USUARIOS[1], password_temporal: "Reset99xy" }) });
    renderConSesion();
    await screen.findByText("kam@example.com");

    await iniciarYConfirmarReset("kam@example.com");
    await screen.findByText("Reset99xy");

    fireEvent.click(screen.getByRole("button", { name: "Listo" }));

    await waitFor(() => expect(screen.queryByText("Reset99xy")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("FIX B: agregar usuario (contraseña ya revelada) — clic fuera y Escape NO cierran; 'Listo' SÍ cierra", async () => {
    stubFetchRouter({
      altaStatus: 201,
      altaBody: { usuario: { id: "u-nuevo", email: "nuevo@example.com", rol: "kam" }, password_temporal: "Temp1234" },
    });
    renderConSesion();
    await screen.findByText("kam@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Agregar usuario" }));
    fireEvent.change(await screen.findByLabelText("Correo"), { target: { value: "nuevo@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    await screen.findByText("Temp1234");

    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Temp1234")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Listo" }));

    await waitFor(() => expect(screen.queryByText("Temp1234")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
