"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatoNumero } from "@/lib/formato";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { CatalogoFacetas, CatalogoFacetaValor } from "@/types/api";

export interface CatalogoArbolProps {
  /**
   * (INV-TAXO F3 · A1, + producto en CAT-B1 · Tramo C) Facetas EN CASCADA de
   * la MISMA página que alimenta la tabla/grid (`CatalogoPage.facetas`) —
   * este componente NUNCA hace fetch propio ni recalcula la cascada, solo la
   * renderiza: `tecnologias` sobre el universo completo, `marcas` sobre
   * universo ∩ tecnología, `familias`/`sin_familia` sobre universo ∩
   * tecnología ∩ marca, `productos` sobre universo ∩ tecnología ∩ marca ∩
   * familia (ver doc-comment de `CatalogoFacetas`, types/api.ts). `null`
   * antes de la primera carga o tras un error sin data previa.
   */
  facetas: CatalogoFacetas | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  tecnologiaActiva: string | null;
  marcaActiva: string | null;
  familiaActiva: string | null;
  /** `true` cuando `?badge=sin_familia` está activo — resalta el nodo "Sin familia asignada". */
  sinFamiliaActiva: boolean;
  /** [CAT-B1 · Tramo C] ÚLTIMO nivel de la cascada — gemelo de `familiaActiva`, mismo criterio. */
  productoActiva: string | null;
  onSelectTecnologia: (tecnologia: string) => void;
  onSelectMarca: (marca: string) => void;
  onSelectFamilia: (familia: string) => void;
  onSelectSinFamilia: () => void;
  onSelectProducto: (producto: string) => void;
}

const FILA_BASE =
  "flex w-full items-center gap-1.5 rounded-[7px] px-2 py-[7px] text-left text-[12.5px] transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/**
 * Comparación case-insensitive: el valor "activo" viaja por la URL y pudo
 * llegar con otra capitalización que la que guarda la faceta — mismo
 * criterio que la regla anti-trampa del backend (`facetaConSeleccion`,
 * inventory.service.ts).
 */
function mismoValor(activo: string | null, valor: string): boolean {
  return activo !== null && activo.toLowerCase() === valor.toLowerCase();
}

/**
 * Resumen "tecnología › marca › familia" para el botón móvil (y
 * potencialmente breadcrumbs futuros) — "Todas" si no hay ningún nivel
 * seleccionado. 100% PURO, exportado para test directo.
 *
 * (O1) `tecnologia` puede traer el sentinel `SIN_TECNOLOGIA` — igual que el
 * chip de `catalogo-view.tsx`, ese valor crudo NUNCA se muestra tal cual en
 * copy de usuario: se traduce a "Sin tecnología".
 */
export function resumenSeleccionArbol(
  tecnologia: string | null,
  marca: string | null,
  familia: string | null,
  sinFamilia: boolean,
  /** [CAT-B1 · Tramo C] ÚLTIMO nivel — opcional con default `null` para no romper los ~12 call-sites de 4 args previos a este campo. */
  producto: string | null = null,
): string {
  const tecnologiaLabel = tecnologia === SIN_TECNOLOGIA ? "Sin tecnología" : tecnologia;
  const nivelFamilia = familia ?? (sinFamilia ? "Sin familia asignada" : null);
  const partes = [tecnologiaLabel, marca, nivelFamilia, producto].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(" › ") : "Todas";
}

/**
 * Una lista de valores de una faceta (nivel del árbol), cada uno un botón
 * navegable con su conteo. `sufijo` (R1-3) agrega un nodo extra AL FINAL
 * de la misma lista — p.ej. el nodo fijo "Sin familia asignada" de la
 * sección Familia o "Sin tecnología" de la sección Tecnología (O1) — sin
 * que ese caller tenga que reimplementar el `<ul>`/`<li>`/botón desde cero.
 */
function ListaFaceta(props: {
  valores: CatalogoFacetaValor[];
  activo: string | null;
  onSelect: (valor: string) => void;
  sufijo?: ReactNode;
}) {
  const { valores, activo, onSelect, sufijo } = props;
  return (
    <ul className="flex flex-col gap-0.5">
      {valores.map((v) => {
        const esActivo = mismoValor(activo, v.valor);
        return (
          <li key={v.valor}>
            <button
              type="button"
              aria-current={esActivo ? "page" : undefined}
              onClick={() => onSelect(v.valor)}
              className={cn(FILA_BASE, "text-ink-2", esActivo && "bg-info-bg font-semibold text-brand")}
            >
              <span className="flex-1 truncate">{v.valor}</span>{" "}
              <span className="font-mono text-[10.5px] text-ink-muted">{formatoNumero(v.conteo)}</span>
            </button>
          </li>
        );
      })}
      {sufijo}
    </ul>
  );
}

/**
 * (O1) Sección colapsable de un nivel del árbol: un `<details>` NATIVO con
 * su `<summary>` — CERO dependencias. Verificado antes de escribir esto:
 * `tailwind.config.ts` trae keyframes `accordion-down/up` que animan hacia
 * `var(--radix-accordion-content-height)`, pero `@radix-ui/react-accordion`
 * NO está instalado → esas keyframes están MUERTAS y no se usan aquí.
 * `open:`/`group-open:` son variantes NATIVAS de Tailwind v3 sobre el
 * atributo `open` del propio `<details>`.
 *
 * Las 4 secciones (Tecnología/Marca/Familia/Producto — CAT-B1 · Tramo C
 * agregó la 4ª) son SIEMPRE hermanas en el DOM — nunca anidadas de verdad
 * (diseño ratificado: anidar habría escondido la Marca ya elegida
 * al colapsar Tecnología). `indent` es 100% cosmético (sangría + riel) para
 * comunicar la jerarquía sin anidar.
 *
 * `open` viaja como prop DERIVADA — NUNCA hay `useState`/`onToggle` aquí ni
 * en el caller (cero persistencia, ni localStorage ni sesión): si el valor
 * calculado no cambia entre renders, React NO vuelve a tocar el atributo
 * DOM `open` (reconciliación por igualdad de primitivo), así que un toggle
 * manual del usuario — nativo, fuera de React — sobrevive a cualquier
 * re-render mientras el criterio de apertura por defecto no cambie (p.ej.
 * un refetch con los mismos filtros activos). Si el criterio SÍ cambia
 * (p.ej. `familiaActiva` pasa de `null` a un valor, incluido un deep-link
 * sin clics previos), React reconcilia el nuevo valor y fuerza la apertura
 * — exactamente la regla pedida.
 */
function SeccionArbol(props: {
  titulo: string;
  conteo: number;
  indent: string;
  defaultOpen: boolean;
  /** Familia (O1): tope de scroll propio y permanente sobre su lista, haya filtro o no. */
  scroll?: boolean;
  children: ReactNode;
}) {
  const { titulo, conteo, indent, defaultOpen, scroll, children } = props;
  return (
    <details className={cn("group", indent)} open={defaultOpen}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2 rounded-[7px] px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground outline-none [&::-webkit-details-marker]:hidden [&::marker]:content-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          <span>{titulo}</span>
        </span>
        <span className="font-mono text-[10.5px] normal-case text-ink-muted">{formatoNumero(conteo)}</span>
      </summary>
      {/*
        (O1, accesibilidad) Nunca `hidden`/`display:none`/`tabIndex` manual
        sobre este contenedor: el `<details>` cerrado ya saca este contenido
        del flujo visual y del orden de tabulación de forma NATIVA —
        envolverlo en un condicional de React lo rompería sin necesidad.
      */}
      <div className={cn("pt-1", scroll && "max-h-[260px] overflow-y-auto pr-1")}>{children}</div>
    </details>
  );
}

/**
 * Árbol en cascada del catálogo (A1, + producto en CAT-B1 · Tramo C):
 * tecnología → marca → familia → producto, 100% alimentado por
 * `CatalogoPage.facetas` (la MISMA respuesta que ya trae la tabla/grid) —
 * sin fetch ni agregación propia. Un SKU con N familias (o N productos) vive
 * en las N ramas (A2): esto es navegación para ENCONTRAR, nunca se suman
 * piezas por rama (`docs/engineering/failure-patterns.md`, P8) — ninguna rama ni badge de
 * conteo de sección aquí es una Σ de piezas/conteos: el badge de cada
 * `<summary>` es la CANTIDAD DE RAMAS de esa faceta (`facetas.X.length`),
 * nunca la suma de sus `.conteo`. `almacén` no vive aquí (tiene su propio
 * select + chip, A4) — solo tecnología/marca/familia/producto forman el
 * árbol.
 *
 * `Producto` es el ÚNICO nivel que puede AUSENTARSE por completo (a
 * diferencia de los otros 3, que siempre tienen al menos su nodo "Sin X"):
 * medido contra el vigente, ninguna tecnología ≠ BRAND1 APORTA un solo
 * producto, así que sin selección esa faceta llega `[]` y la sección NO se
 * pinta (ni vacía, ni con un encabezado sin ramas: se ausenta, ver
 * `hayProductos` abajo). EXCEPCIÓN a propósito: si `?producto=` viene
 * seleccionado con otra tecnología activa, la REGLA ANTI-TRAMPA del backend
 * (`facetaConSeleccion`, inventory.service.ts) empuja esa entrada con
 * conteo 0 y la sección SÍ se pinta con esa única rama — para que el
 * usuario nunca quede atrapado sin forma de quitar el filtro desde la UI.
 *
 * (O1) Los niveles son secciones COLAPSABLES pero SIEMPRE presentes cuando
 * tienen datos (no exclusivamente anidadas tras "expandir" un padre): la
 * cascada del backend ya las escopea correctamente según la selección
 * activa (p.ej. `facetas.marcas` viene acotado a la tecnología elegida, pero
 * SIGUE listando TODAS las marcas de ese universo, no solo la elegida) —
 * replicar un expand/collapse manual por rama exigiría un fetch por rama
 * que el contrato no ofrece. Ver `SeccionArbol` para el detalle de cómo se
 * implementa el colapso (100% `<details>` nativo, cero dependencias).
 *
 * PATRÓN ANTI-REMOUNT (FIX-RESET): la compuerta es `{facetas && <árbol
 * aria-busy={loading}/>}` con fallback a skeleton/error SOLO cuando
 * `facetas` es `null` — nunca se desmonta el árbol ya cargado por un
 * `loading=true` de un refetch en curso.
 */
export function CatalogoArbol(props: CatalogoArbolProps) {
  const {
    facetas,
    loading,
    error,
    onRetry,
    tecnologiaActiva,
    marcaActiva,
    familiaActiva,
    sinFamiliaActiva,
    productoActiva,
    onSelectTecnologia,
    onSelectMarca,
    onSelectFamilia,
    onSelectSinFamilia,
    onSelectProducto,
  } = props;
  const [sheetAbierto, setSheetAbierto] = useState(false);

  function seleccionar(onSelect: (valor: string) => void, valor: string) {
    onSelect(valor);
    setSheetAbierto(false);
  }
  function seleccionarSinFamilia() {
    onSelectSinFamilia();
    setSheetAbierto(false);
  }

  let cuerpo: ReactNode;
  if (facetas) {
    // (O1) Mismo criterio que `hayFamilias`/`sin_familia`: `sin_tecnologia`
    // es el complemento de `tecnologias` (SKUs sin tecnología efectiva), así
    // que también cuenta para decidir si la sección tiene algo que mostrar.
    const hayTecnologias = facetas.tecnologias.length > 0 || facetas.sin_tecnologia > 0;
    const hayMarcas = facetas.marcas.length > 0;
    const hayFamilias = facetas.familias.length > 0 || facetas.sin_familia > 0;
    // (CAT-B1 · Tramo C) SIN complemento "sin_producto": a diferencia de
    // familia/tecnología, la ausencia de producto en el alcance activo NO es
    // un nodo — es la SECCIÓN ENTERA la que se ausenta (nunca un encabezado
    // "Producto" con cero ramas debajo). Medido: ninguna tecnología ≠ BRAND1
    // APORTA un solo producto — pero con `?producto=` seleccionado la REGLA
    // ANTI-TRAMPA (`facetaConSeleccion`) puede empujar UNA entrada con
    // conteo 0, y entonces esta condición es `true` a propósito (ver el
    // test de la regla anti-trampa, abajo).
    const hayProductos = facetas.productos.length > 0;

    // (O1) Apertura por defecto de Familia — regla exacta: cerrada SOLO si
    // NINGUNA de las 4 señales de selección está activa; se auto-abre en
    // cuanto cualquiera lo esté, incluido un deep-link directo (p.ej.
    // `?familia=X`) sin clics previos. `tecnologiaActiva` cubre TAMBIÉN el
    // sentinel `SIN_TECNOLOGIA` (string no vacío ⇒ truthy) a propósito: si
    // el usuario ya filtró "sin tecnología", tiene sentido que Familia
    // arranque expandida igual que con una tecnología real.
    const familiaAbiertaPorDefecto = Boolean(tecnologiaActiva || marcaActiva || familiaActiva || sinFamiliaActiva);
    // (CAT-B1 · Tramo C) Mismo criterio que Familia, MÁS `productoActiva`
    // propio (deep-link directo a `?producto=X`).
    const productoAbiertaPorDefecto = Boolean(
      tecnologiaActiva || marcaActiva || familiaActiva || sinFamiliaActiva || productoActiva,
    );

    cuerpo = !hayTecnologias && !hayMarcas && !hayFamilias && !hayProductos ? (
      <p className="px-2 py-3 text-[12.5px] text-muted-foreground">Sin datos disponibles.</p>
    ) : (
      <div className="flex flex-col gap-1">
        {hayTecnologias && (
          <SeccionArbol titulo="Tecnología" conteo={facetas.tecnologias.length} indent="ml-0" defaultOpen>
            <ListaFaceta
              valores={facetas.tecnologias}
              activo={tecnologiaActiva}
              onSelect={(v) => seleccionar(onSelectTecnologia, v)}
              sufijo={
                facetas.sin_tecnologia > 0 && (
                  <li>
                    <button
                      type="button"
                      aria-current={tecnologiaActiva === SIN_TECNOLOGIA ? "page" : undefined}
                      onClick={() => seleccionar(onSelectTecnologia, SIN_TECNOLOGIA)}
                      className={cn(
                        FILA_BASE,
                        "italic text-ink-muted",
                        tecnologiaActiva === SIN_TECNOLOGIA && "bg-info-bg font-semibold not-italic text-brand",
                      )}
                    >
                      <span className="flex-1 truncate">Sin tecnología</span>{" "}
                      <span className="font-mono text-[10.5px] text-ink-muted">{formatoNumero(facetas.sin_tecnologia)}</span>
                    </button>
                  </li>
                )
              }
            />
          </SeccionArbol>
        )}
        {hayMarcas && (
          <SeccionArbol titulo="Marca" conteo={facetas.marcas.length} indent="ml-3 border-l border-line pl-3" defaultOpen>
            <ListaFaceta valores={facetas.marcas} activo={marcaActiva} onSelect={(v) => seleccionar(onSelectMarca, v)} />
          </SeccionArbol>
        )}
        {hayFamilias && (
          <SeccionArbol
            titulo="Familia"
            conteo={facetas.familias.length}
            indent="ml-6 border-l border-line pl-3"
            defaultOpen={familiaAbiertaPorDefecto}
            scroll
          >
            <ListaFaceta
              valores={facetas.familias}
              activo={familiaActiva}
              onSelect={(v) => seleccionar(onSelectFamilia, v)}
              sufijo={
                facetas.sin_familia > 0 && (
                  <li>
                    <button
                      type="button"
                      aria-current={sinFamiliaActiva ? "page" : undefined}
                      onClick={seleccionarSinFamilia}
                      className={cn(
                        FILA_BASE,
                        "italic text-ink-muted",
                        sinFamiliaActiva && "bg-info-bg font-semibold not-italic text-brand",
                      )}
                    >
                      <span className="flex-1 truncate">Sin familia asignada</span>{" "}
                      <span className="font-mono text-[10.5px] text-ink-muted">{formatoNumero(facetas.sin_familia)}</span>
                    </button>
                  </li>
                )
              }
            />
          </SeccionArbol>
        )}
        {hayProductos && (
          <SeccionArbol
            titulo="Producto"
            conteo={facetas.productos.length}
            indent="ml-9 border-l border-line pl-3"
            defaultOpen={productoAbiertaPorDefecto}
            scroll
          >
            <ListaFaceta valores={facetas.productos} activo={productoActiva} onSelect={(v) => seleccionar(onSelectProducto, v)} />
          </SeccionArbol>
        )}
      </div>
    );
  } else if (loading) {
    cuerpo = <ArbolSkeleton />;
  } else if (error) {
    cuerpo = (
      <div className="flex flex-col items-start gap-2 px-2 py-3">
        <p className="text-[12.5px] text-muted-foreground">No se pudo cargar el árbol del catálogo.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  } else {
    // Defensivo: con `facetas` no-null y sin loading/error, este caso no debería darse en producción.
    cuerpo = <p className="px-2 py-3 text-[12.5px] text-muted-foreground">Sin datos disponibles.</p>;
  }

  const resumen = resumenSeleccionArbol(tecnologiaActiva, marcaActiva, familiaActiva, sinFamiliaActiva, productoActiva);

  return (
    <>
      <nav
        aria-label="Árbol del catálogo"
        aria-busy={loading}
        className="hidden w-full max-w-[270px] shrink-0 self-start rounded-2xl border border-line bg-surface p-2.5 md:block"
      >
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Árbol del catálogo
        </p>
        {cuerpo}
      </nav>

      <div className="md:hidden">
        <Button type="button" variant="outline" className="w-full justify-between" onClick={() => setSheetAbierto(true)}>
          <span className="truncate">Árbol: {resumen}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
        <Sheet open={sheetAbierto} onOpenChange={setSheetAbierto}>
          <SheetContent side="left" className="w-[280px] overflow-y-auto border-line bg-surface p-4">
            <SheetHeader>
              <SheetTitle>Árbol del catálogo</SheetTitle>
            </SheetHeader>
            <div className="mt-3">{cuerpo}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

function ArbolSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-2 px-1 py-1" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}
