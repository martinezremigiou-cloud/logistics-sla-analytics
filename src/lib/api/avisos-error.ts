// ============================================================
// [INV-B9] api/avisos-error.ts — la ÚNICA traducción error de dominio →
// respuesta HTTP del seguimiento.
//
// Vive aparte por la misma razón que `proyectos-error.ts`: la misma decisión
// duplicada en cuatro rutas se vuelve cuatro decisiones distintas en cuanto
// alguien toca una.
// ============================================================
import type { NextResponse } from 'next/server';
import { apiError } from './errors';
import { AvisoError } from '@/services/avisos.service';

/**
 * `NextResponse` ya armada si `e` es un `AvisoError`; `null` si no lo es — y
 * entonces el caller debe dejarlo caer a `internalError`, porque es un error
 * que nadie anticipó y merece un 500 con su traza en el log.
 */
export function respuestaDeAvisoError(e: unknown): NextResponse | null {
  if (!(e instanceof AvisoError)) return null;

  switch (e.codigo) {
    case 'sku_no_encontrado':
      return apiError('sku_no_encontrado', { message: 'Ese SKU no existe en el catálogo.' });
    case 'demasiados_seguimientos':
      return apiError('demasiados_seguimientos', {
        message: 'Alcanzaste el máximo de SKUs seguidos. Deja de seguir alguno para agregar otro.',
      });
    case 'sin_avisos':
      return apiError('invalid_body', {
        message: 'Elige al menos una cosa que quieras saber de este SKU.',
      });
  }
}
