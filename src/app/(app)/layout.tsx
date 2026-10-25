import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider } from "@/components/providers/session-provider";
import { SeleccionProvider } from "@/components/providers/seleccion-provider";
import { SeguimientoProvider } from "@/components/providers/seguimiento-provider";
import { BurbujaChat } from "@/components/chat/burbuja-chat";
import { createSupabaseSessionClient } from "@/lib/supabase/session";
import type { Rol } from "@/types/enums";

// `createSupabaseSessionClient()` usa `cookies()` (next/headers), lo que ya
// opta a esta ruta por rendering dinámico. Se deja explícito por si el
// prerender de build llegara a intentar estático (defensa en profundidad).
export const dynamic = "force-dynamic";

/** Fila cruda de `perfiles` (select mínimo para la sesión del shell). */
interface PerfilRow {
  email: string;
  rol: Rol;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defensa en profundidad: el middleware ya redirige sin sesión, pero el
  // layout no debe confiar únicamente en eso.
  if (!user) {
    redirect("/login");
  }

  const { data: perfilRow } = await supabase
    .from("perfiles")
    .select("email,rol")
    .eq("id", user.id)
    .maybeSingle();

  const perfil = perfilRow as PerfilRow | null;
  // El trigger handle_new_user crea el perfil al registrar el usuario en
  // auth.users; si por alguna carrera aún no existe, se degrada SIEMPRE al
  // rol menos privilegiado (fail-closed) — hoy 'visitante' (equivalente en
  // permisos a 'kam', ver Bloque 7-A) en vez de asumir 'kam' arbitrariamente.
  const sesion = perfil ?? { email: user.email ?? "", rol: "visitante" as const };

  // [INV-B8.2] `SeleccionProvider` va DENTRO de `SessionProvider` y FUERA de
  // `AppShell`: necesita el `id` de la sesión (es lo que aísla la Selección de
  // un KAM de la de otro en el mismo navegador, ver `src/lib/seleccion.ts`), y
  // tiene que envolver al shell entero para que la Selección sobreviva a la
  // navegación interna del route group.
  return (
    <SessionProvider sesion={{ id: user.id, email: sesion.email, rol: sesion.rol }}>
      {/* [INV-B9] `SeguimientoProvider` envuelve al shell entero por el mismo
          motivo que la Selección: el layout de `(app)` es el único nivel que
          NO se remonta al navegar, así que la lista de SKU seguidos se lee UNA
          vez y no en cada pantalla. */}
      <SeleccionProvider>
        <SeguimientoProvider>
          <AppShell sesion={sesion}>{children}</AppShell>
          {/* [INV-B10] La burbuja va FUERA del shell y dentro del layout: flota
              sobre todo, y este es el único nivel que NO se remonta al navegar,
              así que la conversación sobrevive a moverse entre el catálogo y una
              ficha. Mismo asiento y mismo motivo que la Selección. */}
          <BurbujaChat />
        </SeguimientoProvider>
      </SeleccionProvider>
    </SessionProvider>
  );
}
