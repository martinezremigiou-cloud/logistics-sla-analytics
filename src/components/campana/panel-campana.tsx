"use client";

// ============================================================
// [INV-B9] panel-campana.tsx — lo que se ve al abrir la campana. SIN fetch.
//
// Recibe el DTO y lo pinta. Está partido del cableado por la misma razón que
// en INV-B8.2: la evidencia visual se renderiza con `renderToStaticMarkup`,
// que **no corre ningún `useEffect`**, así que un panel que hiciera su propio
// fetch saldría siempre vacío y la evidencia mostraría un componente que no es
// el que ve el usuario.
//
// EL ORDEN LO FIJÓ EL BRIEF: la capa fija arriba, lo suscrito abajo. Un
// vendedor ve primero el pulso general y después lo suyo.
//
// EL PULSO ES MOVIMIENTO, NO INVENTARIO — y ésa fue la corrección más grande
// del checkpoint. Medido sobre un snapshot real: de las etapas del
// pipeline, **la mayoría están vacías** en cualquier momento. Una tabla de etapas
// habría mostrado una columna de ceros. Lo que sí se mueve es el lote: «N de Aduana a
// Almacén North», «M de Preparación a Almacén FW».
//
// LA ÚLTIMA LÍNEA —cuándo cargó cada fuente— PARECE RELLENO Y ES LA MÁS
// IMPORTANTE. Contesta «¿por qué no he visto nada?». Sin ella, una campana
// vacía no distingue «no pasó nada» de «el dato dejó de llegar», que es
// exactamente la trampa de `contar_pendientes()`: degrada a cero silencioso e
// indistinguible. Y es la falla que ya se materializó dos veces.
// ============================================================
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bell, MailWarning, PackageCheck, Truck } from "lucide-react";
import { formatoNumero, formatoFechaHora } from "@/lib/formato";
import { ETIQUETA_AVISO } from "@/lib/avisos";
import type { CampanaResponse } from "@/types/avisos";

/**
 * Un renglón por SKU, con sus avisos dentro. Conserva el orden de llegada de
 * los SKU para que la lista no baile entre aperturas.
 */
function agruparPorSku(avisos: CampanaResponse["avisos"]) {
  const orden: string[] = [];
  const porSku = new Map<string, CampanaResponse["avisos"]>();
  for (const a of avisos) {
    const lista = porSku.get(a.sku);
    if (lista) lista.push(a);
    else {
      orden.push(a.sku);
      porSku.set(a.sku, [a]);
    }
  }
  return orden.map((sku) => ({ sku, avisos: porSku.get(sku)! }));
}

export function PanelCampana({ datos }: { datos: CampanaResponse }) {
  const { pulso, avisos, seguidos, ultimas, calladas } = datos;
  const hayPulso = pulso.movimientos.length > 0 || pulso.llegadas.length > 0 || pulso.enCamino.skus > 0;

  return (
    <div className="flex max-h-[70vh] w-[min(92vw,384px)] flex-col overflow-y-auto">
      {/* ---------- LA LÍNEA DE ADMIN. Ventas nunca llega aquí: el servidor
           devuelve `calladas` vacío para cualquier rol que no sea admin. ---------- */}
      {calladas.map((c) => (
        <div key={c.fuente} className="flex items-start gap-2 border-b border-line-soft bg-warn-bg px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <p className="text-[12.5px] leading-snug text-warn">
            <strong className="font-semibold">{c.fuente}</strong> lleva {formatoNumero(c.dias)} días sin traer nada
            nuevo, y {c.otra} sí trajo hace {formatoNumero(c.diasOtra)}.{" "}
            <span className="opacity-80">
              Puede ser que el archivo no haya cambiado o que la ingesta no esté corriendo: `snapshots` no los
              distingue.
            </span>
          </p>
        </div>
      ))}

      {/*
        [INV-B9.1] LA SEGUNDA LÍNEA DE ADMIN. Misma forma y mismas restricciones
        que la de la ingesta callada: UNA línea, solo admin, para una falla que
        de otro modo no deja rastro. n8n puede dejar de llamar —variable
        ausente, workflow desactivado, transporte rechazando— y en los tres
        casos no pasa nada visible. Es la falla de las 182 horas, en el canal
        que se está construyendo ahora.
      */}
      {datos.correoCallado && (
        <div className="flex items-start gap-2 border-b border-line-soft bg-warn-bg px-3.5 py-2.5">
          <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <p className="text-[12.5px] leading-snug text-warn">
            El <strong className="font-semibold">correo</strong> no confirma un envío desde hace{" "}
            {formatoNumero(datos.correoCallado.dias)} días.
          </p>
        </div>
      )}

      {/* ---------- LA CAPA FIJA ---------- */}
      <section className="border-b border-line-soft px-3.5 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">El pulso</h3>

        {!hayPulso && <p className="text-[12.5px] text-ink-muted">Sin movimiento en los últimos días.</p>}

        {pulso.movimientos.length > 0 && (
          <div className="mb-2">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
              <Truck className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
              {formatoNumero(pulso.movimientos.length)} SKU avanzaron de etapa
            </p>
            <ul className="mt-1 space-y-0.5">
              {pulso.movimientos.slice(0, 4).map((m) => (
                <li key={m.sku} className="flex items-center gap-1 text-[11.5px] text-ink-muted">
                  <span className="truncate font-mono text-ink-2">{m.sku}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{m.a}</span>
                </li>
              ))}
            </ul>
            {pulso.movimientos.length > 4 && (
              <p className="mt-0.5 text-[11px] text-ink-muted">y {formatoNumero(pulso.movimientos.length - 4)} más</p>
            )}
          </div>
        )}

        {pulso.llegadas.length > 0 && (
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-success">
            <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {formatoNumero(pulso.llegadas.length)} SKU llegaron
          </p>
        )}

        {pulso.enCamino.skus > 0 && (
          <p className="text-[12.5px] text-ink-2">
            {formatoNumero(pulso.enCamino.skus)} SKU en camino · {formatoNumero(pulso.enCamino.piezas)} pz ·{" "}
            {formatoNumero(pulso.enCamino.etapasOcupadas)} etapas ocupadas
          </p>
        )}
      </section>

      {/* ---------- LO SUSCRITO ---------- */}
      <section className="px-3.5 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Lo que sigues
        </h3>

        {/* ZERO-STATE: quien no sigue nada tiene que entender CÓMO seguir su
            primer SKU, no solo leer que no tiene nada. */}
        {seguidos === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-3 text-[12.5px] leading-snug text-ink-muted">
            <p className="mb-1 font-semibold text-ink-2">Todavía no sigues ningún SKU.</p>
            <p>
              Marca la campana de un SKU en el{" "}
              <Link href="/catalogo" className="font-semibold text-brand hover:underline">
                catálogo
              </Link>{" "}
              y te avisamos aquí cuando llegue.
            </p>
          </div>
        )}

        {seguidos > 0 && avisos.length === 0 && (
          <p className="text-[12.5px] text-ink-muted">
            Sigues {formatoNumero(seguidos)} SKU y ninguno se movió en los últimos días.
          </p>
        )}

        {avisos.length > 0 && (
          <>
            <p className="mb-1.5 text-[12.5px] text-ink-2">
              De tus {formatoNumero(seguidos)} SKU,{" "}
              <strong className="font-semibold text-ink">{formatoNumero(new Set(avisos.map((a) => a.sku)).size)}</strong>{" "}
              se movieron.
            </p>
            {/*
              UN RENGLÓN POR SKU, NO POR AVISO. El motor emite un aviso por
              (SKU, tipo) porque el bloque de correo puede querer enrutar por
              tipo; el PANEL agrupa, y la diferencia no es cosmética: medido
              contra la historia real, alguien con los cuatro avisos encendidos
              recibiría **60 renglones** en una recarga completa de stock, y eso
              es la lista de eventos que el brief prohíbe. Agrupado son 30 —
              exactamente los que dice el encabezado que se movieron.
            */}
            <ul className="space-y-1">
              {agruparPorSku(avisos).map((g) => (
                <li key={g.sku} className="rounded-lg border border-line px-2.5 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link
                      href={`/catalogo/${encodeURIComponent(g.sku)}`}
                      className="truncate font-mono text-[12px] font-semibold text-ink hover:text-brand hover:underline"
                    >
                      {g.sku}
                    </Link>
                    <span className="shrink-0 text-[11px] text-ink-muted">
                      {g.avisos.map((a) => ETIQUETA_AVISO[a.tipo]).join(" · ")}
                    </span>
                  </div>
                  {g.avisos.map((a) => (
                    <p key={a.tipo} className="font-mono text-[11.5px] text-ink-muted">
                      {a.de ?? "—"} <span aria-hidden="true">→</span>{" "}
                      <strong className="font-semibold text-ink-2">{a.a ?? "—"}</strong>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ---------- LA FRESCURA ---------- */}
      <footer className="mt-auto border-t border-line-soft px-3.5 py-2">
        {ultimas.map((u) => (
          <p key={u.fuente} className="text-[11px] text-ink-muted">
            <span className="font-semibold">{u.fuente}</span>:{" "}
            {u.ultima ? formatoFechaHora(u.ultima) : "sin cargas todavía"}
          </p>
        ))}
      </footer>
    </div>
  );
}

/** La píldora del badge. Va aparte para poder retratarla sin el panel entero. */
export function IconoCampana({ nuevos }: { nuevos: number }) {
  return (
    <span className="relative inline-flex">
      <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
      {nuevos > 0 && (
        // Mismo patrón visual que el badge de Pendientes en el sidebar
        // (`bg-danger`, redondo, mono): un usuario no tiene por qué aprender
        // dos lenguajes de "hay algo nuevo".
        <span className="absolute -right-1.5 -top-1.5 min-w-[15px] rounded-full bg-danger px-1 text-center font-mono text-[9.5px] font-semibold leading-[15px] text-white">
          {nuevos > 99 ? "99+" : nuevos}
        </span>
      )}
    </span>
  );
}
