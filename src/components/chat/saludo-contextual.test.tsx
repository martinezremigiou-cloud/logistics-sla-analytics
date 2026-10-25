// ============================================================
// [INV-B11] O6-adenda · EL SALUDO, Y LA REGLA QUE IMPORTA MÁS QUE EL TEXTO.
//
// La regla va por delante del copy:
//
//     > Una vez por sesión, y no negociable. Un aviso que aparece cada vez que
//     > entras al catálogo es ruido en una semana.
//
// Y la DoD pidió por nombre la prueba difícil: **que descartado NO reaparezca
// en la misma sesión**. Esa es la única que no se cumple sola — «se muestra» y
// «se cierra» son un `useState`; «no vuelve» necesita un testigo, y un testigo
// mal puesto se ve idéntico a uno bien puesto hasta que alguien recarga.
// ============================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SaludoContextual, CLAVE_SALUDO, TEXTO_SALUDO, esRutaDeSaludo } from "./saludo-contextual";

const ruta = vi.hoisted(() => ({ actual: "/catalogo" }));
vi.mock("next/navigation", () => ({ usePathname: () => ruta.actual }));

function pintar(props: Partial<Parameters<typeof SaludoContextual>[0]> = {}) {
  const onAbrirChat = vi.fn();
  const r = render(<SaludoContextual onAbrirChat={onAbrirChat} {...props} />);
  return { ...r, onAbrirChat };
}

beforeEach(() => {
  window.sessionStorage.clear();
  ruta.actual = "/catalogo";
});

describe("[INV-B11] el saludo · dónde sale y dónde no", () => {
  it("en el catálogo sale, con el copy aprobado", () => {
    pintar();
    expect(screen.getByText(TEXTO_SALUDO)).toBeInTheDocument();
  });

  it("en la ficha de un SKU también: es donde se le ocurre la pregunta", () => {
    ruta.actual = "/catalogo/KYA2490";
    pintar();
    expect(screen.getByText(TEXTO_SALUDO)).toBeInTheDocument();
  });

  it("fuera del catálogo NO sale", () => {
    // El control del de arriba: sin esto, un saludo que saliera SIEMPRE dejaría
    // las dos primeras en verde y aparecería en las siete pantallas.
    for (const fuera of ["/", "/proyectos", "/embarques", "/config", "/catalogoXYZ"]) {
      ruta.actual = fuera;
      pintar();
      expect(screen.queryByText(TEXTO_SALUDO), `salió en ${fuera}`).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("`esRutaDeSaludo` no se deja engañar por un prefijo parecido", () => {
    expect(esRutaDeSaludo("/catalogo")).toBe(true);
    expect(esRutaDeSaludo("/catalogo/KYA2490")).toBe(true);
    expect(esRutaDeSaludo("/catalogos")).toBe(false);
    expect(esRutaDeSaludo(null)).toBe(false);
  });
});

describe("[INV-B11] el saludo · UNA VEZ POR SESIÓN", () => {
  it("descartado NO reaparece en la misma sesión — la prueba que pidió la DoD", () => {
    const { unmount } = pintar();
    fireEvent.click(screen.getByLabelText("Cerrar el saludo"));
    expect(screen.queryByText(TEXTO_SALUDO)).not.toBeInTheDocument();

    // LA MITAD QUE IMPORTA: se desmonta y se vuelve a montar, que es lo que
    // pasa al navegar a otra pantalla y volver. Un `useState` a secas lo
    // traería de vuelta y esta línea es lo único que lo caza.
    unmount();
    pintar();
    expect(screen.queryByText(TEXTO_SALUDO), "el saludo volvió después de cerrarlo").not.toBeInTheDocument();
  });

  it("el testigo vive en `sessionStorage`, no en `localStorage`", () => {
    // No es un detalle de implementación: `localStorage` es POR NAVEGADOR, así
    // que en una máquina compartida el segundo KAM no vería el saludo nunca
    // porque el primero ya lo cerró. Es la razón de B10-7, aplicada.
    pintar();
    fireEvent.click(screen.getByLabelText("Cerrar el saludo"));
    expect(window.sessionStorage.getItem(CLAVE_SALUDO)).toBe("visto");
    expect(window.localStorage.getItem(CLAVE_SALUDO), "el testigo se fue a localStorage").toBeNull();
  });

  it("con el testigo ya puesto no sale, ni siquiera en el catálogo", () => {
    window.sessionStorage.setItem(CLAVE_SALUDO, "visto");
    pintar();
    expect(screen.queryByText(TEXTO_SALUDO)).not.toBeInTheDocument();
  });

  it("abrir el chat desde el saludo lo cierra Y lo marca visto", () => {
    // Si abriera el chat sin marcar, cerrar el chat lo traería de vuelta.
    const { onAbrirChat } = pintar();
    fireEvent.click(screen.getByText(TEXTO_SALUDO));
    expect(onAbrirChat).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(CLAVE_SALUDO)).toBe("visto");
  });
});

describe("[INV-B11] el saludo · NUNCA BLOQUEANTE", () => {
  it("no es un diálogo y no roba el foco", () => {
    pintar();
    // Un `role="dialog"`/`alertdialog` obligaría a atenderlo; `status` lo
    // anuncia a un lector de pantalla sin mover el foco de nadie.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Nadie tomó el foco al montarse.
    expect(document.activeElement, "el saludo se robó el foco al aparecer").toBe(document.body);
  });

  it("un almacenamiento bloqueado NO lo hace saludar en cada navegación", () => {
    // Modo privado estricto: leer lanza. Se prefiere no saludar antes que
    // saludar sin poder recordarlo — que sería el ruido que la regla evita.
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("bloqueado");
      },
    });
    try {
      pintar();
      expect(screen.queryByText(TEXTO_SALUDO)).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(window, "sessionStorage", original);
    }
  });

  it("sembrado manda sobre el efecto: es lo que permite retratar los dos estados", () => {
    window.sessionStorage.setItem(CLAVE_SALUDO, "visto");
    pintar({ inicialVisible: true });
    expect(screen.getByText(TEXTO_SALUDO), "el sembrado no pudo forzar el estado visible").toBeInTheDocument();
    cleanup();
    window.sessionStorage.clear();
    pintar({ inicialVisible: false });
    expect(screen.queryByText(TEXTO_SALUDO), "el sembrado no pudo forzar el estado descartado").not.toBeInTheDocument();
  });
});
