"use client";

import { useEffect, useState } from "react";
import { Check, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApi } from "@/lib/hooks/use-api";
import { useSesion } from "@/components/providers/session-provider";
import { MUESTRA_CLASIFICACION_V2 } from "@/lib/roles";
import { COLORES_SKU, ORDEN_COLORES_SKU, type ColorSku } from "@/lib/colores-sku";
import { ListaFamiliaChips } from "@/components/shared/familias-chips";
import { cn } from "@/lib/utils";
import type { OverrideResult } from "@/types/api";
import type { OrigenClasificacion } from "@/types/enums";

export interface FichaAtributosProps {
  sku: string;
  /** (R3-4) Marca efectiva (v2 ?? fuente) — SIEMPRE solo-lectura en ambos roles: no existe override de marca, mismo criterio que `clase`. [FIX-B1] `tecnologia` YA NO comparte este criterio: desde este bloque tiene override propio (admin) — ver `TecnologiaEditable`. */
  marca: string;
  familiaEfectiva: string | null;
  /**
   * (INV-TAXO F2) `familiaEfectiva` ya separada en sus átomos — ver
   * `separarFamilias`, `src/lib/familias.ts`. Invariante: `familiasEfectivas
   * === separarFamilias(familiaEfectiva)` (hasta una docena de átomos en un campo,
   * con una fracción visible de los SKUs afectados). Requerido (no opcional), mismo criterio que
   * `SkuDetalle.familias_efectivas` en `types/api.ts`: que `tsc` enumere
   * este call-site en vez de dejarlo navegando por el string crudo.
   *
   * (R3-5) Consumida SOLO por `FichaAtributosSoloLectura` (rol `kam`): es
   * la única que pinta un chip por elemento, vía `ListaFamiliaChips`
   * (`components/shared/familias-chips.tsx`) — el origen (badge `editado`/
   * `clasificación v2`) es del CAMPO completo y se pinta UNA sola vez,
   * nunca uno por chip. `FichaAtributosEditable` (rol `admin`) NO la
   * consume a propósito: `FamiliaEditable` edita `familiaEfectiva` como
   * valor ÚNICO — el contrato `PUT /api/override` reemplaza el campo
   * completo, nunca un átomo suelto, así que no hay una acción de "editar
   * este chip" que darle a cada elemento. La prop se mantiene requerida
   * (no partida en dos interfaces) para que ambos modos compartan el mismo
   * `FichaAtributosProps` sin duplicar el resto del contrato.
   */
  familiasEfectivas: string[];
  descrEfectiva: string | null;
  original: { familia: string | null; descr: string | null };
  /**
   * [2.0.1-A · D3] Qué capa gana cuando la pantalla y el archivo de inventario
   * no dicen lo mismo. Solo 'v2' pinta la insignia de atención: la divergencia
   * MANUAL ya no es silenciosa (tiene autor, fecha y botón de revertir, justo
   * aquí al lado).
   */
  divergenciaFamilia?: 'v2' | 'manual' | null;
  /** `undefined` en fixtures viejos (mismo criterio que `SkuDetalle.color`) — se trata como `null`. */
  color?: string | null;
  /** Clase efectiva (B-PARCHE F4): SIEMPRE solo-lectura (sin override) para ambos roles. `undefined` en fixtures previos a F1/F4 — mismo criterio que `color`. */
  clase?: string | null;
  /**
   * Tecnología EFECTIVA. [FIX-B1] Ya NO es siempre solo-lectura: para el rol
   * admin es editable cuando el Excel no la trae (`TecnologiaEditable`, más
   * abajo) — EL EXCEL GANA, la única capa con el orden invertido respecto a
   * familia/descripción (ver `capaFuenteManual`, `services/derivaciones.ts`).
   * Para roles no-admin sigue siendo solo el valor, sin ninguna insignia.
   * `undefined` en fixtures previos a F1/F4 — mismo criterio que `color`.
   */
  tecnologia?: string | null;
  /**
   * [FIX-B1] El valor CAPTURADO en el portal (override activo de
   * `campo='tecnologia'`), independiente de si está en efecto o no. `null` =
   * nunca se capturó nada. Solo lo usa la vista admin, para distinguir:
   *   - Excel vacío + `tecnologiaPortal` no-nulo → está EN EFECTO (origen
   *     'manual', `tecnologia === tecnologiaPortal`): insignia "Capturada
   *     en el portal" + botón para quitarla.
   *   - Excel poblado + `tecnologiaPortal` no-nulo → quedó SIN efecto: nota
   *     "Lo capturado en el portal (X) ya no aplica: manda el Excel" + la
   *     misma opción de quitarlo.
   * `undefined` en fixtures previos a este bloque — se trata como `null`.
   */
  tecnologiaPortal?: string | null;
  /**
   * Capa que aportó cada valor efectivo (B-PARCHE F1/F4): determina qué
   * badge (si alguno) acompaña cada fila. `undefined` = fixtures previos a
   * F1 — el componente infiere 'manual'/'fuente' comparando la efectiva
   * contra el original (mismo comportamiento pre-F1, ver `resolverOrigen`).
   */
  origenes?: {
    descr: OrigenClasificacion;
    familia: OrigenClasificacion;
    marca: OrigenClasificacion;
    clase: OrigenClasificacion;
    tecnologia: OrigenClasificacion | null;
  };
  /**
   * Valores CRUDOS de `clasificacion_v2` (B-PARCHE F1/F4), sin resolver
   * contra overrides: el `title` de `BadgeEditado` la muestra como la CAPA
   * INMEDIATA bajo un override manual activo (gotcha ratificado: revertir
   * restaura ESA capa, no necesariamente `original`). `null` = sin fila v2
   * para este sku (dispara la pill "Sin clasificación v2"); `undefined` =
   * fixtures previos a F1/F4.
   */
  v2?: {
    descr: string | null;
    familia: string | null;
    marca: string | null;
    clase: string | null;
    tecnologia: string | null;
  } | null;
  /**
   * (R3-4) Espejo de `SkuDetalle.decidido_en_bandeja` (`types/api.ts`):
   * campos de la capa v2 cuyo valor lo decidió un administrador al resolver
   * un pendiente en la bandeja (hoy solo `marca`, vía `marca_ambigua`), NO
   * el archivo mensual. Requerido (no opcional), mismo criterio que
   * `familiasEfectivas`: que `tsc` enumere este call-site. Cuando
   * `decididoEnBandeja.marca` es `true` Y el origen efectivo de marca es
   * 'v2', la fila Marca cambia su insignia de "clasificación v2" a
   * "decidido en bandeja" (ver `FilaMarca`/`BadgeDecididoEnBandeja` abajo)
   * — nunca las dos a la vez.
   */
  decididoEnBandeja: { marca: boolean };
  /**
   * Refetch de la ficha (`useApi` de `FichaView`) — se invoca tras cada
   * guardado exitoso para reflejar efectivas frescas. [FIX-B1 · verificación]
   * Y UN rechazo también lo invoca: el 409 `excel_manda` de tecnología, que
   * avisa que la ficha en pantalla ya envejeció (ver `TecnologiaEditable`).
   */
  onSaved?: () => void;
}

interface FamiliaOpcion {
  id: string;
  nombre: string;
  activo: boolean;
}
interface FamiliasResponse {
  items: FamiliaOpcion[];
}

const NUEVA_FAMILIA_VALUE = "__nueva_familia__";
const MENSAJE_FAMILIA_DUPLICADA = "Ya existe una familia con ese nombre.";

/**
 * Resuelve el origen efectivo de un campo (B-PARCHE F4): usa `origenes.<campo>`
 * cuando el backend lo manda (F1). En fixtures/tests previos a F1 (prop
 * `origenes` ausente) infiere 'manual' cuando la efectiva difiere del
 * original y 'fuente' si no — idéntico al comportamiento pre-F1 (la única
 * fuente de "editado" era esa comparación).
 */
function resolverOrigen(origen: OrigenClasificacion | undefined, editada: boolean): OrigenClasificacion {
  return origen ?? (editada ? "manual" : "fuente");
}

/**
 * Badge "editado" (tono info): junto al campo cuando el origen efectivo es
 * 'manual' (override activo). El `title` muestra la CAPA INMEDIATA que
 * "revertir" restauraría (B-PARCHE F4, gotcha ratificado): si hay un valor
 * de `clasificacion_v2` debajo del override, esa es la capa que gana al
 * revertir — no necesariamente el original de `productos`.
 *
 * [MVP-2 · frente E] "editado" no es jerga y se pinta para todos los roles,
 * pero su tooltip no puede nombrar "clasificación v2" para no-admin
 * (`mostrarV2`, `MUESTRA_CLASIFICACION_V2` en `src/lib/roles.ts`): cuando
 * `mostrarV2` es falso se sigue usando `valorV2` si existe (el tooltip debe
 * seguir siendo VERAZ sobre qué restaura "revertir"), solo se le quita la
 * etiqueta técnica.
 */
function BadgeEditado({
  valorOriginal,
  valorV2,
  mostrarV2,
}: {
  valorOriginal: string | null;
  valorV2?: string | null;
  mostrarV2: boolean;
}) {
  const title = mostrarV2 && valorV2 ? `Original (clasificación v2): ${valorV2}` : `Original: ${(valorV2 ?? valorOriginal) ?? "—"}`;
  return (
    <span
      title={title}
      className="inline-flex w-fit items-center rounded-full bg-info-bg px-2 py-0.5 text-[10.5px] font-semibold text-info"
    >
      editado
    </span>
  );
}

/** Estilo compartido de las insignias de origen "informativas" (sin acción, a diferencia de `BadgeEditado`) — `BadgeClasificacionV2` y `BadgeDecididoEnBandeja` (R3-4) SIEMPRE lo reusan tal cual, nunca inventan un look propio. */
const BADGE_ORIGEN_CLASSNAME = "rounded-full border border-line bg-transparent px-2 py-0.5 text-[10.5px] font-medium text-ink-muted";

/**
 * [2.0.1-A · D3] La MISMA insignia de origen, en tono de atención. Forma,
 * tamaño y tipografía intactos: lo único que cambia es el color, y es la única
 * licencia que se toma aquí — una insignia que nadie tiene que mirar no sirve
 * para lo que se declaró NO NEGOCIABLE (que la divergencia deje de ser
 * silenciosa).
 */
const BADGE_ATENCION_CLASSNAME = "rounded-full border border-warn bg-transparent px-2 py-0.5 text-[10.5px] font-medium text-warn";

/**
 * «la fuente cambió»: el archivo de inventario ya clasifica este SKU en otra
 * familia, y lo que la pantalla muestra es la clasificación revisada, que se
 * quedó con la anterior.
 *
 * EL COPY NO CULPA A NADIE Y NO NOMBRA JERGA. Un KAM lee «el archivo de
 * inventario ahora dice X»; solo a quien ve el vocabulario v2 se le añade qué
 * capa está ganando. No dice «error» ni «dato malo» porque no lo es: son dos
 * verdades de dos momentos distintos.
 */
function BadgeFuenteCambio({ familiaFuente, mostrarV2 }: { familiaFuente: string | null; mostrarV2: boolean }) {
  const base = familiaFuente
    ? `El archivo de inventario ahora clasifica este SKU como ${familiaFuente}.`
    : "El archivo de inventario ya no declara esta familia.";
  return (
    <span
      title={mostrarV2 ? `${base} La capa que gana aquí es la clasificación v2.` : base}
      className={BADGE_ATENCION_CLASSNAME}
    >
      la fuente cambió
    </span>
  );
}

/**
 * Badge "clasificación v2" (B-PARCHE F4): junto al campo cuando el origen
 * efectivo es 'v2' (sin override manual activo). Informativo, sin acción —
 * a diferencia de `BadgeEditado`, no hay nada que revertir.
 */
function BadgeClasificacionV2({ valorFuente }: { valorFuente: string | null }) {
  return (
    <span title={`Clasificación v2 · original: ${valorFuente ?? "—"}`} className={BADGE_ORIGEN_CLASSNAME}>
      clasificación v2
    </span>
  );
}

/**
 * Badge "decidido en bandeja" (R3-4): sustituye a `BadgeClasificacionV2` en
 * la fila Marca cuando `decidido_en_bandeja.marca` es `true` — un admin
 * eligió ese valor al resolver un pendiente `marca_ambigua` en la bandeja
 * (queda escrito en `clasificacion_v2.marca_v2`), NO el archivo mensual.
 * Reusa EXACTAMENTE el mismo estilo que `BadgeClasificacionV2`
 * (`BADGE_ORIGEN_CLASSNAME`) — solo cambian el copy y el tooltip, nunca se
 * inventa un sistema de insignias nuevo (spec R3-4).
 */
function BadgeDecididoEnBandeja() {
  return (
    <span
      title="Decidido en bandeja · un administrador eligió este valor al resolver un pendiente, no proviene del archivo mensual."
      className={BADGE_ORIGEN_CLASSNAME}
    >
      decidido en bandeja
    </span>
  );
}

/** Pill de card (B-PARCHE F4): visible en ambos roles cuando el sku no tiene fila propia en `clasificacion_v2` (`detalle.v2 === null`, nivel SKU — no por campo). */
function PillSinClasificacionV2() {
  return (
    <span className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted">
      Sin clasificación v2
    </span>
  );
}

/** [FIX-B1] `label` opcional (default "revertir") — "quitar" para la captura de tecnología sin efecto (misma acción: PUT valor:null), otro copy porque no hay nada que "revertir" cuando el Excel ya manda. */
function BotonRevertir({ onClick, disabled, label = "revertir" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-sm text-[11.5px] font-semibold text-ink-muted outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50"
    >
      <RotateCcw className="h-3 w-3" aria-hidden="true" />
      {label}
    </button>
  );
}

/** [FIX-B1] Insignia informativa (sin acción): la tecnología la trae el archivo de inventario, no se puede sobrescribir desde el portal mientras el Excel siga trayéndola. */
function BadgeVieneDelExcel() {
  return (
    <span
      title="El archivo de inventario ya trae este dato; para cambiarlo hay que corregir el Excel."
      className={BADGE_ORIGEN_CLASSNAME}
    >
      Viene del Excel
    </span>
  );
}

/** [FIX-B1] Insignia (tono info, mismo estilo que `BadgeEditado`): el valor lo capturó una persona en el portal porque el Excel no lo traía. */
function BadgeCapturadaEnPortal() {
  return (
    <span
      title="Este valor se capturó manualmente en el portal porque el Excel no traía tecnología para este SKU."
      className="inline-flex w-fit items-center rounded-full bg-info-bg px-2 py-0.5 text-[10.5px] font-semibold text-info"
    >
      Capturada en el portal
    </span>
  );
}

/**
 * Fila "Clase" (B-PARCHE F4): SOLO-LECTURA para AMBOS roles (no existe
 * mecanismo de override para este campo) — mismo patrón visual que la fila
 * Familia en modo `kam` (chip `bg-surface-3`). Compartida entre
 * `FichaAtributosSoloLectura` y `FichaAtributosEditable` para no duplicar
 * el markup; sin `valorFuente` propio en el badge v2 (el DTO no expone un
 * "original" separado para clase, a diferencia de familia/descr).
 *
 * [FIX-B1] Antes vivía junto con "Tecnología" en `FilaClaseTecnologia` — se
 * separan porque desde este bloque Tecnología YA NO es solo-lectura para
 * admin (ver `TecnologiaEditable`); Clase sigue exactamente igual.
 */
function FilaClase({
  clase,
  origenClase,
  mostrarV2,
}: {
  clase?: string | null;
  origenClase?: OrigenClasificacion;
  mostrarV2: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Clase</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex w-fit items-center rounded-full bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">
          {clase ?? "—"}
        </span>
        {origenClase === "v2" && mostrarV2 && <BadgeClasificacionV2 valorFuente={null} />}
      </div>
    </div>
  );
}

/**
 * [FIX-B1] Fila "Tecnología" para roles NO-admin: «sólo el valor» (decisión
 * de producto) — sin insignias de ningún tipo, ni "Viene del Excel" ni
 * "Capturada en el portal" (esas distinciones son de quién puede editar).
 * Mismo patrón visual (chip `bg-surface-3`) que el resto de filas
 * solo-lectura.
 */
function FilaTecnologiaSoloLectura({ tecnologia }: { tecnologia?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tecnología</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex w-fit items-center rounded-full bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">
          {tecnologia ?? "Sin tecnología"}
        </span>
      </div>
    </div>
  );
}

interface FilaMarcaProps {
  marca: string;
  origenMarca?: OrigenClasificacion;
  /** `decidido_en_bandeja.marca` (R3-4) — `true` cuando un admin la eligió al resolver un pendiente `marca_ambigua`, no el archivo mensual. */
  decididoEnBandeja: boolean;
  /** [MVP-2 · frente E] `MUESTRA_CLASIFICACION_V2[rol]` — gatea SOLO la insignia "clasificación v2"; "decidido en bandeja" no es jerga v2 y se pinta igual en ambos roles. */
  mostrarV2: boolean;
}

/**
 * Fila "Marca" (R3-4): SOLO-LECTURA en AMBOS roles, mismo criterio exacto
 * que `FilaClase` — no existe mecanismo de override para marca
 * (`origenes.marca` solo puede ser 'v2'/'fuente', nunca 'manual', ver
 * `capaFuente` en `derivaciones.ts`), y el DTO tampoco expone un
 * "original" separado para ella (mismo motivo por el que `valorFuente` va
 * en `null`, igual que Clase). [FIX-B1] Tecnología YA NO comparte este
 * criterio — desde este bloque tiene override propio para admin, ver
 * `TecnologiaEditable`.
 *
 * Único campo con una TERCERA variante de insignia: cuando el origen es
 * 'v2' Y `decididoEnBandeja` es `true`, la insignia deja de ser
 * "clasificación v2" (que implicaría "lo dijo el Excel") y pasa a
 * "decidido en bandeja" (lo eligió un admin) — nunca ambas a la vez. Fuera
 * de ese caso, el comportamiento es idéntico al resto de campos con origen
 * v2.
 */
function FilaMarca({ marca, origenMarca, decididoEnBandeja, mostrarV2 }: FilaMarcaProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Marca</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex w-fit items-center rounded-full bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">
          {marca}
        </span>
        {origenMarca === "v2" &&
          (decididoEnBandeja ? <BadgeDecididoEnBandeja /> : mostrarV2 && <BadgeClasificacionV2 valorFuente={null} />)}
      </div>
    </div>
  );
}

/**
 * Card "Atributos editables" — R5 ABIERTO en B5: `kam` conserva el
 * modo 100% solo lectura (candado) tal cual venía de B4; `admin` edita
 * familia/descripción/color en línea. La decisión de rol vive acá
 * (`useSesion`) para no ensuciar `FichaDetalle`/`FichaView` con lógica
 * de permisos.
 *
 * [MVP-2 · frente E, vocabulario] `mostrarV2` (`MUESTRA_CLASIFICACION_V2`
 * en `src/lib/roles.ts`) se calcula UNA sola vez aquí y se hereda como prop
 * hacia ambas variantes: decide si se pintan los badges/pill "clasificación
 * v2" (jerga técnica que, por decisión de producto, KAM y Visitante ya no deben
 * ver — Admin la conserva). No decide ningún otro comportamiento.
 */
export function FichaAtributos(props: FichaAtributosProps) {
  const { rol } = useSesion();
  const mostrarV2 = MUESTRA_CLASIFICACION_V2[rol];
  return rol === "admin" ? (
    <FichaAtributosEditable {...props} mostrarV2={mostrarV2} />
  ) : (
    <FichaAtributosSoloLectura {...props} mostrarV2={mostrarV2} />
  );
}

/** Rol `kam`/`visitante`: idéntico al comportamiento de B4 (cero inputs/selects/textareas/botones, ni deshabilitados) + filas de clasificación v2 (B-PARCHE F4, hoy solo visibles para admin — ver `mostrarV2`). */
function FichaAtributosSoloLectura({
  marca,
  familiaEfectiva,
  familiasEfectivas,
  descrEfectiva,
  original,
  divergenciaFamilia = null,
  clase,
  tecnologia,
  origenes,
  v2,
  decididoEnBandeja,
  mostrarV2,
}: FichaAtributosProps & { mostrarV2: boolean }) {
  const familiaEditada = familiaEfectiva !== original.familia;
  const descrEditada = descrEfectiva !== original.descr;
  const origenFamilia = resolverOrigen(origenes?.familia, familiaEditada);
  const origenDescr = resolverOrigen(origenes?.descr, descrEditada);

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          {/* [FIX-B1] Antes "Atributos editables" — decisión de producto: el
              título es el mismo para los dos roles ("Datos del producto");
              lo que distingue es el subtítulo de abajo. */}
          <h2 className="text-[13.5px] font-semibold text-ink">Datos del producto</h2>
          {/* [FIX-B1] Antes "SKU bloqueado · ningún campo editable" —
              decisión de producto: subtítulo corto "Solo consulta"; el chip de
              abajo ya dice el porqué, no hace falta repetirlo aquí. */}
          <p className="text-[12px] text-muted-foreground">Solo consulta</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mostrarV2 && v2 === null && <PillSinClasificacionV2 />}
          <span className="inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-bg px-2.5 py-1 text-[11.5px] font-semibold text-warn">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* Antes: "Solo lectura · edición con inicio de sesión (B5)" — filtraba un nombre de bloque interno y mentía (el usuario ya inició sesión; lo que falta es el rol, no la sesión). Decisión de producto (FIX-B1): este chip SE QUEDA igual. */}
            Solo lectura · tu rol no permite editar
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <FilaMarca marca={marca} origenMarca={origenes?.marca} decididoEnBandeja={decididoEnBandeja.marca} mostrarV2={mostrarV2} />

        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Familia</p>
          <div className="flex flex-wrap items-center gap-2">
            <ListaFamiliaChips familias={familiasEfectivas} />
            {origenFamilia === "manual" && (
              <BadgeEditado valorOriginal={original.familia} valorV2={v2?.familia} mostrarV2={mostrarV2} />
            )}
            {origenFamilia === "v2" && mostrarV2 && <BadgeClasificacionV2 valorFuente={original.familia} />}
            {divergenciaFamilia === "v2" && <BadgeFuenteCambio familiaFuente={original.familia} mostrarV2={mostrarV2} />}
          </div>
          {/* [2.0.1-A · D3] La línea NO es redundante con el tooltip de la
              insignia: a 390 px no hay hover — la misma regla que
              `familias-celda` ya se escribió para su colapso. Y se pinta para
              TODOS los roles, sin jerga: gatearla por rol dejaría la
              divergencia silenciosa justo para el KAM que enseña la pantalla. */}
          {divergenciaFamilia === "v2" && (
            <p role="note" className="text-[11.5px] leading-snug text-warn">
              {original.familia
                ? `Según el archivo de inventario: ${original.familia}.`
                : "El archivo de inventario ya no declara esta familia."}
            </p>
          )}
        </div>

        <FilaClase clase={clase} origenClase={origenes?.clase} mostrarV2={mostrarV2} />
        <FilaTecnologiaSoloLectura tecnologia={tecnologia} />

        <div className="flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Descripción</p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] text-ink-2">{descrEfectiva ?? "—"}</p>
            {origenDescr === "manual" && <BadgeEditado valorOriginal={original.descr} valorV2={v2?.descr} mostrarV2={mostrarV2} />}
            {origenDescr === "v2" && mostrarV2 && <BadgeClasificacionV2 valorFuente={original.descr} />}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Rol `admin`: familia (select + alta inline), clase (solo-lectura, B-PARCHE F4), [FIX-B1] tecnología (editable SOLO cuando el Excel no la trae), descripción (textarea) y color (swatches), cada uno con guardado propio. */
function FichaAtributosEditable({
  sku,
  marca,
  familiaEfectiva,
  descrEfectiva,
  original,
  divergenciaFamilia = null,
  color,
  clase,
  tecnologia,
  tecnologiaPortal,
  origenes,
  v2,
  decididoEnBandeja,
  mostrarV2,
  onSaved,
}: FichaAtributosProps & { mostrarV2: boolean }) {
  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          {/* [FIX-B1] Antes "Atributos editables" — decisión de producto: mismo
              título que la vista no-admin ("Datos del producto"); el
              subtítulo de abajo es lo que distingue qué se puede tocar. */}
          <h2 className="text-[13.5px] font-semibold text-ink">Datos del producto</h2>
          {/* [FIX-B1] Antes "SKU bloqueado · Familia, Descripción y Color
              editables" — decisión de producto: ahora nombra también la
              condición de Tecnología, para que el admin sepa por qué a
              veces ve un chip y a veces un selector. */}
          <p className="text-[12px] text-muted-foreground">
            Puedes editar familia, descripción y color; la tecnología, sólo si el Excel no la trae.
          </p>
        </div>
        {v2 === null && <PillSinClasificacionV2 />}
      </div>

      <div className="flex flex-col gap-4">
        <FilaMarca marca={marca} origenMarca={origenes?.marca} decididoEnBandeja={decididoEnBandeja.marca} mostrarV2={mostrarV2} />
        {/* [2.0.1-A · D3] La bandera va TAMBIÉN aquí, y no es un adorno
            duplicado: el admin es quien PUEDE re-revisar la clasificación, así
            que esconderla justo en el modo donde se arregla habría sido la
            media función de P24 — y así nació, con la insignia solo en el modo
            lectura, hasta que la prueba del rol admin lo delató. */}
        <div className="flex flex-col gap-1">
          <FamiliaEditable
            sku={sku}
            familiaEfectiva={familiaEfectiva}
            original={original.familia}
            origen={origenes?.familia}
            valorV2={v2?.familia}
            mostrarV2={mostrarV2}
            onSaved={onSaved}
          />
          {divergenciaFamilia === "v2" && (
            <div className="flex flex-wrap items-center gap-2">
              <BadgeFuenteCambio familiaFuente={original.familia} mostrarV2={mostrarV2} />
              <p role="note" className="text-[11.5px] leading-snug text-warn">
                {original.familia
                  ? `Según el archivo de inventario: ${original.familia}.`
                  : "El archivo de inventario ya no declara esta familia."}
              </p>
            </div>
          )}
        </div>
        <FilaClase clase={clase} origenClase={origenes?.clase} mostrarV2={mostrarV2} />
        <TecnologiaEditable
          sku={sku}
          tecnologiaEfectiva={tecnologia ?? null}
          origen={origenes?.tecnologia}
          tecnologiaPortal={tecnologiaPortal ?? null}
          onSaved={onSaved}
        />
        <DescripcionEditable
          sku={sku}
          descrEfectiva={descrEfectiva}
          original={original.descr}
          origen={origenes?.descr}
          valorV2={v2?.descr}
          mostrarV2={mostrarV2}
          onSaved={onSaved}
        />
        <ColorEditable sku={sku} color={color ?? null} onSaved={onSaved} />
      </div>
    </Card>
  );
}

interface CampoEditableProps {
  sku: string;
  onSaved?: () => void;
}

interface GuardarCampoOpts<T> {
  url: string;
  body: unknown;
  msgOk: string;
  msgError: string;
  /** Se llama con el JSON de respuesta cuando `res.ok` — aplica el resultado (p.ej. valor efectivo fresco) y dispara `onSaved`. */
  onOk: (result: T) => void;
  /** Se llama en cualquier falla (`!res.ok` o excepción) — deshace el cambio optimista aplicado ANTES de invocar esta función (no-op si el campo no optimiza, como `descripcion`). */
  onRollback: () => void;
  /**
   * [FIX-B1 · verificación] Opcional. Se llama DESPUÉS de `onRollback` en
   * cualquier falla, con el `error` del cuerpo (`ApiErrorBody`) o `null` si
   * no hubo cuerpo legible (red caída, cuerpo no-JSON, sin `error`). Existe
   * para que un campo reaccione a un rechazo CONCRETO sin que esta función
   * sepa de dominio — hoy sólo tecnología la usa (`excel_manda` → refetch
   * de la ficha; `tecnologia_no_seleccionable` → refetch de la lista de
   * tecnologías).
   */
  onRechazo?: (codigo: string | null) => void;
}

/**
 * [FIX-B1 · revisión] Códigos de error cuyo `message` (`ApiErrorBody`,
 * `lib/api/errors.ts`) es SEGURO de mostrar tal cual en la ficha: los dos
 * 409 de tecnología, cuyo texto ya está curado en es-MX para este flujo
 * ("Este producto ya trae tecnología en el archivo de inventario…", ver
 * `app/api/override/route.ts`). El resto de los códigos que puede
 * devolver `PUT /api/override` también trae `message` (p.ej. el 400
 * `valor_familia_invalido`: `La familia "X" no existe o está inactiva;
 * créala primero con POST /api/familias`), pero ese texto nombra una ruta
 * de la API —el detalle de OTRO flujo, el alta de familia de
 * `handleAltaFamilia`— y no le dice nada útil a quien está eligiendo una
 * familia de la lista — para esos, `guardarCampo` conserva el `msgError`
 * genérico de siempre.
 */
const CODIGOS_CON_MENSAJE_SEGURO_PARA_LA_FICHA = new Set<string>(["excel_manda", "tecnologia_no_seleccionable"]);

/**
 * Boilerplate compartido de guardado (M1): `fetch` PUT + manejo uniforme de
 * éxito/error, reutilizado por familia/descripción/color/tecnología. El
 * caller aplica el cambio optimista (si corresponde) ANTES de llamar aquí y
 * envuelve la llamada en su propio `setGuardando(true)/finally
 * setGuardando(false)` — esta función solo resuelve fetch → éxito/error,
 * nunca lanza.
 *
 * [FIX-B1] En falla, intenta leer `message` del cuerpo de error (contrato
 * `ApiErrorBody`, `lib/api/errors.ts`) y lo usa en vez de `msgError` SOLO
 * cuando `error` está en `CODIGOS_CON_MENSAJE_SEGURO_PARA_LA_FICHA` — así
 * los 409 `excel_manda`/`tecnologia_no_seleccionable` (mensaje llano ya
 * armado server-side) le llegan al usuario tal cual, en vez de un "No se
 * pudo actualizar…" genérico que no explica el PORQUÉ, sin arrastrar el
 * `message` de otros códigos que no le hablan a este flujo. `msgError`
 * sigue siendo el fallback: un cuerpo no-JSON, sin `message` o con un
 * código fuera de la lista no rompe nada.
 */
async function guardarCampo<T = unknown>({
  url,
  body,
  msgOk,
  msgError,
  onOk,
  onRollback,
  onRechazo,
}: GuardarCampoOpts<T>): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      onRollback();
      let mensaje = msgError;
      let codigo: string | null = null;
      try {
        const cuerpo = (await res.json()) as { error?: string; message?: string };
        codigo = typeof cuerpo?.error === "string" ? cuerpo.error : null;
        if (cuerpo?.message && codigo && CODIGOS_CON_MENSAJE_SEGURO_PARA_LA_FICHA.has(codigo)) {
          mensaje = cuerpo.message;
        }
      } catch {
        // Cuerpo no-JSON o vacío: se queda el mensaje genérico y sin código.
      }
      toast.error(mensaje);
      onRechazo?.(codigo);
      return;
    }
    const result = (await res.json()) as T;
    onOk(result);
    toast.success(msgOk);
  } catch {
    onRollback();
    toast.error(msgError);
    onRechazo?.(null);
  }
}

function FamiliaEditable({
  sku,
  familiaEfectiva,
  original,
  origen,
  valorV2,
  mostrarV2,
  onSaved,
}: CampoEditableProps & {
  familiaEfectiva: string | null;
  original: string | null;
  origen?: OrigenClasificacion;
  valorV2?: string | null;
  mostrarV2: boolean;
}) {
  const { data: familiasData, refetch: refetchFamilias } = useApi<FamiliasResponse>("/api/familias");
  const familias = familiasData?.items ?? [];

  const [valorLocal, setValorLocal] = useState(familiaEfectiva);
  useEffect(() => setValorLocal(familiaEfectiva), [familiaEfectiva]);

  const [guardando, setGuardando] = useState(false);
  const [mostrandoNueva, setMostrandoNueva] = useState(false);
  const [nuevaTexto, setNuevaTexto] = useState("");
  const [errorNueva, setErrorNueva] = useState<string | null>(null);
  const [guardandoNueva, setGuardandoNueva] = useState(false);

  const editada = valorLocal !== original;
  const origenResuelto = resolverOrigen(origen, editada);
  // [FIX-B1 · verificación] El mismo hueco que ya se cerró en Tecnología
  // (`valorFueraDeLista` de `TecnologiaEditable`): Radix sólo pinta en el
  // disparador el texto de un `SelectItem` cuyo `value` coincide, y
  // `/api/familias` —sin `incluirInactivas`— lista sólo las ACTIVAS. Una
  // familia compuesta («CLIP 3.0 / CLIP ROTATIVO», que no es un nombre del
  // catálogo sino dos), una inactiva, o cualquiera mientras la lista aún
  // carga, dejaban el selector EN BLANCO con un valor vigente. Se añade ese
  // valor como opción deshabilitada: visible en el disparador, no elegible.
  const valorFueraDeLista =
    valorLocal !== null && valorLocal !== "" && !familias.some((f) => f.nombre === valorLocal) ? valorLocal : null;

  /** `valor: null` = revertir (quitar el override; C2) — mismo flujo que asignar una familia. */
  async function aplicarFamilia(valor: string | null) {
    const anterior = valorLocal;
    setValorLocal(valor);
    setGuardando(true);
    try {
      await guardarCampo<OverrideResult>({
        url: "/api/override",
        body: { sku, campo: "familia", valor },
        msgOk: "Familia actualizada.",
        msgError: "No se pudo actualizar la familia.",
        onOk: (result) => {
          setValorLocal(result.familia_efectiva);
          onSaved?.();
        },
        onRollback: () => setValorLocal(anterior),
      });
    } finally {
      setGuardando(false);
    }
  }

  function handleChange(value: string) {
    if (value === NUEVA_FAMILIA_VALUE) {
      setMostrandoNueva(true);
      setErrorNueva(null);
      return;
    }
    void aplicarFamilia(value);
  }

  async function handleAltaFamilia() {
    const nombre = nuevaTexto.trim();
    if (!nombre) return;
    setErrorNueva(null);
    setGuardandoNueva(true);
    try {
      const res = await fetch("/api/familias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      if (res.status === 409) {
        setErrorNueva(MENSAJE_FAMILIA_DUPLICADA);
        return;
      }
      if (!res.ok) {
        toast.error("No se pudo crear la familia.");
        return;
      }
      const creada = (await res.json()) as FamiliaOpcion;
      refetchFamilias();
      setMostrandoNueva(false);
      setNuevaTexto("");
      await aplicarFamilia(creada.nombre);
    } catch {
      toast.error("No se pudo crear la familia.");
    } finally {
      setGuardandoNueva(false);
    }
  }

  /** Reversión REAL (C2): PUT valor:null — quita el override, la efectiva vuelve al origen vivo (puede ser null: "sin familia"). */
  function handleRevertir() {
    void aplicarFamilia(null);
  }

  function handleCancelarNueva() {
    setMostrandoNueva(false);
    setNuevaTexto("");
    setErrorNueva(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Familia</p>
      <div className="flex flex-wrap items-center gap-2">
        {/* [FIX-B1 · verificación] `value` SIEMPRE una cadena, igual que en
            `TecnologiaEditable` (ver el porqué completo allá): con `?? undefined`,
            un SKU sin familia monta el Select NO controlado, y Radix se queda
            pintando su estado interno — la familia que el servidor RECHAZÓ tras
            el rollback, o el texto «＋ Agregar nueva familia…» al elegir esa
            opción (que `handleChange` no guarda en `valorLocal`). Con `?? ""`
            el Select está controlado desde el montaje y vuelve al placeholder
            «Sin familia» en cuanto `valorLocal` es `null`. */}
        <Select value={valorLocal ?? ""} onValueChange={handleChange} disabled={guardando}>
          {/* [FIX-B1] `aria-label` explícito: desde este bloque la card admin
              puede tener DOS combobox (Familia y, si el Excel no trae
              tecnología, Tecnología) — sin nombre, `getByRole("combobox")`
              a secas dejaría de ser único. */}
          <SelectTrigger aria-label="Familia" className="h-9 w-[230px] text-[12.5px]">
            <SelectValue placeholder="Sin familia" />
          </SelectTrigger>
          <SelectContent>
            {valorFueraDeLista !== null && (
              <SelectItem key={`fuera-de-lista:${valorFueraDeLista}`} value={valorFueraDeLista} disabled>
                {valorFueraDeLista}
              </SelectItem>
            )}
            {familias.map((f) => (
              <SelectItem key={f.id} value={f.nombre}>
                {f.nombre}
              </SelectItem>
            ))}
            <SelectItem value={NUEVA_FAMILIA_VALUE}>＋ Agregar nueva familia…</SelectItem>
          </SelectContent>
        </Select>
        {origenResuelto === "manual" && <BadgeEditado valorOriginal={original} valorV2={valorV2} mostrarV2={mostrarV2} />}
        {origenResuelto === "v2" && mostrarV2 && <BadgeClasificacionV2 valorFuente={original} />}
        {origenResuelto === "manual" && <BotonRevertir onClick={handleRevertir} disabled={guardando} />}
      </div>

      {mostrandoNueva && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={nuevaTexto}
            onChange={(e) => {
              setNuevaTexto(e.target.value);
              setErrorNueva(null);
            }}
            placeholder="Nombre de la nueva familia"
            aria-label="Nombre de la nueva familia"
            className="h-9 w-[230px] text-[12.5px]"
          />
          <Button type="button" size="sm" onClick={handleAltaFamilia} disabled={guardandoNueva || !nuevaTexto.trim()}>
            Agregar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={handleCancelarNueva}>
            Cancelar
          </Button>
          {errorNueva && (
            <p role="alert" className="w-full text-[11.5px] text-warn">
              {errorNueva}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface TecnologiasResponse {
  items: string[];
}

/**
 * [FIX-B1] Fila "Tecnología", rol admin. LA ÚNICA capa de la card con el
 * orden invertido — EL EXCEL GANA (`capaFuenteManual`, `services/
 * derivaciones.ts`), inversa de familia/descripción (donde gana el
 * portal, `FamiliaEditable`/`DescripcionEditable`). DOS ramas y CUATRO
 * estados visibles (los «Estado 1..4» que nombran las pruebas):
 *
 *   Rama «el Excel manda» — `excelTrae`: la prop `origen` (la resolvió el
 *   servidor) es 'fuente' Y `tecnologiaEfectiva` no es nula. La RAMA se
 *   decide siempre por props, nunca por estado local: sólo el servidor sabe
 *   si el Excel trae el dato.
 *     1. Sin captura del portal → solo-lectura, insignia "Viene del Excel".
 *     4. Con una captura de antes del Excel, ya sin efecto (`portalLocal
 *        !== null`) → lo mismo + nota "Lo capturado en el portal (X) ya no
 *        aplica: manda el Excel" + botón "quitar".
 *
 *   Rama «el Excel calla» — cualquier otro caso → selector con
 *   `tecnologias_seleccionables()` (vía `/api/tecnologias`).
 *     2. Sin captura (`portalLocal === null`) → sólo el selector.
 *     3. Con captura EN EFECTO (`portalLocal !== null`) → insignia
 *        "Capturada en el portal" + botón "quitar".
 *
 * DENTRO de cada rama, la insignia, la nota y el botón miran `portalLocal`
 * (estado local sembrado de la prop `tecnologiaPortal` en cada refetch, y
 * que se mueve con el guardado optimista y su rollback), NO la prop
 * `origen`: si miraran `origen`, tras un «quitar» con 200 y antes del
 * refetch la fila diría "Sin tecnología" junto a "Capturada en el portal" y
 * un botón "quitar" que ya no tiene nada que quitar. En reposo las dos
 * lecturas coinciden: con el Excel vacío, `origen === 'manual'` ⟺
 * `tecnologia_portal !== null`, porque las dos salen de la misma fila
 * `overrideActivo(…, 'tecnologia')` (`capaFuenteManual` en
 * `services/derivaciones.ts`, `tecnologiaPortal` en `services/
 * sku.service.ts`); sólo difieren entre el guardado y el refetch de la
 * ficha (`onSaved`).
 *
 * Roles no-admin no pasan por aquí — ver `FilaTecnologiaSoloLectura`.
 */
function TecnologiaEditable({
  sku,
  tecnologiaEfectiva,
  origen,
  tecnologiaPortal,
  onSaved,
}: CampoEditableProps & {
  tecnologiaEfectiva: string | null;
  origen?: OrigenClasificacion | null;
  tecnologiaPortal: string | null;
}) {
  const [valorLocal, setValorLocal] = useState(tecnologiaEfectiva);
  useEffect(() => setValorLocal(tecnologiaEfectiva), [tecnologiaEfectiva]);
  const [portalLocal, setPortalLocal] = useState(tecnologiaPortal);
  useEffect(() => setPortalLocal(tecnologiaPortal), [tecnologiaPortal]);

  const [guardando, setGuardando] = useState(false);

  // `origen` ausente (fixtures retro-compat, previas a FIX-B1) → se asume
  // 'fuente': con un valor presente, es el comportamiento pre-existente
  // ("solo mostrar lo que venga"); mismo criterio de default que ya usa
  // `sku.service.ts` para el resto de campos (nunca `null` en la práctica).
  const origenResuelto = origen ?? "fuente";
  // El Excel trae valor ⟺ origen resuelto por el servidor es 'fuente' CON
  // valor no-nulo (capa por default: fuente+null significa "ni el archivo
  // ni el portal traen nada", y ESE caso sí necesita el selector).
  const excelTrae = origenResuelto === "fuente" && tecnologiaEfectiva !== null;

  // `null` cuando el Excel ya manda (Estado 1/4): no hace falta la lista de
  // opciones porque no hay selector que poblar — evita una llamada a
  // `/api/tecnologias` que ningún control va a usar.
  const {
    data: tecnologiasData,
    error: errorTecnologias,
    refetch: refetchTecnologias,
  } = useApi<TecnologiasResponse>(excelTrae ? null : "/api/tecnologias");
  const opciones = tecnologiasData?.items ?? [];
  // [FIX-B1 · verificación] Una lista que NO SE PUDO CARGAR no es una lista
  // vacía: sin leer `error`, un 500 de `/api/tecnologias` se veía idéntico a
  // `items: []` legítimo (selector «Sin tecnología», cero opciones, ningún
  // aviso). Con error, el selector se deshabilita y aparece un aviso con
  // «Reintentar» (`refetch` de `useApi`, que limpia `error` al volver a
  // pedir). «quitar» NO depende de la lista y sigue disponible.
  const listaFallo = errorTecnologias !== null;
  // [FIX-B1 · verificación] Radix sólo pinta en el disparador el texto de un
  // `SelectItem` cuyo `value` coincide: si lo capturado ya salió de la lista
  // (o la lista aún carga, o falló), el selector se veía EN BLANCO con una
  // captura vigente. Se añade ese valor como opción deshabilitada — visible
  // en el disparador, no elegible en la lista.
  const valorFueraDeLista = valorLocal !== null && valorLocal !== "" && !opciones.includes(valorLocal) ? valorLocal : null;

  /** `valor: null` = quitar la captura del portal (C2, mismo mecanismo que familia/descripción). */
  async function aplicarTecnologia(valor: string | null) {
    const anteriorValor = valorLocal;
    const anteriorPortal = portalLocal;
    setValorLocal(valor);
    setPortalLocal(valor);
    setGuardando(true);
    try {
      await guardarCampo<OverrideResult>({
        url: "/api/override",
        body: { sku, campo: "tecnologia", valor },
        msgOk: valor === null ? "Captura de tecnología retirada." : "Tecnología actualizada.",
        msgError: "No se pudo actualizar la tecnología.",
        onOk: (result) => {
          setValorLocal(result.tecnologia_efectiva);
          onSaved?.();
        },
        onRollback: () => {
          setValorLocal(anteriorValor);
          setPortalLocal(anteriorPortal);
        },
        // [FIX-B1 · verificación] Dos rechazos dicen que algo en pantalla YA
        // ENVEJECIÓ, y cada uno refresca lo suyo — por eso sus mensajes
        // (`app/api/override/route.ts`) dicen «ya se actualizó» y no
        // «recarga»:
        //   · 409 `excel_manda`: el Excel empezó a traer tecnología después
        //     de que se abrió la ficha. Sin refetch, la fila seguía
        //     ofreciendo el selector que el servidor acaba de rechazar; con
        //     `onSaved` la ficha se pone al día y pasa a la rama «el Excel
        //     manda».
        //   · 409 `tecnologia_no_seleccionable`: el valor elegido ya salió de
        //     `tecnologias_seleccionables()`. Lo que envejeció es la LISTA,
        //     no la ficha: se vuelve a pedir `/api/tecnologias` y la opción
        //     rechazada deja de ofrecerse.
        // Ningún otro rechazo refresca nada: no dicen nada de la pantalla.
        onRechazo: (codigo) => {
          if (codigo === "excel_manda") onSaved?.();
          if (codigo === "tecnologia_no_seleccionable") refetchTecnologias();
        },
      });
    } finally {
      setGuardando(false);
    }
  }

  function handleChange(value: string) {
    void aplicarTecnologia(value);
  }
  function handleQuitar() {
    void aplicarTecnologia(null);
  }

  if (excelTrae) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tecnología</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex w-fit items-center rounded-full bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink-2">
            {tecnologiaEfectiva}
          </span>
          <BadgeVieneDelExcel />
        </div>
        {portalLocal !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="note" className="text-[11.5px] leading-snug text-warn">
              {`Lo capturado en el portal (${portalLocal}) ya no aplica: manda el Excel.`}
            </p>
            <BotonRevertir onClick={handleQuitar} disabled={guardando} label="quitar" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tecnología</p>
      <div className="flex flex-wrap items-center gap-2">
        {/* [FIX-B1 · revisión] `value` SIEMPRE una cadena (nunca `undefined`):
            con Radix 2.x, `value={undefined}` vuelve el Select NO controlado
            (`useControllableState`, `isControlled = prop !== undefined`) — y
            como `valorLocal` arranca en `null` (Excel vacío, Estado 2), el
            Select nace SIN CONTROLAR. Al elegir una opción, Radix escribe esa
            elección en su estado INTERNO (además de avisarnos); si luego un
            rechazo del servidor (p. ej. el 409 `excel_manda`) hace rollback
            (`valorLocal` vuelve a `null` → prop vuelve a `undefined`), el
            Select se lee otra vez como no-controlado y
            muestra su estado interno viejo — el valor RECHAZADO sigue en
            pantalla aunque `valorLocal` ya sea `null` (medido por un revisor:
            "DESPUÉS DEL 409: EAS"). `?? ""` mantiene el prop SIEMPRE definido
            → SIEMPRE controlado → Radix pinta el placeholder ("Sin
            tecnología") en cuanto `valorLocal` vuelve a `null`, sin depender
            de un estado interno que nunca se sincronizó. */}
        <Select value={valorLocal ?? ""} onValueChange={handleChange} disabled={guardando || listaFallo}>
          <SelectTrigger aria-label="Tecnología" className="h-9 w-[230px] text-[12.5px]">
            <SelectValue placeholder="Sin tecnología" />
          </SelectTrigger>
          <SelectContent>
            {valorFueraDeLista !== null && (
              <SelectItem key={`fuera-de-lista:${valorFueraDeLista}`} value={valorFueraDeLista} disabled>
                {valorFueraDeLista}
              </SelectItem>
            )}
            {opciones.map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {portalLocal !== null && <BadgeCapturadaEnPortal />}
        {portalLocal !== null && <BotonRevertir onClick={handleQuitar} disabled={guardando} label="quitar" />}
      </div>
      {listaFallo && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-[11.5px] leading-snug text-warn">
            No se pudo cargar la lista de tecnologías.
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={refetchTecnologias}>
            Reintentar
          </Button>
        </div>
      )}
    </div>
  );
}

function DescripcionEditable({
  sku,
  descrEfectiva,
  original,
  origen,
  valorV2,
  mostrarV2,
  onSaved,
}: CampoEditableProps & {
  descrEfectiva: string | null;
  original: string | null;
  origen?: OrigenClasificacion;
  valorV2?: string | null;
  mostrarV2: boolean;
}) {
  const [borrador, setBorrador] = useState(descrEfectiva ?? "");
  useEffect(() => setBorrador(descrEfectiva ?? ""), [descrEfectiva]);
  const [guardando, setGuardando] = useState(false);

  const editada = descrEfectiva !== original;
  const origenResuelto = resolverOrigen(origen, editada);
  const cambiosSinGuardar = borrador.trim() !== (descrEfectiva ?? "").trim();
  const valorValido = borrador.trim().length > 0 && borrador.trim().length <= 2000;

  /** `valor: null` = revertir (quitar el override; C2) — no hay cambio optimista previo que revertir (`onRollback` no-op), igual que antes. */
  async function guardar(valor: string | null) {
    setGuardando(true);
    try {
      await guardarCampo<OverrideResult>({
        url: "/api/override",
        body: { sku, campo: "descripcion", valor },
        msgOk: "Descripción actualizada.",
        msgError: "No se pudo actualizar la descripción.",
        onOk: (result) => {
          setBorrador(result.descr_efectiva ?? "");
          onSaved?.();
        },
        onRollback: () => {},
      });
    } finally {
      setGuardando(false);
    }
  }

  function handleGuardar() {
    const valor = borrador.trim();
    if (!valor) return;
    void guardar(valor);
  }
  function handleCancelar() {
    setBorrador(descrEfectiva ?? "");
  }
  /** Reversión REAL (C2): PUT valor:null — la efectiva vuelve al origen vivo (puede ser null). */
  function handleRevertir() {
    void guardar(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Descripción</p>
        {origenResuelto === "manual" && <BadgeEditado valorOriginal={original} valorV2={valorV2} mostrarV2={mostrarV2} />}
        {origenResuelto === "v2" && mostrarV2 && <BadgeClasificacionV2 valorFuente={original} />}
        {origenResuelto === "manual" && <BotonRevertir onClick={handleRevertir} disabled={guardando} />}
      </div>
      <Textarea
        value={borrador}
        onChange={(e) => setBorrador(e.target.value)}
        maxLength={2000}
        disabled={guardando}
        aria-label="Descripción"
        className="min-h-[72px] text-[13px]"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={handleGuardar} disabled={guardando || !cambiosSinGuardar || !valorValido}>
          Guardar
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={handleCancelar} disabled={guardando || !cambiosSinGuardar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function ColorEditable({ sku, color, onSaved }: CampoEditableProps & { color: string | null }) {
  const [colorLocal, setColorLocal] = useState<string | null>(color);
  useEffect(() => setColorLocal(color), [color]);
  const [guardando, setGuardando] = useState(false);

  async function aplicarColor(valor: ColorSku | null) {
    const anterior = colorLocal;
    setColorLocal(valor);
    setGuardando(true);
    try {
      // Color no lee nada de la respuesta (no es un override versionado como
      // familia/descripción): confía en el valor optimista ya aplicado arriba.
      await guardarCampo({
        url: "/api/color",
        body: { sku, color: valor },
        msgOk: "Color actualizado.",
        msgError: "No se pudo actualizar el color.",
        onOk: () => onSaved?.(),
        onRollback: () => setColorLocal(anterior),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Color</p>
      <div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-2.5">
        {ORDEN_COLORES_SKU.map((slug) => {
          const info = COLORES_SKU[slug];
          const seleccionado = colorLocal === slug;
          return (
            <button
              key={slug}
              type="button"
              role="radio"
              aria-checked={seleccionado}
              aria-label={info.label}
              title={info.label}
              disabled={guardando}
              onClick={() => void aplicarColor(slug)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-surface transition-transform focus-visible:ring-2 focus-visible:ring-ink-muted2 disabled:pointer-events-none disabled:opacity-50",
                info.bgClass,
                seleccionado ? "ring-2 ring-ink-muted2" : "hover:scale-105",
              )}
            >
              {seleccionado && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden="true" />}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={colorLocal === null}
          aria-label="Sin color"
          title="Sin color"
          disabled={guardando}
          onClick={() => void aplicarColor(null)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-line bg-surface outline-none ring-offset-2 ring-offset-surface transition-transform focus-visible:ring-2 focus-visible:ring-ink-muted2 disabled:pointer-events-none disabled:opacity-50",
            colorLocal === null ? "ring-2 ring-ink-muted2" : "hover:scale-105",
          )}
        />
      </div>
    </div>
  );
}
