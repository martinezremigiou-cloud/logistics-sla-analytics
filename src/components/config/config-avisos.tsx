"use client";

// ============================================================
// [INV-B9] config-avisos.tsx — la tarjeta de avisos de Configuración.
//
// VA DENTRO DE `config-preferencias.tsx`, que ya existía. El brief lo pidió
// literal: «no crees una pantalla nueva». Es una tarjeta más junto a Apariencia
// y Cuenta.
//
// QUÉ SE CONFIGURA AQUÍ Y QUÉ NO. Aquí viven los avisos POR OMISIÓN —lo que se
// aplica a un SKU nuevo— y el interruptor de «preguntar por cada uno». Lo que
// NO vive aquí es qué SKU sigues: eso se marca en el catálogo y en la ficha,
// que es donde uno está mirando el SKU. Una lista de seguimientos en
// Configuración sería una segunda superficie para el mismo estado.
//
// CAMBIAR EL DEFAULT NO TOCA LO YA SEGUIDO, y se dice en pantalla. Retroactivo
// sería peor: alguien que afinó tres SKU a mano los perdería por cambiar una
// preferencia general.
// ============================================================
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSeguimientoOpcional } from "@/components/providers/seguimiento-provider";
import { TIPOS_AVISO, ETIQUETA_AVISO, type TipoAviso } from "@/lib/avisos";
import { formatoNumero } from "@/lib/formato";
import type { AvisosSku } from "@/types/avisos";

const CAMPO: Record<TipoAviso, keyof AvisosSku> = {
  llegada: "av_llegada",
  estatus: "av_estatus",
  disponible: "av_disponible",
  reservado: "av_reservado",
};

export function ConfigAvisos() {
  const seguimiento = useSeguimientoOpcional();
  const [guardando, setGuardando] = useState(false);

  // Sin provider no se pinta, igual que los botones de seguir. Degradar a "no
  // está la tarjeta" es mejor que tumbar la pantalla de configuración entera.
  if (!seguimiento) return null;

  const { preferencias } = seguimiento;
  const encendidos = TIPOS_AVISO.filter((t) => preferencias[CAMPO[t]]).length;

  async function cambiar(parche: Partial<AvisosSku> & { preguntar_por_sku?: boolean; boletin_correo?: boolean }) {
    if (!seguimiento) return;
    setGuardando(true);
    try {
      await seguimiento.guardarPreferencias(parche);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="text-[13.5px] font-semibold text-ink">Avisos</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Lo que quieres saber de un SKU nuevo cuando lo sigues. Sigues {formatoNumero(seguimiento.total)} SKU
          ahora mismo; cambiar esto <strong className="font-semibold">no toca los que ya sigues</strong>.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        {TIPOS_AVISO.map((tipo) => (
          <div key={tipo} className="flex items-center justify-between gap-3 py-1">
            <Label htmlFor={`pref-${tipo}`} className="text-[13px]">
              {ETIQUETA_AVISO[tipo]}
            </Label>
            <Switch
              id={`pref-${tipo}`}
              checked={preferencias[CAMPO[tipo]]}
              // El último encendido no se puede apagar: dejarlos todos en
              // `false` haría que seguir un SKU no significara nada, y el CHECK
              // de la base lo rechazaría con un 23514 que nadie quiere leer.
              disabled={guardando || (encendidos === 1 && preferencias[CAMPO[tipo]])}
              onCheckedChange={(v) => {
                if (!v && encendidos === 1) {
                  toast.error("Deja al menos un tipo de aviso encendido.");
                  return;
                }
                void cambiar({ [CAMPO[tipo]]: v } as Partial<AvisosSku>);
              }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-start justify-between gap-3 border-t border-line-soft pt-3">
        <div className="min-w-0">
          <Label htmlFor="pref-preguntar">Preguntar por cada SKU</Label>
          <p className="text-[12px] leading-snug text-muted-foreground">
            Apagado, seguir un SKU es un solo clic y aplica lo de arriba.
          </p>
        </div>
        <Switch
          id="pref-preguntar"
          checked={preferencias.preguntar_por_sku}
          disabled={guardando}
          onCheckedChange={(v) => void cambiar({ preguntar_por_sku: v })}
        />
      </div>

      {/*
        [INV-B9.1] EL APAGADOR DEL BOLETÍN — la otra mitad de la «opción 3»
        acordada: el bloque general le llega a todos, y quien lo sienta ruidoso lo
        apaga. Vive AQUÍ y no en la ventana de un SKU porque no es de un SKU:
        el boletín es lo que se mueve en la operación entera.

        NO apaga el correo completo, y la línea lo dice: los avisos de los SKU
        que uno marcó con «también por correo» siguen llegando. Si apagara todo,
        sería un segundo interruptor que significa lo mismo que `av_correo` y
        acabarían contradiciéndose.
      */}
      <div className="flex items-start justify-between gap-3 border-t border-line-soft pt-3">
        <div className="min-w-0">
          <Label htmlFor="pref-boletin">Resumen semanal de la operación</Label>
          <p className="text-[12px] leading-snug text-muted-foreground">
            El bloque general del correo: lo que se movió y lo que viene en camino. Apagarlo{" "}
            <strong className="font-semibold">no</strong> apaga los avisos de tus SKU.
          </p>
        </div>
        <Switch
          id="pref-boletin"
          checked={preferencias.boletin_correo}
          disabled={guardando}
          onCheckedChange={(v) => void cambiar({ boletin_correo: v })}
        />
      </div>
    </Card>
  );
}
