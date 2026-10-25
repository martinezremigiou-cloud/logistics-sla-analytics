"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatoNumero } from "@/lib/formato";

interface PaginacionProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** Paginación server-driven: el estado real (`page`) vive en la URL; este componente solo notifica cambios. */
export function Paginacion({ page, totalPages, total, onPageChange }: PaginacionProps) {
  // totalPages puede llegar en 0 (catálogo vacío): se muestra como "1 de 1" con ambos extremos deshabilitados.
  const paginasTotales = Math.max(totalPages, 1);
  const enPrimera = page <= 1;
  const enUltima = page >= paginasTotales;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2">
      <p className="text-[12.5px] text-muted-foreground">
        Página {formatoNumero(page)} de {formatoNumero(paginasTotales)} · {formatoNumero(total)} resultados
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Página anterior"
          disabled={enPrimera}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Página siguiente"
          disabled={enUltima}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
