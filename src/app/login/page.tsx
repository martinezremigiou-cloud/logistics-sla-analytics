import { Suspense } from "react";
import { BrandMark } from "@/components/shared/brand-mark";
import { NOMBRE_PRODUCTO } from "@/config/producto";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-app md:flex-row">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-sidebar-top via-sidebar to-navy-600 px-12 py-14 text-white md:flex md:w-1/2 lg:w-[45%]">
        {/* Bloque 7-B · O15 (ronda 2) — sin chip: este panel ya es navy, así
            que la marca completa (X cian + blanco) va directo encima sin
            fondo intermedio (el chip azul empastaba el cian contra sí mismo).

            Bloque 7-B · O15 (ronda 3) — alto bajado de 28 a 24: mismo
            ajuste y misma razón que en sidebar.tsx (ver ese comentario) —
            logo-principal.png ya llegó recortado al contenido, sin el
            margen transparente que "amortiguaba" el 28 original. */}
        <div className="flex items-center gap-2.5">
          <BrandMark variant="completa" size={24} />
          <span className="flex flex-col leading-tight">
            <span className="text-[14.5px] font-bold">{NOMBRE_PRODUCTO}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-sub">Inventario y aduana</span>
          </span>
        </div>

        <h2 className="max-w-md text-[28px] font-bold leading-tight tracking-tight">
          Visibilidad de inventario y aduana, por SKU.
        </h2>

        <p className="text-[12px] text-sidebar-sub">Uso interno · {NOMBRE_PRODUCTO}</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 sm:px-10">
        {/* Única excepción que SÍ conserva un fondo: este header va sobre
            bg-surface-app (claro en tema claro), donde el trazo blanco de
            la marca desaparecería. El respaldo es navy-800 (#15294A, el
            mismo navy del sidebar/panel) — no el azul del chip anterior.
            Ancho automático (px-2.5, sin w- fijo): la marca es rectangular
            (1.535:1 para esta variante — ver brand-mark.tsx), no cuadrada,
            así que un cuadrado ya no le queda.

            Alto de la marca bajado de 20 a 17 (ronda 3, mismo motivo que
            arriba): se aplica el MISMO factor de reducción que ya bajó el
            panel de escritorio de 28 a 24 (24/28 = 6/7 ≈ 0.857) sobre el
            20 anterior — 20 × 6/7 ≈ 17.14 → 17 —, en vez de elegir un
            valor aparte; así se conserva la proporción que ya existía
            entre los dos emplazamientos. Este header sigue siendo el más
            chico de los dos porque va dentro de un chip con su propio
            padding (px-2.5 py-2), que ya aporta peso visual además de la
            marca. */}
        <div className="mb-6 flex items-center gap-2.5 md:hidden">
          <span className="inline-flex shrink-0 items-center justify-center rounded-[10px] bg-navy-800 px-2.5 py-2">
            <BrandMark variant="completa" size={17} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[14.5px] font-bold text-ink">{NOMBRE_PRODUCTO}</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">Inventario y aduana</span>
          </span>
        </div>

        <div className="w-full max-w-[400px] rounded-2xl bg-surface p-8 shadow-sm">
          <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">ACCESO INTERNO</span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Inicia sesión</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Ingresa con tu correo y contraseña de {NOMBRE_PRODUCTO}.</p>

          <div className="mt-6">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
