import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/** Cliente Supabase anon, seguro para el navegador. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
