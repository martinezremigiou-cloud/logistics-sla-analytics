import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// [MVP-CIERRE] · P15 aplicado a nuestra propia herramienta.
//
// Una corrida salió con un test rojo y su identidad SE PERDIÓ: el
// reflejo fue volver a correr la suite, y la salida de la corrida roja
// murió en ese instante. No fue un descuido — no había reporter a archivo,
// así que re-ejecutar era el único camino disponible. Es exactamente el
// mecanismo de P15: el grito de `assertCatalogoOk` también existió, y
// también murió, en la ventana de retención de Vercel.
//
// Cada invocación escribe su PROPIO archivo, con marca de tiempo. Esto es
// lo que de verdad cierra el hueco: un nombre fijo lo habría sobrescrito la
// siguiente corrida verde y el rojo se habría perdido igual, con un
// instrumento puesto y todo. Para leerlo: `node scripts/ultimo-rojo.mjs`.
const marcaDeCorrida = new Date().toISOString().replace(/[:.]/g, "-");

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Libros .xlsx de muestra en `muestra/` (carpeta ignorada por git): se generan antes de recolectar las
    // pruebas, de forma determinista y sin red (scripts/generar-datos-muestra.mjs). Sin esto, las suites
    // de integración que dependen de esos libros se saltarían en silencio en un clon fresco o en CI.
    globalSetup: ["./scripts/datos-muestra/global-setup.mjs"],
    css: false,
    // `scripts/rls-negativas.test.ts` SÍ corre aquí: sus secciones sin red (matriz,
    // evaluador puro, sonda) siempre; su batería EN VIVO contra una base local solo
    // con `RLS_EN_VIVO=1` (ver la guarda en ese archivo y `supabase/README.md`).
    exclude: [...configDefaults.exclude],
    reporters: ["default", "json"],
    outputFile: { json: `./.vitest/corrida-${marcaDeCorrida}.json` },
    env: {
      // Pin de zona horaria del runner (C2): determinismo para los helpers
      // de fecha (`formatoFechaHora`, `hoyMexico`) sin importar la TZ local
      // de la máquina que corre `vitest` (Windows dev, CI, etc.).
      TZ: "America/Mexico_City",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
      INGEST_SECRET: "placeholder-ingest-secret-for-tests",
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
