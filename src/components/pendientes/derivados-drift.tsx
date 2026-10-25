"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatoNumero } from "@/lib/formato";
import type { DriftFamiliasVista, TestigoPuentesVista } from "@/types/api";

const LIMITE_CORRIDAS = 3;
const LIMITE_MOVIMIENTOS = 6;

export interface DerivadosDriftProps {
  drift: DriftFamiliasVista | null;
  puentes: TestigoPuentesVista | null;
}

/**
 * [2.0.1-A · D2] La re-ramificación del espejo, en la Bandeja — que es donde el
 * contador vive, por decisión de producto.
 *
 * Mismo carril que los descuadres: **derivado en cada lectura, jamás
 * persistido**, así que no tiene botones de confirmar/descartar. La diferencia
 * con aquéllos es de qué se corrige: un descuadre se arregla en el archivo; una
 * re-ramificación no es un error de nadie — es el negocio moviéndose, y lo que
 * hace falta es VERLA.
 *
 * DOS TARJETAS Y NO UNA: el drift es POR CORRIDA (un evento) y el puente es un
 * ESTADO acumulado. Denominadores distintos no comparten titular — juntarlos
 * daría un número que no significa nada.
 *
 * `null` NO es cero: significa «no se pudo derivar» (la lectura falló o el
 * entorno no tiene la tabla). Un cero ahí diría «no hay nada roto» justo cuando
 * no se pudo mirar, que es el patrón que este repo persigue desde P4.
 */
export function DerivadosDrift({ drift, puentes }: DerivadosDriftProps) {
  // `== null` a propósito, no `=== null`: durante un despliegue un cliente nuevo
  // puede recibir el JSON de un servidor viejo, sin estos campos. `undefined` y
  // `null` significan lo mismo aquí —«no se pudo derivar»— y confundirlos
  // reventaba el render (visto en un fixture previo a este objetivo).
  const driftSeguro = drift ?? null;
  const puentesSeguro = puentes ?? null;
  const [expandido, setExpandido] = useState(false);

  return (
    <>
      <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[13.5px] font-semibold text-ink">
            Familias que se movieron{driftSeguro ? ` (${formatoNumero(driftSeguro.totalReasignaciones)} en ${driftSeguro.ventanaDias} días)` : ""}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Se deriva del historial de cambios en cada lectura — no es una lista de errores: es el archivo
            reclasificando productos.
          </p>
        </div>

        {driftSeguro === null ? (
          <p className="py-2 text-[12.5px] text-warn">No se pudo derivar el movimiento de familias en esta lectura.</p>
        ) : driftSeguro.corridas.length === 0 ? (
          <p className="py-2 text-[12.5px] text-muted-foreground">
            Ninguna carga movió familias en los últimos {driftSeguro.ventanaDias} días.
          </p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-line-soft">
              {(expandido ? driftSeguro.corridas : driftSeguro.corridas.slice(0, LIMITE_CORRIDAS)).map((c) => (
                <li key={c.snapshotId} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-ink">
                      {c.detectadoEn.slice(0, 10)} · {formatoNumero(c.reasignaciones)} SKU reclasificados
                    </span>
                    {c.vaciadas.length > 0 && (
                      <span className="inline-flex w-fit items-center rounded-full bg-warn-bg px-2.5 py-1 text-[11.5px] font-semibold text-warn">
                        {formatoNumero(c.vaciadas.length)} familia(s) se quedaron sin SKU
                      </span>
                    )}
                  </div>

                  <ul className="flex flex-col gap-0.5">
                    {c.movimientos.slice(0, LIMITE_MOVIMIENTOS).map((m) => (
                      <li key={`${m.de}->${m.a}`} className="font-mono text-[11.5px] text-ink-2">
                        {m.de} → {m.a} <span className="text-muted-foreground">({formatoNumero(m.n)})</span>
                      </li>
                    ))}
                    {c.movimientos.length > LIMITE_MOVIMIENTOS && (
                      <li className="text-[11.5px] text-muted-foreground">
                        …y {formatoNumero(c.movimientos.length - LIMITE_MOVIMIENTOS)} movimiento(s) más
                      </li>
                    )}
                  </ul>

                  {/* Se llaman PROBABLES porque en este sistema un renombre no
                      existe como evento: deja la misma huella que una fusión
                      (vaciar + dar de alta + mover), y solo se distinguen
                      interpretándola. Decirlo evita que el rótulo prometa
                      certeza que el dato no tiene. */}
                  {/* La llave lleva ORIGEN Y DESTINO, no sólo el origen: una
                      familia que se parte en dos —que es la forma que tiene una
                      re-ramificación real, y de eso van estas tarjetas— produce
                      dos renombres probables con el MISMO `de`. Con la llave a
                      medias React montaba uno y descartaba el otro en silencio:
                      el renglón desaparecido no habría dado ni un error, sólo
                      una lista incompleta con cara de completa. Es la misma
                      llave compuesta que ya usan los movimientos (`de->a`) y
                      las propuestas de puente, dos renglones más arriba. */}
                  {c.renombresProbables.map((r) => (
                    <p key={`ren-${r.de}->${r.a}`} className="text-[11.5px] text-ink-2">
                      Parece un renombre: <strong>{r.de}</strong> → <strong>{r.a}</strong> ({formatoNumero(r.n)} SKU juntos).
                    </p>
                  ))}
                  {c.propuestasPuente.map((p) => (
                    <p key={`prop-${p.de}-${p.a}`} className="text-[11.5px] text-warn">
                      La ficha de <strong>{p.de}</strong> quizá debería seguir a sus {formatoNumero(p.n)} SKU hacia{" "}
                      <strong>{p.a}</strong> — lo decide una persona.
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            {driftSeguro.corridas.length > LIMITE_CORRIDAS && !expandido && (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setExpandido(true)}>
                Ver las {formatoNumero(driftSeguro.corridas.length)} cargas
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-0.5">
          {/* EL TITULAR ES EL CAMINO, NO LA TABLA (P27): «N filas de puente»
              no es «N documentos que alguien pueda alcanzar». Ese número ya se
              movió una vez sin que nadie lo notara. */}
          <h2 className="text-[13.5px] font-semibold text-ink">
            Fichas alcanzables por SKU{puentesSeguro ? ` (${formatoNumero(puentesSeguro.documentosAlcanzablesPorSku)})` : ""}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            Cuántos documentos siguen teniendo camino desde un producto. Se deriva en cada lectura.
          </p>
        </div>

        {puentesSeguro === null ? (
          <p className="py-2 text-[12.5px] text-warn">No se pudo derivar el estado del puente documental.</p>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-2">
              <strong>{formatoNumero(puentesSeguro.filasSinCamino)}</strong> de {formatoNumero(puentesSeguro.filasTotales)} familias con
              ficha ya no tienen ningún SKU en el archivo vigente: su documentación existe, pero nadie llega a ella
              preguntando por un producto.
            </p>
            {puentesSeguro.sinCamino.length > 0 && (
              <p className="font-mono text-[11.5px] leading-relaxed text-muted-foreground">
                {puentesSeguro.sinCamino.slice(0, 12).join(" · ")}
                {puentesSeguro.sinCamino.length > 12 ? ` … +${formatoNumero(puentesSeguro.sinCamino.length - 12)}` : ""}
              </p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
