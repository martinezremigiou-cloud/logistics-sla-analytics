"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { FamiliaChip } from "@/components/shared/familias-chips";
import { cn } from "@/lib/utils";

interface FamiliasCeldaProps {
  /**
   * (INV-TAXO F2 · A3) Primario `item.familias` — NUNCA `item.familia` (el
   * crudo de display está prohibido para filtrar/agrupar/sumar, ver
   * `CatalogoItem.familia`, types/api.ts). `[]` respeta el badge
   * `sin_familia` ya existente.
   */
  familias: string[];
  /**
   * [2.0.1-A · D3] `true` cuando la familia que se muestra ya no es la que el
   * archivo de inventario declara (la capa v2 se quedó con el nombre viejo).
   * Pinta un punto, no un segundo chip: esta columna es la más apretada de la
   * tabla —su ancho ya costó un recorte real— y `layout-check` A1 vigila que
   * nada quede truncado ilegible. El punto SEÑALA; la ficha explica.
   */
  divergente?: boolean;
  /** Lo que dice el archivo, para poder nombrarlo en el `title`/`aria-label`. */
  familiaFuente?: string | null;
  className?: string;
}

/**
 * El punto de «la fuente cambió». Lleva `title` Y `aria-label`: en 390 px no
 * hay hover, que es la misma regla que esta celda ya se escribió para su
 * colapso (nunca solo hover — accesibilidad y móvil).
 */
function PuntoFuenteCambio({ familiaFuente }: { familiaFuente?: string | null }) {
  const dice = familiaFuente ? `el archivo de inventario ahora dice ${familiaFuente}` : "el archivo de inventario ya no dice esta familia";
  return (
    <span
      role="img"
      aria-label={dice}
      title={dice}
      className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn align-middle"
    />
  );
}

/**
 * Celda de familia expandible, compartida por `CatalogoTabla`/`CatalogoGrid`
 * (A3). Pinta cada chip con `FamiliaChip` (`@/components/shared/familias-chips`,
 * F2 de esta ronda) — el mismo primitivo que ya usan `ficha-atributos.tsx` y
 * `cruce/foco-sku.tsx`, así los 3 consumidores comparten look de chip. Lo
 * que NO se consolida (y sigue siendo exclusivo de esta celda, ver
 * doc-comment de `ListaFamiliaChips`) es la UX de colapso: colapsada
 * muestra la primera familia + contador del resto ("SERIES 12 +10"); se
 * expande con hover Y con teclado/tap (nunca solo hover — accesibilidad y
 * móvil):
 *   - hover  → `onMouseEnter`/`onMouseLeave` sobre el contenedor
 *     (`hoverActivo`).
 *   - teclado → foco del botón (`onFocus`/`onBlur`, `focoActivo`) ya lo
 *     revela, sin necesidad de activarlo.
 *   - tap/click → alterna un estado "fijado" independiente de hover/foco,
 *     para que persista en dispositivos táctiles (sin evento de hover real).
 * `revelado = hoverActivo || focoActivo || fijado` (R1-4): hover y foco
 * viven en estados SEPARADOS a propósito — con un solo booleano
 * compartido, perder el foco (`onBlur`) colapsaba el panel aunque el
 * mouse siguiera encima (el `blur` pisaba lo que el `mouseEnter` ya había
 * marcado); con estados separados, perder el foco solo apaga `focoActivo`
 * y el panel se mantiene abierto mientras `hoverActivo` (o `fijado`)
 * siga en pie.
 * `Escape` colapsa incondicionalmente los tres. El trigger detiene `click`
 * (`preventDefault`+`stopPropagation`) para poder anidarse dentro de un
 * `<a>` (la card de `CatalogoGrid` completa es un link) sin disparar la
 * navegación del ancestro.
 */
export function FamiliasCelda({ familias, divergente = false, familiaFuente = null, className }: FamiliasCeldaProps) {
  const [hoverActivo, setHoverActivo] = useState(false);
  const [focoActivo, setFocoActivo] = useState(false);
  const [fijado, setFijado] = useState(false);

  if (familias.length === 0) {
    return <FamiliaChip familia="Sin familia" className={cn("whitespace-nowrap", className)} />;
  }

  const [primera, ...resto] = familias;

  if (resto.length === 0) {
    return (
      <span className="inline-flex items-center">
        <FamiliaChip familia={primera} className={cn("whitespace-nowrap", className)} />
        {divergente && <PuntoFuenteCambio familiaFuente={familiaFuente} />}
      </span>
    );
  }

  const revelado = hoverActivo || focoActivo || fijado;

  function alternar(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    setFijado((v) => !v);
  }

  function alColapsar() {
    setFijado(false);
    setHoverActivo(false);
    setFocoActivo(false);
  }

  function alTecla(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape") alColapsar();
  }

  return (
    <div
      className={cn("relative inline-block", className)}
      onMouseEnter={() => setHoverActivo(true)}
      onMouseLeave={() => setHoverActivo(false)}
    >
      <button
        type="button"
        aria-expanded={revelado}
        aria-label={`${primera} y ${resto.length} ${resto.length === 1 ? "familia" : "familias"} más`}
        onClick={alternar}
        onFocus={() => setFocoActivo(true)}
        onBlur={() => setFocoActivo(false)}
        onKeyDown={alTecla}
        className="inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {/*
          El "+N" es un resumen compuesto, no una familia real — pero se
          pinta con el MISMO `FamiliaChip` que el panel expandido de abajo
          para que el trigger y el panel luzcan como el mismo chip en dos
          estados (colapsado/expandido), no como dos sistemas de chip
          distintos.
        */}
        <FamiliaChip familia={`${primera} +${resto.length}`} className="whitespace-nowrap" />
      </button>
      {divergente && <PuntoFuenteCambio familiaFuente={familiaFuente} />}

      {revelado && (
        // R1-4: centrado (`left-1/2 -translate-x-1/2`) en vez de `left-0` —
        // con `left-0` el panel (hasta 280px) crece SIEMPRE hacia la
        // derecha del trigger, y en la última columna de la tabla
        // (envuelta en `overflow-x-auto`, `catalogo-tabla.tsx`) ese
        // crecimiento se salía del contenedor y quedaba recortado.
        // Centrado bajo el trigger reparte el ancho a ambos lados.
        <div className="absolute left-1/2 top-full z-20 mt-1 flex max-w-[280px] -translate-x-1/2 flex-wrap gap-1 rounded-[10px] border border-line bg-surface p-2 shadow-md">
          {familias.map((f) => (
            <FamiliaChip key={f} familia={f} className="whitespace-nowrap" />
          ))}
        </div>
      )}
    </div>
  );
}
