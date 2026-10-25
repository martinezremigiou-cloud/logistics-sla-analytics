// ============================================================
// [INV-B8] partidas-api.ts — las 3 escrituras de `proyecto_partidas` desde
// el cliente (agregar/cambiar cantidad/quitar), en un solo lugar para que
// `agregar-sku-dialog.tsx` y `proyecto-partida-fila.tsx` no dupliquen el
// mismo manejo de error (mismo criterio que `resolverPendienteFetch` en
// `pendiente-acciones.tsx`): `toast.error` con el mensaje curado del API
// (409 `partida_duplicada`, 404 `sku_no_encontrado`, 409 `proyecto_lleno`,
// 404 `proyecto_no_encontrado`) si viene, fallback genérico si no — NUNCA
// lanzan, siempre regresan `false` en cualquier falla.
// ============================================================
import { toast } from 'sonner';
import type { ResultadoVolcado } from '@/types/proyectos';

const MENSAJE_ERROR_GENERICO = 'No se pudo actualizar el proyecto.';

async function mensajeDeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' && body.message ? body.message : MENSAJE_ERROR_GENERICO;
  } catch {
    // Respuesta de error sin JSON válido: se conserva el mensaje genérico.
    return MENSAJE_ERROR_GENERICO;
  }
}

/** POST /api/proyectos/[id]/partidas. */
export async function agregarPartidaFetch(proyectoId: string, sku: string, cantidad: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/proyectos/${encodeURIComponent(proyectoId)}/partidas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, cantidad }),
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

/** PATCH /api/proyectos/[id]/partidas/[partidaId]. */
export async function cambiarCantidadFetch(proyectoId: string, partidaId: string, cantidad: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/proyectos/${encodeURIComponent(proyectoId)}/partidas/${encodeURIComponent(partidaId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cantidad }),
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

/**
 * [INV-B8.2] POST /api/proyectos/[id]/partidas/volcado.
 *
 * A diferencia de las otras tres, ésta **no devuelve un booleano**: un volcado
 * puede aplicar unos renglones, detectar otros como reintento y chocar con un
 * tercero, y aplastar eso en «sí/no» perdería justo lo que el usuario necesita
 * leer. Devuelve el desglose del servidor, o `null` si la llamada falló.
 *
 * Tampoco muestra un `toast` de éxito: quien la llama enseña el resultado en
 * su propia pantalla, con el detalle. Sí muestra el error de la llamada, igual
 * que las otras.
 */
export async function volcarSeleccionFetch(
  proyectoId: string,
  items: { sku: string; cantidad: number; cantidadVista: number }[],
): Promise<ResultadoVolcado | null> {
  try {
    const res = await fetch(`/api/proyectos/${encodeURIComponent(proyectoId)}/partidas/volcado`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) {
      toast.error(await mensajeDeError(res));
      return null;
    }
    return (await res.json()) as ResultadoVolcado;
  } catch {
    toast.error(MENSAJE_ERROR_GENERICO);
    return null;
  }
}

/** DELETE /api/proyectos/[id]/partidas/[partidaId]. */
export async function quitarPartidaFetch(proyectoId: string, partidaId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/proyectos/${encodeURIComponent(proyectoId)}/partidas/${encodeURIComponent(partidaId)}`, {
      method: 'DELETE',
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
