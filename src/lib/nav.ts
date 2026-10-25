import {
  LayoutGrid, Layers, Workflow, Folder, Truck, Database, ImageUp, SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { Rol } from "@/types/enums";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  badgeLabel?: string;
  /** Oculto para rol no-admin; solo visible para `admin` (Sidebar y BottomNav filtran por esto). */
  adminOnly?: boolean;
  /**
   * [INV-B8] Segundo eje de permiso, independiente de `adminOnly`: qué
   * roles VEN este item. `Record<Rol, boolean>` a propósito — mismo molde
   * que `MUESTRA_CLASIFICACION_V2` (`src/lib/roles.ts`): agregar un rol
   * nuevo a `Rol` (`types/enums.ts`) ROMPE la compilación de cualquier
   * `rolesPermitidos` ya escrito hasta decidir explícitamente si ese rol
   * hereda visibilidad — no puede quedar afuera en silencio, como sí podría
   * pasar con un `Rol[]` (agregar un rol al tipo no invalida un arreglo
   * literal que ya no lo liste).
   *
   * Ausente → visible para todos los roles que ya pasen `adminOnly` (mismo
   * comportamiento que todo `NavItem` previo a este eje). Los dos ejes se
   * combinan con AND vía `puedeVerNavItem` — un item podría en teoría ser
   * `adminOnly` Y traer `rolesPermitidos`, aunque hoy ninguno lo necesita.
   */
  rolesPermitidos?: Record<Rol, boolean>;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutGrid },
  { label: "Catálogo", href: "/catalogo", icon: Layers },
  { label: "Embarques", href: "/embarques", icon: Workflow },
  // [INV-B8] Visible para admin y kam; oculto para visitante. La RLS ya
  // deja a un visitante sin nada que ver ahí (no puede crear proyectos,
  // `proyectos_insert_own_no_visitante`) — este filtro evita que aterrice
  // en una pantalla que no puede usar, en vez de dejarlo descubrirlo ahí.
  // [ROL-SOPORTE] `soporte: true` — gemelo de `kam`: arma sus PROPIOS proyectos.
  // Acordado el 22-sep. Era `false` por la frase «rol de sólo lectura», que
  // la medición de las 12 policies sin `is_admin()` desmintió.
  { label: "Proyectos", href: "/proyectos", icon: Folder, rolesPermitidos: { admin: true, kam: true, visitante: false, soporte: true } },
  { label: "Histórico de embarques", href: "/embarques/historico", icon: Truck },
  { label: "Snapshots", href: "/snapshots", icon: Database },
  { label: "Carga de imágenes", href: "/carga", icon: ImageUp, adminOnly: true },
  { label: "Configuración", href: "/config", icon: SlidersHorizontal },
];

/**
 * Combina los dos ejes de permiso (`adminOnly` + `rolesPermitidos`) con AND
 * — ÚNICO lugar que decide "¿este rol ve este item?", para que Sidebar y
 * BottomNav (Bloque 7-B / INV-B8) nunca puedan divergir en el criterio.
 */
export function puedeVerNavItem(item: NavItem, rol: Rol): boolean {
  if (item.adminOnly && rol !== "admin") return false;
  if (item.rolesPermitidos && !item.rolesPermitidos[rol]) return false;
  return true;
}
