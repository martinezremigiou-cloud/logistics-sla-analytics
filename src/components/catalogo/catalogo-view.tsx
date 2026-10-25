"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { List, LayoutGrid, ChevronRight, EyeOff } from "lucide-react";
import { useApi } from "@/lib/hooks/use-api";
import { useSesion } from "@/components/providers/session-provider";
import { MUESTRA_CLASIFICACION_V2 } from "@/lib/roles";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { ChipFiltroActivo } from "@/components/shared/chip-filtro-activo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatoNumero } from "@/lib/formato";
import { construirUrlApi, aplicarActualizacion, hayFiltrosDeUsuario } from "@/lib/url-query";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { TAXONOMIA_ESTATUS } from "@/lib/estatus";
import { CatalogoArbol } from "./catalogo-arbol";
import { CatalogoFiltros } from "./catalogo-filtros";
import { CatalogoTabla } from "./catalogo-tabla";
import { CatalogoGrid } from "./catalogo-grid";
import { Paginacion } from "./paginacion";
import { CatalogoResultadosSkeleton } from "./catalogo-skeleton";
import type { BadgeCatalogo, CatalogoPage } from "@/types/api";

// "badge"/"sinV2" (Bloque 6, F4): drill-down desde las alertas del
// dashboard (`/catalogo?badge=sobre_reservado`, `/catalogo?sinV2=1`) — pass-
// through puro hacia `/api/inventory` (mismo mecanismo que el resto de
// `CAMPOS_QUERY`). `badge=sin_familia` (INV-TAXO F2 · A1) es TAMBIÉN cómo
// el árbol navega al nodo "Sin familia asignada" — mismo query param,
// mismo chip removible (`BADGE_LABELS`), sin superficie nueva de contrato.
// [2.0.1-A] "estatus": el filtro por estatus RESUELTO (taxonomía de
// `src/lib/estatus.ts`) — NO es `badge`, que mira presencia sin precedencia;
// los dos conviven y se combinan con AND (la diferencia está fijada por el
// fixture divergente de `inventory.service.test.ts`).
const CAMPOS_QUERY = ["q", "marca", "familia", "producto", "almacen", "tecnologia", "estatus", "divergencia", "badge", "sinV2", "page", "pageSize"] as const;

/** Copy es-MX del chip removible por valor de `badge`. */
const BADGE_LABELS: Record<BadgeCatalogo, string> = {
  sobre_reservado: "Sobre-reservados",
  sin_familia: "Sin familia asignada",
  stock_cero: "Sin stock",
};

/** Arma `/api/inventory?...` reenviando SOLO los params presentes en la URL propia — vía `construirUrlApi` (`@/lib/url-query`, M5: antes duplicado carácter por carácter con `embarques-view.tsx`). */
export function buildInventoryUrl(searchParams: URLSearchParams): string {
  return construirUrlApi("/api/inventory", CAMPOS_QUERY, searchParams);
}

/**
 * Isla client de `/catalogo`: TODO el estado de filtros/paginación/vista
 * vive en la URL (`useSearchParams` como fuente de verdad); los cambios se
 * escriben con `router.replace` (sin ensuciar el historial).
 *
 * (INV-TAXO F2/F3/R1-2 · A1) Las 4 dimensiones de filtro (tecnología,
 * marca, familia, almacén) — tanto el árbol (`CatalogoArbol`) como los
 * `<select>` de `CatalogoFiltros` — se alimentan de UNA sola fuente:
 * `data.facetas`, la MISMA respuesta de `/api/inventory` que ya trae la
 * tabla/grid. Antes había TRES orígenes distintas para las mismas opciones
 * (`data.facetas` para el árbol, `cargarCatalogoCompleto` — ~5 requests
 * propios — para Marca/Tecnología de `CatalogoFiltros`, y un
 * `useApi("/api/familias")` propio de `CatalogoFiltros` para Familia); con
 * `data.facetas` como única fuente, las 4 dimensiones cascadean IGUAL en
 * el árbol y en los selects, y ninguno de los dos hace fetch propio.
 *
 * (CAT-B1 · Tramo C) `producto` es una 5ª dimensión, gemela de `familia`
 * (misma URL→cascada→consulta), pero SOLO vive en el árbol — `CatalogoFiltros`
 * no tiene `<select>` propio para este nivel (decisión de superficie, no un
 * hueco): el árbol ya la hace alcanzable, y solo tiene valores reales bajo
 * `tecnologia=BRAND1`.
 *
 * Chrome persistente (C3) + gate anti-remount (R1-1, docs/engineering/failure-patterns.md
 * (P3)): el componente hace UN solo `return` — todos los estados (loading/
 * error/vacío/data) se resuelven ANTES, en las variables `resultados`/
 * `barra`, dentro del MISMO árbol de JSX. `<CatalogoFiltros>`/
 * `<CatalogoArbol>` quedan así SIEMPRE montados; solo la columna de
 * resultados intercambia contenido. El skeleton de resultados SOLO cubre
 * la carga inicial (`loading && !data`): con `data` ya en mano, un refetch
 * (cambiar de filtro) deja la tabla/grid MONTADA (mismo nodo), marcada
 * `aria-busy` — nunca la reemplaza por el skeleton (antes, `if (loading)`
 * a secas desmontaba la tabla en CADA cambio de filtro mientras
 * `CatalogoArbol`, alimentado por el mismo fetch, seguía montado con
 * `aria-busy`: la misma vista reaccionaba distinto al mismo evento).
 */
export function CatalogoView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // [MVP-2 · frente E, vocabulario] Decisión de producto: KAM/Visitante no ven el
  // vocabulario técnico "clasificación v2" — gatea solo el chip removible
  // de más abajo (`MUESTRA_CLASIFICACION_V2`, `src/lib/roles.ts`); el filtro
  // ?sinV2= en sí sigue aplicándose igual para todos los roles.
  const { rol } = useSesion();
  const mostrarV2 = MUESTRA_CLASIFICACION_V2[rol];

  const q = searchParams.get("q") ?? "";
  const marca = searchParams.get("marca");
  const familia = searchParams.get("familia");
  // [CAT-B1 · Tramo C] ÚLTIMO nivel del árbol (tecnologia ∩ marca ∩ familia) — gemelo de `familia`, mismo criterio.
  const producto = searchParams.get("producto");
  const almacen = searchParams.get("almacen");
  const tecnologia = searchParams.get("tecnologia");
  const estatus = searchParams.get("estatus");
  // Drill-down de solo-lectura (F4): llegan por URL desde el dashboard, sin control propio en esta vista.
  const badge = searchParams.get("badge");
  const divergenciaParam = searchParams.get("divergencia");
  const divergenciaActiva = divergenciaParam === "1" || divergenciaParam === "true";
  const sinV2Param = searchParams.get("sinV2");
  const sinV2Activo = sinV2Param === "1" || sinV2Param === "true";
  const vista = searchParams.get("vista") === "grid" ? "grid" : "lista";

  const apiUrl = buildInventoryUrl(searchParams);
  const { data, error, loading, refetch } = useApi<CatalogoPage>(apiUrl);
  // (R1-2) Única fuente de las 4 dimensiones de filtro — compartida por
  // `CatalogoArbol` (abajo) y `CatalogoFiltros`: NINGUNO de los dos hace
  // fetch propio. `null` antes de la primera carga o tras un error sin
  // data previa (ambos consumidores degradan a "sin opciones data-driven"
  // en ese hueco, igual que antes).
  const facetas = data?.facetas ?? null;

  function navegar(updates: Record<string, string | null>, opts: { resetPage?: boolean } = {}) {
    const qs = aplicarActualizacion(searchParams, updates, opts);
    router.replace(`${pathname}${qs}`, { scroll: false });
  }

  // ------------------------------------------------------------
  // Handlers de las 4 dimensiones del árbol (A1, + producto en CAT-B1 ·
  // Tramo C) + almacén (A4) — COMPARTIDOS con `CatalogoFiltros` (mismo
  // cambio, dos puntos de entrada: el nodo del árbol o el <select>). El
  // nivel elegido resetea los niveles inferiores (cascada): tecnología →
  // resetea marca+familia+producto; marca → resetea familia+producto;
  // familia → resetea producto (el ÚLTIMO nivel, nada debajo que resetear).
  // `badge` es ortogonal EXCEPTO cuando vale 'sin_familia': ese valor es
  // mutuamente excluyente con una `familia` concreta (el árbol lo usa para
  // su nodo "Sin familia asignada", A1), así que elegir una familia real lo
  // limpia.
  // ------------------------------------------------------------
  function handleTecnologia(t: string | null) {
    navegar({ tecnologia: t, marca: null, familia: null, producto: null }, { resetPage: true });
  }
  function handleMarca(m: string | null) {
    navegar({ marca: m, familia: null, producto: null }, { resetPage: true });
  }
  function handleFamilia(f: string | null) {
    const updates: Record<string, string | null> = { familia: f, producto: null };
    if (badge === "sin_familia") updates.badge = null;
    navegar(updates, { resetPage: true });
  }
  function handleSinFamilia() {
    navegar({ familia: null, producto: null, badge: "sin_familia" }, { resetPage: true });
  }
  function handleProducto(p: string | null) {
    navegar({ producto: p }, { resetPage: true });
  }
  function handleAlmacen(a: string | null) {
    navegar({ almacen: a }, { resetPage: true });
  }
  // [2.0.1-A] Ortogonal a la cascada (como almacén): no resetea ningún otro nivel.
  function handleEstatus(e: string | null) {
    navegar({ estatus: e }, { resetPage: true });
  }
  function handleSubmitQ(texto: string) {
    navegar({ q: texto || null }, { resetPage: true });
  }
  function handleLimpiar() {
    router.replace(pathname, { scroll: false });
  }
  function handlePageChange(p: number) {
    navegar({ page: p === 1 ? null : String(p) });
  }
  function handleVista(v: "lista" | "grid") {
    navegar({ vista: v === "lista" ? null : "grid" });
  }

  const filtrosProps = {
    facetas,
    q,
    marca,
    familia,
    almacen,
    tecnologia,
    estatus,
    onSubmitQ: handleSubmitQ,
    onChangeMarca: handleMarca,
    onChangeFamilia: handleFamilia,
    onChangeAlmacen: handleAlmacen,
    onChangeTecnologia: handleTecnologia,
    onChangeEstatus: handleEstatus,
    onLimpiar: handleLimpiar,
  };
  const arbolProps = {
    facetas,
    loading,
    error: Boolean(error),
    onRetry: refetch,
    tecnologiaActiva: tecnologia,
    marcaActiva: marca,
    familiaActiva: familia,
    sinFamiliaActiva: badge === "sin_familia",
    productoActiva: producto,
    onSelectTecnologia: handleTecnologia,
    onSelectMarca: handleMarca,
    onSelectFamilia: handleFamilia,
    onSelectSinFamilia: handleSinFamilia,
    onSelectProducto: handleProducto,
  };

  // [2.0.1-A] `estatus` cuenta como filtro: sin él aquí, `?estatus=` con 0
  // resultados caería al vacío de cold-start («Aún no hay datos… Ir a
  // Snapshots») — una mentira alcanzable desde un <select>, a diferencia de
  // badge/sinV2 que solo llegan por drill-down y quedan fuera a propósito.
  // (Revisión M2: el predicado es UNO, `hayFiltrosDeUsuario`, compartido con
  // el `hasFilters` de la barra — antes eran dos copias negadas.)
  const sinFiltros = !hayFiltrosDeUsuario({ q, marca, familia, almacen, tecnologia, estatus, producto });

  // [VERT-B2] ¿La marca que el usuario tiene puesta es una de las EXCLUIDAS?
  //
  // Se coteja contra `data.excluidos.marcas`, que YA viaja en el contrato: no
  // hace falta campo nuevo, y sobre todo no hace falta un `if (marca ===
  // "VERTICAL")` en el cliente — la lista la decide el dato (`marcas.
  // excluida_del_catalogo`, migración 0039) y la pantalla sólo la lee.
  //
  // Case-insensitive por el mismo motivo que la cascada y el filtro del
  // servicio: `marca` viene CRUDA de la URL y `?marca=vertical` es alcanzable
  // a mano.
  const marcaExcluidaActiva = Boolean(
    marca && data?.excluidos.marcas.some((m) => m.toLowerCase() === marca.toLowerCase()),
  );

  // ------------------------------------------------------------
  // Todos los estados (loading/error/vacío/data) se resuelven en variables
  // ANTES del único `return` de abajo — así `<CatalogoFiltros>`/
  // `<CatalogoArbol>` (declarados una sola vez, más abajo) nunca se
  // desmontan al cambiar de estado. Solo `resultados` (columna derecha) y
  // `barra` (conteo + toggle Lista/Grid, solo cuando hay datos) cambian de
  // contenido.
  //
  // GATE ANTI-REMOUNT (R1-1, docs/engineering/failure-patterns.md (P3)): `error`/`!data`
  // deciden ANTES que `loading` — con `data` ya en mano, `useApi` mantiene
  // ese `data` durante todo el refetch (`loading=true` sin vaciarlo, ver
  // `use-api.ts`), así que ninguna rama de aquí abajo vuelve a mirar
  // `loading` a secas: solo decide el esqueleto cuando TODAVÍA no hay
  // `data` que mostrar (`!data`, que cubre tanto la primera carga con
  // `loading=true` como el defensivo sin loading/error). Con `data`
  // presente, la rama final pasa `loading` como `ariaBusy` a la tabla en
  // vez de desmontarla — mismo patrón que `CatalogoArbol`/`EmbarquesTabla`.
  // ------------------------------------------------------------
  let resultados: ReactNode;
  let barra: ReactNode = null;

  if (error && !data) {
    resultados = <EstadoError mensaje={error.message} onRetry={refetch} />;
  } else if (!data) {
    // `loading && !data` (primera carga) o defensivo (sin loading/error,
    // `useApi` siempre trae `data`) — ambos casos muestran el mismo esqueleto.
    resultados = <CatalogoResultadosSkeleton />;
  } else if (data.total === 0 && sinFiltros) {
    resultados = (
      <EstadoVacio
        titulo="Aún no hay datos de inventario cargados."
        descripcion="Cuando corra la primera ingesta, el catálogo aparecerá aquí."
        cta={
          <Button variant="outline" asChild>
            <Link href="/snapshots">Ir a Snapshots</Link>
          </Button>
        }
      />
    );
  } else if (data.total === 0 && !sinFiltros) {
    // [VERT-B2] EL VACÍO TIENE QUE DECIR POR QUÉ ESTÁ VACÍO.
    //
    // Con una liga guardada `?marca=VERTICAL` el copy genérico —«Ningún SKU
    // coincide con los filtros actuales»— es verdadero y es INÚTIL: sugiere
    // que el filtro no encontró nada, cuando lo que pasó es que una regla
    // escondió la marca entera. Y desde que la anti-trampa dejó de reinyectar
    // lo excluido, el árbol ya no pinta el nodo que antes daba la pista falsa:
    // si esta rama no lo explica, no lo explica nadie.
    resultados = marcaExcluidaActiva ? (
      <EstadoVacio
        titulo={`${marca} no se lista en el catálogo`}
        descripcion="Es una regla de marca, no un filtro sin resultados: sus SKU siguen en la base y en la ingesta; lo que se excluye es la vista del catálogo."
        cta={
          <Button variant="outline" onClick={() => handleMarca(null)}>
            Quitar el filtro de marca
          </Button>
        }
      />
    ) : (
      <EstadoVacio
        titulo="Sin resultados"
        descripcion="Ningún SKU coincide con los filtros actuales."
        cta={
          <Button variant="outline" onClick={handleLimpiar}>
            Limpiar filtros
          </Button>
        }
      />
    );
  } else {
    const fueraDeRango = data.items.length === 0 && data.total > 0;

    barra = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">{formatoNumero(data.total)} resultados</p>
        <div role="group" aria-label="Vista" className="flex items-center gap-[3px] rounded-[9px] bg-surface-3 p-[3px]">
          <button
            type="button"
            aria-pressed={vista === "lista"}
            onClick={() => handleVista("lista")}
            className={cn(
              "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px] font-semibold text-ink-muted",
              vista === "lista" && "bg-surface text-ink shadow-sm",
            )}
          >
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            Lista
          </button>
          <button
            type="button"
            aria-pressed={vista === "grid"}
            onClick={() => handleVista("grid")}
            className={cn(
              "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px] font-semibold text-ink-muted",
              vista === "grid" && "bg-surface text-ink shadow-sm",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Grid
          </button>
        </div>
      </div>
    );

    resultados = fueraDeRango ? (
      <EstadoVacio
        titulo="Sin resultados en esta página"
        cta={
          <Button variant="outline" onClick={() => handlePageChange(1)}>
            Ir a la página 1
          </Button>
        }
      />
    ) : (
      <>
        {vista === "lista" ? (
          <CatalogoTabla items={data.items} ariaBusy={loading} />
        ) : (
          <CatalogoGrid items={data.items} ariaBusy={loading} />
        )}
        <Paginacion page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={handlePageChange} />
      </>
    );
  }

  // A4: chips de filtro activo por dimensión (tecnología, marca, familia,
  // producto — CAT-B1 · Tramo C —, almacén) + los ya existentes de
  // drill-down (badge/sinV2, F4) — todos comparten `ChipFiltroActivo`
  // (`src/components/shared`), cada uno refleja el estado real de la URL y
  // se puede quitar individualmente.
  const hayChips = Boolean(
    tecnologia || marca || familia || producto || almacen || estatus || divergenciaActiva || badge || (sinV2Activo && mostrarV2),
  );

  return (
    <div className="flex flex-col gap-4">
      {barra}
      <CatalogoFiltros {...filtrosProps} />
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <CatalogoArbol {...arbolProps} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* [VERT-B2] LA DECLARACIÓN DE LO ESCONDIDO.

              VA AQUÍ Y NO JUNTO AL CONTEO, y las dos razones se midieron:

              (1) `barra` —donde vive «N resultados»— es `null` en CUATRO de las
                  cinco ramas de estado, incluidas las dos de total 0. O sea que
                  la declaración desaparecería justo cuando es la explicación
                  completa. Este contenedor se renderiza siempre.

              (2) La frase es ABSOLUTA a propósito: «N SKU no se listan», nunca
                  «N resultados · M excluidos». `data.total` es el universo
                  FILTRADO y `excluidos.total` es el corte ENTERO —constante bajo
                  cualquier filtro—, así que soldarlos en una línea nombraría un
                  numerador y un denominador que con `?marca=BRAND1` no comparten
                  NI UNA FILA. Es la regla #3 de la casa: nombrar el denominador.
                  Dicha así, la línea sigue siendo verdadera con cualquier filtro
                  puesto, porque nunca prometió hablar del filtro. */}
          {data && data.excluidos.total > 0 && (
            <details className="group rounded-[10px] bg-surface-3 px-3 py-2 text-[12.5px] leading-snug text-ink-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong className="font-semibold text-ink">{formatoNumero(data.excluidos.total)} SKU</strong> no se
                  listan en el catálogo por regla de marca
                </span>
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
                <span className="sr-only">ver el detalle</span>
              </summary>
              <p className="mt-1.5 pl-5">
                <strong className="font-semibold text-ink">{data.excluidos.marcas.join(" · ")}</strong> — el dato entra
                completo por la ingesta y sigue en la base; lo que se excluye es la <em>vista</em> del catálogo. La
                regla es un dato, no código: se enciende y se apaga sin desplegar.
              </p>
            </details>
          )}
          {hayChips && (
            <div className="flex flex-wrap items-center gap-2">
              {tecnologia && (
                <ChipFiltroActivo
                  label={tecnologia === SIN_TECNOLOGIA ? "Sin tecnología" : `Tecnología: ${tecnologia}`}
                  onClear={() => handleTecnologia(null)}
                />
              )}
              {marca && <ChipFiltroActivo label={`Marca: ${marca}`} onClear={() => handleMarca(null)} />}
              {familia && <ChipFiltroActivo label={`Familia: ${familia}`} onClear={() => handleFamilia(null)} />}
              {producto && <ChipFiltroActivo label={`Producto: ${producto}`} onClear={() => handleProducto(null)} />}
              {almacen && <ChipFiltroActivo label={`Almacén: ${almacen}`} onClear={() => handleAlmacen(null)} />}
              {estatus && (
                <ChipFiltroActivo
                  // El label sale de la MISMA taxonomía que el <select> y la
                  // pastilla; una clave desconocida en la URL se muestra cruda
                  // (la API ya la habrá rechazado con invalid_query).
                  label={`Estatus: ${TAXONOMIA_ESTATUS.find((e) => e.clave === estatus)?.label ?? estatus}`}
                  onClear={() => handleEstatus(null)}
                />
              )}
              {badge && (
                <ChipFiltroActivo
                  label={BADGE_LABELS[badge as BadgeCatalogo] ?? badge}
                  onClear={() => navegar({ badge: null }, { resetPage: true })}
                />
              )}
              {/* [MVP-2 · frente E] Se ELIGIÓ no pintar el chip para no-admin (en vez de
                  una etiqueta neutra): el filtro sigue aplicándose (arriba, pass-through
                  puro), pero ya no queda ningún enlace en la UI que lleve a un no-admin
                  hasta acá (el sub-enlace del dashboard también se quitó, ver
                  dashboard-kpis.tsx) — inventar copy nuevo solo para una URL escrita a
                  mano sería superficie que nadie pidió. "Limpiar filtros" (siempre
                  montado en CatalogoFiltros) sigue disponible para quitarlo. */}
              {/* [2.0.1-A · D3] SIN gate de rol, a diferencia del chip de sinV2:
                  este copy no nombra la jerga v2, y gatearlo dejaría la
                  divergencia silenciosa justo para el KAM que enseña la
                  pantalla — que es lo que se puso como no negociable. */}
              {divergenciaActiva && (
                <ChipFiltroActivo
                  label="Familia distinta a la del archivo"
                  onClear={() => navegar({ divergencia: null }, { resetPage: true })}
                />
              )}
              {sinV2Activo && mostrarV2 && (
                <ChipFiltroActivo label="Sin clasificación v2" onClear={() => navegar({ sinV2: null }, { resetPage: true })} />
              )}
            </div>
          )}
          {resultados}
        </div>
      </div>
    </div>
  );
}
