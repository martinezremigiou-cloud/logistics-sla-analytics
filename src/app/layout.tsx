import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { sidebarColapsadoBlockingScript } from "@/components/layout/sidebar-colapso";
import { NOMBRE_PRODUCTO } from "@/config/producto";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: NOMBRE_PRODUCTO, template: `%s · ${NOMBRE_PRODUCTO}` },
  description: "Portal interno de inventario y embarques para KAMs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body className="font-sans text-ink antialiased">
        {/* Bloque 7-B · O16 — script bloqueante (mismo mecanismo que usa
            next-themes más abajo, vía ThemeProvider) que aplica el
            ancho/opacidad del sidebar ANTES de que React hidrate, para que
            no haya parpadeo. Ver sidebar-colapso.ts para el detalle. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: sidebarColapsadoBlockingScript() }} />
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
