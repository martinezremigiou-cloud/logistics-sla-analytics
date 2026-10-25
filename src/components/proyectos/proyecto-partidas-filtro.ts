// ============================================================
// [INV-B8] proyecto-partidas-filtro.ts — filtro 100% CLIENTE de la card
// "Partidas del proyecto" (100% PURO).
//
// `GET /api/proyectos/[id]` ya trae TODAS las partidas del proyecto en un
// solo viaje (acotadas por `MAX_PARTIDAS`, hoy 200) — no hay paginación de
// servidor que reenviar. El buscador de texto, los dos selectores (Marca/
// Tecnología) y el chip "⚠ En riesgo" de la card filtran ese arreglo YA
// CARGADO, en memoria, sin un segundo fetch. Se extrae a un módulo aparte
// (mismo criterio que `buildInventoryUrl`/`buildCambiosUrl`) para poder
// probarlo sin montar React.
// ============================================================
import type { PartidaItem } from '@/types/proyectos';

export interface FiltrosPartidas {
  q: string;
  marca: string | null;
  tecnologia: string | null;
  soloEnRiesgo: boolean;
}

export const FILTROS_PARTIDAS_VACIOS: FiltrosPartidas = { q: '', marca: null, tecnologia: null, soloEnRiesgo: false };

/** `true` si algún filtro está activo — controla si se pinta "Limpiar filtros" y si aplica el zero-state "filtrado sin resultados". */
export function hayFiltrosActivos(filtros: FiltrosPartidas): boolean {
  return Boolean(filtros.q.trim() || filtros.marca || filtros.tecnologia || filtros.soloEnRiesgo);
}

/**
 * `q` matchea SKU o descripción (case-insensitive, substring — mismo
 * criterio de "búsqueda libre" que el resto del portal). Marca/Tecnología
 * son igualdad exacta contra el valor EFECTIVO de la partida (los mismos
 * valores que pueblan los `<select>`, vía `detalle.facetas`). `soloEnRiesgo`
 * filtra por `partida.en_riesgo`, ya derivado por el servicio — esta
 * función no vuelve a calcularlo.
 */
export function filtrarPartidas(partidas: PartidaItem[], filtros: FiltrosPartidas): PartidaItem[] {
  const q = filtros.q.trim().toLowerCase();
  return partidas.filter((p) => {
    if (filtros.marca && p.marca !== filtros.marca) return false;
    if (filtros.tecnologia && p.tecnologia !== filtros.tecnologia) return false;
    if (filtros.soloEnRiesgo && !p.en_riesgo) return false;
    if (q) {
      const enSku = p.sku.toLowerCase().includes(q);
      const enDescr = (p.descripcion ?? '').toLowerCase().includes(q);
      if (!enSku && !enDescr) return false;
    }
    return true;
  });
}
