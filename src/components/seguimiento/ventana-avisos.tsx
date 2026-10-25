"use client";

// ============================================================
// [INV-B9] ventana-avisos.tsx — «¿qué quieres saber de este SKU?»
//
// ES EL CORAZÓN DEL BLOQUE, y la razón está en el brief: **no decidimos qué le
// importa a un vendedor, se lo preguntamos una vez.** Es el mismo principio de
// «prohibido catálogo hardcodeado» del eje de agrupación y de la cadena de
// imágenes.
//
// EL DEFAULT ES «YA LLEGÓ», Y SALE DE UNA MEDICIÓN, no de una intuición. Sobre
// un periodo de historia real, por orden de frecuencia:
//
//   ya llegó (disponible 0 → hay)    el más raro: pocos avisos al mes por 30 SKU
//   cambió de etapa                  más frecuente
//   cambió el reservado              más frecuente aún
//   cambió el disponible             el más frecuente de los cuatro
//
// «Ya llegó» es el evento MÁS RARO, y por eso es el default correcto: es el
// único que deja a la campana significando algo cuando suena. «Todo» habría
// dado muchos avisos al mes y entrenado a la gente a ignorarla.
//
// «USAR ESTO PARA LOS SIGUIENTES» VIENE MARCADO. Es el arreglo al riesgo que
// se señaló: si cada uno de 30 SKU pregunta, la función muere. Quien lo
// desmarque volverá a ver esta ventana; quien lo deje, no la ve nunca más.
// ============================================================
import { useState, type Dispatch, type SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TIPOS_AVISO, ETIQUETA_AVISO, type TipoAviso } from "@/lib/avisos";
import type { AvisosSku } from "@/types/avisos";

/** Qué dispara cada opción, en palabras de vendedor. La ventana tiene que explicarse sola. */
const EXPLICACION: Record<TipoAviso, string> = {
  llegada: "Pasó de no haber a haber.",
  estatus: "Se movió de etapa. Cualquiera.",
  disponible: "Cambió cuánto hay disponible.",
  reservado: "Cambió cuánto está comprometido.",
};

const CAMPO: Record<TipoAviso, keyof AvisosSku> = {
  llegada: "av_llegada",
  estatus: "av_estatus",
  disponible: "av_disponible",
  reservado: "av_reservado",
};

export interface VentanaAvisosProps {
  sku: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inicial: AvisosSku;
  /** [INV-B9.1] Estado actual del interruptor de correo. Nace APAGADO: el correo se pide. */
  correoInicial?: boolean;
  /** Devuelve `true` si se guardó. La ventana solo se cierra cuando sí. */
  onConfirmar: (avisos: AvisosSku, avCorreo: boolean, usarParaLosSiguientes: boolean) => Promise<boolean>;
  /** Texto del botón de confirmar. Al EDITAR un seguimiento que ya existe, «Seguir este SKU» mentiría. */
  textoConfirmar?: string;
  /** Sin el SKU en el título: la misma ventana sirve para editar las preferencias generales. */
  titulo?: string;
  /**
   * [INV-B9.1] Si se pinta «usar esto para los siguientes».
   *
   * **Se apaga al EDITAR, y no es cosmético.** Al editar, el llamador ignora ese
   * valor a propósito —afinar un SKU no declara un default para los que vengan—,
   * así que dejar el interruptor puesto pintaría un control encendido que no
   * hace nada. Es P7 exacto: una interfaz que afirma un efecto inexistente.
   */
  mostrarUsarSiempre?: boolean;
}

export function VentanaAvisos({
  sku,
  open,
  onOpenChange,
  inicial,
  correoInicial = false,
  onConfirmar,
  titulo,
  textoConfirmar,
  mostrarUsarSiempre = true,
}: VentanaAvisosProps) {
  const [avisos, setAvisos] = useState<AvisosSku>({
    av_estatus: inicial.av_estatus,
    av_disponible: inicial.av_disponible,
    av_reservado: inicial.av_reservado,
    av_llegada: inicial.av_llegada,
  });
  const [avCorreo, setAvCorreo] = useState(correoInicial);
  const [usarSiempre, setUsarSiempre] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // `todos` vive en `CuerpoVentanaAvisos`, que es quien pinta el atajo.
  const alguno = avisos.av_estatus || avisos.av_disponible || avisos.av_reservado || avisos.av_llegada;

  async function confirmar() {
    if (!alguno) return;
    setGuardando(true);
    try {
      if (await onConfirmar(avisos, avCorreo, usarSiempre)) onOpenChange(false);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo ?? "¿Qué quieres saber de este SKU?"}</DialogTitle>
          <DialogDescription>
            {titulo ? "Se aplicará a los SKU que sigas de ahora en adelante." : <span className="font-mono">{sku}</span>}
          </DialogDescription>
        </DialogHeader>

        <CuerpoVentanaAvisos
          avisos={avisos}
          setAvisos={setAvisos}
          avCorreo={avCorreo}
          setAvCorreo={setAvCorreo}
          usarSiempre={usarSiempre}
          setUsarSiempre={setUsarSiempre}
          mostrarUsarSiempre={mostrarUsarSiempre}
          guardando={guardando}
        />

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void confirmar()} disabled={guardando || !alguno}>
            {guardando ? "Guardando…" : (textoConfirmar ?? "Seguir este SKU")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// SE EXPORTA EL CUERPO, y no por gusto de granularidad: un `Dialog` de radix
// emite **CERO bytes** bajo `renderToStaticMarkup` — su portal no existe en el
// servidor, medido en INV-B8.2. Un marco de evidencia con la ventana dentro
// habria salido literalmente vacio, con su rotulo puesto. Sacando el cuerpo del
// envoltorio, la evidencia visual lo retrata; el envoltorio (titulo, botones)
// hay que verlo en el navegador.
// ============================================================
export function CuerpoVentanaAvisos({
  avisos,
  setAvisos,
  avCorreo = false,
  setAvCorreo,
  usarSiempre,
  setUsarSiempre,
  mostrarUsarSiempre = true,
  guardando = false,
}: {
  avisos: AvisosSku;
  setAvisos: Dispatch<SetStateAction<AvisosSku>>;
  avCorreo?: boolean;
  setAvCorreo?: Dispatch<SetStateAction<boolean>>;
  usarSiempre: boolean;
  setUsarSiempre: Dispatch<SetStateAction<boolean>>;
  mostrarUsarSiempre?: boolean;
  guardando?: boolean;
}) {
  const alguno = avisos.av_estatus || avisos.av_disponible || avisos.av_reservado || avisos.av_llegada;
  const todos = avisos.av_estatus && avisos.av_disponible && avisos.av_reservado && avisos.av_llegada;

  return (
        <div className="flex flex-col gap-1">
        {TIPOS_AVISO.map((tipo) => {
          const campo = CAMPO[tipo];
          return (
            <div key={tipo} className="flex items-start justify-between gap-3 rounded-lg px-1 py-2">
              <div className="min-w-0">
                <Label htmlFor={`aviso-${tipo}`} className="text-[13px] font-semibold text-ink">
                  {ETIQUETA_AVISO[tipo]}
                </Label>
                <p className="text-[12px] leading-snug text-ink-muted">{EXPLICACION[tipo]}</p>
              </div>
              <Switch
                id={`aviso-${tipo}`}
                checked={avisos[campo]}
                disabled={guardando}
                onCheckedChange={(v) => setAvisos((a) => ({ ...a, [campo]: v }))}
              />
            </div>
          );
        })}

        {/*
          «Todo» no es una quinta opción: es un atajo que enciende las cuatro.
          Un quinto valor sería un estado que significa dos cosas.
        */}
        <button
          type="button"
          disabled={guardando}
          onClick={() =>
            setAvisos(
              todos
                ? { av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true }
                : { av_estatus: true, av_disponible: true, av_reservado: true, av_llegada: true },
            )
          }
          className="self-start rounded-md px-1 py-1 text-[12px] font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
        >
          {todos ? "Solo lo esencial" : "Todo"}
        </button>

        {!alguno && (
          <p className="mt-1 rounded-md bg-warn-bg px-2.5 py-1.5 text-[12px] text-warn">
            Elige al menos una cosa, o el seguimiento no te diría nada.
          </p>
        )}

        {/*
          [INV-B9.1] EL SEGUNDO NIVEL DE CRITICIDAD, y es UN INTERRUPTOR dentro
          de esta ventana — no una segunda ventana con las mismas cuatro
          preguntas. Decisión de producto, y la razón es la misma que hizo que «usar
          esto para los siguientes» viniera marcado: **la pregunta "¿qué me
          importa de este SKU?" ya está contestada arriba.** Volver a hacerla
          para el correo la mataría con 30 SKU.

          Lo que se manda por correo es lo de arriba. Esto decide SI ADEMÁS te
          busca, no QUÉ.
        */}
        <div className="mt-2 flex items-start justify-between gap-3 border-t border-line-soft pt-3">
          <div className="min-w-0">
            <Label htmlFor="aviso-correo" className="text-[13px] font-semibold text-ink">
              También por correo
            </Label>
            <p className="text-[12px] leading-snug text-ink-muted">
              Lo de arriba, además, en el correo. Nunca sin campana.
            </p>
          </div>
          <Switch
            id="aviso-correo"
            checked={avCorreo}
            disabled={guardando || !setAvCorreo || !alguno}
            onCheckedChange={(v) => setAvCorreo?.(v)}
          />
        </div>

        {mostrarUsarSiempre && (
          <div className="mt-2 flex items-start justify-between gap-3 border-t border-line-soft pt-3">
            <div className="min-w-0">
              <Label htmlFor="aviso-usar-siempre" className="text-[13px] font-semibold text-ink">
                Usar esto para los siguientes
              </Label>
              <p className="text-[12px] leading-snug text-ink-muted">
                No volver a preguntar por cada SKU. Se puede cambiar en Configuración.
              </p>
            </div>
            <Switch
              id="aviso-usar-siempre"
              checked={usarSiempre}
              disabled={guardando}
              onCheckedChange={setUsarSiempre}
            />
          </div>
        )}
      </div>
  );
}
