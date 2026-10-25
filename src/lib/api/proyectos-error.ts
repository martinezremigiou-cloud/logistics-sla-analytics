// ============================================================
// [INV-B8] api/proyectos-error.ts — la ÚNICA traducción error de dominio →
// respuesta HTTP del Módulo Proyectos.
//
// Vive en un archivo compartido y no dentro de cada route por la misma razón
// que `perfil-rol.ts` existe: la MISMA decisión duplicada en cuatro rutas se
// vuelve cuatro decisiones distintas en cuanto alguien toca una. El repo ya
// pagó ese precio — `requireAdminSession` y `middleware.esAdmin` armaban la
// misma consulta con manejo de error DIVERGENTE.
//
// La decisión que codifica, y conviene que esté escrita en un solo sitio:
// **"no es tuyo" y "no existe" responden lo mismo (404)**. La RLS no
// distingue esos dos casos, y distinguirlos aquí arriba ya sería confirmar
// que el recurso existe. El único 403 es el del rol —"tú no creas
// proyectos"—, que no revela nada sobre ningún recurso concreto.
// ============================================================
import type { NextResponse } from 'next/server';
import { apiError } from './errors';
import { ProyectoError } from '@/services/proyectos.service';

/**
 * `NextResponse` ya armada si `e` es un `ProyectoError`; `null` si no lo es
 * —y entonces el caller debe dejarlo caer a `internalError`, porque es un
 * error que nadie anticipó y merece un 500 con su traza en el log.
 */
export function respuestaDeProyectoError(e: unknown): NextResponse | null {
  if (!(e instanceof ProyectoError)) return null;

  switch (e.codigo) {
    case 'no_encontrado':
      return apiError('proyecto_no_encontrado', { message: 'El proyecto no existe o no es tuyo.' });
    case 'partida_duplicada':
      return apiError('partida_duplicada', {
        message: 'Ese SKU ya está en el proyecto. Cambia su cantidad en vez de agregarlo otra vez.',
      });
    case 'proyecto_lleno':
      return apiError('proyecto_lleno', { message: 'El proyecto alcanzó el máximo de partidas.' });
    case 'sku_no_encontrado':
      return apiError('sku_no_encontrado', { message: 'Ese SKU no existe en el catálogo.' });
    case 'perfil_no_encontrado':
      return apiError('perfil_no_encontrado', { message: 'Esa cuenta no existe.' });
    case 'prohibido':
      return apiError('forbidden', { message: 'Tu rol no permite esta acción sobre proyectos.' });
  }
}
