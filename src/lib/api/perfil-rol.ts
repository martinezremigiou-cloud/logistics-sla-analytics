// ============================================================
// [INV-B7B] ronda 2 · punto A · lib/api/perfil-rol.ts  (Edge-safe)
//
// Único lugar que arma `select('rol').eq('id', userId).maybeSingle()`
// contra `perfiles`. Antes esa MISMA consulta vivía duplicada, con
// manejo de error DIVERGENTE, en `lib/api/auth.ts`
// (`requireAdminSession`: un fallo de lectura responde 500) y en
// `middleware.ts` (`esAdmin`: un fallo de lectura se descartaba en
// silencio, sin registrar nada). Ahora los dos llaman a
// `leerRolPerfil` y CADA UNO decide cómo reaccionar al error — pero
// ninguno vuelve a inventar la query ni el shape de la fila.
//
// Edge-safe A PROPÓSITO: `middleware.ts` corre en el runtime Edge de
// Next (no Node) — este módulo NO importa nada de Node (fs/path/
// crypto de Node, Buffer, etc.), ni siquiera indirectamente. Los
// únicos imports son TIPOS (`import type`, borrados por completo en
// compilación gracias a `isolatedModules` en tsconfig — nunca dejan
// huella en el bundle runtime) y el propio cliente `db` que cada
// caller ya trae armado (session client de Node para las rutas /api,
// cliente de `@supabase/ssr` en Edge para el middleware). El helper no
// decide QUÉ cliente usar, solo QUÉ preguntarle — así funciona igual
// sin importar en qué runtime corra quien lo invoque.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

/** Fila cruda de `perfiles` (select mínimo: solo `rol`). Detalle interno — ningún caller necesita este shape, solo el resultado ya normalizado de abajo. */
interface PerfilRolRow {
  rol: Rol;
}

export interface LeerRolPerfilResult {
  /** `null` si no hay fila (perfil inexistente) o si `error` no es `null`. Nunca leer `rol` sin antes checar `error`. */
  rol: Rol | null;
  /** Error crudo de PostgREST/red tal cual lo devuelve supabase-js; `null` en el camino feliz. Cada caller decide qué hacer con él (500 propio vs. fail-closed logueado) — este helper no lo interpreta ni lo descarta. */
  error: unknown;
}

/** Lee el rol del perfil de `userId`. Misma tabla y mismo criterio para cualquier caller — ver cabecera del archivo. */
export async function leerRolPerfil(db: SupabaseClient, userId: string): Promise<LeerRolPerfilResult> {
  const { data, error } = await db.from('perfiles').select('rol').eq('id', userId).maybeSingle();
  if (error) {
    return { rol: null, error };
  }
  return { rol: (data as PerfilRolRow | null)?.rol ?? null, error: null };
}
