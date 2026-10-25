"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { Button } from "@/components/ui/button";
import { FichaSkeleton } from "./ficha-skeleton";
import { FichaDetalle } from "./ficha-detalle";
import type { SkuDetalle } from "@/types/api";

interface FichaViewProps {
  sku: string;
}

const MENSAJE_404_FALLBACK = "SKU no encontrado en el catálogo";

/**
 * Isla client de `/catalogo/[sku]`: TODO el estado (fetch/loading/error)
 * vive acá. El 404 (`sku_no_encontrado`) tiene un estado dedicado (distinto
 * del error genérico) porque es un resultado esperado de navegación, no una
 * falla de red/servidor.
 *
 * Gate anti-remount (docs/engineering/failure-patterns.md (P3), mismo anti-patrón vivido
 * en FIX-RESET): `FichaAtributos` dispara `onSaved` → `refetch` tras cada
 * guardado (familia/descripción/tecnología/color) y también ante un 409
 * `excel_manda` de tecnología —el rechazo que avisa que el Excel ya trae el
 * dato y la ficha en pantalla envejeció—, lo que pone `loading=true` con
 * `data` todavía poblado (ver `use-api.ts`). Un gate `if (loading) return
 * <Skeleton/>` desmontaría TODA la ficha (y el estado local de sus
 * sub-componentes, p.ej. el select de familia a medio abrir) en cada
 * guardado exitoso. Por eso: el error SOLO reemplaza el contenido cuando no
 * hay ningún `data` que mostrar, y el skeleton SOLO cuando todavía no llegó
 * el primer `data` — igual criterio que `config-usuarios.tsx` (FIX C).
 */
export function FichaView({ sku }: FichaViewProps) {
  const { data, error, loading, refetch } = useApi<SkuDetalle>(`/api/sku/${encodeURIComponent(sku)}`);

  if (error && !data) {
    if (error.error === "sku_no_encontrado") {
      return (
        <EstadoVacio
          titulo={error.message ?? MENSAJE_404_FALLBACK}
          descripcion={`No encontramos "${sku}" en el catálogo.`}
          cta={
            <Button variant="outline" asChild>
              <Link href="/catalogo">Volver al catálogo</Link>
            </Button>
          }
        />
      );
    }
    return <EstadoError mensaje={error.message} onRetry={refetch} />;
  }

  return (
    <>
      {loading && !data && <FichaSkeleton />}
      {data && <FichaDetalle detalle={data} onSaved={refetch} busy={loading} />}
    </>
  );
}
