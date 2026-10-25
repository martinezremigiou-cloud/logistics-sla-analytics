"use server";

import { redirect } from "next/navigation";
import { createSupabaseSessionClient } from "@/lib/supabase/session";

/** Server Action de logout: cierra la sesión (revoca cookies) y regresa a /login. */
export async function cerrarSesion() {
  const supabase = createSupabaseSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
