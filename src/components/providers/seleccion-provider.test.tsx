import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SeleccionProvider, useSeleccion } from "./seleccion-provider";
import { SessionProvider } from "./session-provider";
import { claveDeSeleccion, agregar, SELECCION_VACIA } from "@/lib/seleccion";

// ============================================================
// Los tres invariantes del bloque, comprobados AQUÍ —con React y con un
// `localStorage` de verdad (jsdom)— y no solo en `src/lib/seleccion.test.ts`.
//
// La distinción importa: el módulo puro prueba que las OPERACIONES son
// correctas; este archivo prueba que el CABLEADO no las anula. El bug clásico
// de este patrón no está en la lógica sino en el orden de los efectos — un
// primer render vacío que se persiste encima de lo guardado borra la Selección
// al refrescar, y la lógica pura sigue impecable mientras tanto.
// ============================================================

const KAM_A = "11111111-1111-4111-8111-111111111111";
const KAM_B = "22222222-2222-4222-8222-222222222222";

function Sonda() {
  const s = useSeleccion();
  return (
    <div>
      <span data-testid="skus">{s.seleccion.items.map((i) => `${i.sku}:${i.cantidad}`).join("|")}</span>
      <span data-testid="piezas">{s.totalPiezas}</span>
      <span data-testid="hidratada">{String(s.hidratada)}</span>
      <button onClick={() => s.alternar("SUJ500-F", 40)}>alternar</button>
      <button onClick={() => s.vaciar()}>vaciar</button>
    </div>
  );
}

function montar(sesionId: string) {
  return render(
    <SessionProvider sesion={{ id: sesionId, email: "kam@example.com", rol: "kam" }}>
      <SeleccionProvider>
        <Sonda />
      </SeleccionProvider>
    </SessionProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("[INV-B8.2] SeleccionProvider", () => {
  it("hidrata desde localStorage al montar", () => {
    window.localStorage.setItem(
      claveDeSeleccion(KAM_A),
      JSON.stringify(agregar(agregar(SELECCION_VACIA, "SUJ500-F", 40), "JE016-YD", 120)),
    );
    montar(KAM_A);
    expect(screen.getByTestId("skus")).toHaveTextContent("SUJ500-F:40|JE016-YD:120");
    expect(screen.getByTestId("piezas")).toHaveTextContent("160");
    expect(screen.getByTestId("hidratada")).toHaveTextContent("true");
  });

  // ============================================================
  // EL BUG QUE SE VE COMO «SE PERDIÓ SOLA». El primer render (servidor y
  // cliente) tiene la Selección vacía porque `localStorage` se lee en un
  // efecto. Sin la guarda `hidratada`, el efecto de persistencia escribiría esa
  // Selección vacía ENCIMA de la guardada, y refrescar la página la borraría.
  // ============================================================
  it("el primer render vacío NO pisa lo guardado", () => {
    const guardada = JSON.stringify(agregar(SELECCION_VACIA, "SUJ500-F", 40));
    window.localStorage.setItem(claveDeSeleccion(KAM_A), guardada);
    montar(KAM_A);
    expect(window.localStorage.getItem(claveDeSeleccion(KAM_A))).toBe(guardada);
  });

  it("persiste los cambios, y vaciar BORRA la clave en vez de dejar basura", () => {
    montar(KAM_A);
    fireEvent.click(screen.getByText("alternar"));
    expect(window.localStorage.getItem(claveDeSeleccion(KAM_A))).toContain("SUJ500-F");

    fireEvent.click(screen.getByText("vaciar"));
    expect(window.localStorage.getItem(claveDeSeleccion(KAM_A))).toBeNull();
  });

  // ============================================================
  // INVARIANTE 1 · sobrevive a la navegación.
  // Navegar dentro del route group `(app)` desmonta la PÁGINA, no el layout;
  // pero un refresco desmonta todo. Se comprueba el caso duro: desmontar el
  // árbol completo y volver a montarlo.
  // ============================================================
  it("sobrevive a un desmontaje completo del árbol (refresco de la pestaña)", () => {
    const primera = montar(KAM_A);
    fireEvent.click(screen.getByText("alternar"));
    primera.unmount();

    montar(KAM_A);
    expect(screen.getByTestId("skus")).toHaveTextContent("SUJ500-F:40");
  });

  // ============================================================
  // INVARIANTE 2 · NO sobrevive a un cambio de sesión.
  // Aquí no hubo evento de cierre de sesión que escuchar: se monta con otra
  // cuenta y ya. El aislamiento lo da la clave, no un `useEffect` de limpieza.
  // ============================================================
  it("el KAM B no hereda la Selección del KAM A en el mismo navegador", () => {
    const primera = montar(KAM_A);
    fireEvent.click(screen.getByText("alternar"));
    primera.unmount();

    montar(KAM_B);
    expect(screen.getByTestId("skus")).toHaveTextContent("");
    // Y la del KAM A sigue intacta: no se trata de borrar, sino de AISLAR.
    expect(window.localStorage.getItem(claveDeSeleccion(KAM_A))).toContain("SUJ500-F");
  });

  it("cambiar de sesión SIN desmontar tampoco filtra (el mismo árbol, otro id)", () => {
    const vista = montar(KAM_A);
    fireEvent.click(screen.getByText("alternar"));
    expect(screen.getByTestId("skus")).toHaveTextContent("SUJ500-F:40");

    act(() => {
      vista.rerender(
        <SessionProvider sesion={{ id: KAM_B, email: "otro@example.com", rol: "kam" }}>
          <SeleccionProvider>
            <Sonda />
          </SeleccionProvider>
        </SessionProvider>,
      );
    });
    expect(screen.getByTestId("skus")).toHaveTextContent("");
  });

  // ============================================================
  // INVARIANTE 3 · no es dato originado. La comprobación es negativa y por eso
  // se escribe: NADA de la Selección toca la base. Si mañana alguien la
  // «mejora» persistiéndola en una tabla, esta prueba no se pone roja sola —
  // pero el comentario dice dónde mirar y la deuda B8-10 dice por qué no.
  // ============================================================
  it("todo lo que persiste cabe en UNA clave de localStorage con la cuenta dentro", () => {
    montar(KAM_A);
    fireEvent.click(screen.getByText("alternar"));
    const claves = Object.keys(window.localStorage);
    expect(claves).toEqual([claveDeSeleccion(KAM_A)]);
  });
});
