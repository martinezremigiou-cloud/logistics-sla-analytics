"use client";

import { useState } from "react";
import Image from "next/image";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOMBRE_PRODUCTO } from "@/config/producto";

/**
 * Marca del producto.
 *
 * Bloque 7-B · O15 — la marca vive en un archivo estático
 * (`public/logo.svg`, un marcador neutro) y este componente lo consume sin
 * que los call-sites (sidebar.tsx, login/page.tsx) sepan de dónde sale:
 *
 *   - variant="completa" → pensada para el LOGIN (panel navy + header
 *     móvil), la marca "principal", a la entrada.
 *   - variant="paloma" → pensada para el SIDEBAR, el cromo de todas las
 *     páginas internas (marca simplificada).
 *
 * Hoy las dos variantes apuntan al mismo marcador cuadrado, pero cada una
 * conserva su PROPIA relación ancho:alto en `RATIO_ANCHO_ALTO`: sustituir el
 * arte de una sola variante no obliga a tocar ningún call-site. `size` es
 * siempre el ALTO en px, nunca el ancho: el ancho sale solo de
 * `RATIO_ANCHO_ALTO[variant]`, nunca fijado a mano en un call-site.
 *
 * (El favicon usa un mecanismo aparte, por convención de archivo de Next
 * (`src/app/icon.svg`), y este componente no lo consume.)
 *
 * Si el archivo correspondiente llegara a faltar (404 — p. ej. un
 * despliegue que no copió `public/`), el `onError` de la imagen
 * degrada al mismo `Shield` de lucide-react que ya se usaba de
 * placeholder antes de que llegara el arte real. Nunca hace falta
 * comprobar "a mano" si el archivo existe: el navegador ya intenta
 * cargarlo, y si falla, cae al ícono — por eso este componente necesita
 * estado (`"use client"`).
 *
 * `next/image` con `unoptimized`: `sharp` no está instalado (y este bloque
 * no agrega dependencias) — sin `unoptimized`, la optimización on-demand
 * de `next/image` puede reventar en `next start`. `width`/`height`
 * explícitos (derivados de `size`) evitan salto de layout mientras carga.
 *
 * EL RESPALDO YA NO ES EL CASO NORMAL (con el arte real cableado, el 404
 * es la excepción, no la regla como durante la ronda anterior) pero se
 * conserva por resiliencia — y sigue teniendo que reservar el MISMO ancho
 * que la imagen para no saltar el layout si llega a activarse: el
 * `Shield` de respaldo se dibuja CUADRADO (`size × size`) mientras la
 * imagen reserva `size × RATIO_ANCHO_ALTO[variant] × size` (rectangular).
 * Una envoltura `<span>` del tamaño exacto de la imagen, con el glyph de
 * `Shield` centrado adentro a su tamaño natural sin distorsión, es lo que
 * mata ese salto sin importar cuál de los dos se termine mostrando (fix
 * de la ronda de revisión INV-B7B, punto E).
 *
 * ALTERNATIVA EVALUADA Y NO ADOPTADA — CSS puro sin cliente (`<span>` con
 * la PNG en `background-image`, capas de fondo apiladas con el SVG de
 * respaldo debajo, sin JS/estado/`onError`): es una técnica real y bien
 * establecida (`background-image: url(png), url(svg-fallback)` — si la
 * capa de arriba no carga, simplemente no pinta y deja ver la de abajo,
 * sin el ícono nativo de "imagen rota" que sí puede dejar un `<img>`).
 * Se descarta por dos motivos concretos, no por pereza:
 *
 *   1. HUECO DE COBERTURA REAL (no cosmético): jsdom NO renderiza CSS —
 *      no carga imágenes ni evalúa si un `background-image` "falló". La
 *      suite de este archivo verifica el swap real (`fireEvent.error`
 *      sobre el `<img>` → el `Shield` aparece con los atributos
 *      correctos); con la alternativa CSS, esa verificación de
 *      COMPORTAMIENTO sería irreproducible en esta suite — como mucho se
 *      podría afirmar que las dos URLs quedaron en el `style`, nunca que
 *      el navegador de verdad revela la capa de abajo cuando la de arriba
 *      404. Es exactamente el hueco que `docs/engineering/failure-patterns.md` (P6)
 *      ("cobertura que da falsa confianza") y P5 ("supuesto no escrito,
 *      nunca probado contra el sistema real") piden nombrar en vez de
 *      aceptar en silencio.
 *   2. El SVG de la capa de respaldo tendría que ser un STRING de
 *      marcado (data URI) hardcodeado a mano, por fuera del sistema de
 *      íconos de `lucide-react` que usa el resto del código — un
 *      duplicado del glyph de `Shield` que puede desalinearse si el
 *      paquete cambia el ícono, en vez del componente `<Shield/>` real.
 *
 * El apunte de `next/image unoptimized` de arriba es la otra cara de esta
 * decisión: la alternativa CSS solo funciona si se abandona `next/image`
 * (y el propio `<img>`) por completo para el respaldo — un `<img>` roto
 * muestra su ícono nativo de "imagen rota" que el CSS no puede suprimir
 * de forma confiable en todos los navegadores. Ese es un cambio de
 * arquitectura mayor para un camino que hoy es la excepción (el archivo
 * falta), no el caso normal — no vale la pena el hueco de cobertura del
 * punto 1 para eso. Si el hallazgo se retoma más adelante, este
 * comentario documenta la evaluación para no repetirla desde cero.
 */

/**
 * Relación ancho:alto de cada variante, medida sobre el arte (`logo.svg`,
 * viewBox cuadrado → 1). Cada variante tiene la suya — no se promedia a un
 * número compartido — y vive aquí, en un solo lugar, para que ningún
 * call-site repita el cálculo.
 */
const RATIO_ANCHO_ALTO: Record<"completa" | "paloma", number> = {
  completa: 1,
  paloma: 1,
};

const ARCHIVO: Record<"completa" | "paloma", string> = {
  completa: "/logo.svg",
  paloma: "/logo.svg",
};

export interface BrandMarkProps {
  /**
   * Qué marca pintar. "completa" = la marca principal (login, la entrada).
   * "paloma" = la marca simplificada (sidebar, el cromo interno).
   */
  variant: "completa" | "paloma";
  /**
   * Alto en px. El ancho SIEMPRE sale de
   * `size * RATIO_ANCHO_ALTO[variant]` — nunca se fija a mano.
   */
  size: number;
  /**
   * true cuando la marca aparece SIN el nombre del producto al lado (hoy
   * ningún call-site lo necesita: los 3 emplazamientos actuales van pegados
   * a ese texto, que ya nombra la app). Decide el `alt`: decorativo
   * (`alt=""` + `aria-hidden`) cuando hay texto al lado, descriptivo
   * (`NOMBRE_PRODUCTO`) cuando la marca tiene que valerse sola.
   */
  standalone?: boolean;
  className?: string;
}

export function BrandMark({ variant, size, standalone = false, className }: BrandMarkProps) {
  const [fallo, setFallo] = useState(false);
  const decorativo = !standalone;
  const ancho = Math.round(size * RATIO_ANCHO_ALTO[variant]);

  if (fallo) {
    // Envoltura del MISMO ancho/alto que reservaba `<Image>` (ancho × size)
    // — el glyph de `Shield` adentro conserva su tamaño natural (cuadrado,
    // sin distorsión), centrado. La accesibilidad (role/aria-label/
    // aria-hidden) vive en la envoltura, que es ahora el elemento "lógico"
    // equivalente a la imagen; el glyph interno es SIEMPRE decorativo
    // (aria-hidden="true" fijo).
    return (
      <span
        data-brand-variant={variant}
        role={decorativo ? undefined : "img"}
        aria-hidden={decorativo ? "true" : undefined}
        aria-label={decorativo ? undefined : NOMBRE_PRODUCTO}
        style={{ width: ancho, height: size }}
        className={cn("inline-flex shrink-0 items-center justify-center", className)}
      >
        <Shield aria-hidden="true" size={size} strokeWidth={2} className="shrink-0 text-white" />
      </span>
    );
  }

  return (
    <Image
      src={ARCHIVO[variant]}
      alt={decorativo ? "" : NOMBRE_PRODUCTO}
      aria-hidden={decorativo ? "true" : undefined}
      data-brand-variant={variant}
      width={ancho}
      height={size}
      unoptimized
      onError={() => setFallo(true)}
      className={cn("shrink-0", className)}
    />
  );
}
