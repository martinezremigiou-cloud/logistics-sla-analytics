"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar, type Sesion } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AvisoVersionNueva } from "@/components/shared/aviso-version-nueva";
import { SeleccionFlotante } from "@/components/seleccion/seleccion-flotante";
import { useSeleccionOpcional } from "@/components/providers/seleccion-provider";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_COLAPSADO_STORAGE_KEY,
  aplicarColapsoSidebar,
  leerColapsadoSidebar,
} from "@/components/layout/sidebar-colapso";
import { ATRIBUTO_SELECCION, reservaDeContenido } from "@/components/layout/carril";

export function AppShell({ children, sesion }: { children: React.ReactNode; sesion: Sesion }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Arranca en "expandido" (= lo que ya pinta el SSR) para no desalinear la
  // hidratación. El script bloqueante de layout.tsx ya aplicó el ancho/
  // opacidad REALES sobre <html> antes de este render — este estado solo
  // sincroniza aria-expanded (Topbar) e `inert` (abajo) con el DOM, nunca
  // decide el ancho visual (ver sidebar-colapso.ts).
  const [colapsado, setColapsado] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  // [INV-B8.2] La píldora de la Selección flota sobre el contenido, y lo que
  // vive al fondo de las páginas son ACCIONES: la paginación del catálogo, los
  // botones de exportar de un proyecto. `position: fixed` no ocupa espacio en
  // el flujo, así que si el `<main>` no reserva el hueco, la píldora se planta
  // encima del control de "página siguiente" cuando el usuario llega al final
  // — y el usuario no tiene forma de quitarla de ahí.
  //
  // El hueco se reserva SOLO con la Selección no vacía, que es cuando la
  // píldora existe. Cubre el estado CONTRAÍDO, no el desplegado: el panel
  // abierto sí puede tapar contenido, pero es un overlay que el usuario abrió
  // y cierra con un clic. Reservar el alto del panel abierto haría saltar la
  // página entera al desplegarlo.
  const seleccion = useSeleccionOpcional();
  const hayPildora = (seleccion?.seleccion.items.length ?? 0) > 0;

  useEffect(() => {
    setColapsado(leerColapsadoSidebar());
  }, []);

  // [2.0.1-A] EL SHELL PUBLICA SI HAY SELECCIÓN, y el carril decide qué hacer
  // con eso (regla 5: con Selección viva, el saludo del asistente se aparta —
  // `globals.css`). Va como atributo en `<html>` y no como prop hacia el chat
  // porque `flotantes.test.ts` prohíbe —con razón— que el asistente conozca la
  // Selección: acoplarlos fue el defecto que O6 evitó a propósito. Mismo molde
  // imperativo que el `inert` de aquí abajo y que `sidebar-colapso.ts`.
  useEffect(() => {
    const raiz = document.documentElement;
    if (hayPildora) raiz.setAttribute(ATRIBUTO_SELECCION, "1");
    else raiz.removeAttribute(ATRIBUTO_SELECCION);
    return () => raiz.removeAttribute(ATRIBUTO_SELECCION);
  }, [hayPildora]);

  // [INV-B7B] ronda 2, punto E: antes el <aside> colapsado solo llevaba
  // `aria-hidden` — ancho/opacidad ya en 0 (vía las custom properties de
  // sidebar-colapso.ts), pero sus <Link> internos seguían en el orden de
  // tabulación (`aria-hidden` NO le quita el foco a nada por sí solo). Un
  // Tab caía en un enlace invisible dentro de un contenedor `aria-hidden`
  // — Chrome lo trata como error de accesibilidad real (foco dentro de un
  // subárbol marcado como oculto) y lo reporta en consola, no como mera
  // advertencia cosmética.
  //
  // `inert` reemplaza a `aria-hidden` aquí porque resuelve las dos partes
  // del problema con un solo atributo estándar: saca el subárbol del
  // orden de tabulación (foco) Y lo excluye del árbol de accesibilidad
  // (el mismo efecto que ya daba `aria-hidden`) — nunca vuelve a dejar al
  // navegador en el estado inconsistente de "foco posible dentro de un
  // contenedor marcado como oculto".
  //
  // Se aplica con `setAttribute`/`removeAttribute` imperativos sobre el
  // nodo real (vía `ref`), NO como prop de JSX, por dos razones:
  //   1. @types/react en esta versión (React 18) no tiene `inert` tipado
  //      en `HTMLAttributes` (llegó después, con React 19) — agregar un
  //      paquete de tipos nuevo está fuera de alcance de este bloque.
  //   2. React 18 tampoco reconoce `inert` en su lista de atributos
  //      booleanos: pasarle `true`/`false` como boolean (a diferencia de
  //      `aria-hidden`, sí reconocido por el prefijo `aria-`) hace que
  //      React lo trate como atributo booleano "genérico" y termine SIN
  //      escribirlo nunca en el DOM real.
  // `setAttribute`/`removeAttribute` no necesitan tipado especial — son
  // métodos estándar de `Element` — así que evitan ambos problemas sin
  // instalar nada nuevo.
  useEffect(() => {
    const nodo = asideRef.current;
    if (!nodo) return;
    if (colapsado) {
      nodo.setAttribute("inert", "");
    } else {
      nodo.removeAttribute("inert");
    }
  }, [colapsado]);

  function alternarColapso() {
    const siguiente = !colapsado;
    aplicarColapsoSidebar(siguiente);
    try {
      localStorage.setItem(SIDEBAR_COLAPSADO_STORAGE_KEY, siguiente ? "1" : "0");
    } catch {
      // localStorage inaccesible — el toggle sigue funcionando en esta sesión, solo no persiste.
    }
    setColapsado(siguiente);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-app">
      {/* El sidebar permanece siempre montado (nunca se desmonta al
          colapsar) — solo transiciona ancho/opacidad, leídos de las custom
          properties que setea sidebar-colapso.ts. */}
      <aside
        ref={asideRef}
        style={{ width: "var(--mx-sidebar-w, 230px)", opacity: "var(--mx-sidebar-opacity, 1)" }}
        className="hidden shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-in-out md:block"
      >
        {/* `mostrarSeleccion` sólo aquí y sólo expandido: colapsado el `<aside>`
            mide 0 px con `overflow-hidden`, así que el panel quedaría en el DOM
            —y en el árbol de accesibilidad— recortado e invisible. Habría DOS
            paneles a la vez para un lector de pantalla. */}
        <Sidebar sesion={sesion} mostrarSeleccion={!colapsado} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[230px] border-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Navegación principal</SheetTitle>
          </SheetHeader>
          {/* En el cajón NO: bajo `md` la Selección flota, y pintarla también
              aquí la duplicaría en cuanto alguien abriera el menú. */}
          <Sidebar sesion={sesion} onNavigate={() => setMobileOpen(false)} mostrarSeleccion={false} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Encargo final (Bloque 7-B) — se monta aquí, no más abajo en una
            página individual, porque AppShell es el único nivel que NO se
            remonta con la navegación interna del route group (app): el
            banner sigue vivo (y su estado, ya detectado, no se resetea) al
            cambiar de pantalla, justo cuando más hace falta verlo.
            AvisoVersionNueva devuelve `null` mientras no hay nada que
            avisar — no reserva hueco, no hay salto al aparecer más que el
            reflow normal de empujar Topbar/main hacia abajo, esperado para
            un banner de ancho completo. Nunca recarga sola (ver el propio
            componente): el reload es siempre un clic del usuario. */}
        <AvisoVersionNueva />
        <Topbar onMenuClick={() => setMobileOpen(true)} colapsado={colapsado} onToggleColapsado={alternarColapso} />
        <main
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[clamp(16px,3.2vw,30px)]",
            // [2.0.1-A] La reserva se DERIVA del carril (`reservaDeContenido`),
            // no de dos números elegidos a ojo. `pb-14`/`pb-32` suponían el alto
            // del nav (mal: mide 54) y el de la píldora, y ninguno de los dos se
            // enteraba si el otro cambiaba. `position: fixed` no ocupa flujo: sin
            // esta reserva, los controles del final de una página —la paginación
            // del catálogo, los botones de un proyecto— quedan bajo un flotante
            // y nadie puede tocarlos.
            //
            // LOS DOS HECHOS SE PASAN JUNTOS, y la corrección es de este bloque
            // contra sí mismo: aquí había un `"md:pb-0"` **fuera** de la
            // llamada, así que de `md` para arriba la reserva era cero hubiera o
            // no píldora. Y en escritorio la píldora SÍ flota cuando el sidebar
            // está colapsado (es la misma condición que decide `SeleccionFlotante`
            // ahí abajo), de modo que la paginación del catálogo quedaba bajo
            // ella sin manera de alcanzarla. Es la reserva anulada por el
            // arreglo que la derivó: la razón de que ahora la función pida los
            // dos regímenes y no quede sitio donde escribir un `md:` suelto.
            reservaDeContenido({ pildora: hayPildora, pildoraEnEscritorio: hayPildora && colapsado }),
          )}
        >
          {children}
        </main>
      </div>

      <BottomNav sesion={sesion} onMore={() => setMobileOpen(true)} />
      {/* Hermano de `BottomNav` y no hijo del `<main>`: flota sobre TODA la
          aplicación, no sobre una página. Devuelve `null` sin Selección.

          [INV-B11] O6 · CUÁNDO FLOTA Y CUÁNDO NO.

          El panel vive en el pie del sidebar siempre que HAYA sidebar. Sólo
          flota en los dos estados donde no lo hay, y la condición se parte en
          dos mitades porque cada una la sabe un sistema distinto:

            · colapsado  → lo sabe REACT (`colapsado`), y entonces flota a
                           TODOS los anchos: bajo `md` tampoco hay sidebar
            · expandido  → sólo puede flotar bajo `md`, y eso lo sabe el CSS
                           (`md:hidden`)

          Sin la mitad de React, colapsar el sidebar haría desaparecer la
          Selección — que es justo lo que se puso como requisito de O6. */}
      {seleccion && <SeleccionFlotante className={colapsado ? undefined : "md:hidden"} />}
    </div>
  );
}
