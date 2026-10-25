"use client";

// ============================================================
// [INV-B8] proyecto-detalle-view.tsx — isla client de `/proyectos/[id]`.
//
// GATE DE VISITANTE (spec del bloque): mismo criterio que `proyectos-view.tsx`
// (`useSesion()` → `<SinPermiso/>`, URL de fetch apagada para ese rol).
//
// GATE ANTI-REMOUNT (mismo molde que `ficha-view.tsx`/`cambios-view.tsx`):
// el 404 (`proyecto_no_encontrado`) es un `return` temprano e
// IRRECUPERABLE por refetch — no tiene sentido montar la card de partidas
// para un proyecto que no existe (o no es tuyo: la RLS no distingue los dos
// casos, y este componente tampoco). Cualquier otro estado se resuelve en
// UN solo árbol de JSX: `loading && !data` cubre solo la carga inicial;
// con `data` ya en mano, un refetch (tras agregar/editar/quitar una
// partida) deja el hero y la card de partidas MONTADOS.
// ============================================================
import Link from "next/link";
import { useSesion } from "@/components/providers/session-provider";
import { useApi } from "@/lib/hooks/use-api";
import { PUEDE_ESCRIBIR_PROYECTOS } from "@/lib/roles";
import { SinPermiso } from "@/components/shared/sin-permiso";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { Button } from "@/components/ui/button";
import { ProyectoHero } from "./proyecto-hero";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProyectoPartidas } from "./proyecto-partidas";
import { ProyectoFotografias } from "./proyecto-fotografias";
import { ProyectoDocumentoPrevia } from "./proyecto-documento-previa";
import { ProyectoDetalleSkeleton } from "./proyecto-detalle-skeleton";
import type { ProyectoDetalle } from "@/types/proyectos";

export interface ProyectoDetalleViewProps {
  id: string;
}

const MENSAJE_404_FALLBACK = "Proyecto no encontrado";

export function ProyectoDetalleView({ id }: ProyectoDetalleViewProps) {
  const { rol } = useSesion();
  // [ROL-SOPORTE] Por el permiso, no por la identidad. Ver `lib/roles.ts`.
  const esVisitante = !PUEDE_ESCRIBIR_PROYECTOS[rol];
  const { data, error, loading, refetch } = useApi<ProyectoDetalle>(esVisitante ? null : `/api/proyectos/${encodeURIComponent(id)}`);

  if (esVisitante) {
    return <SinPermiso rolActual={rol} />;
  }

  if (error && !data) {
    if (error.error === "proyecto_no_encontrado") {
      return (
        <EstadoVacio
          titulo={error.message ?? MENSAJE_404_FALLBACK}
          descripcion="Puede que el enlace sea antiguo o el proyecto ya no exista."
          cta={
            <Button variant="outline" asChild>
              <Link href="/proyectos">Volver a Proyectos</Link>
            </Button>
          }
        />
      );
    }
    return <EstadoError mensaje={error.message} onRetry={refetch} />;
  }

  return (
    <div className="flex flex-col gap-5" aria-busy={loading}>
      {loading && !data && <ProyectoDetalleSkeleton />}
      {data && (
        <>
          <ProyectoHero detalle={data} />
          {/*
            ────────────────────────────────────────────────────────────
            [2.0.1-B · S-4] TRES PESTAÑAS, y «Actividad» NO está.

            La maqueta lista cuatro. La cuarta necesitaría una bitácora que este
            sistema no lleva: una pestaña «Actividad» vacía —o poblada con lo
            único que hay, la fecha de creación— es INTERFAZ FANTASMA (P7), que
            es prometer una capacidad que no existe. Se declara ausente en vez
            de dibujarse hueca.

            NO son direccionables por URL, y también es una decisión: hacerlo
            exigiría `useSearchParams` y con él un `Suspense` en la ruta, y no
            hay quien pida hoy un enlace a una pestaña concreta.

            ⚠ Este comentario afirmaba que «la prueba del Zoom se pondrá roja y
            obligará a decidirlo». NO PUEDE: `proyecto-zoom.test.tsx` solo
            renderiza `<ProyectoZoom>` y afirma sobre SU marcado; agregar
            `useSearchParams` AQUÍ no toca ese árbol y esa prueba se queda verde
            para siempre. Era una guarda que no puede fallar (P19), declarada en
            prosa.

            El trinquete de verdad está en `proyecto-detalle-view.test.tsx`
            («si estas pestañas se vuelven direccionables…»), que lee ESTE
            fuente. Ése sí se pone rojo, y lo que obliga a decidir es si el botón
            «Revisar y exportar» del Zoom vuelve o no.
            ────────────────────────────────────────────────────────────
          */}
          <Tabs defaultValue="partidas" className="flex flex-col gap-4">
            <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto bg-surface-3">
              <TabsTrigger value="partidas">Partidas</TabsTrigger>
              <TabsTrigger value="fotografias">Fotografías</TabsTrigger>
              <TabsTrigger value="documento">Documento</TabsTrigger>
            </TabsList>

            <TabsContent value="partidas" className="mt-0">
              <ProyectoPartidas detalle={data} onChanged={refetch} />
            </TabsContent>

            <TabsContent value="fotografias" className="mt-0">
              <ProyectoFotografias detalle={data} />
            </TabsContent>

            {/*
              El contenido de esta pestaña se MONTA solo cuando se abre. No es
              una optimización: cada previa es un render de PDF en el servidor
              —tipografías subseteadas y hasta 12 imágenes descargadas— y
              montarla siempre cobraría ese costo a todo el que entra a ver las
              partidas. Radix desmonta el contenido inactivo por omisión, y de
              ahí sale también la revocación del object URL.
            */}
            <TabsContent value="documento" className="mt-0">
              <ProyectoDocumentoPrevia proyectoId={data.id} folio={data.folio} titulo={data.titulo} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
