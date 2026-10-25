"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, puedeVerNavItem } from "@/lib/nav";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/shared/brand-mark";
import { NOMBRE_PRODUCTO } from "@/config/producto";
import { cerrarSesion } from "@/lib/auth/actions";
import { ETIQUETA_ROL } from "@/lib/roles";
import { SeleccionFlotante } from "@/components/seleccion/seleccion-flotante";
import type { Rol } from "@/types/enums";

export interface Sesion {
  email: string;
  rol: Rol;
}

export function Sidebar({
  sesion,
  onNavigate,
  /**
   * [INV-B11] O6 · Si este render del sidebar pinta la Selección en su pie.
   *
   * Es un PARÁMETRO y no una deducción porque el sidebar se pinta en tres
   * sitios con reglas distintas: el `<aside>` de escritorio expandido (sí), el
   * mismo `<aside>` colapsado (no: mide 0 px con `overflow-hidden`, así que el
   * panel quedaría recortado pero presente en el árbol de accesibilidad) y el
   * cajón de móvil (no: ahí la Selección flota).
   *
   * Deducirlo desde aquí exigiría saber el ancho y el estado de colapso, y
   * **ninguno de los dos se sabe en este archivo**.
   */
  mostrarSeleccion = false,
}: {
  sesion: Sesion;
  onNavigate?: () => void;
  mostrarSeleccion?: boolean;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => puedeVerNavItem(item, sesion.rol));
  const inicial = sesion.email.charAt(0).toUpperCase() || "?";

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-sidebar-top to-sidebar px-3.5 py-[18px] text-white">
      {/* Bloque 7-B · O15 (ronda 2) — sin chip: la marca (variante "paloma",
          marca "simplificada" del cromo interno) va directo sobre el navy del
          sidebar, que da contraste de sobra sin necesitar un fondo
          intermedio.

          Alto de la marca: 24px. El texto de al lado es el nombre del producto
          (`NOMBRE_PRODUCTO`, 14.5px bold, leading-tight), que en los 230px del
          sidebar ocupa DOS líneas (ver sidebar-presupuesto.test.tsx): la marca
          queda por debajo del alto del texto, que domina la fila. */}
      <div className="mb-5 flex items-center gap-2.5 px-1.5">
        <BrandMark variant="paloma" size={24} />
        <span className="flex flex-col leading-tight">
          <span className="text-[14.5px] font-bold">{NOMBRE_PRODUCTO}</span>
        </span>
      </div>

      <nav aria-label="Navegación principal" className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] text-[13.5px] font-medium text-sidebar-idle transition-colors",
                "hover:bg-white/[0.06] hover:text-white",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rail focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                active && "bg-white/[0.13] font-semibold text-white shadow-[inset_2px_0_0_theme(colors.brand.rail)]",
              )}
            >
              <Icon size={20} strokeWidth={1.9} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && (
                <Badge aria-label={item.badgeLabel} className="rounded-full bg-danger px-1.5 py-px font-mono text-[10.5px] font-semibold text-white hover:bg-danger">
                  {item.badge}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      {/* [INV-B11] O6 · LA SELECCIÓN, ARRIBA DEL BLOQUE DE USUARIO.
          Arriba porque el bloque de usuario es TERMINAL —identidad y salida— y
          pertenece al fondo absoluto. Y sin separador propio: reutiliza el
          `border-t` que ese bloque ya trae. Un separador, no dos.
          `conDialogo={false}`: el `VolcarDialog` lo monta el punto flotante, y
          dos serían dos `Dialog` de radix vivos. */}
      {mostrarSeleccion && <SeleccionFlotante anclaje="sidebar" conDialogo={false} className="px-1.5" />}

      <div className="mt-3 flex items-center gap-2.5 border-t border-white/[0.09] px-1.5 pt-3.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-rail text-[13px] font-semibold text-white"
        >
          {inicial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[12.5px] font-semibold text-white" title={sesion.email}>
            {sesion.email}
          </span>
          <span className="mt-0.5 inline-flex w-fit items-center rounded-full bg-white/10 px-1.5 py-px text-[10px] font-semibold uppercase text-sidebar-idle">
            {ETIQUETA_ROL[sesion.rol]}
          </span>
        </span>
        <form action={cerrarSesion}>
          <button
            type="submit"
            aria-label="Cerrar sesión"
            className="flex shrink-0 items-center justify-center rounded-[8px] p-1.5 text-sidebar-idle transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-rail focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            <LogOut size={16} strokeWidth={1.9} />
          </button>
        </form>
      </div>
    </div>
  );
}
