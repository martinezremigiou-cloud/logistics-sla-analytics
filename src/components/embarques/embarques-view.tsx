"use client";

// ============================================================
// Bloque 7-A · Libro Mayor · embarques-view.tsx
// Isla client de `/embarques`: TODO el estado (filtros/orden/paginación)
// vive en la URL (`useSearchParams` como fuente de verdad, `router.replace`
// para escribir) — molde: `src/components/catalogo/catalogo-view.tsx`
// (`buildInventoryUrl`/`aplicarActualizacion` con skip-empty) y
// `src/components/config/config-usuarios.tsx` (gate de chrome persistente
// `loading && !data` / `data && <... aria-busy>`, ver docs/engineering/failure-patterns.md (P3)).
//
// REGLA DURA DEL BLOQUE: sin querystring, `ambito` cae al default del
// backend ('todos') → todas las filas (activas + histórico). Este componente NO
// filtra nada del lado del cliente: lo que se ve es exactamente lo que
// regresa `/api/embarques` para el querystring actual.
// ============================================================
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { ChipFiltroActivo } from "@/components/shared/chip-filtro-activo";
import { Button } from "@/components/ui/button";
import { Paginacion } from "@/components/catalogo/paginacion";
import { formatoNumero } from "@/lib/formato";
import { construirUrlApi, aplicarActualizacion } from "@/lib/url-query";
import { EmbarquesFiltros, FECHA_CAMPO_LABEL, type Ambito, type ConteosAmbito, type FechaCampo } from "./embarques-filtros";
import { EmbarquesTabla } from "./embarques-tabla";
import { EmbarquesResultadosSkeleton } from "./embarques-skeleton";
import type { EmbarquesResponse } from "@/types/api";

const CAMPOS_QUERY = [
  "q",
  "ambito",
  "estatus",
  "pais",
  "retrasado",
  "fechaCampo",
  "desde",
  "hasta",
  "orden",
  "dir",
  "page",
  "pageSize",
] as const;

/** Arma `/api/embarques?...` reenviando SOLO los params presentes en la URL propia (skip-empty: un `q=` vacío responde 400) — vía `construirUrlApi` (`@/lib/url-query`, M5: antes duplicado carácter por carácter con `catalogo-view.tsx`). */
export function buildEmbarquesApiUrl(searchParams: URLSearchParams): string {
  return construirUrlApi("/api/embarques", CAMPOS_QUERY, searchParams);
}

type OrdenKey = "recientes" | "eta_asc" | "piezas_desc";

/**
 * 3 presets curados de `orden`+`dir` (el contrato permite más
 * combinaciones; la UI solo ofrece estas). Un deep-link con otra
 * combinación cae visualmente a "Más recientes" SIN tocar la URL (el
 * request real sigue honrando `orden`/`dir` tal cual — esto solo decide
 * qué opción del select aparece marcada).
 *
 * `dir` se revisa TAMBIÉN para `piezas` (fix B12, ronda 2 de
 * revisor-codigo): antes `orden=piezas` con CUALQUIER `dir` — incluido
 * `asc` — se rotulaba "Piezas: mayor a menor", aunque los datos vinieran
 * ascendentes. No existe preset "piezas asc" en el select: `?orden=piezas&
 * dir=asc` cae a "recientes", igual que cualquier otra combinación no
 * curada.
 */
function ordenKeyDesdeUrl(orden: string | null, dir: string | null): OrdenKey {
  if (orden === "piezas" && dir !== "asc") return "piezas_desc";
  if (orden === "eta" && dir === "asc") return "eta_asc";
  return "recientes";
}

function esAmbito(v: string | null): v is Ambito {
  return v === "todos" || v === "activos" || v === "historial";
}
function esFechaCampo(v: string | null): v is FechaCampo {
  return v === "etd" || v === "eta" || v === "llegada";
}

/** Copy del chip removible del rango de fecha activo (panel "Más filtros"). */
function etiquetaRangoFecha(campo: FechaCampo, desde: string | null, hasta: string | null): string {
  const nombre = FECHA_CAMPO_LABEL[campo];
  if (desde !== null && hasta !== null) return `${nombre}: ${desde} – ${hasta}`;
  if (desde !== null) return `${nombre}: desde ${desde}`;
  return `${nombre}: hasta ${hasta}`;
}

export function EmbarquesView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const q = searchParams.get("q") ?? "";
  const ambitoParam = searchParams.get("ambito");
  const ambito: Ambito = esAmbito(ambitoParam) ? ambitoParam : "todos";

  const estatusParam = searchParams.get("estatus");
  const estatusNum = estatusParam !== null ? Number(estatusParam) : NaN;
  const estatus = Number.isInteger(estatusNum) && estatusNum >= 1 && estatusNum <= 11 ? estatusNum : null;

  const pais = searchParams.get("pais");

  const retrasadoParam = searchParams.get("retrasado");
  const retrasado = retrasadoParam === "1" || retrasadoParam === "true";

  const fechaCampoParam = searchParams.get("fechaCampo");
  const fechaCampo: FechaCampo = esFechaCampo(fechaCampoParam) ? fechaCampoParam : "eta";

  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  // Guard M8 (revisor-codigo, ronda 2): un rango invertido (desde > hasta)
  // es 400 en el backend (`rango_invertido`, embarques.schema.ts). Sin este
  // guard, `useApi` disparaba la request igual, el fetch fallaba y la
  // TABLA ENTERA desaparecía detrás de un `EstadoError` genérico con un
  // "Reintentar" que repetiría el mismo 400 para siempre (el error depende
  // de la URL, nunca de la red). Comparación lexicográfica: ambos son
  // `'YYYY-MM-DD'` de ancho fijo, así que coincide con el orden cronológico
  // (mismo criterio que `embarquesQuerySchema.superRefine`).
  const rangoFechaInvalido = desde !== null && hasta !== null && desde > hasta;

  const ordenKey = ordenKeyDesdeUrl(searchParams.get("orden"), searchParams.get("dir"));

  const computedApiUrl = buildEmbarquesApiUrl(searchParams);
  // La URL que alimenta a `useApi` se CONGELA en el último valor VÁLIDO
  // mientras `rangoFechaInvalido` sea true: como el string de `apiUrl` no
  // cambia, `useApi` no reintenta el fetch y `data`/`error`/`loading` se
  // quedan exactamente como estaban — la tabla (si ya había una) permanece
  // montada con sus datos previos en vez de vaciarse.
  const [apiUrl, setApiUrl] = useState<string | null>(rangoFechaInvalido ? null : computedApiUrl);
  useEffect(() => {
    if (!rangoFechaInvalido) setApiUrl(computedApiUrl);
  }, [rangoFechaInvalido, computedApiUrl]);

  const { data, error, loading, refetch } = useApi<EmbarquesResponse>(apiUrl);

  // A3 (revisor-codigo, ronda 2): las 3 tabs se alimentan de
  // `facetas.ambito` (universo del snapshot, nunca reacciona a filtros —
  // ver types/api.ts) en vez de un segundo fetch auxiliar `?pageSize=1`
  // que antes repetía el pipeline COMPLETO de `listEmbarques` (resolveVigente
  // + 3 fetchAllRows + resolverClasificacion sobre todo el catálogo) solo
  // para leer 3 enteros, y que además descartaba silenciosamente su propio
  // `error`/`loading` (si fallaba, las tabs quedaban sin conteo para
  // siempre, sin reintento ni rastro).
  const conteos: ConteosAmbito = {
    todos: data?.facetas.ambito.todos ?? null,
    activos: data?.facetas.ambito.activos ?? null,
    historial: data?.facetas.ambito.historial ?? null,
  };

  function navegar(updates: Record<string, string | null>, opts: { resetPage?: boolean } = {}) {
    const qs = aplicarActualizacion(searchParams, updates, opts);
    router.replace(`${pathname}${qs}`, { scroll: false });
  }

  function handleChangeAmbito(a: Ambito) {
    navegar({ ambito: a === "todos" ? null : a }, { resetPage: true });
  }
  function handleSubmitQ(texto: string) {
    navegar({ q: texto || null }, { resetPage: true });
  }
  function handleChangeEstatus(e: number | null) {
    navegar({ estatus: e === null ? null : String(e) }, { resetPage: true });
  }
  function handleToggleRetrasado() {
    navegar({ retrasado: retrasado ? null : "1" }, { resetPage: true });
  }
  function handleChangePais(p: string | null) {
    navegar({ pais: p }, { resetPage: true });
  }
  function handleChangeFechaCampo(campo: FechaCampo) {
    navegar({ fechaCampo: campo === "eta" ? null : campo }, { resetPage: true });
  }
  function handleChangeDesde(v: string | null) {
    navegar({ desde: v }, { resetPage: true });
  }
  function handleChangeHasta(v: string | null) {
    navegar({ hasta: v }, { resetPage: true });
  }
  function handleChangeOrden(key: OrdenKey) {
    if (key === "eta_asc") navegar({ orden: null, dir: "asc" }, { resetPage: true });
    else if (key === "piezas_desc") navegar({ orden: "piezas", dir: null }, { resetPage: true });
    else navegar({ orden: null, dir: null }, { resetPage: true });
  }
  function handlePageChange(p: number) {
    navegar({ page: p === 1 ? null : String(p) });
  }
  function limpiarPais() {
    navegar({ pais: null }, { resetPage: true });
  }
  function limpiarRangoFecha() {
    navegar({ desde: null, hasta: null }, { resetPage: true });
  }
  function handleLimpiarTodo() {
    router.replace(pathname, { scroll: false });
  }

  const sinFiltros = !q && ambito === "todos" && estatus === null && pais === null && !retrasado && desde === null && hasta === null;

  // ------------------------------------------------------------
  // Chrome persistente: `<EmbarquesFiltros>` (declarada una sola vez, en el
  // único `return` de abajo) NUNCA se desmonta. Gate estricto (P3 de
  // docs/engineering/failure-patterns.md, FIX C de config-usuarios.tsx): el skeleton
  // SOLO cubre la carga inicial (`loading && !data`); con `data` ya en mano,
  // un refetch (cambiar de tab/filtro/página) deja la tabla MONTADA con
  // `aria-busy`, nunca la reemplaza por el skeleton.
  // ------------------------------------------------------------
  // B11 (revisor-codigo, ronda 2): `barra` ("N resultados" + "Ordenar por")
  // se computa condicionada SOLO a `data` — antes vivía dentro de la rama
  // "con resultados" de abajo y se desmontaba en cold-start/vacío/fuera-de-
  // rango. El caso más útil: en "fuera de rango" (página vacía con
  // total>0) ahora se puede reordenar de inmediato, sin tener que volver
  // primero a la página 1 solo para recuperar el control.
  const barra: ReactNode = data ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-muted-foreground">{formatoNumero(data.total)} resultados</p>
      <div className="flex items-center gap-1.5">
        <label htmlFor="embarques-orden" className="text-[12px] text-ink-muted">
          Ordenar por
        </label>
        <select
          id="embarques-orden"
          value={ordenKey}
          onChange={(e) => handleChangeOrden(e.target.value as OrdenKey)}
          className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
        >
          <option value="recientes">Más recientes</option>
          <option value="eta_asc">ETA próxima</option>
          <option value="piezas_desc">Piezas: mayor a menor</option>
        </select>
      </div>
    </div>
  ) : null;

  let resultados: ReactNode;

  if (rangoFechaInvalido && !data) {
    // Deep-link con rango ya invertido desde el arranque: nunca hubo un
    // fetch exitoso que "conservar" (ver guard M8 arriba). La validación
    // inline junto a los inputs de fecha (`EmbarquesFiltros`) ya explica el
    // porqué; aquí solo se evita mostrar un skeleton que nunca resolvería.
    resultados = (
      <EstadoVacio
        titulo="Corrige el rango de fechas"
        descripcion="La fecha “Desde” debe ser anterior o igual a “Hasta” para poder mostrar resultados."
      />
    );
  } else if (loading && !data) {
    resultados = <EmbarquesResultadosSkeleton />;
  } else if (error && !data) {
    resultados = <EstadoError mensaje={error.message} onRetry={refetch} />;
  } else if (data) {
    const coldStart = data.snapshot === null || (data.total === 0 && sinFiltros);
    const vacioFiltrado = !coldStart && data.total === 0;
    const fueraDeRango = !coldStart && !vacioFiltrado && data.items.length === 0 && data.total > 0;

    if (coldStart) {
      resultados = (
        <EstadoVacio
          titulo="Aún no hay embarques cargados."
          descripcion="Cuando corra la primera ingesta de aduana, el libro de embarques aparecerá aquí."
          cta={
            <Button variant="outline" asChild>
              <Link href="/snapshots">Ir a Snapshots</Link>
            </Button>
          }
        />
      );
    } else if (vacioFiltrado) {
      resultados = (
        <EstadoVacio
          titulo="Sin resultados"
          descripcion="Ningún embarque coincide con los filtros actuales."
          cta={
            <Button variant="outline" onClick={handleLimpiarTodo}>
              Limpiar filtros
            </Button>
          }
        />
      );
    } else if (fueraDeRango) {
      resultados = (
        <EstadoVacio
          titulo="Sin resultados en esta página"
          cta={
            <Button variant="outline" onClick={() => handlePageChange(1)}>
              Ir a la página 1
            </Button>
          }
        />
      );
    } else {
      resultados = (
        <>
          <EmbarquesTabla items={data.items} ariaBusy={loading} />
          <Paginacion page={data.page} totalPages={data.totalPages} total={data.total} onPageChange={handlePageChange} />
        </>
      );
    }
  } else {
    // Defensivo: sin loading/error, `useApi` siempre trae `data` (mismo criterio que CatalogoView).
    resultados = <EmbarquesResultadosSkeleton />;
  }

  return (
    <div className="flex flex-col gap-4">
      <EmbarquesFiltros
        ambito={ambito}
        onChangeAmbito={handleChangeAmbito}
        conteos={conteos}
        q={q}
        onSubmitQ={handleSubmitQ}
        estatus={estatus}
        facetasEstatus={data?.facetas.estatus ?? []}
        onChangeEstatus={handleChangeEstatus}
        retrasado={retrasado}
        onToggleRetrasado={handleToggleRetrasado}
        pais={pais}
        facetasPaises={data?.facetas.paises ?? []}
        onChangePais={handleChangePais}
        fechaCampo={fechaCampo}
        onChangeFechaCampo={handleChangeFechaCampo}
        desde={desde}
        onChangeDesde={handleChangeDesde}
        hasta={hasta}
        onChangeHasta={handleChangeHasta}
        rangoFechaInvalido={rangoFechaInvalido}
      />

      {(pais !== null || desde !== null || hasta !== null) && (
        <div className="flex flex-wrap items-center gap-2">
          {pais !== null && <ChipFiltroActivo label={`País: ${pais}`} onClear={limpiarPais} />}
          {(desde !== null || hasta !== null) && (
            <ChipFiltroActivo label={etiquetaRangoFecha(fechaCampo, desde, hasta)} onClear={limpiarRangoFecha} />
          )}
        </div>
      )}

      {barra}
      {resultados}
    </div>
  );
}
