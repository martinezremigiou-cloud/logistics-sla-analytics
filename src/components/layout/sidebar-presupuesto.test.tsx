import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./sidebar";

// GATE de presupuesto vertical — Bloque 7-B · O16.
//
// jsdom no tiene motor de layout real: `getBoundingClientRect`/`offsetHeight`
// siempre dan 0 aquí, así que este archivo no puede "medir" píxeles en
// pantalla. En su lugar reproduce el mismo cálculo de caja CSS que ya usó la
// especificación de O16 (padding explícito + line-height de `leading-tight`,
// que es determinista, más el ícono de lucide-react que es un <svg
// width/height> fijo en px) y lo cruza con el conteo REAL de filas que sí
// renderiza el componente (eso es lo único que jsdom puede verificar de
// verdad). Si algún día cambian los valores en sidebar.tsx, estas constantes
// deben actualizarse a mano — quedan documentadas línea por línea contra el
// className real para que ese desvío sea auditable en code review.

// --- Fila del <nav> (sidebar.tsx, <Link> de cada item) ---
const FILA_PADDING_VERTICAL_PX = 9 * 2; // py-[9px] arriba + abajo = 18px
// <Icon size={20}/> domina sobre la línea de texto de al lado: el texto usa
// text-[13.5px] SIN leading-* explícito → line-height "normal" del
// navegador (~1.2-1.3 en fuentes UI como IBM Plex Sans, es decir ~16-18px),
// por debajo del ícono. Es la misma asunción que ya hace la especificación
// de O16 ("el ícono domina la fila") — no es medible en jsdom porque
// depende de métricas reales de fuente.
const FILA_ICONO_PX = 20;
const FILA_ALTO_PX = FILA_PADDING_VERTICAL_PX + FILA_ICONO_PX; // 38px
const FILA_GAP_PX = 3; // gap-[3px] del <nav>, se cuenta (N-1) veces

// --- Cromo del sidebar fuera del <nav> (mismo <div> raíz de sidebar.tsx) ---
const CONTENEDOR_PADDING_VERTICAL_PX = 18 * 2; // py-[18px] del contenedor raíz = 36px

// Bloque 7-B · O15: no hay chip en el header — la marca
// (<BrandMark variant="paloma">) va directo sobre el navy, sin badge de
// fondo. Quien domina la fila es el bloque de texto: el nombre del producto
// (`NOMBRE_PRODUCTO`, 14.5px bold, leading-tight = 1.25, determinista) que en
// los 230px del sidebar ocupa DOS líneas: 2 * 14.5 * 1.25 = 36.25px, MAYOR
// que la marca (24px).
//
// HEADER_MARCA_PX refleja el `size` REAL que sidebar.tsx le pasa a la marca,
// no un valor viejo: la constante de abajo debe reflejar lo que sidebar.tsx
// tiene hoy.
const HEADER_MARCA_PX = 24;
const HEADER_TEXTO_PX = 36.25;
const HEADER_FILA_PX = Math.max(HEADER_MARCA_PX, HEADER_TEXTO_PX); // 36.25px
const HEADER_MARGEN_PX = 20; // mb-5
const HEADER_ALTO_PX = HEADER_FILA_PX + HEADER_MARGEN_PX; // 56.25px

const FOOTER_MARGEN_PX = 12; // mt-3
const FOOTER_BORDE_PX = 1; // border-t (default de Tailwind = 1px)
const FOOTER_PADDING_TOP_PX = 14; // pt-3.5 (sin pb-*: el padding inferior lo
// aporta el py-[18px] del contenedor raíz, no este bloque)
// avatar h-8=32px vs. bloque de texto (leading-tight = 1.25, determinista):
// email 12.5*1.25=15.625 + mt-0.5(2) + badge(py-px*2=2 + 10*1.25=12.5=14.5)
// = 32.125px — le gana al avatar por una fracción de px, ambos deterministas.
const FOOTER_FILA_PX = 32.125;
const FOOTER_ALTO_PX = FOOTER_MARGEN_PX + FOOTER_BORDE_PX + FOOTER_PADDING_TOP_PX + FOOTER_FILA_PX; // 59.125px

const CROMO_ALTO_PX = CONTENEDOR_PADDING_VERTICAL_PX + HEADER_ALTO_PX + FOOTER_ALTO_PX; // 151.375px

/** Referencia de viewport corto acordada en O16 para este GATE. */
const PRESUPUESTO_VERTICAL_PX = 900;

function altoNavProyectado(cantidadItems: number): number {
  return cantidadItems * FILA_ALTO_PX + (cantidadItems - 1) * FILA_GAP_PX;
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/lib/auth/actions", () => ({
  cerrarSesion: vi.fn(),
}));

// 11 ítems simulados (más de los 8 reales de hoy, ver sidebar.test.tsx) —
// el ícono se define DENTRO del factory (no como import externo) porque
// vi.mock() se hoistea sobre los imports del archivo y no puede referenciar
// variables de nivel superior. El tipo de ícono no afecta el alto de fila
// (ver FILA_ICONO_PX: siempre size=20 en sidebar.tsx, sin importar cuál).
//
// [INV-B8] `puedeVerNavItem` se reexporta TAL CUAL desde el módulo real
// (`importOriginal`) — solo se sustituye `NAV_ITEMS`. Ninguno de los 11
// ítems simulados declara `adminOnly`/`rolesPermitidos`, así que el
// predicado real los deja pasar para cualquier rol, igual que antes de que
// ese segundo eje existiera; reimplementarlo aquí a mano habría sido una
// segunda copia de la misma regla, exactamente lo que este eje evita.
vi.mock("@/lib/nav", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nav")>();
  function IconoSimulado(): null {
    return null;
  }
  const NAV_ITEMS = Array.from({ length: 11 }, (_, i) => ({
    label: `Item simulado ${i + 1}`,
    href: `/item-simulado-${i + 1}`,
    icon: IconoSimulado,
  }));
  return { ...actual, NAV_ITEMS };
});

describe("Sidebar — GATE de presupuesto vertical (Bloque 7-B · O16)", () => {
  it("las constantes documentadas arriba coinciden con lo que hoy tiene sidebar.tsx", () => {
    expect(FILA_ALTO_PX).toBe(38);
    expect(CROMO_ALTO_PX).toBe(151.375);
  });

  it("con 11 ítems simulados, el <nav> renderiza exactamente 11 filas reales", () => {
    render(<Sidebar sesion={{ email: "admin@example.com", rol: "admin" }} />);

    expect(screen.getAllByRole("link")).toHaveLength(11);
  });

  it("11 ítems: el alto proyectado del sidebar completo cabe en 900px", () => {
    const altoNav = altoNavProyectado(11);
    const totalUsado = CROMO_ALTO_PX + altoNav;
    const libres = PRESUPUESTO_VERTICAL_PX - totalUsado;

    expect(altoNav).toBe(448); // 11*38 + 10*3
    expect(Math.round(totalUsado)).toBe(599);
    expect(Math.round(libres)).toBe(301);
    expect(totalUsado).toBeLessThanOrEqual(PRESUPUESTO_VERTICAL_PX);
  });

  // [INV-B8] 8 ítems (conteo real hoy para admin, tras sumar "Proyectos"
  // entre "El Cruce" y "Embarques" — ver sidebar.test.tsx).
  it("8 ítems (conteo real hoy para admin): también cabe, con más margen todavía", () => {
    const altoNav = altoNavProyectado(8);
    const totalUsado = CROMO_ALTO_PX + altoNav;
    const libres = PRESUPUESTO_VERTICAL_PX - totalUsado;

    expect(altoNav).toBe(325); // 8*38 + 7*3
    expect(Math.round(totalUsado)).toBe(476);
    expect(Math.round(libres)).toBe(424);
    expect(totalUsado).toBeLessThanOrEqual(PRESUPUESTO_VERTICAL_PX);
  });
});
