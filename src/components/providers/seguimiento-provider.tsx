"use client";

// ============================================================
// [INV-B9] seguimiento-provider.tsx — qué SKU sigue esta sesión.
//
// MISMO PATRÓN QUE `SeleccionProvider`, OTRO ALMACÉN, y la diferencia es la
// decisión del bloque: la Selección vive en `localStorage` porque es un
// borrador de trabajo; el seguimiento vive en una TABLA porque el bloque de
// correo tiene que leerlo desde el servidor, y `localStorage` no se lo puede
// decir.
//
// Consecuencia práctica: aquí no hay hidratación anti-parpadeo sino una
// LECTURA. `cargado` cumple el papel que `hidratada` cumplía allá — que el
// botón no aparezca en el estado equivocado durante medio segundo.
//
// LAS MUTACIONES SON OPTIMISTAS Y SE REVIERTEN. Marcar un SKU tiene que
// sentirse instantáneo mientras se recorre el catálogo; si el servidor
// rechaza, el estado vuelve atrás y `seguimiento-api.ts` ya mostró el motivo.
// Sin la reversión, la interfaz afirmaría un seguimiento que no existe — que
// es la clase de mentira que este proyecto viene persiguiendo.
// ============================================================
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { seguirSkuFetch, dejarDeSeguirFetch, guardarPreferenciasFetch } from "@/components/seguimiento/seguimiento-api";
import type { AvisosSku, PreferenciasAvisos, SeguimientosResponse } from "@/types/avisos";

/** Espejo de los DEFAULT de la 0026. Se usan mientras la lectura no llega y si el perfil no tiene fila. */
export const PREFERENCIAS_POR_OMISION: PreferenciasAvisos = {
  av_estatus: false,
  av_disponible: false,
  av_reservado: false,
  av_llegada: true,
  preguntar_por_sku: false,
  visto_hasta: null,
  boletin_correo: true,
};

/** Lo que el provider guarda por SKU: los cuatro avisos MÁS el canal. */
export interface EstadoSeguimiento extends AvisosSku {
  av_correo: boolean;
}

interface ContextoSeguimiento {
  /** `false` hasta que llegó la lista. Evita que el botón parpadee en el estado equivocado. */
  cargado: boolean;
  sigue: (sku: string) => boolean;
  avisosDe: (sku: string) => EstadoSeguimiento | null;
  total: number;
  preferencias: PreferenciasAvisos;
  seguir: (sku: string, avisos?: AvisosSku, avCorreo?: boolean) => Promise<boolean>;
  dejarDeSeguir: (sku: string) => Promise<boolean>;
  guardarPreferencias: (parche: Partial<Omit<PreferenciasAvisos, "visto_hasta">> & { marcar_visto?: true }) => Promise<void>;
  recargar: () => void;
}

const SeguimientoContext = createContext<ContextoSeguimiento | null>(null);

/** `trim + UPPER`, el mismo criterio con el que el ETL escribe `productos.sku` y con el que se guardó la fila. */
function normalizar(sku: string): string {
  return sku.trim().toUpperCase();
}

export function SeguimientoProvider({ children }: { children: ReactNode }) {
  const lista = useApi<SeguimientosResponse>("/api/seguimientos");
  const [mapa, setMapa] = useState<Map<string, EstadoSeguimiento>>(new Map());
  const [preferencias, setPreferencias] = useState<PreferenciasAvisos>(PREFERENCIAS_POR_OMISION);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    if (!lista.data) return;
    const siguiente = new Map<string, EstadoSeguimiento>();
    for (const item of lista.data.items) {
      siguiente.set(normalizar(item.sku), {
        av_estatus: item.av_estatus,
        av_disponible: item.av_disponible,
        av_reservado: item.av_reservado,
        av_llegada: item.av_llegada,
        av_correo: item.av_correo,
      });
    }
    setMapa(siguiente);
    setCargado(true);
  }, [lista.data]);

  // Un error de lectura también «carga»: si no, el botón se quedaría en su
  // estado indeterminado para siempre y el usuario no sabría que puede pulsar.
  useEffect(() => {
    if (lista.error) setCargado(true);
  }, [lista.error]);

  const prefsApi = useApi<PreferenciasAvisos>("/api/preferencias");
  useEffect(() => {
    if (prefsApi.data) setPreferencias(prefsApi.data);
  }, [prefsApi.data]);

  const seguir = useCallback(
    async (sku: string, avisos?: AvisosSku, avCorreo?: boolean) => {
      const clave = normalizar(sku);
      const previo = mapa.get(clave) ?? null;
      const aplicados: EstadoSeguimiento = {
        ...(avisos ?? {
          av_estatus: preferencias.av_estatus,
          av_disponible: preferencias.av_disponible,
          av_reservado: preferencias.av_reservado,
          av_llegada: preferencias.av_llegada,
        }),
        av_correo: avCorreo ?? previo?.av_correo ?? false,
      };

      setMapa((m) => new Map(m).set(clave, aplicados));
      const ok = await seguirSkuFetch(clave, avisos, avCorreo);
      if (!ok) {
        setMapa((m) => {
          const copia = new Map(m);
          if (previo) copia.set(clave, previo);
          else copia.delete(clave);
          return copia;
        });
      }
      return ok;
    },
    [mapa, preferencias],
  );

  const dejarDeSeguir = useCallback(
    async (sku: string) => {
      const clave = normalizar(sku);
      const previo = mapa.get(clave) ?? null;

      setMapa((m) => {
        const copia = new Map(m);
        copia.delete(clave);
        return copia;
      });
      const ok = await dejarDeSeguirFetch(clave);
      if (!ok && previo) setMapa((m) => new Map(m).set(clave, previo));
      return ok;
    },
    [mapa],
  );

  const guardarPreferencias = useCallback<ContextoSeguimiento["guardarPreferencias"]>(async (parche) => {
    const guardadas = await guardarPreferenciasFetch(parche);
    if (guardadas) setPreferencias(guardadas);
  }, []);

  const valor = useMemo<ContextoSeguimiento>(
    () => ({
      cargado,
      sigue: (sku: string) => mapa.has(normalizar(sku)),
      avisosDe: (sku: string) => mapa.get(normalizar(sku)) ?? null,
      total: mapa.size,
      preferencias,
      seguir,
      dejarDeSeguir,
      guardarPreferencias,
      recargar: lista.refetch,
    }),
    [cargado, mapa, preferencias, seguir, dejarDeSeguir, guardarPreferencias, lista.refetch],
  );

  return <SeguimientoContext.Provider value={valor}>{children}</SeguimientoContext.Provider>;
}

/**
 * Provider de valor FIJO, sin fetch. Para tests y para la EVIDENCIA VISUAL,
 * que se renderiza con `renderToStaticMarkup` y **no corre ningún `useEffect`**
 * — con el provider real, el botón se pintaría siempre en «no sigue» y la
 * evidencia mostraría un solo estado de los dos.
 *
 * No es superficie de producción: `(app)/layout.tsx` monta el de arriba.
 * Es el mismo asiento que `SeleccionFija` en INV-B8.2.
 */
export function SeguimientoFijo({
  seguidos,
  preferencias = PREFERENCIAS_POR_OMISION,
  children,
}: {
  seguidos: Record<string, AvisosSku & { av_correo?: boolean }>;
  preferencias?: PreferenciasAvisos;
  children: ReactNode;
}) {
  const valor = useMemo<ContextoSeguimiento>(() => {
    const mapa = new Map(
      Object.entries(seguidos).map(([sku, a]) => [normalizar(sku), { ...a, av_correo: a.av_correo ?? false }]),
    );
    return {
      cargado: true,
      sigue: (sku: string) => mapa.has(normalizar(sku)),
      avisosDe: (sku: string) => mapa.get(normalizar(sku)) ?? null,
      total: mapa.size,
      preferencias,
      seguir: async () => true,
      dejarDeSeguir: async () => true,
      guardarPreferencias: async () => {},
      recargar: () => {},
    };
  }, [seguidos, preferencias]);

  return <SeguimientoContext.Provider value={valor}>{children}</SeguimientoContext.Provider>;
}

/**
 * Devuelve `null` fuera del provider en vez de lanzar — igual que
 * `useSeleccionOpcional()`: sin seguimiento un botón simplemente no se pinta,
 * y eso permite montar el catálogo en un test sin arrastrar el provider.
 */
export function useSeguimientoOpcional(): ContextoSeguimiento | null {
  return useContext(SeguimientoContext);
}

export function useSeguimiento(): ContextoSeguimiento {
  const contexto = useContext(SeguimientoContext);
  if (!contexto) throw new Error("useSeguimiento() debe usarse dentro de <SeguimientoProvider>.");
  return contexto;
}
