"use client";

// ============================================================
// Bloque 5 · P3 · session-provider.tsx
// Expone la sesión (id/email/rol) a las páginas/componentes CLIENT de
// `(app)/**` (Ficha, /config, /carga) que necesitan saber el rol del
// usuario para decidir si algo es editable. `(app)/layout.tsx` YA
// resuelve esta información server-side; este provider simplemente la
// re-expone vía Context.
//
// Decisión documentada (menos invasiva): `AppShell`/`Sidebar`/`BottomNav`
// siguen recibiendo su propio `sesion: {email, rol}` por PROPS, sin
// cambios — ya están cableados y probados así desde B1. Este provider
// es un canal ADICIONAL, independiente, para el resto del árbol; no
// reemplaza esas props.
// ============================================================
import { createContext, useContext, type ReactNode } from "react";
import type { Rol } from "@/types/enums";

export interface SesionUsuario {
  id: string;
  email: string;
  rol: Rol;
}

const SessionContext = createContext<SesionUsuario | null>(null);

export function SessionProvider({ sesion, children }: { sesion: SesionUsuario; children: ReactNode }) {
  return <SessionContext.Provider value={sesion}>{children}</SessionContext.Provider>;
}

/**
 * Sesión del usuario actual (id/email/rol). DEBE usarse dentro de
 * `<SessionProvider>` (montado en `(app)/layout.tsx`, envolviendo
 * `<AppShell>`) — lanza si no hay proveedor en el árbol, en vez de
 * degradar en silencio a un rol por defecto (fail-fast: un consumidor
 * montado fuera del layout real es un error de cableado, no un caso
 * válido de "sin sesión").
 */
export function useSesion(): SesionUsuario {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error("useSesion() debe usarse dentro de <SessionProvider>.");
  }
  return ctx;
}
