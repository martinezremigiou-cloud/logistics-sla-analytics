"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, puedeVerNavItem } from "@/lib/nav";
import type { Sesion } from "@/components/layout/sidebar";

// Etiquetas cortas para el espacio reducido de la barra móvil (no reutiliza
// el label de NAV_ITEMS, que está pensado para el sidebar de escritorio).
const BOTTOM_SLOTS = [
  { href: "/", label: "Inicio" },
  { href: "/catalogo", label: "Catálogo" },
  { href: "/embarques", label: "Embarques" },
  { href: "/embarques/historico", label: "Histórico" },
] as const;

export function BottomNav({ sesion, onMore }: { sesion: Sesion; onMore: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación principal (móvil)"
      // [2.0.1-A] EL SUELO DEL CARRIL, y ahora DECLARA su alto.
      // `h-[var(--mx-carril-alto-nav)]` no es decoración: tres archivos daban
      // por hecho que esta barra medía 3.5rem para calcular su propio offset y
      // **nadie lo había medido** — medía 54 px, no 56, porque el alto salía del
      // contenido (`py-2` + icono + etiqueta). Declararlo convierte la
      // suposición de otros en un contrato de éste. Ver `carril.ts`.
      data-carril-piso="navegacion"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--mx-carril-alto-nav)] items-stretch border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {BOTTOM_SLOTS.map((slot) => {
        const navItem = NAV_ITEMS.find((item) => item.href === slot.href);
        if (!navItem) return null;
        if (!puedeVerNavItem(navItem, sesion.rol)) return null;
        const active = slot.href === "/" ? pathname === "/" : pathname.startsWith(slot.href);
        const Icon = navItem.icon;
        return (
          <Link
            key={slot.href}
            href={slot.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-medium text-ink-muted transition-colors",
              active && "text-brand",
            )}
          >
            <Icon size={19} strokeWidth={active ? 2.1 : 1.9} />
            <span>{slot.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        aria-label="Más opciones"
        className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-medium text-ink-muted transition-colors"
      >
        <Menu size={19} strokeWidth={1.9} />
        <span>Más</span>
      </button>
    </nav>
  );
}
