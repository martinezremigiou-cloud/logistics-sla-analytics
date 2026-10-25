"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENTIDAD_LABELS, TIPO_LABELS } from "./snapshots-formato";
import type { CambioItem } from "@/types/api";

type Entidad = CambioItem["entidad"];
type Tipo = CambioItem["tipo"];

export interface CambiosFiltrosProps {
  sku: string | null;
  entidad: Entidad | null;
  tipo: Tipo | null;
  onSubmitSku: (sku: string) => void;
  onChangeEntidad: (entidad: Entidad | null) => void;
  onChangeTipo: (tipo: Tipo | null) => void;
  onLimpiar: () => void;
}

const ENTIDAD_VALORES: Entidad[] = ["producto", "stock", "reserva", "embarque"];
const TIPO_VALORES: Tipo[] = ["ALTA", "BAJA", "MODIFICACION"];

/**
 * Filtros del detalle de un snapshot (`/snapshots/[id]`): buscador de SKU
 * (por submit, no en vivo — `sku` es una igualdad EXACTA en el contrato,
 * no una búsqueda de texto libre, así que no tiene sentido refetchear en
 * cada tecla) + selects de entidad/tipo (inmediatos). 100% presentacional
 * — el estado real vive en `CambiosView`. Siempre montado por el caller
 * (chrome persistente, FIX-RESET): este componente nunca decide si se
 * muestra o no.
 */
export function CambiosFiltros({ sku, entidad, tipo, onSubmitSku, onChangeEntidad, onChangeTipo, onLimpiar }: CambiosFiltrosProps) {
  const [texto, setTexto] = useState(sku ?? "");
  // Si `sku` cambia desde afuera (chip removido, "Limpiar filtros"), el input local se resincroniza.
  useEffect(() => setTexto(sku ?? ""), [sku]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmitSku(texto.trim());
  }

  const hasFilters = Boolean(sku || entidad || tipo);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <form onSubmit={handleSubmit} className="relative w-full max-w-[240px]">
        <label htmlFor="cambios-filtro-sku" className="sr-only">
          Buscar por SKU
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <Input
          id="cambios-filtro-sku"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por SKU exacto…"
          className="h-9 rounded-[9px] border-line bg-surface-input pl-8 text-[13px]"
        />
      </form>

      <label className="sr-only" htmlFor="cambios-filtro-entidad">
        Entidad
      </label>
      <select
        id="cambios-filtro-entidad"
        value={entidad ?? ""}
        onChange={(e) => onChangeEntidad(e.target.value === "" ? null : (e.target.value as Entidad))}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Entidad: todas</option>
        {ENTIDAD_VALORES.map((v) => (
          <option key={v} value={v}>
            {ENTIDAD_LABELS[v]}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="cambios-filtro-tipo">
        Tipo
      </label>
      <select
        id="cambios-filtro-tipo"
        value={tipo ?? ""}
        onChange={(e) => onChangeTipo(e.target.value === "" ? null : (e.target.value as Tipo))}
        className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
      >
        <option value="">Tipo: todos</option>
        {TIPO_VALORES.map((v) => (
          <option key={v} value={v}>
            {TIPO_LABELS[v]}
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
