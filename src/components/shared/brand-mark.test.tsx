import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrandMark } from "./brand-mark";
import { NOMBRE_PRODUCTO } from "@/config/producto";

describe("BrandMark — marca vía next/image, con caída a Shield (Bloque 7-B · O15)", () => {
  it("variant='completa' apunta a /logo.svg (login)", () => {
    const { container } = render(<BrandMark variant="completa" size={28} />);

    // jsdom resuelve el atributo a una URL absoluta (http://localhost:3000/...)
    // — se compara el sufijo, que es lo que sí controla este componente.
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/\/logo\.svg$/);
  });

  it("variant='paloma' apunta a /logo.svg (sidebar)", () => {
    const { container } = render(<BrandMark variant="paloma" size={28} />);

    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/\/logo\.svg$/);
  });

  it("width/height explícitos: alto = size, ancho = size * ratio de la variante redondeado (hoy la marca es cuadrada: ratio 1)", () => {
    const { container } = render(<BrandMark variant="completa" size={28} />);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("height", "28");
    expect(img).toHaveAttribute("width", "28"); // 28 * 1
  });

  it("cada variante se calcula con SU relación ancho:alto (hoy las dos valen 1: el mismo size da el mismo ancho)", () => {
    const { container: completa } = render(<BrandMark variant="completa" size={28} />);
    const { container: paloma } = render(<BrandMark variant="paloma" size={28} />);

    expect(completa.querySelector("img")).toHaveAttribute("width", "28"); // 28 * 1
    expect(paloma.querySelector("img")).toHaveAttribute("width", "28"); // 28 * 1
  });

  it("usa next/image unoptimized: el src NO pasa por el proxy /_next/image (sharp no está instalado)", () => {
    const { container } = render(<BrandMark variant="paloma" size={20} />);

    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    expect(src).toMatch(/\/logo\.svg$/);
    expect(src).not.toContain("/_next/image");
  });

  it("decorativa por default (hay texto con el nombre del producto al lado en los 3 call-sites reales): alt vacío + aria-hidden, sin role='img'", () => {
    const { container } = render(<BrandMark variant="completa" size={28} />);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("standalone=true (sin texto al lado): alt descriptivo (el nombre del producto), sin aria-hidden", () => {
    render(<BrandMark variant="completa" size={28} standalone />);

    const img = screen.getByRole("img", { name: NOMBRE_PRODUCTO });
    expect(img).not.toHaveAttribute("aria-hidden");
  });

  it("mientras el archivo no exista (onError / 404): cae al Shield de lucide-react — mismo placeholder de siempre, con su tamaño natural sin distorsión", () => {
    const { container } = render(<BrandMark variant="paloma" size={28} />);

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // El glyph interno conserva su tamaño natural (cuadrado): NO se estira al ancho rectangular de la envoltura.
    expect(svg).toHaveAttribute("width", "28");
    expect(svg).toHaveAttribute("height", "28");
  });

  // ----------------------------------------------------------------
  // Ronda de revisión INV-B7B, punto E — cuando el archivo llega a faltar
  // (404), antes se dibujaba CUADRADO (size×size) mientras la imagen
  // reserva size×RATIO_ANCHO_ALTO[variant]×size (rectangular), así que el
  // remount <Image>→<Shield> saltaba el layout de lo que está al lado en
  // CADA carga fallida. Fix: una envoltura <span> reserva el MISMO
  // ancho/alto que reservaba <Image>; el data-attribute y la
  // accesibilidad se movieron a esa envoltura (ver brand-mark.tsx).
  // ----------------------------------------------------------------
  it("MUTANTE (punto E): la envoltura del respaldo reserva EXACTAMENTE el mismo ancho/alto que reservaba <Image> — mata el salto de layout", () => {
    const { container } = render(<BrandMark variant="completa" size={28} />);

    const img = container.querySelector("img") as HTMLImageElement;
    const anchoImagen = img.getAttribute("width");
    const altoImagen = img.getAttribute("height");
    expect(anchoImagen).toBe("28"); // 28 * 1

    fireEvent.error(img);

    // Con el código viejo (`<Shield size={size}/>` sin envoltura), este
    // `parentElement` no reserva ningún ancho propio y la línea de abajo
    // falla: el respaldo colapsaba a `size×size`, no al ancho de la imagen.
    const envoltura = container.querySelector("svg")?.parentElement as HTMLElement;
    expect(envoltura.style.width).toBe(`${anchoImagen}px`);
    expect(envoltura.style.height).toBe(`${altoImagen}px`);
    expect(envoltura).toHaveAttribute("data-brand-variant", "completa");
  });

  it("el fallback también respeta decorativo vs. standalone (accesibilidad en la envoltura; el glyph interno es SIEMPRE decorativo)", () => {
    const { container } = render(<BrandMark variant="completa" size={20} standalone />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    const svg = container.querySelector("svg");
    // El rol/label real de "es una imagen" vive en la envoltura, no en el glyph.
    expect(svg).toHaveAttribute("aria-hidden", "true");

    const envoltura = svg?.parentElement as HTMLElement;
    expect(envoltura).not.toHaveAttribute("aria-hidden");
    expect(envoltura).toHaveAttribute("aria-label", NOMBRE_PRODUCTO);
    expect(envoltura).toHaveAttribute("role", "img");
  });

  it("fallback decorativo (default, sin standalone): aria-hidden en la envoltura, sin role ni aria-label", () => {
    const { container } = render(<BrandMark variant="paloma" size={28} />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    const envoltura = container.querySelector("svg")?.parentElement as HTMLElement;
    expect(envoltura).toHaveAttribute("aria-hidden", "true");
    expect(envoltura).not.toHaveAttribute("role");
    expect(envoltura).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
