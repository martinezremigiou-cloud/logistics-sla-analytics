"use client";

import Link from "next/link";
import { UserPlus, Tag, GitMerge, ShieldAlert, Scale, Atom, HelpCircle, FolderPlus, type LucideIcon } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatoFechaHora, formatoNumero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PendienteAcciones } from "./pendiente-acciones";
import { arregloPayload, marcarEspaciosDobles, numeroPayload, textoPayload, tituloPendiente } from "./pendiente-copy";
import type { EstadoPendiente, PendienteDato, TipoPendiente } from "@/types/api";

export interface PendienteFilaProps {
  pendiente: PendienteDato;
  /** Refetch de la bandeja — se propaga a `PendienteAcciones` (no-op para filas resuelto/descartado). */
  onResuelto: () => void;
  /**
   * (MVP-CIERRE F2) Vocabulario DECLARADO de tecnologías (`public.tecnologias`),
   * para el diálogo de `sku_sin_tecnologia`. Se pasa como prop en vez de
   * pedirlo aquí: la bandeja ya lo trae en su única respuesta y un fetch por
   * fila serían decenas de peticiones para la misma lista corta.
   */
  tecnologias?: string[];
}

const ICONO_TIPO: Record<TipoPendiente, { Icon: LucideIcon; clase: string }> = {
  kam_desconocido: { Icon: UserPlus, clase: "bg-info-bg text-info" },
  marca_west: { Icon: Tag, clase: "bg-warn-bg text-warn" },
  colision_familia: { Icon: GitMerge, clase: "bg-danger-bg text-danger" },
  cuarentena_etl: { Icon: ShieldAlert, clase: "bg-surface-3 text-ink-muted" },
  // (INV-TAXO F2 / INV-B7B) marca_ambigua: dos productores — 0011_taxo (2
  // capas que se contradicen) y 0012_b7b (la marca es en realidad una
  // TECNOLOGÍA-categoría, con o sin contradicción entre capas, ver
  // `pendiente-copy.ts`) — misma severidad que colision_familia (conflicto
  // de datos, no un simple pendiente de captura), ícono distinto (Scale:
  // "pesar entre varias opciones").
  marca_ambigua: { Icon: Scale, clase: "bg-danger-bg text-danger" },
  // familia_atomo_dudoso: pregunta de clasificación de bajo riesgo (la
  // compuerta anti-átomo-fantasma ya evitó el daño) — misma severidad que
  // marca_west (juicio pendiente, no urgente); Atom por el término de dominio.
  familia_atomo_dudoso: { Icon: Atom, clase: "bg-warn-bg text-warn" },
  // (MVP-CIERRE F2) sku_sin_tecnologia: no es un conflicto de datos —el SKU
  // entró bien— sino una clasificación que falta. Misma severidad que
  // marca_west/familia_atomo_dudoso (juicio pendiente, no urgente).
  sku_sin_tecnologia: { Icon: HelpCircle, clase: "bg-warn-bg text-warn" },
  // (B, [MVP-2]) familia_nueva: tampoco es un conflicto de datos — es una
  // familia que el catálogo nunca vio, esperando veredicto. Misma
  // severidad que sus vecinas de "juicio pendiente, no urgente"; FolderPlus
  // por el término de dominio (categoría nueva llegando al catálogo).
  familia_nueva: { Icon: FolderPlus, clase: "bg-warn-bg text-warn" },
};

function IconoPendiente({ tipo }: { tipo: TipoPendiente }) {
  const { Icon, clase } = ICONO_TIPO[tipo];
  return (
    <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", clase)}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
    </span>
  );
}

/** Detalle por tipo (spec F4) — usa siempre el crudo de `payload`, defensivo ante campos ausentes. */
function DetallePendiente({ pendiente }: { pendiente: PendienteDato }) {
  const { tipo, payload } = pendiente;

  if (tipo === "kam_desconocido") {
    // Solo con conteo real del encolado ETL (fix B3): los seeds de la
    // migración 0009 (RETAILER24 descartado, NADIA resuelto) no traen
    // `ocurrencias` en su payload — sin este guard pintaban "0 reservas en
    // 0 SKUs", un conteo fabricado y falso. abierto+sin ocurrencias
    // (defensivo) tampoco lo muestra; resuelto/descartado NUNCA lo muestran.
    if (pendiente.estado !== "abierto" || payload.ocurrencias === undefined) return null;
    const ocurrencias = numeroPayload(payload, "ocurrencias");
    const skus = arregloPayload(payload, "skus");
    return (
      <p className="text-[12px] text-ink-2">
        {formatoNumero(ocurrencias)} reservas en {formatoNumero(skus.length)} SKUs
      </p>
    );
  }

  if (tipo === "marca_west") {
    const sku = textoPayload(payload, "sku");
    const marcaActual = textoPayload(payload, "marca_actual");
    return (
      <p className="text-[12px] text-ink-2">
        marca actual {marcaActual || "—"} ·{" "}
        <Link href={`/catalogo/${encodeURIComponent(sku)}`} className="font-mono font-semibold text-ink hover:text-brand">
          {sku}
        </Link>
      </p>
    );
  }

  if (tipo === "colision_familia") {
    const variantes = arregloPayload(payload, "variantes");
    const skus = arregloPayload(payload, "skus");
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1.5">
          {variantes.map((v, i) => (
            <code key={i} className="w-fit rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
              {marcarEspaciosDobles(v)}
            </code>
          ))}
        </div>
        <p className="text-[11.5px] text-ink-muted">{formatoNumero(skus.length)} SKUs afectados</p>
      </div>
    );
  }

  if (tipo === "marca_ambigua") {
    const sku = textoPayload(payload, "sku");
    const marcaActual = textoPayload(payload, "marca_actual");
    const marcaFuente = textoPayload(payload, "marca_fuente");
    const tecnologia = textoPayload(payload, "tecnologia");
    const nMarcas = numeroPayload(payload, "n_marcas_de_la_tecnologia");
    // Dos productores con reglas distintas (ver cabecera de `pendiente-copy.ts`):
    // 0011_taxo SIEMPRE contradice v2 vs fuente; 0012_b7b ("tecnología
    // -categoría") trae casos reales donde `marca_actual === marca_fuente`
    // (p.ej. ambas "EAS") — pintar "v2 EAS vs fuente EAS" ahí se leería como un
    // error del sistema, no como la pregunta real. Por eso la contradicción
    // SOLO se pinta cuando de verdad existe; si no, se encabeza con la
    // tecnología (el motivo real, cuando el payload la trae — 0012) y, si
    // tampoco viene (payloads de 0011 incompletos/futuros), un respaldo neutro.
    const hayContradiccion = marcaActual !== "" && marcaFuente !== "" && marcaActual !== marcaFuente;
    const texto = hayContradiccion
      ? `v2 ${marcaActual} vs fuente ${marcaFuente}`
      : tecnologia
        ? `«${tecnologia}» es una tecnología, no un fabricante${nMarcas > 0 ? ` (${formatoNumero(nMarcas)} marcas posibles)` : ""}`
        : `marca actual ${marcaActual || "—"}`;
    return (
      <p className="text-[12px] text-ink-2">
        {texto} ·{" "}
        <Link href={`/catalogo/${encodeURIComponent(sku)}`} className="font-mono font-semibold text-ink hover:text-brand">
          {sku}
        </Link>
      </p>
    );
  }

  if (tipo === "familia_atomo_dudoso") {
    const atomos = arregloPayload(payload, "atomos");
    const fantasmas = new Set(arregloPayload(payload, "atomos_fantasma"));
    const skus = arregloPayload(payload, "skus");
    // (R3-5) El payload trae `n_skus` explícito (ver `pendiente-copy.ts`) —
    // es el conteo REAL de SKUs afectados; `skus` puede venir acotado/
    // muestreado. `n_skus` gana siempre que el backend lo mande como
    // número; `skus.length` es SOLO el respaldo para payloads que no lo
    // traigan (p.ej. fixtures previos a este campo).
    const nSkus = typeof payload.n_skus === "number" ? payload.n_skus : skus.length;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1.5">
          {atomos.map((atomo, i) => (
            <code
              key={i}
              title={fantasmas.has(atomo) ? "Átomo sospechoso de ser sufijo de modelo, no familia real" : undefined}
              className={cn(
                "w-fit rounded px-1.5 py-0.5 font-mono text-[11px]",
                fantasmas.has(atomo) ? "bg-warn-bg text-warn" : "bg-surface-3 text-ink-2",
              )}
            >
              {atomo}
            </code>
          ))}
        </div>
        <p className="text-[11.5px] text-ink-muted">{formatoNumero(nSkus)} SKUs con esta familia</p>
      </div>
    );
  }

  // (MVP-CIERRE F2) El payload ya trae todo lo que hace falta para decidir
  // SIN salir de la fila: marca y familia de origen, la descripción, y de
  // qué población viene. Con decenas de pendientes en cola, obligar a abrir la ficha
  // de cada uno sería el verdadero costo.
  if (tipo === "sku_sin_tecnologia") {
    const sku = textoPayload(payload, "sku");
    const marca = textoPayload(payload, "marca_origen");
    const familia = textoPayload(payload, "familia_origen");
    const descr = textoPayload(payload, "descr_origen");
    const poblacion = textoPayload(payload, "poblacion");
    const sinFamilia = payload.sin_familia === true;
    const ORIGEN: Record<string, string> = {
      alta_reciente: "entró en la última ingesta",
      preexistente_sin_ficha: "ya estaba, nunca tuvo ficha v2",
      ficha_sin_tecnologia: "tiene ficha v2, sin tecnología",
    };
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-[12px] text-ink-2">
          {marca && <>marca {marca} · </>}
          {sinFamilia ? <span className="text-warn">sin familia</span> : familia && <>familia {familia}</>} ·{" "}
          <Link href={`/catalogo/${encodeURIComponent(sku)}`} className="font-mono font-semibold text-ink hover:text-brand">
            {sku}
          </Link>
        </p>
        {descr && <p className="text-[11.5px] text-ink-muted">{descr}</p>}
        {poblacion && <p className="text-[11px] text-ink-muted">{ORIGEN[poblacion] ?? poblacion}</p>}
      </div>
    );
  }

  // (B, [MVP-2]) familia_nueva: la evidencia completa en la fila —
  // cuántos SKU la trajeron y con qué familias existentes se parece por
  // prefijo de tokens (0019) — para decidir sin abrir nada más. Si no hay
  // hermanas, lo dice (con o sin prefijo): el silencio no vale.
  if (tipo === "familia_nueva") {
    const prefijo = textoPayload(payload, "prefijo");
    const hermanas = arregloPayload(payload, "hermanas");
    const skus = arregloPayload(payload, "skus");
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[12px] text-ink-2">
          {formatoNumero(skus.length)} SKU {skus.length === 1 ? "la trajo" : "la trajeron"} en esta ingesta.
        </p>
        {hermanas.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-[12px] text-ink-2">
              Se parece a <strong>{formatoNumero(hermanas.length)} familias existentes</strong> que empiezan por{" "}
              <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px]">{prefijo}</code>:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {hermanas.map((h, i) => (
                <code key={i} className="w-fit rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {h}
                </code>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] text-ink-muted">
            {prefijo
              ? `Sin familias existentes que empiecen por «${prefijo}».`
              : "Nombre de una sola palabra: sin hermanas que sugerir."}
          </p>
        )}
        <p className="text-[12px] font-medium text-ink">¿Es una familia propia, o es la misma que una de éstas?</p>
      </div>
    );
  }

  // cuarentena_etl: sin productor todavía (B6 F2) — degrada a un motivo genérico si el payload no trae uno.
  const motivo = textoPayload(payload, "motivo");
  return <p className="text-[12px] text-ink-2">{motivo || "Requiere revisión manual."}</p>;
}

type EstadoResuelto = Extract<EstadoPendiente, "resuelto" | "descartado">;

const ESTADO_RESOLUCION_CLASE: Record<EstadoResuelto, string> = {
  resuelto: "bg-success-bg text-success",
  descartado: "bg-surface-3 text-ink-muted",
};
const ESTADO_RESOLUCION_LABEL: Record<EstadoResuelto, string> = {
  resuelto: "Resuelto",
  descartado: "Descartado",
};

/** Solo-lectura para filas resuelto/descartado: badge de estado + actor/fecha + motivo — SIN acciones. */
function ResolucionInfo({ pendiente }: { pendiente: PendienteDato }) {
  if (pendiente.estado === "abierto") return null;
  const estado = pendiente.estado;
  const motivo = pendiente.resolucion && typeof pendiente.resolucion.motivo === "string" ? pendiente.resolucion.motivo : null;
  const esAltaKam = pendiente.tipo === "kam_desconocido" && estado === "resuelto";
  // (INV-TAXO F2) confirmar marca_ambigua SÍ escribe (alta en `marcas` + upsert de
  // clasificacion_v2.marca_v2, ver 0011_taxo.sql) — `resolucion.marca` es el nombre
  // CANÓNICO que quedó. familia_atomo_dudoso NO tiene equivalente a propósito: su
  // "confirmar" ratifica el statu quo sin escribir nada (ver DetallePendiente arriba).
  const marcaConfirmada =
    pendiente.tipo === "marca_ambigua" && estado === "resuelto" && pendiente.resolucion && typeof pendiente.resolucion.marca === "string"
      ? pendiente.resolucion.marca
      : null;

  // (MVP-CIERRE F2) `sku_sin_tecnologia` se resuelve escribiendo la
  // clasificación (upsert de clasificacion_v2, 0013) — se pinta lo que
  // quedó, igual que marca_ambigua.
  const res = pendiente.resolucion;
  const tecConfirmada =
    pendiente.tipo === "sku_sin_tecnologia" && estado === "resuelto" && res && typeof res.tecnologia === "string"
      ? res.tecnologia
      : null;
  const famConfirmada =
    pendiente.tipo === "sku_sin_tecnologia" && estado === "resuelto" && res && typeof res.familia === "string"
      ? res.familia
      : null;

  // (MVP-CIERRE F2) EL AUTO-CIERRE TIENE QUE VERSE. `sku_sin_tecnologia` es
  // un criterio de ESTADO: la ingesta cierra sola los que dejaron de aplicar
  // —porque el SKU recibió tecnología por otra vía, o salió del catálogo—.
  // Si eso se pintara igual que una resolución humana, la bandeja diría
  // "resuelto por auto:ingesta" y nadie sabría que nadie decidió nada. Un
  // pendiente que se cierra sin rastro es P15 con otro disfraz.
  const autoCerrado = res && res.accion === "auto_cierre";

  return (
    <div className="flex flex-col gap-1">
      <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold", ESTADO_RESOLUCION_CLASE[estado])}>
        {ESTADO_RESOLUCION_LABEL[estado]}
      </span>
      {autoCerrado && (
        <span className="inline-flex w-fit items-center rounded-full bg-info-bg px-2.5 py-0.5 text-[11px] font-semibold text-info">
          cerrado automáticamente
        </span>
      )}
      <p className="text-[11.5px] text-ink-muted">
        {pendiente.resuelto_por ?? "—"} · {formatoFechaHora(pendiente.resuelto_en)}
      </p>
      {motivo && <p className="text-[12px] text-ink-2">{motivo}</p>}
      {esAltaKam && <p className="text-[11.5px] text-ink-muted">→ alta en catálogo KAMs</p>}
      {marcaConfirmada && <p className="text-[11.5px] text-ink-muted">→ marca confirmada: {marcaConfirmada}</p>}
      {tecConfirmada && (
        <p className="text-[11.5px] text-ink-muted">
          → tecnología: {tecConfirmada}
          {famConfirmada && ` · familia: ${famConfirmada}`}
        </p>
      )}
    </div>
  );
}

/** Fila de la bandeja (Table de shadcn, patrón `ficha-reservas.tsx`): icono por tipo · título + detalle + fecha · acciones (abierto) o resolución (resuelto/descartado). */
export function PendienteFila({ pendiente, onResuelto, tecnologias = [] }: PendienteFilaProps) {
  return (
    <TableRow className="border-line-soft align-top">
      <TableCell className="w-[52px]">
        <IconoPendiente tipo={pendiente.tipo} />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-semibold text-ink">{tituloPendiente(pendiente)}</p>
          <DetallePendiente pendiente={pendiente} />
          <p className="text-[11px] text-ink-muted">{formatoFechaHora(pendiente.detectado_en)}</p>
        </div>
      </TableCell>
      <TableCell>
        {pendiente.estado === "abierto" ? (
          <PendienteAcciones pendiente={pendiente} onResuelto={onResuelto} tecnologias={tecnologias} />
        ) : (
          <ResolucionInfo pendiente={pendiente} />
        )}
      </TableCell>
    </TableRow>
  );
}
