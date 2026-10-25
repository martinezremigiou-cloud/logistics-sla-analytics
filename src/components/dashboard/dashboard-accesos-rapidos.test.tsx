import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardAccesosRapidosCard, ACCESOS } from "./dashboard-accesos-rapidos";

describe("DashboardAccesosRapidosCard", () => {
  it("los cuatro destinos ratificados siguen intactos", () => {
    render(<DashboardAccesosRapidosCard />);
    expect(screen.getByRole("link", { name: "Embarques" })).toHaveAttribute("href", "/embarques");
    expect(screen.getByRole("link", { name: "Histórico de embarques" })).toHaveAttribute("href", "/embarques/historico");
    expect(screen.getByRole("link", { name: /Catálogo/ })).toHaveAttribute("href", "/catalogo");
    expect(screen.getByRole("link", { name: /Snapshots/ })).toHaveAttribute("href", "/snapshots");
  });

  // [C-DASH·12 · E-7] LA RAZÓN DE SER DE ESTE BLOQUE, y por eso va como prueba.
  //
  // Al retirar Alertas (C-DASH·11) dos filtros VIVOS se quedaron sin su única
  // entrada en la interfaz — medido con un grep por el repo entero: la tarjeta de
  // Alertas era el ÚNICO sitio que emitía esos dos `href`. Los dos siguen
  // funcionando (`catalogo-view.tsx:98`, `cruce-view.tsx:41`), así que lo que se
  // perdió no era la función: era el clic.
  //
  // El bloque lo autorizó por escrito: *«los href que sean el único acceso a una
  // vista se preservan en Accesos rápidos o se declara que se pierden»*.
  it("recupera las DOS puertas que Alertas se llevó al retirarse", () => {
    render(<DashboardAccesosRapidosCard />);
    expect(screen.getByRole("link", { name: /Familias distintas/ })).toHaveAttribute("href", "/catalogo?divergencia=1");
    expect(screen.getByRole("link", { name: /Embarques retrasados/ })).toHaveAttribute("href", "/embarques?retrasado=1");
  });

  // Y LO QUE **NO** SE RECUPERA, afirmado para que no se cuele por la puerta de
  // atrás: se retiró Alertas porque *«no nos sirve»*. Devolver aquí los CONTEOS
  // —las familias divergentes, los descuadres— sería reconstruir esa tarjeta con
  // otro nombre, y eso no es una decisión de la cadena. Se recupera la PUERTA, no
  // el número. La deuda `DOS-CONTEOS-GLOBALES-SIN-SUPERFICIE` sigue abierta a
  // propósito, con su disparador.
  it("son PUERTAS, no avisos: ningún acceso lleva conteo", () => {
    const { container } = render(<DashboardAccesosRapidosCard />);
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.textContent ?? "", `«${a.textContent}» no puede traer una cifra`).not.toMatch(/\d/);
    }
    // El componente sigue sin depender de datos del tablero: no recibe props.
    expect(DashboardAccesosRapidosCard.length, "no toma props, así que no puede pintar un conteo").toBe(0);
  });

  // D-8, ya resuelta: el 36 px del mockup se cayó como conflicto, y **el
  // criterio ergonómico se mantiene: ~44 px, por WCAG 2.5.5** (Target Size) y por
  // la medición de los ~58 de hoy. jsdom no hace layout, así que no se puede medir
  // el alto aquí — se afirma la ARITMÉTICA que lo produce: relleno 12 + 12 y un
  // ícono de 32 dan 56, y el rótulo no puede achicarlo porque el ícono es
  // `shrink-0`. Quien quite el `p-3` o encoja el ícono pone esto rojo.
  it("cada acceso conserva la caja de ~56 px que D-8 exige (≥44 por WCAG 2.5.5)", () => {
    const { container } = render(<DashboardAccesosRapidosCard />);
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.className, "el relleno de 12 px arriba y abajo").toContain("p-3");
      const icono = a.querySelector("span");
      expect(icono?.className, "la caja del ícono, 32 px y sin encoger").toContain("h-8");
      expect(icono?.className).toContain("shrink-0");
    }
  });

  // El mockup pedía «los 4 en línea», y eso NO se escribe como `grid-cols-4`: con
  // la fila entera el ancho de la columna cambia con el viewport —MEDIDO: 387 px a
  // 768 y 888 a 1280— y una rejilla de 4 fijas aplastaría los rótulos abajo. Se
  // declara el ANCHO MÍNIMO de una casilla y la rejilla deduce cuántas caben.
  // El 168 salió de una MEDICIÓN que corrigió a mi aritmética: calculé 176 sobre los
  // 888 px de la columna, y la rejilla no mide la columna sino la columna MENOS el
  // `p-[18px]` de la tarjeta — medido, 349 px a 768 y 850 a 1280. Con 176 caía a UNA
  // columna a 768, con seis casillas apiladas. Con 168, medido en el navegador:
  // 390→1 · 640→3 · 768→2 · 1024→3 · 1280→4 · 1704→6. El «4 en línea» del mockup
  // EMERGE a 1280; no está escrito en ninguna parte.
  it("la rejilla deduce las columnas de un ancho mínimo declarado, no de un número fijo", () => {
    const { container } = render(<DashboardAccesosRapidosCard />);
    const rejilla = container.querySelector("[data-accesos]");
    expect(rejilla?.className).toContain("minmax(168px,1fr)");
    expect(rejilla?.className, "un número fijo de columnas volvería a fijar el ancho").not.toMatch(/grid-cols-\d/);
  });

  it("CONTROL POSITIVO · los seis destinos son distintos y ninguno está vacío", () => {
    const hrefs = ACCESOS.map((a) => a.href);
    expect(hrefs).toHaveLength(6);
    expect(new Set(hrefs).size, "dos accesos al mismo sitio serían uno disfrazado de dos").toBe(6);
    for (const h of hrefs) expect(h.startsWith("/")).toBe(true);
    const etiquetas = ACCESOS.map((a) => a.label);
    expect(new Set(etiquetas).size).toBe(6);
  });
});
