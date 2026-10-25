// ============================================================
// [INV-B8] nav.test.ts — el predicado combinado de visibilidad de nav.
//
// `puedeVerNavItem` es el ÚNICO lugar que decide "¿este rol ve este item?"
// (Sidebar y BottomNav lo comparten) — estas pruebas fijan su contrato para
// que los dos ejes (`adminOnly`, `rolesPermitidos`) y su combinación con AND
// no puedan divergir en silencio entre los dos consumidores.
// ============================================================
import { describe, it, expect } from "vitest";
import { LayoutGrid } from "lucide-react";
import { NAV_ITEMS, puedeVerNavItem, type NavItem } from "./nav";

function item(overrides: Partial<NavItem> = {}): NavItem {
  return { label: "Item", href: "/item", icon: LayoutGrid, ...overrides };
}

describe("puedeVerNavItem", () => {
  it("sin ningún eje declarado: visible para los 3 roles", () => {
    const it1 = item();
    expect(puedeVerNavItem(it1, "admin")).toBe(true);
    expect(puedeVerNavItem(it1, "kam")).toBe(true);
    expect(puedeVerNavItem(it1, "visitante")).toBe(true);
  });

  it("adminOnly: solo admin", () => {
    const it1 = item({ adminOnly: true });
    expect(puedeVerNavItem(it1, "admin")).toBe(true);
    expect(puedeVerNavItem(it1, "kam")).toBe(false);
    expect(puedeVerNavItem(it1, "visitante")).toBe(false);
  });

  it("rolesPermitidos: respeta exactamente el Record, sin importar adminOnly", () => {
    const it1 = item({ rolesPermitidos: { admin: true, kam: true, visitante: false, soporte: false } });
    expect(puedeVerNavItem(it1, "admin")).toBe(true);
    expect(puedeVerNavItem(it1, "kam")).toBe(true);
    expect(puedeVerNavItem(it1, "visitante")).toBe(false);
  });

  it("los dos ejes combinan con AND: adminOnly gana aunque rolesPermitidos permita el rol", () => {
    const it1 = item({ adminOnly: true, rolesPermitidos: { admin: true, kam: true, visitante: true, soporte: true } });
    expect(puedeVerNavItem(it1, "admin")).toBe(true);
    expect(puedeVerNavItem(it1, "kam")).toBe(false);
  });

  // ⚠ `soporte` estaba en el objeto pero NO en esta aserción: `Record<Rol, X>`
  // obliga a que la clave exista, no a que su valor sea el decidido — cambiarlo
  // salía VERDE. Y su valor cambió el mismo día: se acordó que `soporte`
  // ESCRIBE, gemelo de `kam`, así que **ve Proyectos**. Sin esta línea el cambio
  // de decisión habría pasado sin que ninguna prueba se enterara.
  it("'Proyectos' en NAV_ITEMS: admin, kam y soporte sí; visitante no", () => {
    const proyectos = NAV_ITEMS.find((i) => i.href === "/proyectos");
    expect(proyectos).toBeDefined();
    expect(puedeVerNavItem(proyectos!, "admin")).toBe(true);
    expect(puedeVerNavItem(proyectos!, "kam")).toBe(true);
    expect(puedeVerNavItem(proyectos!, "soporte")).toBe(true);
    expect(puedeVerNavItem(proyectos!, "visitante")).toBe(false);
  });

  it("'Proyectos' está entre 'Embarques' y 'Histórico de embarques'", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    const iCruce = hrefs.indexOf("/embarques");
    const iProyectos = hrefs.indexOf("/proyectos");
    const iEmbarques = hrefs.indexOf("/embarques/historico");
    expect(iProyectos).toBe(iCruce + 1);
    expect(iEmbarques).toBe(iProyectos + 1);
  });

  it("'Predicción de Stock' NO forma parte de NAV_ITEMS (B10, fuera de alcance de este bloque)", () => {
    expect(NAV_ITEMS.some((i) => i.href.includes("prediccion"))).toBe(false);
  });
});
