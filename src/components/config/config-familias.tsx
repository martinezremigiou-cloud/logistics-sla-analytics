"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, AlertTriangle } from "lucide-react";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError } from "@/components/shared/estado-carga";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatoNumero } from "@/lib/formato";
import type { FusionFamiliaResultado, FusionPreviewResponse } from "@/types/api";

interface FamiliaItem {
  id: string;
  nombre: string;
  activo: boolean;
}
interface FamiliasResponse {
  items: FamiliaItem[];
}

const MENSAJE_FAMILIA_DUPLICADA = "Ya existe una familia con ese nombre.";
// (C, [MVP-2]) Errores de la fusión — mensajes genéricos de red/parseo;
// los curados del API (400/404/503) se leen del body, mismo criterio que
// `resolverPendienteFetch` (pendiente-acciones.tsx).
const MENSAJE_ERROR_ALCANCE = "No se pudo calcular el alcance de la fusión.";
const MENSAJE_ERROR_FUSION = "No se pudo fusionar la familia.";

/**
 * (C, [MVP-2]) Declara el ALCANCE de la fusión — la razón de ser del
 * frente: la pantalla dice qué cubre y qué NO cubre ANTES de que el
 * admin confirme, calculado con los datos reales (`GET
 * /api/familias/fusionar`, ver `familias.service.ts`). El alias resuelve
 * la CELDA completa, no el átomo: un compuesto que contiene el átomo del
 * alias (p.ej. "SERIES2 48 / SERIES2 72" para el alias "SERIES2") queda
 * FUERA de esta regla y necesita la suya propia — si no hay ninguno, se
 * dice también: el silencio no vale.
 */
function AlcanceFusion({ alias, destino, preview }: { alias: string; destino: string; preview: FusionPreviewResponse }) {
  const { cubre, skus_directos, no_cubre } = preview;
  // Frase precomputada (no en JSX multilínea): un salto de línea a mitad de
  // oración con expresiones a los lados colapsa a un espacio "de más" que
  // vuelve frágil cualquier comparación exacta — mejor una sola cadena.
  const fraseNoCubre =
    no_cubre.length === 1
      ? `NO cubre 1 valor compuesto que contiene «${alias}»:`
      : `NO cubre ${formatoNumero(no_cubre.length)} valores compuestos que contienen «${alias}»:`;
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line-soft bg-surface-3 p-3">
      <p className="text-[13px] font-semibold text-ink">
        Fusionar <span className="font-mono">{alias}</span> → <span className="font-mono">{destino}</span>
      </p>

      <div className="flex items-start gap-2">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} aria-hidden="true" />
        {cubre === 1 ? (
          <p className="text-[12.5px] text-ink-2">
            Cubre 1 valor del catálogo · {formatoNumero(skus_directos)} SKU migrarán en la próxima ingesta.
          </p>
        ) : (
          <p className="text-[12.5px] text-ink-2">
            «{alias}» todavía no existe como fila del catálogo — la regla aplicará en cuanto aparezca en el Excel.
          </p>
        )}
      </div>

      {no_cubre.length > 0 ? (
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-[12.5px] text-ink-2">{fraseNoCubre}</p>
            <ul className="flex flex-col gap-0.5">
              {no_cubre.map((c) => (
                <li key={c.nombre} className="font-mono text-[12px] text-ink-2">
                  {c.nombre} — {formatoNumero(c.skus)} SKU
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-ink-muted">Si también es errata, fusiónalo aparte.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} aria-hidden="true" />
          <p className="text-[12.5px] text-ink-2">No hay valores compuestos afectados.</p>
        </div>
      )}
    </div>
  );
}

/**
 * (C, [MVP-2]) "Fusionar familias": alias (la errata) + destino (la
 * familia buena). Al abrir el diálogo de confirmación se calcula el
 * alcance EN VIVO (nunca se reutiliza un preview viejo mientras el admin
 * tecleaba) y solo entonces se habilita "Fusionar" — la pantalla nunca
 * deja confirmar sin haber declarado su alcance primero.
 */
function DialogFusionar({ items, onFusionado }: { items: FamiliaItem[]; onFusionado: () => void }) {
  const [alias, setAlias] = useState("");
  const [destino, setDestino] = useState("");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<FusionPreviewResponse | null>(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const listaId = "config-familias-catalogo";
  const aliasValor = alias.trim();
  const destinoValor = destino.trim();
  const listo = aliasValor !== "" && destinoValor !== "" && aliasValor.toLowerCase() !== destinoValor.toLowerCase();

  async function abrir() {
    setOpen(true);
    setPreview(null);
    setCargandoPreview(true);
    try {
      const res = await fetch(`/api/familias/fusionar?alias=${encodeURIComponent(aliasValor)}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error(MENSAJE_ERROR_ALCANCE);
        setOpen(false);
        return;
      }
      setPreview((await res.json()) as FusionPreviewResponse);
    } catch {
      toast.error(MENSAJE_ERROR_ALCANCE);
      setOpen(false);
    } finally {
      setCargandoPreview(false);
    }
  }

  async function handleFusionar() {
    setEnviando(true);
    try {
      const res = await fetch("/api/familias/fusionar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `skusEsperados` es el conteo que `AlcanceFusion` acaba de mostrar,
        // devuelto tal cual: confirmación de doble llave. `fusionar_familia`
        // (0018) lo contrasta contra el conteo VIVO y aborta si no coincide,
        // así que una fusión solo se aplica sobre el alcance que el admin de
        // verdad vio. El botón está deshabilitado hasta que `preview` cargue,
        // de modo que aquí nunca es null.
        body: JSON.stringify({
          alias: aliasValor,
          destino: destinoValor,
          skusEsperados: preview?.skus_directos ?? 0,
        }),
      });
      if (!res.ok) {
        let mensaje = MENSAJE_ERROR_FUSION;
        try {
          const errBody = (await res.json()) as { message?: string };
          if (typeof errBody.message === "string" && errBody.message) mensaje = errBody.message;
        } catch {
          // Respuesta de error sin JSON válido: se conserva el mensaje genérico.
        }
        toast.error(mensaje);
        return;
      }
      const resultado = (await res.json()) as FusionFamiliaResultado;
      toast.success(
        `${resultado.alias} se fusionó con ${resultado.destino} — ${formatoNumero(resultado.skus_que_migraran)} SKU migrarán en la próxima ingesta.`,
      );
      setOpen(false);
      setAlias("");
      setDestino("");
      onFusionado();
    } catch {
      toast.error(MENSAJE_ERROR_FUSION);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Fusionar familias</h3>
        <p className="text-[11.5px] text-ink-muted">
          Para corregir una errata: la familia de la izquierda deja de ofrecerse y sus SKU migran a la de la derecha
          en la próxima ingesta.
        </p>
      </div>

      <datalist id={listaId}>
        {items.map((f) => (
          <option key={f.id} value={f.nombre} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <Label htmlFor="fusion-alias">Familia con errata</Label>
          <Input
            id="fusion-alias"
            list={listaId}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="p. ej. SERIES2"
            autoComplete="off"
          />
        </div>
        <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <Label htmlFor="fusion-destino">Fusionar hacia</Label>
          <Input
            id="fusion-destino"
            list={listaId}
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            placeholder="p. ej. SERIES 2"
            autoComplete="off"
          />
        </div>
        <Button type="button" variant="outline" disabled={!listo} onClick={() => void abrir()}>
          Fusionar…
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar fusión</DialogTitle>
            <DialogDescription>Esta regla es permanente: se aplica en cada ingesta futura, no solo una vez.</DialogDescription>
          </DialogHeader>

          {cargandoPreview && <Skeleton className="h-24 w-full" />}
          {preview && <AlcanceFusion alias={aliasValor} destino={destinoValor} preview={preview} />}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleFusionar()} disabled={enviando || cargandoPreview || !preview}>
              {enviando ? "Fusionando…" : "Fusionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Card "Familias" (SOLO admin): lista de chips + alta inline.
 * Ediciones/desactivación NO se pintan en esta fase.
 *
 * GATE ANTI-REMOUNT (ronda de revisión INV-B7B, docs/engineering/failure-patterns.md
 * (P3)): forma canónica `{loading && !data && <Skeleton/>}` + `{data &&
 * <… aria-busy={loading}/>}` — con `data` ya en mano (p.ej. el refetch que
 * dispara un alta exitosa), los chips quedan MONTADOS (mismo nodo),
 * marcados `aria-busy`, en vez de desaparecer. Antes, `{!loading && !error
 * && data && (...)}` desmontaba los chips en CADA refetch (el gate exigía
 * `!loading`, así que cualquier refetch con `data` ya poblada los
 * reemplazaba por el `<Skeleton/>` de arriba). `error` solo reemplaza el
 * contenido cuando NO hay `data` que mostrar todavía (`useApi` vacía
 * `data` en un refetch fallido, ver `use-api.ts`) — mismo criterio que
 * `CatalogoView`/`ConfigUsuarios`. Candado de regresión (test de mutación)
 * en `config-familias.test.tsx`.
 */
export function ConfigFamilias() {
  const { data, error, loading, refetch } = useApi<FamiliasResponse>("/api/familias");
  const [nombre, setNombre] = useState("");
  const [errorAlta, setErrorAlta] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorAlta(null);
    const valor = nombre.trim();
    if (!valor) return;

    setGuardando(true);
    try {
      const res = await fetch("/api/familias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: valor }),
      });
      if (res.status === 409) {
        setErrorAlta(MENSAJE_FAMILIA_DUPLICADA);
        return;
      }
      if (!res.ok) {
        toast.error("No se pudo crear la familia.");
        return;
      }
      // `reactivada` (D, [MVP-2]): el mismo POST puede revivir una familia
      // inactiva homónima en vez de crear una — ver familias.service.ts.
      // El usuario merece saber cuál de las dos pasó, no un aviso genérico.
      const creada = (await res.json()) as { reactivada?: boolean; aliasVivo?: boolean };
      setNombre("");
      refetch();
      toast.success(
        creada.aliasVivo
          ? "Familia reactivada — pero sigue fusionada con otra, así que la ingesta no le asignará productos. Deshaz la fusión si eso no es lo que quieres."
          : creada.reactivada
            ? "Familia reactivada."
            : "Familia agregada.",
      );
    } catch {
      toast.error("No se pudo crear la familia.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[13.5px] font-semibold text-ink">Familias</h2>

      {loading && !data && <Skeleton className="h-8 w-full" />}
      {error && !data && <EstadoError mensaje={error.message} onRetry={refetch} />}
      {data && (
        <div className="flex flex-wrap gap-2" aria-busy={loading}>
          {data.items.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Aún no hay familias en el catálogo.</p>
          ) : (
            data.items.map((f) => (
              <Badge key={f.id} variant="secondary" className="font-normal">
                {f.nombre}
              </Badge>
            ))
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <Label htmlFor="nueva-familia-nombre">Nueva familia</Label>
          <Input
            id="nueva-familia-nombre"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              setErrorAlta(null);
            }}
            disabled={guardando}
            placeholder="Nombre de la familia"
          />
        </div>
        <Button type="submit" disabled={guardando || !nombre.trim()}>
          Agregar
        </Button>
      </form>
      {errorAlta && (
        <p role="alert" className="text-[11.5px] text-warn">
          {errorAlta}
        </p>
      )}

      {data && <DialogFusionar items={data.items} onFusionado={refetch} />}
    </Card>
  );
}
