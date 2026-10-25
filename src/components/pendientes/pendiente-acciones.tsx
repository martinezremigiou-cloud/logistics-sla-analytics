"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { formatoNumero } from "@/lib/formato";
import { arregloPayload, capitalizarNombre, textoPayload } from "./pendiente-copy";
import type { PendienteDato, ResolverPendienteResult, ResolverFamiliaNuevaResult } from "@/types/api";
import type { ResolverPendienteBody, ResolverFamiliaNuevaBody } from "@/schemas/pendientes.schema";

const MENSAJE_ERROR_GENERICO = "No se pudo procesar el pendiente.";

/**
 * POST /api/pendientes/[id] (confirmar/descartar): `toast.error` con el
 * mensaje curado del API si viene (p.ej. 400 "pendiente ya resuelto"),
 * fallback genérico si no — NUNCA lanza (mismo criterio que
 * `guardarCampo` de `ficha-atributos.tsx`).
 */
async function resolverPendienteFetch(id: string, body: ResolverPendienteBody): Promise<ResolverPendienteResult | null> {
  try {
    const res = await fetch(`/api/pendientes/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let mensaje = MENSAJE_ERROR_GENERICO;
      try {
        const errBody = (await res.json()) as { message?: string };
        if (typeof errBody.message === "string" && errBody.message) mensaje = errBody.message;
      } catch {
        // Respuesta de error sin JSON válido: se conserva el mensaje genérico.
      }
      toast.error(mensaje);
      return null;
    }
    return (await res.json()) as ResolverPendienteResult;
  } catch {
    toast.error(MENSAJE_ERROR_GENERICO);
    return null;
  }
}

/**
 * (B, [MVP-2]) POST /api/pendientes/[id]/fusionar — SOLO para la rama
 * "es la misma que X" de `familia_nueva`. Endpoint distinto de
 * `resolverPendienteFetch` (la RPC de atrás tiene otra firma, ver
 * `pendientes.service.ts`); mismo criterio de error: `toast.error` con
 * el mensaje curado del API si viene, NUNCA lanza.
 */
async function resolverFamiliaNuevaFetch(id: string, body: ResolverFamiliaNuevaBody): Promise<ResolverFamiliaNuevaResult | null> {
  try {
    const res = await fetch(`/api/pendientes/${id}/fusionar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let mensaje = MENSAJE_ERROR_GENERICO;
      try {
        const errBody = (await res.json()) as { message?: string };
        if (typeof errBody.message === "string" && errBody.message) mensaje = errBody.message;
      } catch {
        // Respuesta de error sin JSON válido: se conserva el mensaje genérico.
      }
      toast.error(mensaje);
      return null;
    }
    return (await res.json()) as ResolverFamiliaNuevaResult;
  } catch {
    toast.error(MENSAJE_ERROR_GENERICO);
    return null;
  }
}

export interface PendienteAccionesProps {
  pendiente: PendienteDato;
  /** Refetch de la bandeja (`useApi` de `BandejaView`) — se invoca tras cada resolución exitosa. */
  onResuelto: () => void;
  /** (MVP-CIERRE F2) Vocabulario declarado de tecnologías, para `sku_sin_tecnologia`. */
  tecnologias?: string[];
}

/**
 * Botonera de un pendiente ABIERTO — varía por `tipo` (spec F4). Las filas
 * resuelto/descartado son de solo lectura (ver `ResolucionInfo` en
 * `pendiente-fila.tsx`): este componente solo se monta para `estado==='abierto'`.
 */
export function PendienteAcciones({ pendiente, onResuelto, tecnologias = [] }: PendienteAccionesProps) {
  const descartar = <DialogDescartar id={pendiente.id} onResuelto={onResuelto} />;

  if (pendiente.tipo === "kam_desconocido") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <DialogConfirmarKam pendiente={pendiente} onResuelto={onResuelto} />
        {descartar}
      </div>
    );
  }

  if (pendiente.tipo === "marca_west") {
    const sku = textoPayload(pendiente.payload, "sku");
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" asChild>
          <Link href={`/catalogo/${encodeURIComponent(sku)}`}>Abrir ficha</Link>
        </Button>
        <DialogMarcarResuelto id={pendiente.id} pregunta="¿Ya corregiste la marca en la ficha?" onResuelto={onResuelto} />
        {descartar}
      </div>
    );
  }

  if (pendiente.tipo === "colision_familia") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" asChild>
          <Link href="/config?tab=familias">Abrir familias</Link>
        </Button>
        <DialogMarcarResuelto id={pendiente.id} pregunta="¿Ya corregiste la colisión de familia en Familias?" onResuelto={onResuelto} />
        {descartar}
      </div>
    );
  }

  if (pendiente.tipo === "marca_ambigua") {
    const sku = textoPayload(pendiente.payload, "sku");
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" asChild>
          <Link href={`/catalogo/${encodeURIComponent(sku)}`}>Abrir ficha</Link>
        </Button>
        <DialogElegirMarca pendiente={pendiente} onResuelto={onResuelto} />
        {descartar}
      </div>
    );
  }

  if (pendiente.tipo === "familia_atomo_dudoso") {
    const opcionDescartar =
      textoPayload(pendiente.payload, "opcion_descartar") ||
      "Son DOS familias distintas: separarlas exige un cambio de datos o de código fuera de este flujo — aquí solo se registra el veredicto, no se aplica.";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <DialogRatificarFamilia pendiente={pendiente} onResuelto={onResuelto} />
        <DialogDescartar
          id={pendiente.id}
          onResuelto={onResuelto}
          triggerLabel="Descartar: son dos familias"
          notaAdicional={opcionDescartar}
        />
      </div>
    );
  }

  if (pendiente.tipo === "sku_sin_tecnologia") {
    const sku = textoPayload(pendiente.payload, "sku");
    return (
      <div className="flex flex-wrap items-center gap-2">
        <DialogClasificarSku pendiente={pendiente} onResuelto={onResuelto} tecnologias={tecnologias} />
        <Button type="button" size="sm" variant="outline" asChild>
          <Link href={`/catalogo/${encodeURIComponent(sku)}`}>Abrir ficha</Link>
        </Button>
        {descartar}
      </div>
    );
  }

  // (B, [MVP-2]) familia_nueva: dos caminos + descartar (spec del frente
  // B). "Es la misma que…" fusiona (RPC aparte, ver DialogFusionarFamiliaNueva);
  // "Es una familia propia" RATIFICA vía el confirmar genérico — mismo
  // criterio que familia_atomo_dudoso (confirmar no escribe ninguna regla
  // nueva, solo dice "el catálogo ya está bien como está").
  if (pendiente.tipo === "familia_nueva") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <DialogFusionarFamiliaNueva pendiente={pendiente} onResuelto={onResuelto} />
        <DialogMarcarResuelto
          id={pendiente.id}
          pregunta={`¿"${textoPayload(pendiente.payload, "familia")}" es una familia PROPIA, distinta de las existentes? Se confirma sin fusionarla con ninguna otra.`}
          triggerLabel="Es una familia propia"
          dialogTitle="¿Es una familia nueva?"
          onResuelto={onResuelto}
        />
        {descartar}
      </div>
    );
  }

  // cuarentena_etl: sin destino de navegación propio (sin productor todavía, B6 F2) — mismo par genérico confirmar/descartar.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DialogMarcarResuelto id={pendiente.id} pregunta="¿Ya revisaste este registro en cuarentena?" onResuelto={onResuelto} />
      {descartar}
    </div>
  );
}

/**
 * (B, [MVP-2]) "Es la misma que…" de `familia_nueva`: escribe un ALIAS
 * permanente (RPC `resolver_familia_nueva` → `fusionar_familia`, 0019/
 * 0018) — NUNCA asigna sola, el admin elige el destino. Las `hermanas`
 * del payload (mismo prefijo de tokens, 0019) se ofrecen como chips que
 * PRELLENAN el input (no seleccionan directo, mismo patrón que
 * `sugerencias` en `DialogClasificarSku`): el destino real puede no estar
 * entre ellas, así que el input siempre queda editable. Si `hermanas`
 * viene vacío no se ofrece ninguna — se pregunta igual (spec del frente).
 * `motivo` se compone aquí con el destino elegido para que quede trazado
 * en `resolucion.motivo` (el RPC no persiste `destino` en ningún otro
 * campo — ver `pendientes.schema.ts`), y lo pinta el render GENÉRICO de
 * motivo que ya tiene `ResolucionInfo`, sin rama nueva ahí.
 */
function DialogFusionarFamiliaNueva({ pendiente, onResuelto }: { pendiente: PendienteDato; onResuelto: () => void }) {
  const familia = textoPayload(pendiente.payload, "familia");
  const hermanas = arregloPayload(pendiente.payload, "hermanas");
  const [open, setOpen] = useState(false);
  const [destino, setDestino] = useState("");
  const [enviando, setEnviando] = useState(false);

  function abrir() {
    setDestino("");
    setOpen(true);
  }

  async function handleConfirmar() {
    const valor = destino.trim();
    if (!valor) return;
    setEnviando(true);
    try {
      const resultado = await resolverFamiliaNuevaFetch(pendiente.id, {
        destino: valor,
        motivo: `Fusionada con «${valor}».`,
        // Confirmación de doble llave: el conteo que el productor guardó en
        // el payload y que esta fila ya le mostró al admin. `fusionar_familia`
        // (0018) lo contrasta contra el conteo VIVO y aborta si no coincide —
        // así, si una ingesta movió SKU entre que se encoló el pendiente y
        // este clic, la fusión se detiene en vez de aplicarse a ciegas.
        skusEsperados: arregloPayload(pendiente.payload, "skus").length,
      });
      if (resultado) {
        const { skus_que_migraran } = resultado.fusion;
        toast.success(`${familia} se fusionó con ${valor} — ${formatoNumero(skus_que_migraran)} SKU migrarán en la próxima ingesta.`);
        setOpen(false);
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={abrir}>
        Es la misma que…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Con cuál familia existente es la misma?</DialogTitle>
            <DialogDescription>
              Se crea una regla permanente: la próxima vez que «{familia}» llegue en el Excel, se asignará
              automáticamente a la familia que elijas aquí.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pendiente-familia-nueva-destino-${pendiente.id}`}>Familia destino</Label>
            <Input
              id={`pendiente-familia-nueva-destino-${pendiente.id}`}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              disabled={enviando}
              autoComplete="off"
            />
            {hermanas.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11px] text-ink-muted">hermanas:</span>
                {hermanas.map((h) => (
                  <button
                    key={h}
                    type="button"
                    disabled={enviando}
                    onClick={() => setDestino(h)}
                    className="rounded-[7px] border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2 transition-colors hover:bg-surface-input"
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmar()} disabled={enviando || !destino.trim()}>
              {enviando ? "Fusionando…" : "Fusionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DialogConfirmarKam({ pendiente, onResuelto }: { pendiente: PendienteDato; onResuelto: () => void }) {
  const kamRaw = textoPayload(pendiente.payload, "kam_raw");
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState(() => capitalizarNombre(kamRaw));
  const [enviando, setEnviando] = useState(false);

  function abrir() {
    setNombre(capitalizarNombre(kamRaw));
    setOpen(true);
  }

  async function handleConfirmar() {
    const valor = nombre.trim();
    if (!valor) return;
    setEnviando(true);
    try {
      const resultado = await resolverPendienteFetch(pendiente.id, { accion: "confirmar", valor });
      if (resultado) {
        toast.success(`KAM ${valor} dado de alta`);
        setOpen(false);
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={abrir}>
        Confirmar como KAM
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar como KAM</DialogTitle>
            <DialogDescription>Se dará de alta en el catálogo de KAMs con este nombre (o se reutiliza si ya existe).</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pendiente-kam-nombre-${pendiente.id}`}>Nombre canónico</Label>
            <Input
              id={`pendiente-kam-nombre-${pendiente.id}`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              disabled={enviando}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmar()} disabled={enviando || !nombre.trim()}>
              {enviando ? "Guardando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * (INV-TAXO F2 / INV-B7B) "Elegir marca correcta" (`marca_ambigua`): dos
 * productores con preguntas distintas para el MISMO `tipo` (ver cabecera
 * de `pendiente-copy.ts`) — 0011_taxo encola cuando las 2 capas (v2 vs
 * fuente vigente) se CONTRADICEN; 0012_b7b encola cuando la marca es en
 * realidad el nombre de una TECNOLOGÍA (p.ej. "EAS") y no el de un
 * fabricante, con o sin contradicción entre capas. En ambos casos alguien
 * debe elegir la marca correcta entre `candidatas` (2 en 0011, hasta 9 en
 * 0012) — ver `marca_actual`/`marca_fuente`/`tecnologia` en el payload.
 * SIN preselección a propósito (`elegida` arranca en `null` cada vez que
 * se abre): el RPC rechaza un `confirmar` sin `valor` para este tipo
 * (fail-closed, 0011_taxo.sql), y aquí la UI hace ese requisito IMPOSIBLE
 * de saltarse (el botón "Confirmar" queda deshabilitado hasta elegir una
 * candidata).
 */
function DialogElegirMarca({ pendiente, onResuelto }: { pendiente: PendienteDato; onResuelto: () => void }) {
  const sku = textoPayload(pendiente.payload, "sku");
  const marcaActual = textoPayload(pendiente.payload, "marca_actual");
  const marcaFuente = textoPayload(pendiente.payload, "marca_fuente");
  const candidatas = arregloPayload(pendiente.payload, "candidatas");
  const pregunta = textoPayload(pendiente.payload, "pregunta");
  const [open, setOpen] = useState(false);
  const [elegida, setElegida] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function abrir() {
    setElegida(null);
    setOpen(true);
  }

  function origenDe(candidata: string): string {
    if (candidata === marcaActual) return "Clasificación v2";
    if (candidata === marcaFuente) return "Fuente vigente";
    return "";
  }

  async function handleConfirmar() {
    if (!elegida) return;
    setEnviando(true);
    try {
      const resultado = await resolverPendienteFetch(pendiente.id, { accion: "confirmar", valor: elegida });
      if (resultado) {
        toast.success(`Marca ${elegida} confirmada.`);
        setOpen(false);
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={abrir}>
        Elegir marca correcta
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Elegir marca correcta</DialogTitle>
            <DialogDescription>
              {pregunta || `Elige la marca correcta de ${sku} entre las opciones disponibles.`}
            </DialogDescription>
          </DialogHeader>
          {/* (INV-B7B) 0012_b7b puede traer hasta 9 candidatas (vs. 2 en 0011)
              — scroll interno con tope de alto para que la lista no empuje el
              footer (Cancelar/Confirmar) fuera del viewport en pantallas
              chicas; `DialogContent` (shadcn) no trae su propio max-height. */}
          <div role="radiogroup" aria-label="Marca correcta" className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
            {candidatas.map((candidata) => {
              const seleccionada = elegida === candidata;
              const origen = origenDe(candidata);
              return (
                <button
                  key={candidata}
                  type="button"
                  role="radio"
                  aria-checked={seleccionada}
                  disabled={enviando}
                  onClick={() => setElegida(candidata)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-[9px] border px-3 py-2 text-left transition-colors",
                    seleccionada ? "border-brand bg-brand/5" : "border-line hover:bg-surface-input",
                  )}
                >
                  <span className="font-mono text-[13px] font-semibold text-ink">{candidata}</span>
                  {origen && <span className="text-[11px] text-ink-muted">{origen}</span>}
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmar()} disabled={enviando || !elegida}>
              {enviando ? "Guardando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * (MVP-CIERRE F2) Valores que el admin ya usó en esta bandeja, para
 * ofrecerlos de un clic.
 *
 * Existe por una razón medida: son decenas de pendientes y se agrupan fuerte —la
 * mayoría de marca NACIONAL, otras BRAND1 o VERTICAL—. Sin esto, resolverlos significa
 * teclear la misma palabra muchas veces, y ese es el costo real de este
 * frente, no el diálogo.
 *
 * Se guarda en `localStorage` y NO se hardcodea ningún vocabulario: la lista
 * arranca vacía y la construye el propio admin con su primera decisión. Así
 * la UI no inventa tecnologías que el negocio no usa, ni envejece cuando
 * aparezca una nueva. Cualquier fallo de almacenamiento (modo privado,
 * cuota) degrada a "sin sugerencias", nunca rompe el diálogo.
 */
const CLAVE_RECIENTES = "app:tecnologias-recientes";
const TOPE_RECIENTES = 8;

function leerRecientes(): string[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE_RECIENTES);
    const lista: unknown = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(lista) ? lista.filter((v): v is string => typeof v === "string").slice(0, TOPE_RECIENTES) : [];
  } catch {
    return [];
  }
}

function recordarReciente(valor: string): void {
  try {
    const previos = leerRecientes().filter((v) => v.toUpperCase() !== valor.toUpperCase());
    window.localStorage.setItem(CLAVE_RECIENTES, JSON.stringify([valor, ...previos].slice(0, TOPE_RECIENTES)));
  } catch {
    // Sin almacenamiento no hay sugerencias — el diálogo sigue funcionando.
  }
}

/**
 * (MVP-CIERRE F2) "Clasificar" de `sku_sin_tecnologia`: el admin decide
 * tecnología y —solo si falta— familia, EN UN SOLO VIAJE (decisión de producto).
 * Un pendiente por SKU, una visita por SKU.
 *
 * El `valor` viaja como JSON (`{"tecnologia","familia"}`) porque la firma
 * del RPC tiene un solo `p_valor text` y añadir un parámetro obligaría a
 * DROP+CREATE de una función que la app ya llama con 4 argumentos
 * nombrados. `familia` es opcional y solo se pide cuando el payload dice
 * `sin_familia`. Ver 0013.
 *
 * FAIL-CLOSED igual que `marca_ambigua`: el RPC rechaza un confirmar sin
 * tecnología, y aquí el botón queda deshabilitado hasta que haya una — el
 * requisito se vuelve imposible de saltarse desde la UI, no solo desde SQL.
 */
function DialogClasificarSku({
  pendiente,
  onResuelto,
  tecnologias = [],
}: {
  pendiente: PendienteDato;
  onResuelto: () => void;
  tecnologias?: string[];
}) {
  const sku = textoPayload(pendiente.payload, "sku");
  const marcaOrigen = textoPayload(pendiente.payload, "marca_origen");
  const descr = textoPayload(pendiente.payload, "descr_origen");
  const pregunta = textoPayload(pendiente.payload, "pregunta");
  const faltaFamilia = pendiente.payload.sin_familia === true;

  const [open, setOpen] = useState(false);
  const [tecnologia, setTecnologia] = useState("");
  const [familia, setFamilia] = useState("");
  const [recientes, setRecientes] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  function abrir() {
    setTecnologia("");
    setFamilia("");
    setRecientes(leerRecientes());
    setOpen(true);
  }

  // El vocabulario DECLARADO va primero (`public.tecnologias`: EAS, BRAND2,
  // BRAND1, VERTICAL) y lo ya usado después, sin repetir. Arrancar vacío
  // descartaba información real: la tabla existe desde 0011, está poblada y
  // en sincronía perfecta con `clasificacion_v2` (cero valores sin respaldo).
  // Lo "reciente" sigue teniendo sentido para una tecnología nueva que
  // todavía no esté en el catálogo.
  const yaEnCatalogo = new Set(tecnologias.map((t) => t.toUpperCase()));
  const sugerencias = [...tecnologias, ...recientes.filter((r) => !yaEnCatalogo.has(r.toUpperCase()))];

  async function handleConfirmar() {
    const tec = tecnologia.trim();
    if (!tec) return;
    const fam = familia.trim();
    setEnviando(true);
    try {
      const valor = JSON.stringify(fam ? { tecnologia: tec, familia: fam } : { tecnologia: tec });
      const resultado = await resolverPendienteFetch(pendiente.id, { accion: "confirmar", valor });
      if (resultado) {
        recordarReciente(tec);
        toast.success(`${sku}: tecnología ${tec}${fam ? ` · familia ${fam}` : ""}`);
        setOpen(false);
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={abrir}>
        Clasificar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clasificar {sku}</DialogTitle>
            <DialogDescription>
              {pregunta || "¿Qué tecnología le corresponde a este SKU?"}
            </DialogDescription>
          </DialogHeader>

          {/* Contexto para decidir sin abrir la ficha: es lo que hace
              soportable resolver decenas seguidos. */}
          {(marcaOrigen || descr) && (
            <div className="rounded-[9px] bg-surface-3 px-3 py-2">
              {marcaOrigen && <p className="text-[12px] text-ink-2">marca de origen: {marcaOrigen}</p>}
              {descr && <p className="text-[11.5px] text-ink-muted">{descr}</p>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pendiente-tec-${pendiente.id}`}>Tecnología</Label>
            <Input
              id={`pendiente-tec-${pendiente.id}`}
              value={tecnologia}
              onChange={(e) => setTecnologia(e.target.value)}
              disabled={enviando}
              autoComplete="off"
            />
            {sugerencias.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11px] text-ink-muted">tecnologías:</span>
                {sugerencias.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={enviando}
                    onClick={() => setTecnologia(r)}
                    className="rounded-[7px] border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2 transition-colors hover:bg-surface-input"
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          {faltaFamilia && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`pendiente-fam-${pendiente.id}`}>Familia (opcional)</Label>
              <Input
                id={`pendiente-fam-${pendiente.id}`}
                value={familia}
                onChange={(e) => setFamilia(e.target.value)}
                disabled={enviando}
                autoComplete="off"
              />
              <p className="text-[11px] text-ink-muted">Este SKU tampoco tiene familia. Si la dejas vacía, se queda sin familia.</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmar()} disabled={enviando || !tecnologia.trim()}>
              {enviando ? "Guardando…" : "Clasificar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * (INV-TAXO F2) "Confirmar" de `familia_atomo_dudoso`: RATIFICA que el
 * valor es UNA sola familia (la compuerta anti-átomo-fantasma acertó) —
 * el RPC NO escribe nada para este tipo (0011_taxo.sql). El copy usa
 * `opcion_confirmar` del payload (texto real del veredicto) con un
 * respaldo si falta, y el botón dice "Ratificar" (no un "Confirmar"
 * genérico) para que nunca aparente aplicar un cambio que no ocurre.
 */
function DialogRatificarFamilia({ pendiente, onResuelto }: { pendiente: PendienteDato; onResuelto: () => void }) {
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const opcionConfirmar =
    textoPayload(pendiente.payload, "opcion_confirmar") ||
    "Confirmar aquí RATIFICA que es una sola familia: no se escribe ningún dato, el valor ya se lee sin separar.";

  async function handleConfirmar() {
    setEnviando(true);
    try {
      const resultado = await resolverPendienteFetch(pendiente.id, { accion: "confirmar" });
      if (resultado) {
        toast.success("Familia ratificada — no se modificó ningún dato.");
        setOpen(false);
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Confirmar: es una sola familia
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Es una sola familia?</DialogTitle>
            <DialogDescription>{opcionConfirmar}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmar()} disabled={enviando}>
              {enviando ? "Guardando…" : "Ratificar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface DialogMarcarResueltoProps {
  id: string;
  pregunta: string;
  onResuelto: () => void;
  /** (B, [MVP-2]) Copy del botón disparador; por defecto "Marcar resuelto" (sin cambio para marca_west/colision_familia/cuarentena_etl). */
  triggerLabel?: string;
  /** (B, [MVP-2]) Título del diálogo; por defecto "Marcar como resuelto". */
  dialogTitle?: string;
}

/**
 * "Marcar resuelto" genérico (marca_west / colision_familia /
 * cuarentena_etl / la rama "es una familia propia" de familia_nueva):
 * confirma sin exigir motivo — el RPC `resolver_pendiente` trata estos
 * tipos igual (sin el alta especial de `kam_desconocido`).
 */
function DialogMarcarResuelto({
  id,
  pregunta,
  onResuelto,
  triggerLabel = "Marcar resuelto",
  dialogTitle = "Marcar como resuelto",
}: DialogMarcarResueltoProps) {
  const [open, setOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function handleConfirmar() {
    setEnviando(true);
    try {
      const resultado = await resolverPendienteFetch(id, { accion: "confirmar" });
      if (resultado) {
        toast.success("Marcado como resuelto.");
        setOpen(false);
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{pregunta}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConfirmar()} disabled={enviando}>
              {enviando ? "Guardando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface DialogDescartarProps {
  id: string;
  onResuelto: () => void;
  /** Copy del botón disparador. Por defecto "Descartar" (sin cambio para los tipos previos a INV-TAXO F2). */
  triggerLabel?: string;
  /** Texto adicional ANTES de la pregunta genérica de motivo (p.ej. `opcion_descartar` de `familia_atomo_dudoso`). */
  notaAdicional?: string;
}

function DialogDescartar({ id, onResuelto, triggerLabel = "Descartar", notaAdicional }: DialogDescartarProps) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setMotivo("");
  }

  async function handleDescartar() {
    const valor = motivo.trim();
    if (!valor || enviando) return;
    setEnviando(true);
    try {
      const resultado = await resolverPendienteFetch(id, { accion: "descartar", motivo: valor });
      if (resultado) {
        toast.success("Pendiente descartado.");
        onResuelto();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar pendiente</AlertDialogTitle>
            <AlertDialogDescription>Explica brevemente por qué se descarta. El motivo queda registrado.</AlertDialogDescription>
          </AlertDialogHeader>
          {notaAdicional && <p className="text-[12.5px] text-ink-2">{notaAdicional}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pendiente-descartar-motivo-${id}`}>Motivo</Label>
            <Textarea
              id={`pendiente-descartar-motivo-${id}`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={enviando}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={enviando || !motivo.trim()} onClick={() => void handleDescartar()}>
              Confirmar descarte
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
