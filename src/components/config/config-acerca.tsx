"use client";

// ============================================================
// [INV-B11] O6-adenda · ACERCA DE LA APP.
//
// Copy aprobado el 2026-08-21, **palabra por palabra**. Lo único que
// no es suyo es el número de build, que sale del entorno.
//
// POR QUÉ ESTA TARJETA EXISTE, y no es relleno: las tres cosas que dice —de
// dónde salen los datos, que la fecha de corte NO es tiempo real, y qué NO
// tiene el portal— son exactamente las tres que un KAM asume mal. «No hay
// precios» ahorra una llamada; «no es tiempo real» ahorra una decisión tomada
// sobre una cifra de hace tres días.
// ============================================================
import { Card } from "@/components/ui/card";
import { CONTACTOS } from "@/lib/contactos";
import { NOMBRE_PRODUCTO } from "@/config/producto";
import { TestigoCorpus } from "./testigo-corpus";

/**
 * El identificador del despliegue, horneado en build por `next.config.mjs`.
 *
 * **Se pinta solo si existe.** En local no existe, y un «Versión: undefined»
 * en pantalla es peor que no decir versión — dice que el dato está roto cuando
 * lo que pasa es que no aplica fuera de Vercel.
 */
const BUILD = process.env.NEXT_PUBLIC_DEPLOY_ID ?? null;

export function ConfigAcerca() {
  const responsable = CONTACTOS.software;

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[13.5px] font-semibold text-ink">{NOMBRE_PRODUCTO}</h2>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Visibilidad de inventario y aduana por SKU, para el equipo comercial de Demo.
        </p>
      </div>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">De dónde salen los datos</h3>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          El inventario y los embarques vienen de los archivos de Excel que se cargan periódicamente. La fecha de corte
          que ves arriba a la derecha es del último archivo procesado — <strong className="font-semibold text-ink">no es tiempo real.</strong>
        </p>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          <strong className="font-semibold text-ink">La documentación de producto</strong> viene del vault de fichas
          técnicas de Demo, derivado de los manuales y hojas de especificación de cada fabricante.
        </p>
        {/* [INV-B11] O7 · EL TESTIGO DE FRESCURA. Va aquí y no en una tarjeta
            propia porque el párrafo de arriba explica DE DÓNDE sale la
            documentación, y esto dice DE CUÁNDO. Separarlos obligaría a leer
            dos sitios para tener una sola idea. */}
        <TestigoCorpus />
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Qué NO tiene</h3>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          No hay precios, no hay ventas, y no hay información de clientes más allá de quién tiene reservado qué.
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Responsable de la aplicación</h3>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          {responsable.nombre} · {responsable.puesto} ·{" "}
          <a
            href={`mailto:${responsable.correo}`}
            className="break-all font-mono text-[12px] text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
          >
            {responsable.correo}
          </a>
        </p>
      </section>

      {BUILD && (
        <p className="border-t border-line-soft pt-3 font-mono text-[11px] text-ink-muted">
          Versión: <span className="break-all">{BUILD}</span>
        </p>
      )}
    </Card>
  );
}
