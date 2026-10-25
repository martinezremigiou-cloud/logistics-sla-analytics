// ============================================================
// [INV-B9] seguimiento-api.ts — las tres escrituras del seguimiento, en un
// solo lugar para que el botón, la ventana de preferencias y la sección de
// configuración no dupliquen el mismo manejo de error.
//
// Mismo criterio que `partidas-api.ts` (INV-B8): `toast.error` con el mensaje
// curado del API si viene, genérico si no, y **nunca lanzan** — devuelven
// `false` en cualquier falla. Un botón de seguir que tumba la página del
// catálogo sería peor que un botón que no funciona.
// ============================================================
import { toast } from 'sonner';
import type { AvisosSku, PreferenciasAvisos } from '@/types/avisos';

const MENSAJE_ERROR_GENERICO = 'No se pudo guardar el seguimiento.';

async function mensajeDeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' && body.message ? body.message : MENSAJE_ERROR_GENERICO;
  } catch {
    return MENSAJE_ERROR_GENERICO;
  }
}

/**
 * POST /api/seguimientos. Sirve para seguir Y para cambiar qué se quiere
 * saber: la PK compuesta de la 0026 hace que no pueda duplicar.
 *
 * `avisos` ausente = «aplica mis preferencias», que es el camino normal.
 */
export async function seguirSkuFetch(sku: string, avisos?: AvisosSku, avCorreo?: boolean): Promise<boolean> {
  try {
    const res = await fetch('/api/seguimientos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku,
        ...(avisos ? { avisos } : {}),
        // Ausente si no se toca: el servidor conserva lo que hubiera.
        ...(avCorreo === undefined ? {} : { av_correo: avCorreo }),
      }),
    });
    if (!res.ok) {
      toast.error(await mensajeDeError(res));
      return false;
    }
    return true;
  } catch {
    toast.error(MENSAJE_ERROR_GENERICO);
    return false;
  }
}

/** DELETE /api/seguimientos/[sku]. Dejar de seguir dos veces da el mismo resultado que hacerlo una. */
export async function dejarDeSeguirFetch(sku: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/seguimientos/${encodeURIComponent(sku)}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(await mensajeDeError(res));
      return false;
    }
    return true;
  } catch {
    toast.error(MENSAJE_ERROR_GENERICO);
    return false;
  }
}

/**
 * PATCH /api/preferencias. Devuelve las preferencias ya guardadas —no un
 * booleano— porque el servidor es quien estampa `visto_hasta` y el cliente
 * necesita la hora que puso ÉL, no la que habría puesto el navegador.
 */
export async function guardarPreferenciasFetch(
  parche: Partial<Omit<PreferenciasAvisos, 'visto_hasta'>> & { marcar_visto?: true },
): Promise<PreferenciasAvisos | null> {
  try {
    const res = await fetch('/api/preferencias', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parche),
    });
    if (!res.ok) {
      toast.error(await mensajeDeError(res));
      return null;
    }
    return (await res.json()) as PreferenciasAvisos;
  } catch {
    toast.error(MENSAJE_ERROR_GENERICO);
    return null;
  }
}
