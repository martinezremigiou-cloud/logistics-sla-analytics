"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { TAXONOMIA_ESTATUS } from "@/lib/estatus";
import { hayFiltrosDeUsuario } from "@/lib/url-query";
import type { CatalogoFacetas } from "@/types/api";

interface CatalogoFiltrosProps {
  /**
   * (INV-TAXO F3 · R1-2) Facetas EN CASCADA — la MISMA fuente que
   * alimenta a `CatalogoArbol` (`data.facetas` de `/api/inventory`, ver
   * `catalogo-view.tsx`): las 4 dimensiones de este componente (Marca,
   * Familia, Almacén, Tecnología) se leen de aquí, SIN fetch propio.
   * Antes había TRES orígenes para las mismas opciones: `data.facetas`
   * para el árbol, `cargarCatalogoCompleto` (~5 requests propios) para
   * Marca/Tecnología, y un `useApi("/api/familias")` propio de este
   * componente para Familia — ninguno de los tres reaccionaba igual a la
   * cascada del árbol. `null` antes de la primera carga o tras un error
   * sin data previa: los 4 `<select>` quedan sin más opción que la fija
   * ("todas"/"Sin tecnología"), igual que el árbol degrada a su skeleton.
   *
   * REGLA ANTI-TRAMPA (heredada del contrato, `CatalogoFacetas` en
   * types/api.ts): el valor actualmente seleccionado viaja SIEMPRE en su
   * faceta aunque, tras la cascada, su conteo caiga a 0 — este componente
   * NUNCA filtra por conteo, solo renderiza `facetas.*` tal cual llega,
   * así el usuario nunca queda atrapado sin poder volver a "todas".
   *
   * 🔴 [VERT-B2] ESE «SIEMPRE» DEJÓ DE SER CIERTO, y hay que decirlo aquí
   * porque este doc-comment se apoyaba en él: desde VERT-B2 el servicio NO
   * reinyecta un valor que exista únicamente en la población EXCLUIDA del
   * catálogo (`marcas.excluida_del_catalogo`) — si lo hiciera, el árbol
   * repintaría «VERTICAL (0)» sobre una rejilla vacía.
   *
   * Consecuencia para ESTE componente, que es la que importa: con
   * `?marca=VERTICAL` el valor activo YA NO está entre las opciones, y un
   * `<select>` controlado cuyo `value` no casa con ninguna `<option>` se
   * pinta EN BLANCO — contradiciendo al chip «Marca: VERTICAL» que sí sigue
   * puesto. Por eso la garantía de «nunca atrapado» pasa a sostenerla este
   * componente por su cuenta (ver `marcaFueraDeFaceta` abajo) en vez de
   * heredarla del contrato.
   */
  facetas: CatalogoFacetas | null;
  q: string;
  marca: string | null;
  familia: string | null;
  almacen: string | null;
  tecnologia: string | null;
  /**
   * [2.0.1-A] Clave de estatus activa (`?estatus=`), o null. A diferencia
   * de las 4 dimensiones de arriba, sus opciones NO vienen de `facetas`:
   * son la taxonomía FIJA de `TAXONOMIA_ESTATUS` (`src/lib/estatus.ts`) —
   * la misma data que resuelve la pastilla del renglón, así que un estatus
   * nuevo aparece aquí solo, sin editar este componente. Al no depender
   * del universo, la regla anti-trampa no le hace falta: sus opciones no
   * pueden desaparecer tras una cascada.
   */
  estatus: string | null;
  onSubmitQ: (q: string) => void;
  onChangeMarca: (marca: string | null) => void;
  onChangeFamilia: (familia: string | null) => void;
  onChangeAlmacen: (almacen: string | null) => void;
  onChangeTecnologia: (tecnologia: string | null) => void;
  onChangeEstatus: (estatus: string | null) => void;
  onLimpiar: () => void;
}

/** Fila de filtros del catálogo: 100% presentacional, el estado real vive en `catalogo-view.tsx` (URL + `data.facetas`). */
export function CatalogoFiltros(props: CatalogoFiltrosProps) {
  const {
    facetas,
    q,
    marca,
    familia,
    almacen,
    tecnologia,
    estatus,
    onSubmitQ,
    onChangeMarca,
    onChangeFamilia,
    onChangeAlmacen,
    onChangeTecnologia,
    onChangeEstatus,
    onLimpiar,
  } = props;
  const marcas = facetas?.marcas ?? [];
  // [VERT-B2] La marca activa que el servicio ya NO reinyecta (ver el
  // doc-comment de `facetas`). Se exige `facetas !== null` a propósito: antes
  // de la primera carga las listas están vacías y TODO valor parecería estar
  // fuera — esa rama degrada a los `<select>` sin opciones y no es este caso.
  const marcaFueraDeFaceta =
    facetas !== null && marca !== null && marca !== "" && !marcas.some((m) => m.valor.toLowerCase() === marca.toLowerCase());
  const familias = facetas?.familias ?? [];
  const almacenes = facetas?.almacenes ?? [];
  const tecnologias = facetas?.tecnologias ?? [];
  // (Revisión M2) El MISMO predicado que decide `sinFiltros` en la vista —
  // una sola verdad para «¿hay filtros de usuario activos?».
  const hasFilters = hayFiltrosDeUsuario({ q, marca, familia, almacen, tecnologia, estatus });

  const [texto, setTexto] = useState(q);
  // Si `q` cambia desde afuera (topbar, "Limpiar filtros", navegación), el input local se resincroniza.
  useEffect(() => setTexto(q), [q]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmitQ(texto.trim());
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <form onSubmit={handleSubmit} className="relative w-full max-w-[280px]">
        <label htmlFor="catalogo-filtro-q" className="sr-only">
          Buscar en el catálogo
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <Input
          id="catalogo-filtro-q"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar SKU o descripción…"
          className="h-9 rounded-[9px] border-line bg-surface-input pl-8 text-[13px]"
        />
      </form>

      <label className="sr-only" htmlFor="catalogo-filtro-marca">
        Marca
      </label>
      <select
        id="catalogo-filtro-marca"
        value={marca ?? ""}
        onChange={(e) => onChangeMarca(e.target.value === "" ? null : e.target.value)}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Marca: todas</option>
        {/* El control tiene que reflejar el ESTADO; el árbol ofrece DÓNDE SE
            PUEDE IR. Son trabajos distintos, y por eso la marca excluida vuelve
            aquí —rotulada, no disimulada— y no vuelve al árbol. Sin esto el
            `<select>` se pintaría en blanco con el chip puesto. */}
        {marcaFueraDeFaceta && <option value={marca}>{marca} — fuera del catálogo</option>}
        {marcas.map((m) => (
          <option key={m.valor} value={m.valor}>
            {m.valor}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="catalogo-filtro-familia">
        Familia
      </label>
      <select
        id="catalogo-filtro-familia"
        value={familia ?? ""}
        onChange={(e) => onChangeFamilia(e.target.value === "" ? null : e.target.value)}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Familia: todas</option>
        {familias.map((f) => (
          <option key={f.valor} value={f.valor}>
            {f.valor}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="catalogo-filtro-almacen">
        Almacén
      </label>
      <select
        id="catalogo-filtro-almacen"
        value={almacen ?? ""}
        onChange={(e) => onChangeAlmacen(e.target.value === "" ? null : e.target.value)}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Almacén: todos</option>
        {almacenes.map((a) => (
          <option key={a.valor} value={a.valor}>
            {a.valor}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="catalogo-filtro-tecnologia">
        Tecnología
      </label>
      <select
        id="catalogo-filtro-tecnologia"
        value={tecnologia ?? ""}
        onChange={(e) => onChangeTecnologia(e.target.value === "" ? null : e.target.value)}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Tecnología: todas</option>
        {tecnologias.map((t) => (
          <option key={t.valor} value={t.valor}>
            {t.valor}
          </option>
        ))}
        <option value={SIN_TECNOLOGIA}>Sin tecnología</option>
      </select>

      <label className="sr-only" htmlFor="catalogo-filtro-estatus">
        Estatus
      </label>
      <select
        id="catalogo-filtro-estatus"
        value={estatus ?? ""}
        onChange={(e) => onChangeEstatus(e.target.value === "" ? null : e.target.value)}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Estatus: todos</option>
        {TAXONOMIA_ESTATUS.map((e) => (
          <option key={e.clave} value={e.clave}>
            {e.label}
          </option>
        ))}
      </select>

      {hasFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={onLimpiar} className="text-brand hover:text-brand">
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
