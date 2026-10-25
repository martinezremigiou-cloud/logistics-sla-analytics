"use client";

import { cloneElement, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Plus } from "lucide-react";
import { toast } from "sonner";
import { useApi, type ApiErrorBody } from "@/lib/hooks/use-api";
import { useSesion } from "@/components/providers/session-provider";
import { EstadoError } from "@/components/shared/estado-carga";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ETIQUETA_ROL, ROLES } from "@/lib/roles";
import type { Rol } from "@/types/enums";
import type { UsuarioItem, ActualizarUsuarioResult } from "@/types/api";
import type { PatchUsuarioBody } from "@/schemas/usuarios.schema";
// Fuente de verdad del código de error: `@/lib/api/errors` (ya exportado
// como `ApiErrorCode`; `import type` se borra en build, no arrastra el
// módulo de servidor al bundle de cliente). Ver `resolverErrorPatch`
// abajo (ronda 3, FIX MEDIO-4).
import type { ApiErrorCode } from "@/lib/api/errors";

interface UsuariosResponse {
  items: UsuarioItem[];
}

const MENSAJE_GUARDARRAIL = "No puedes modificar tu propia cuenta.";
const MENSAJE_GENERICO = "No se pudo actualizar el usuario.";
const MENSAJE_SESION_EXPIRADA = "Tu sesión expiró. Inicia sesión de nuevo.";
const MENSAJE_ERROR_SERVIDOR = "Ocurrió un error en el servidor. Intenta de nuevo más tarde.";
/**
 * (ronda de revisión INV-B7B, punto C) `forbidden_origin` (`src/lib/api/
 * origin.ts`) es el 403 más probable del primer arranque en producción: si
 * el dominio real del portal no quedó incluido en la lista de direcciones
 * permitidas del servidor (falta `NEXT_PUBLIC_SITE_URL` o
 * `VERCEL_PROJECT_PRODUCTION_URL`, ver el aviso de `next.config.mjs`),
 * TODAS las escrituras del portal caen aquí para TODOS los usuarios —no
 * solo un admin. Antes de este fix caía al mensaje genérico
 * ("No se pudo actualizar el usuario."), indistinguible de un rechazo de
 * negocio normal, e indiagnosticable desde la interfaz: nada le decía a un
 * admin que el problema es de CONFIGURACIÓN del servidor, no de su acción
 * ni de su cuenta. Mensaje deliberadamente sin jerga (nada de "CORS",
 * "Origin" ni "dominio permitido"): describe el síntoma en términos
 * operativos y da la siguiente acción concreta.
 */
const MENSAJE_ORIGEN_NO_PERMITIDO =
  "El servidor no reconoce la dirección web desde la que se está usando el portal y bloqueó la acción por seguridad. No es un problema con esta cuenta ni con este usuario: repórtalo al equipo técnico para que revise la configuración del servidor.";

/**
 * Mensaje es-MX para un PATCH que responde 5xx con un cuerpo que NO es
 * JSON (página de error HTML de Next, proxy caído, worker muerto, etc.).
 *
 * Bug reportado: un `next dev` huérfano (proceso padre muerto, tuberías rotas
 * hacia su jest-worker) respondía 500 con la página de error HTML de Next
 * SIN ejecutar jamás nuestro handler — nunca hubo mutación ni rechazo de
 * negocio real. Con `MENSAJE_GENERICO` ("No se pudo actualizar el
 * usuario.") ese fallo AMBIENTAL es indistinguible de un rechazo de
 * negocio, y el admin no tiene forma de saber que el problema es del
 * servidor (no de su acción) ni que la operación pudo haber quedado a
 * medias. Este mensaje separa ambos casos y expone el status para quien
 * reporte el problema.
 */
function mensajeErrorServidorSinJson(status: number): string {
  return `El servidor no respondió correctamente (error ${status}). La operación pudo no aplicarse: verifica el estado del usuario y vuelve a intentar.`;
}

/** Copia al portapapeles con feedback (I4): usada por los 2 diálogos de contraseña temporal de abajo. */
async function copiarContrasena(valor: string) {
  try {
    await navigator.clipboard.writeText(valor);
    toast.success("Contraseña copiada");
  } catch {
    toast.error("No se pudo copiar. Selecciona y copia manualmente.");
  }
}

/**
 * Bloque `<code>` + botón "Copiar" de una contraseña temporal (I4).
 * Compartido por el diálogo de alta (`AltaUsuarioDialog`) y el de reset
 * (el `Dialog` de revelado en `ConfigUsuarios`) — antes duplicado en
 * ambos lados (ver `docs/known-limitations.md` (B5-3)).
 */
function ContrasenaTemporalCampo({ password }: { password: string }) {
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 rounded-md border border-line bg-surface-3 px-3 py-2 font-mono text-[13px]">{password}</code>
      <Button type="button" variant="outline" onClick={() => void copiarContrasena(password)}>
        Copiar
      </Button>
    </div>
  );
}

/**
 * Interpreta el shape de error de la API (`ApiErrorBody`) para las
 * mutaciones de esta card (FIX3, ronda 2): antes solo se leía `message`,
 * ausente en 'unauthorized'/'payload_too_large'/'internal_error' — esos
 * códigos siempre caían al mensaje genérico. El caso más probable DÍA A
 * DÍA es la sesión expirada con la pestaña abierta (`unauthorized`), que
 * además de un mensaje claro necesita mandar al admin a /login — pero el
 * 403 más probable del PRIMER arranque en producción es `forbidden_origin`
 * (punto C, ronda de revisión INV-B7B): si la allowlist de `Origin` del
 * servidor no incluye el dominio real (`src/lib/api/origin.ts`), TODAS las
 * escrituras del portal caen aquí, para TODOS los usuarios, y sin mensaje
 * propio es indiagnosticable desde la interfaz.
 *
 * `status` y `cuerpoEsJson` (nuevos parámetros, fix del bug reportado — ver
 * `mensajeErrorServidorSinJson` arriba): `cuerpoEsJson=false` significa que
 * el llamador NO pudo parsear el cuerpo de la respuesta como JSON, así que
 * `body` viene `undefined` y NO es un `ApiErrorBody` real (la respuesta
 * pudo no haber pasado siquiera por nuestro handler). Un 5xx en ese caso
 * usa el mensaje específico de fallo de servidor; un 4xx no-JSON (payload
 * raro pero sí un rechazo de negocio real) se queda con el genérico de
 * siempre.
 */
function resolverErrorPatch(
  body: ApiErrorBody | undefined,
  status: number,
  cuerpoEsJson: boolean,
): { mensaje: string; sesionExpirada: boolean } {
  if (!cuerpoEsJson) {
    return {
      mensaje: status >= 500 ? mensajeErrorServidorSinJson(status) : MENSAJE_GENERICO,
      sesionExpirada: false,
    };
  }
  // `body?.error` llega tipado `string` a secas (contrato compartido de
  // `ApiErrorBody` en `@/lib/hooks/use-api`, también usado por las rutas
  // de LECTURA) — un typo en un `case` de abajo compilaría en silencio.
  // Se castea UNA vez al tipo real (ronda 3, FIX MEDIO-4): con el switch
  // tipado contra la unión completa, TS marca cualquier `case` que no
  // exista en `ApiErrorCode`.
  const codigo = body?.error as ApiErrorCode | undefined;
  switch (codigo) {
    case "unauthorized":
      return { mensaje: MENSAJE_SESION_EXPIRADA, sesionExpirada: true };
    // `forbidden_origin` (punto C): mensaje PROPIO, deliberadamente NO
    // `body?.message` (el del servidor, "Origen no permitido para esta
    // operación.", sigue sin decir qué hacer) — ver el comentario de
    // `MENSAJE_ORIGEN_NO_PERMITIDO` arriba.
    case "forbidden_origin":
      return { mensaje: MENSAJE_ORIGEN_NO_PERMITIDO, sesionExpirada: false };
    case "forbidden":
    case "invalid_body":
      return { mensaje: body?.message ?? MENSAJE_GENERICO, sesionExpirada: false };
    case "internal_error":
      return { mensaje: MENSAJE_ERROR_SERVIDOR, sesionExpirada: false };
    default:
      return { mensaje: MENSAJE_GENERICO, sesionExpirada: false };
  }
}

/** Card "Usuarios y roles" (SOLO admin): lista + alta + rol/suspender/reset por fila. */
export function ConfigUsuarios() {
  const sesion = useSesion();
  const { data, error, loading, refetch } = useApi<UsuariosResponse>("/api/usuarios");
  const [altaOpen, setAltaOpen] = useState(false);
  /**
   * Estado de revelado del reset (FIX1, ronda 2): vive AQUÍ, fuera del
   * gate `{!loading && ...}` de abajo, y no dentro de `<UsuarioFila>`.
   * Antes, `patch()` disparaba `onChanged()` (refetch) DESDE ADENTRO, lo
   * que ponía `loading=true` ~1 frame después de revelar la contraseña y
   * desmontaba TODA la tabla (con ella, `<UsuarioFila>` y su estado local)
   * — el admin nunca llegaba a verla aunque el PATCH ya la hubiera rotado
   * (bug reportado). Montado junto a `<AltaUsuarioDialog>`, que
   * por vivir fuera de este mismo gate nunca sufrió el problema.
   */
  const [resetReveal, setResetReveal] = useState<{ email: string; password: string } | null>(null);

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13.5px] font-semibold text-ink">Usuarios y roles</h2>
        <Button type="button" size="sm" onClick={() => setAltaOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Agregar usuario
        </Button>
      </div>

      {/*
        FIX C (ronda 3, MEDIO-2): el skeleton SOLO cubre la carga INICIAL
        (sin `data` todavía). Una vez que hay `data`, la tabla queda
        montada MIENTRAS el refetch está en vuelo (`loading===true` con
        `data` previo), marcada `aria-busy` y atenuada; antes, cada
        refetch desmontaba TODA la tabla (perdía menús abiertos, foco,
        scroll de cada fila) desde el primer frame de `loading=true`, sin
        esperar respuesta. CORRECCIÓN (ronda 4): esto NO significa "montada
        para siempre a partir de aquí" — si ESE refetch termina en error,
        `useApi` hace `setData(null)` (ver `use-api.ts`) y este mismo gate
        SÍ desmonta la tabla entonces. Por eso el estado de revelado de
        contraseña (`resetReveal`, ver más abajo) vive en `ConfigUsuarios`
        y no en `<UsuarioFila>`: es el único candado real contra el bug
        reportado cuando el refetch falla (ver el test "candado de regresión" en
        `config-usuarios.test.tsx`). El error solo reemplaza a la tabla
        cuando NO hay ningún `data` que mostrar (mismo patrón que
        `CatalogoView`, ver `docs/engineering/failure-patterns.md` (P3)).
      */}
      {loading && !data && <Skeleton className="h-40 w-full" />}
      {error && !data && <EstadoError mensaje={error.message} onRetry={refetch} />}
      {data && (
        <div className={cn("overflow-x-auto rounded-xl border border-line", loading && "opacity-60")}>
          {/* `aria-busy` en el `<table>` (no en el div envolvente): así lo ve `getByRole("table")` en tests y cualquier AT real. */}
          <Table aria-busy={loading}>
            <TableHeader>
              <TableRow className="border-line-soft hover:bg-transparent">
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((u) => (
                <UsuarioFila
                  key={u.id}
                  usuario={u}
                  esUnoMismo={u.id === sesion.id}
                  onChanged={refetch}
                  onPasswordTemporal={(email, password) => setResetReveal({ email, password })}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AltaUsuarioDialog open={altaOpen} onOpenChange={setAltaOpen} onCreated={refetch} />

      <Dialog
        open={resetReveal !== null}
        onOpenChange={(abierto) => {
          // FIX 1 (ronda 4, MEDIO-1): Escape y clic-fuera se neutralizan
          // ENTERA en `onEscapeKeyDown`/`onInteractOutside` del
          // `DialogContent` de abajo — con `preventDefault()` ahí, Radix
          // ni siquiera llega a invocar este `onOpenChange` para esos dos
          // casos (ver `DismissableLayer` de `@radix-ui/react-dialog`). La
          // X, en cambio, es `DialogPrimitive.Close`: dispara
          // `onOpenChange(false)` DIRECTO, sin pasar por esa capa — dejar
          // este handler como no-op (ronda 3) la dejaba MUERTA: un control
          // visible y focusable que no respondía a nada se percibe como
          // app congelada. Se permite cerrar aquí (mismo efecto que
          // "Listo") sin reabrir la puerta a Escape/clic-fuera.
          if (!abierto) setResetReveal(null);
        }}
      >
        <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Contraseña temporal</DialogTitle>
            <DialogDescription>
              {resetReveal && `Compártela con ${resetReveal.email}. No se volverá a mostrar.`}
            </DialogDescription>
          </DialogHeader>
          {resetReveal && <ContrasenaTemporalCampo password={resetReveal.password} />}
          <DialogFooter>
            <Button type="button" onClick={() => setResetReveal(null)}>
              Listo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface ItemGuardarrailProps {
  /** `true` → guardarraíl activo: agrega el `title` de aviso y fuerza disabled. */
  bloqueado: boolean;
  /** `true` → disabled adicional (p.ej. mutación en curso) SIN el título del guardarraíl. */
  procesando: boolean;
  /** Único hijo: el `DropdownMenuItem`/`DropdownMenuRadioItem` a envolver. */
  children: ReactElement<{ disabled?: boolean; title?: string }>;
}

/**
 * Envoltura del guardarraíl "no puedes modificar tu propia cuenta".
 * Historia: en ronda 3 (FIX MEDIO-7) se quitó el `<span title=…>` que
 * envolvía cada item —violaba la regla axe `aria-required-children`
 * (un `<span>` sin rol, intercalado entre `role="menu"` y
 * `role="menuitem"`/`role="menuitemradio"`, no es un hijo válido)— y el
 * `title` se movió DIRECTO al item vía `cloneElement`.
 *
 * FIX 2 (ronda 4, MEDIO-2): ese cambio rompió el tooltip en la práctica.
 * El item deshabilitado lleva `data-[disabled]:pointer-events-none`
 * (ver `DropdownMenuItem`/`DropdownMenuRadioItem`), así que deja de ser
 * hit-target — el navegador nunca detecta hover sobre él y el `title`
 * puesto ahí nunca dispara el tooltip nativo (QA-USR-14 del playbook lo
 * exige). Se reintroduce el wrapper, pero con `role="none"`
 * (equivalente a `role="presentation"`): eso lo saca del árbol de
 * accesibilidad, así que sigue sin violar `aria-required-children` (un
 * nodo `role="none"` no cuenta como hijo para esa regla), mientras que,
 * al estar FUERA del item con `pointer-events` normal, SÍ recibe el
 * hover y muestra el `title`. Se deja el `title` también en el item
 * (no estorba y cubre herramientas que lo consultan ahí directo).
 */
function ItemGuardarrail({ bloqueado, procesando, children }: ItemGuardarrailProps) {
  const disabled = bloqueado || procesando;
  const titulo = bloqueado ? MENSAJE_GUARDARRAIL : undefined;
  return (
    <span role="none" title={titulo}>
      {cloneElement(children, { disabled, title: titulo })}
    </span>
  );
}

interface UsuarioFilaProps {
  usuario: UsuarioItem;
  esUnoMismo: boolean;
  onChanged: () => void;
  /** Publica la contraseña temporal hacia `ConfigUsuarios` (FIX1: el estado de revelado vive ahí, no aquí). */
  onPasswordTemporal: (email: string, password: string) => void;
}

function UsuarioFila({ usuario, esUnoMismo, onChanged, onPasswordTemporal }: UsuarioFilaProps) {
  const router = useRouter();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [suspenderOpen, setSuspenderOpen] = useState(false);
  const [procesando, setProcesando] = useState(false);

  /** SOLO transporte (FIX1): ya no dispara `onChanged()` — cada handler decide cuándo refrescar. */
  async function patch(body: PatchUsuarioBody): Promise<ActualizarUsuarioResult | null> {
    setProcesando(true);
    try {
      const res = await fetch(`/api/usuarios/${usuario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let errorBody: ApiErrorBody | undefined;
        let cuerpoEsJson = true;
        try {
          errorBody = (await res.json()) as ApiErrorBody;
        } catch {
          // Cuerpo no es JSON (o vacío): NO es un ApiErrorBody real — puede
          // ser la página de error HTML de un `next dev` caído, un proxy o
          // un worker muerto que respondió sin ejecutar nuestro handler
          // (bug reportado). `resolverErrorPatch` distingue este caso por
          // `status` (ver `mensajeErrorServidorSinJson`).
          cuerpoEsJson = false;
        }
        const { mensaje, sesionExpirada } = resolverErrorPatch(errorBody, res.status, cuerpoEsJson);
        toast.error(mensaje);
        if (sesionExpirada) {
          // FIX F (ronda 3, MEDIO-6): el middleware SIEMPRE manda a
          // `/login?next=<pathname>` (convención transversal del
          // portal) — replicarla aquí (en vez de un `/login` a secas)
          // hace que el admin vuelva a "Usuarios y roles" tras
          // reautenticarse. `replace` (no `push`) evita dejar esta
          // página muerta en el historial: "atrás" no debe regresar a
          // una card cuya sesión ya expiró.
          router.replace("/login?next=" + encodeURIComponent("/config?tab=usuarios"));
        }
        return null;
      }
      return (await res.json()) as ActualizarUsuarioResult;
    } catch {
      toast.error(MENSAJE_GENERICO);
      return null;
    } finally {
      setProcesando(false);
    }
  }

  async function handleRolChange(rol: Rol) {
    if (rol === usuario.rol) return;
    const result = await patch({ accion: "rol", rol });
    if (result) {
      toast.success("Rol actualizado.");
      onChanged();
    }
  }

  async function handleResetPasswordConfirmado() {
    const result = await patch({ accion: "reset_password" });
    setResetConfirmOpen(false);
    if (result?.password_temporal) {
      // Orden crítico (FIX1): primero se publica la contraseña hacia el
      // estado del padre (fuera del gate de `loading`); SOLO DESPUÉS se
      // dispara el refetch. Invertir este orden es exactamente el bug
      // original: el remount que provoca `onChanged()` llegaría antes de
      // que la contraseña quedara a salvo en un estado que sobrevive a ese
      // remount.
      onPasswordTemporal(usuario.email, result.password_temporal);
      onChanged();
    } else if (result) {
      // FIX H (ronda 3, INFO-2): 200 sin `password_temporal` es un
      // contrato roto de backend que nunca debería ocurrir — pero si
      // ocurre, antes el diálogo se cerraba en silencio (sin toast ni
      // refetch) y el admin no se enteraba de que el reset no sirvió.
      toast.error(MENSAJE_GENERICO);
    }
  }

  async function handleSuspenderConfirmado() {
    const accion = usuario.suspendido ? "reactivar" : "suspender";
    const result = await patch({ accion });
    setSuspenderOpen(false);
    if (result) {
      toast.success(usuario.suspendido ? "Acceso reactivado." : "Acceso suspendido.");
      onChanged();
    }
  }

  return (
    <>
      <TableRow className="border-line-soft">
        <TableCell className="text-[13px] text-ink-2">{usuario.email}</TableCell>
        <TableCell>
          <Badge variant="secondary" className="font-normal">
            {ETIQUETA_ROL[usuario.rol]}
          </Badge>
        </TableCell>
        <TableCell>
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
              usuario.suspendido ? "bg-warn-bg text-warn" : "bg-success-bg text-success",
            )}
          >
            {usuario.suspendido ? "Suspendido" : "Activo"}
          </span>
        </TableCell>
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Acciones para ${usuario.email}`}>
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // "Restablecer contraseña"/"Suspender" abren un Dialog/AlertDialog
              // (sibling, fuera de este menú) tras cerrarse. IMPORTANTE: los
              // `onSelect` de esos items NO llaman `preventDefault()` — hacerlo
              // deja el menú "abierto" (Radix se salta `onClose()`), y dos capas
              // modales abiertas a la vez (este menú + el diálogo) pelean por el
              // foco (bucle infinito). Se deja cerrar el menú de forma normal;
              // el diálogo gestiona su propio foco inicial al montar.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuLabel>Rol</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={usuario.rol} onValueChange={(v) => void handleRolChange(v as Rol)}>
                {ROLES.map((rolOpcion) => (
                  <ItemGuardarrail key={rolOpcion} bloqueado={esUnoMismo} procesando={procesando}>
                    <DropdownMenuRadioItem value={rolOpcion}>{ETIQUETA_ROL[rolOpcion]}</DropdownMenuRadioItem>
                  </ItemGuardarrail>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <ItemGuardarrail bloqueado={esUnoMismo} procesando={procesando}>
                <DropdownMenuItem
                  onSelect={() => {
                    setResetConfirmOpen(true);
                  }}
                >
                  Restablecer contraseña
                </DropdownMenuItem>
              </ItemGuardarrail>
              <ItemGuardarrail bloqueado={esUnoMismo} procesando={procesando}>
                <DropdownMenuItem
                  onSelect={() => {
                    setSuspenderOpen(true);
                  }}
                >
                  {usuario.suspendido ? "Reactivar acceso" : "Suspender acceso"}
                </DropdownMenuItem>
              </ItemGuardarrail>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

      <AlertDialog open={suspenderOpen} onOpenChange={setSuspenderOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{usuario.suspendido ? "Reactivar acceso" : "Suspender acceso"}</AlertDialogTitle>
            <AlertDialogDescription>
              {usuario.suspendido
                ? `${usuario.email} podrá iniciar sesión nuevamente.`
                : `${usuario.email} no podrá iniciar sesión hasta reactivar su acceso.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={procesando}>Cancelar</AlertDialogCancel>
            {/*
              FIX2: `AlertDialogAction` ES un `DialogClose` de Radix — sin
              `e.preventDefault()` cierra el diálogo EN EL CLICK, antes de
              que el `await` del PATCH resuelva (el admin no ve nada
              mientras se procesa). Con `preventDefault()`, Radix se salta
              su propio `onOpenChange(false)` (ver `composeEventHandlers` en
              `@radix-ui/react-dialog`) y el cierre queda 100% en manos del
              handler, que lo hace explícitamente tras la respuesta.
            */}
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSuspenderConfirmado();
              }}
              disabled={procesando}
            >
              {procesando ? (usuario.suspendido ? "Reactivando…" : "Suspendiendo…") : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restablecer contraseña</AlertDialogTitle>
            <AlertDialogDescription>
              La contraseña actual de {usuario.email} dejará de funcionar y se generará una temporal que se mostrará una sola vez.
              {usuario.suspendido && " Este usuario está suspendido y seguirá sin poder iniciar sesión hasta reactivar su acceso."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={procesando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleResetPasswordConfirmado();
              }}
              disabled={procesando}
            >
              {procesando ? "Restableciendo…" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface AltaUsuarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

function AltaUsuarioDialog({ open, onOpenChange, onCreated }: AltaUsuarioDialogProps) {
  const [email, setEmail] = useState("");
  // Default "kam" por ergonomía del alta (decisión de producto, Bloque 7-A) —
  // el tipo sí se amplía a `Rol` para que "visitante" sea seleccionable.
  const [rol, setRol] = useState<Rol>("kam");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState<{ passwordTemporal: string; email: string } | null>(null);

  function reset() {
    setEmail("");
    setRol("kam");
    setError(null);
    setExito(null);
  }

  function handleOpenChange(next: boolean) {
    // FIX 1 (ronda 4, MEDIO-1): mientras `exito` esté poblado, Escape y
    // clic-fuera siguen 100% neutralizados por `onEscapeKeyDown`/
    // `onInteractOutside` en el `DialogContent` de abajo (Radix ni
    // siquiera llega a invocar este `onOpenChange` para esos dos casos) —
    // esa protección NO depende de este handler. La X, en cambio
    // (`DialogPrimitive.Close`), dispara `onOpenChange(false)` DIRECTO;
    // el `if (!next && exito) return;` que vivía aquí (ronda 3, FIX B)
    // también la atrapaba a ELLA, dejándola MUERTA (control visible y
    // focusable que no respondía a nada). Se quita: la contraseña recién
    // creada sigue protegida contra Escape/clic-fuera arriba, y la X
    // vuelve a cerrar el diálogo como cualquier otro.
    onOpenChange(next);
    if (!next) reset();
  }

  /** Cierre DELIBERADO del botón "Listo" (ver guardarraíl de `handleOpenChange` arriba). */
  function cerrarDeliberado() {
    onOpenChange(false);
    reset();
  }

  async function handleCrear() {
    setError(null);
    const valor = email.trim();
    if (!valor) return;

    setGuardando(true);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: valor, rol }),
      });
      if (res.status === 409) {
        setError("Ya existe un usuario con ese correo.");
        return;
      }
      if (!res.ok) {
        toast.error("No se pudo crear el usuario.");
        return;
      }
      const result = (await res.json()) as { usuario: UsuarioItem; password_temporal: string };
      setExito({ passwordTemporal: result.password_temporal, email: valor });
      onCreated();
    } catch {
      toast.error("No se pudo crear el usuario.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onInteractOutside={(e) => {
          if (exito) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (exito) e.preventDefault();
        }}
      >
        {exito ? (
          <>
            <DialogHeader>
              <DialogTitle>Usuario creado</DialogTitle>
              <DialogDescription>Comparte esta contraseña temporal con {exito.email}. No se volverá a mostrar.</DialogDescription>
            </DialogHeader>
            <ContrasenaTemporalCampo password={exito.passwordTemporal} />
            <DialogFooter>
              <Button type="button" onClick={cerrarDeliberado}>
                Listo
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Agregar usuario</DialogTitle>
              <DialogDescription>Se generará una contraseña temporal para el nuevo usuario.</DialogDescription>
            </DialogHeader>
            {error && (
              <div role="alert" className="rounded-[10px] bg-warn-bg px-3 py-2 text-[12.5px] text-warn">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alta-usuario-email">Correo</Label>
              <Input
                id="alta-usuario-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                disabled={guardando}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="alta-usuario-rol">Rol</Label>
              <Select value={rol} onValueChange={(v) => setRol(v as Rol)}>
                <SelectTrigger id="alta-usuario-rol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((rolOpcion) => (
                    <SelectItem key={rolOpcion} value={rolOpcion}>
                      {ETIQUETA_ROL[rolOpcion]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void handleCrear()} disabled={guardando || !email.trim()}>
                {guardando ? "Creando…" : "Agregar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
