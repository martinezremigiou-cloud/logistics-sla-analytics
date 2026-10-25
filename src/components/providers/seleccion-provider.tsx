"use client";

// ============================================================
// [INV-B8.2] seleccion-provider.tsx — la Selección, viva entre vistas.
//
// DÓNDE VIVE Y POR QUÉ. Context montado en `(app)/layout.tsx`, respaldado por
// `localStorage`. Las tres opciones que se evaluaron y lo que sobrevive cada
// una:
//
//   Context a secas          navegar entre vistas · se pierde al refrescar
//   Context + localStorage   también el refresco, por dispositivo   ← ésta
//   Tabla en Supabase        entre dispositivos · pero la vuelve DATO ORIGINADO,
//                            con su RLS, su respaldo y la deuda B8-10
//
// La Selección **no es dato originado**: es un apunte de trabajo del navegador.
// No se persiste en la base, no aparece en ningún documento y perderla no
// pierde nada del negocio. Meterla en una tabla habría sido darle garantías que
// no necesita y costos que sí.
//
// Precedente en el repo, no invención: `sidebar-colapso.ts` ya persiste estado
// de UI en `localStorage` (con su técnica anti-parpadeo documentada), y también
// lo hacen `catalogo-arbol.tsx` y `pendiente-acciones.tsx`. Cero dependencias
// nuevas.
//
// EL AISLAMIENTO ENTRE SESIONES NO VIVE AQUÍ, y es a propósito: vive en la
// CLAVE (`mx-seleccion:<auth.uid()>`, ver `src/lib/seleccion.ts`). Este
// componente solo le pasa el `id` de la sesión que ya resolvió
// `(app)/layout.tsx`. Si el aislamiento dependiera de que este provider
// escuche un evento de cierre de sesión, fallaría callado el día que la
// pestaña muera sin avisar.
//
// TODA LA LÓGICA ES PURA Y VIVE FUERA. Este archivo es cableado: estado,
// hidratación y persistencia. Las operaciones (agregar, alternar, fijar
// cantidad, leer un almacén hostil) están en `src/lib/seleccion.ts`, probadas
// sin React y sin navegador.
// ============================================================
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSesion } from "./session-provider";
import {
  SELECCION_VACIA,
  agregar as agregarPuro,
  alternar as alternarPuro,
  quitar as quitarPuro,
  fijarCantidad as fijarCantidadPuro,
  vaciar as vaciarPuro,
  leerSeleccion,
  escribirSeleccion,
  tiene,
  cantidadDe,
  totalPiezas,
  type Seleccion,
} from "@/lib/seleccion";

interface ContextoSeleccion {
  seleccion: Seleccion;
  /** `false` hasta que se leyó `localStorage`. Evita que la píldora parpadee al montar. */
  hidratada: boolean;
  tiene: (sku: string) => boolean;
  cantidadDe: (sku: string) => number;
  totalPiezas: number;
  agregar: (sku: string, cantidad?: number) => void;
  alternar: (sku: string, cantidad?: number) => void;
  quitar: (sku: string) => void;
  fijarCantidad: (sku: string, cantidad: number) => void;
  vaciar: () => void;
  /**
   * Si el panel flotante está desplegado. Vive AQUÍ y no dentro del panel por
   * dos razones: la evidencia visual se renderiza sin efectos y necesita poder
   * sembrar el estado abierto (ver `SeleccionFija`), y las acciones que van a
   * llegar después —volcar cierra el panel, el botón de la ficha lo abre— son
   * de la Selección, no del componente que la dibuja.
   */
  panelAbierto: boolean;
  setPanelAbierto: (abierto: boolean) => void;
  /**
   * [INV-B11] Si el diálogo de volcado está abierto.
   *
   * **Vivía como `useState` local en `SeleccionFlotante`**, con este comentario
   * al lado: *«no viaja en el contexto porque nadie más necesita saberlo — el
   * criterio es el mismo por el que `panelAbierto` SÍ viaja: ahí hacía falta
   * desde fuera, aquí no»*.
   *
   * Ahora hace falta desde fuera. O6 mueve la Selección al pie del sidebar
   * cuando hay sidebar, así que **el panel se pinta en dos sitios** y los dos
   * tienen que poder abrir el MISMO diálogo. Montar un `VolcarDialog` por sitio
   * dejaría dos `Dialog` de radix vivos y dos `useApi` de proyectos.
   *
   * El criterio no cambió: subió porque se cumplió su condición.
   */
  volcando: boolean;
  setVolcando: (abierto: boolean) => void;
}

const SeleccionContext = createContext<ContextoSeleccion | null>(null);

export function SeleccionProvider({ children }: { children: ReactNode }) {
  const { id: sesionId } = useSesion();
  const [seleccion, setSeleccion] = useState<Seleccion>(SELECCION_VACIA);
  const [hidratada, setHidratada] = useState(false);
  // Arranca CONTRAÍDO. Un panel que se despliega solo encima de la tabla cada
  // vez que alguien marca un SKU sería una interrupción, no una ayuda.
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [volcando, setVolcando] = useState(false);

  // La hidratación va en un efecto y no en el estado inicial a propósito: el
  // servidor no tiene `localStorage`, y leerlo durante el render produciría un
  // desajuste de hidratación. El precio es un primer render con la Selección
  // vacía, y por eso `hidratada` viaja en el contexto — para que la píldora
  // flotante no aparezca vacía y salte medio segundo después.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeleccion(leerSeleccion(window.localStorage, sesionId));
    setHidratada(true);
  }, [sesionId]);

  // Persistir SOLO después de hidratar. Sin esta guarda, el primer efecto
  // escribiría la Selección vacía del render inicial ENCIMA de la guardada, y
  // refrescar la página la borraría — un bug que se ve como "se perdió sola".
  useEffect(() => {
    if (!hidratada || typeof window === "undefined") return;
    escribirSeleccion(window.localStorage, sesionId, seleccion);
  }, [hidratada, sesionId, seleccion]);

  const valor = useMemo<ContextoSeleccion>(
    () => ({
      seleccion,
      hidratada,
      tiene: (sku: string) => tiene(seleccion, sku),
      cantidadDe: (sku: string) => cantidadDe(seleccion, sku),
      totalPiezas: totalPiezas(seleccion),
      agregar: (sku: string, cantidad?: number) => setSeleccion((s) => agregarPuro(s, sku, cantidad)),
      alternar: (sku: string, cantidad?: number) => setSeleccion((s) => alternarPuro(s, sku, cantidad)),
      quitar: (sku: string) => setSeleccion((s) => quitarPuro(s, sku)),
      fijarCantidad: (sku: string, cantidad: number) => setSeleccion((s) => fijarCantidadPuro(s, sku, cantidad)),
      // Vaciar cierra el panel: si no lo hiciera, quedaría un contenedor vacío
      // abierto en pantalla que el usuario ya no tiene motivo para mirar.
      vaciar: () => {
        setSeleccion(vaciarPuro());
        setPanelAbierto(false);
      },
      panelAbierto,
      setPanelAbierto,
      volcando,
      setVolcando,
    }),
    [seleccion, hidratada, panelAbierto, volcando],
  );

  return <SeleccionContext.Provider value={valor}>{children}</SeleccionContext.Provider>;
}

/**
 * Provider de valor FIJO, sin `localStorage` y sin efectos.
 *
 * Existe por una razón concreta y medible: la evidencia visual se produce con
 * `renderToStaticMarkup`, que **no corre ningún `useEffect`** — así que el
 * provider real se pinta siempre con la Selección vacía y el panel devolvería
 * `null`. Con esto la evidencia muestra el panel CON renglones dentro, que es
 * lo único que se puede juzgar. Los tests de componente lo usan por el mismo
 * motivo: sembrar un estado sin simular un navegador.
 *
 * No es superficie de producción: `(app)/layout.tsx` monta `SeleccionProvider`,
 * nunca éste. Las mutaciones son no-ops porque el estado es, literalmente, fijo.
 */
export function SeleccionFija({
  seleccion,
  panelAbierto = false,
  children,
}: {
  seleccion: Seleccion;
  panelAbierto?: boolean;
  children: ReactNode;
}) {
  const valor = useMemo<ContextoSeleccion>(
    () => ({
      seleccion,
      hidratada: true,
      tiene: (sku: string) => tiene(seleccion, sku),
      cantidadDe: (sku: string) => cantidadDe(seleccion, sku),
      totalPiezas: totalPiezas(seleccion),
      agregar: () => {},
      alternar: () => {},
      quitar: () => {},
      fijarCantidad: () => {},
      vaciar: () => {},
      panelAbierto,
      setPanelAbierto: () => {},
      volcando: false,
      setVolcando: () => {},
    }),
    [seleccion, panelAbierto],
  );
  return <SeleccionContext.Provider value={valor}>{children}</SeleccionContext.Provider>;
}

/**
 * La Selección de la sesión actual.
 *
 * Devuelve `null` fuera del provider en vez de lanzar — al revés que
 * `useSesion()`, y la diferencia importa: sin sesión un componente no puede
 * decidir permisos y fallar rápido es lo correcto; sin Selección, un botón
 * simplemente no se pinta. Eso permite montar el catálogo o la ficha en un test
 * sin arrastrar el provider, y que la degradación sea "no hay botón" y no "la
 * página se cae".
 */
export function useSeleccionOpcional(): ContextoSeleccion | null {
  return useContext(SeleccionContext);
}

/** Igual que la anterior, pero para componentes que solo existen dentro del provider (el panel flotante). */
export function useSeleccion(): ContextoSeleccion {
  const contexto = useContext(SeleccionContext);
  if (!contexto) throw new Error("useSeleccion() debe usarse dentro de <SeleccionProvider>.");
  return contexto;
}
