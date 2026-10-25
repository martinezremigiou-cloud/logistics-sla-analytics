"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Menu, PanelLeft, PanelLeftClose, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FreshnessIndicator } from "@/components/layout/freshness-indicator";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Campana } from "@/components/campana/campana";

interface TopbarProps {
  onMenuClick: () => void;
  /** Estado del sidebar de escritorio (ver app-shell.tsx / sidebar-colapso.ts). */
  colapsado: boolean;
  onToggleColapsado: () => void;
}

export function Topbar({ onMenuClick, colapsado, onToggleColapsado }: TopbarProps) {
  const router = useRouter();
  const [term, setTerm] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = term.trim();
    router.push(trimmed ? `/catalogo?q=${encodeURIComponent(trimmed)}` : "/catalogo");
  }

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2.5 border-b border-line-top bg-surface px-[clamp(14px,2.5vw,22px)] py-[11px]">
      <Button variant="outline" size="icon" className="md:hidden" aria-label="Abrir menú" onClick={onMenuClick}>
        <Menu className="h-4 w-4" />
      </Button>

      {/* Control de ocultar/mostrar del sidebar — solo desktop; el móvil ya
          tiene su propio <Sheet> (botón de arriba), no se duplica el
          mecanismo. Vive aquí (no dentro del sidebar) para no consumir su
          presupuesto vertical. */}
      <Button
        variant="outline"
        size="icon"
        className="hidden md:flex"
        aria-label={colapsado ? "Mostrar barra lateral" : "Ocultar barra lateral"}
        aria-expanded={!colapsado}
        onClick={onToggleColapsado}
      >
        {colapsado ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>

      <form onSubmit={handleSubmit} className="relative max-w-[440px] flex-1">
        <label htmlFor="topbar-search" className="sr-only">Buscar</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" aria-hidden="true" />
        <Input
          id="topbar-search"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar SKU o descripción…"
          className="h-9 rounded-[10px] border-line bg-surface-input pl-[38px] text-[13.5px]"
        />
      </form>

      <div className="flex-1" />

      <FreshnessIndicator />
      {/* [INV-B9] La campana va aquí, junto a la píldora de frescura y al
          interruptor de tema — es donde el brief la pidió y donde el usuario ya
          mira para saber "cómo está el dato". */}
      <Campana />
      <ThemeToggle />
    </header>
  );
}
