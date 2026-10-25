"use client";

// ============================================================
// [INV-B11] O6-adenda · AYUDA — a quién escribirle, y qué es esto.
//
// Copy aprobado el 2026-08-21. **Aquí no se redacta**: lo que se lee
// en pantalla es el texto aprobado, salvo donde se dice lo contrario y por qué.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTA PANTALLA NO INVENTA, y es la mitad importante:
//
//   los contactos      salen de `CONTACTOS` (`src/lib/contactos.ts`), el MISMO
//                      mapa del que sale la escalada dentro del chat. Dos
//                      listas serían dos verdades, y la de la pantalla es la
//                      que nadie actualiza.
//   las capacidades    salen de `INTENCIONES`. Escribirlas a mano es P7: el
//                      día que se agregue o se quite una, esta lista anunciaría
//                      algo que el sistema ya no hace. Y ese día no avisa.
// ============================================================
import { useSesion } from "@/components/providers/session-provider";
import { Card } from "@/components/ui/card";
import { CONTACTOS, ORDEN_AYUDA } from "@/lib/contactos";
import { INTENCIONES } from "@/lib/chat/intenciones";
import { ConfigAcerca } from "./config-acerca";

/**
 * El remitente de los avisos, o `null` mientras no esté listo.
 *
 * **SE CONDICIONÓ EXPLÍCITAMENTE:** *«Depende del pulido del workflow —el
 * DNS del dominio y el remitente en el proveedor de correo—. Si eso no está listo,
 * la sección se muestra SIN esa línea, no con una promesa que no se cumple.»*
 *
 * Así que es una constante y no una cadena horneada en el JSX: el día que el
 * DNS quede, esto es **una línea** y la prueba de abajo cambia de rama sola.
 * Hoy vale `null` porque el DNS no está — y decirle a alguien que marque como
 * seguro un remitente que todavía no manda es peor que no decir nada.
 */
export const REMITENTE_AVISOS: string | null = null;

export function ConfigAyuda({
  /**
   * El remitente que se anuncia. Por omisión, el de arriba.
   *
   * **Es prop y no solo constante para que la prueba pueda ejercer LAS DOS
   * RAMAS.** Comprobar hoy que la línea no aparece sería vacuo —la constante
   * vale `null`, claro que no aparece—: sin el control positivo, un `&&` mal
   * escrito que nunca pintara nada estaría igual de verde, y el día que el DNS
   * quede nadie se enteraría de que la línea no sale.
   */
  remitente = REMITENTE_AVISOS,
}: { remitente?: string | null } = {}) {
  const { email } = useSesion();

  return (
    <div className="flex flex-col gap-5">
      {/* ── 1 · TU CORREO ──────────────────────────────────── */}
      <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Correo para avisos</h2>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Aquí llegan los avisos semanales de los SKU que sigues.
        </p>
        {/*
          SE MUESTRA, NO SE EDITA — y la diferencia es deliberada, no un recorte
          del alcance.

          El destino de los avisos es el correo de la CUENTA: la tabla
          `preferencias_notificacion` (migración 0026) no tiene columna de
          correo, y el envío sale del perfil. Volverlo editable aquí sería:
          (a) una migración con su RLS, y (b) **un campo desde el que cualquiera
          redirige los avisos de inventario a una dirección de fuera**. Lo
          segundo es una decisión de seguridad, no un detalle de forma.

          Lo que el usuario necesita saber —a dónde llegan— se cumple igual.
        */}
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Tu correo</span>
          <span className="break-all font-mono text-[12.5px] text-ink">{email}</span>
          <span className="text-[11.5px] leading-snug text-ink-muted">
            Es el correo de tu cuenta. Para cambiarlo, escríbele a {CONTACTOS.software.nombre}.
          </span>
        </div>
        {remitente && (
          <p className="rounded-md bg-surface-3 px-2.5 py-2 text-[11.5px] leading-snug text-ink-2">
            Los avisos salen de <span className="font-mono">{remitente}</span>. Si no te llegan, revisa tu carpeta de
            correo no deseado y márcalo como seguro.
          </p>
        )}
      </Card>

      {/* ── 2 · A QUIÉN ESCRIBIRLE ─────────────────────────── */}
      <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">A quién escribirle</h2>
        {/*
          Tabla en escritorio, tarjetas apiladas en móvil. No es la tabla de
          shadcn con `overflow-x-auto`: una tabla de contactos que se desplaza
          en horizontal esconde justo la columna que se vino a buscar.
        */}
        <ul className="flex flex-col divide-y divide-line-soft">
          {ORDEN_AYUDA.map((area) => {
            const c = CONTACTOS[area];
            return (
              <li key={area} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
                <p className="text-[12.5px] leading-snug text-ink-2 sm:flex-1">Si tu duda es sobre {c.cuando.toLowerCase()}</p>
                <div className="flex min-w-0 flex-col gap-0.5 sm:w-[280px] sm:shrink-0">
                  <span className="text-[12.5px] font-semibold text-ink">{c.nombre}</span>
                  <span className="text-[11px] text-ink-muted">{c.puesto}</span>
                  <a
                    href={`mailto:${c.correo}`}
                    className="break-all font-mono text-[12px] text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {c.correo}
                  </a>
                  <a
                    href={`tel:${c.telefono.replace(/[^\d+]/g, "")}`}
                    className="font-mono text-[12px] text-ink-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {c.telefono}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ── 3 · QUÉ SABE EL ASISTENTE ──────────────────────── */}
      <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Qué sabe el asistente</h2>
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Estas son las preguntas que sabe contestar. Cualquier otra cosa te lo dirá en vez de inventarla.
        </p>
        <ul className="flex flex-col gap-1.5">
          {INTENCIONES.map((i) => (
            <li key={i.id} className="flex gap-2 text-[12.5px] leading-snug text-ink">
              <span aria-hidden="true" className="select-none text-ink-muted">
                ·
              </span>
              <span className="min-w-0">{i.descripcion}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* ── 4 · ACERCA DE LA APP ───────────────────────────── */}
      <ConfigAcerca />
    </div>
  );
}
