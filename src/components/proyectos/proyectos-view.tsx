"use client";

// ============================================================
// [INV-B8] proyectos-view.tsx — isla client de `/proyectos`.
//
// Encabezado completo (h1 + subtítulo + "+ Nuevo proyecto") vive AQUÍ, no
// en `page.tsx`: a diferencia de `/catalogo`/`/embarques`/`/snapshots`
// (header estático en el server shell, sin ninguna acción), el botón abre
// un diálogo con estado propio — no hay forma de partirlo entre server y
// client sin inventar un mecanismo de slots que ningún otro `page.tsx` de
// este repo usa hoy.
//
// GATE DE VISITANTE (spec del bloque): `middleware.ts` NO decide
// autorización por rol — esta isla sí, igual que `carga-view.tsx`
// (`useSesion()` → `<SinPermiso/>`). La URL de fetch se apaga (`null`) para
// el rol gateado en vez de pedirla y descartar la respuesta — mismo
// criterio que `CargaView` con `esAdmin`.
// ============================================================
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useSesion } from "@/components/providers/session-provider";
import { useApi } from "@/lib/hooks/use-api";
import { PUEDE_ESCRIBIR_PROYECTOS } from "@/lib/roles";
import { SinPermiso } from "@/components/shared/sin-permiso";
import { EstadoError } from "@/components/shared/estado-carga";
import { Button } from "@/components/ui/button";
import { ProyectoCard } from "./proyecto-card";
import { NuevoProyectoDialog } from "./nuevo-proyecto-dialog";
import { ReasignarHuerfanoDialog } from "./reasignar-huerfano-dialog";
import { ProyectosSkeleton } from "./proyectos-skeleton";
import { ProyectosPasarela } from "./proyectos-pasarela";
import { ProyectoZoom } from "./proyecto-zoom";
import { ProyectosVacio } from "./proyectos-vacio";
import { useEsAncho } from "./use-es-ancho";
import { DIMENSIONES_TARJETA_LISTA } from "./geometria-lista";
// [INV-B8.2] `ProyectosResponse` se mudó a `@/types/proyectos`. Estaba
// declarada aquí como interface LOCAL, y por eso el segundo consumidor de esta
// misma ruta no tuvo nada que importar y se inventó la forma. Ver el comentario
// del tipo.
import type { ProyectoResumen, ProyectosResponse } from "@/types/proyectos";

export function ProyectosView() {
  const { rol } = useSesion();
  const esAncho = useEsAncho();
  const router = useRouter();
  // [ROL-SOPORTE] Se pregunta por el PERMISO, no por la identidad del rol:
  // `rol === "visitante"` dejaba entrar a cualquier rol futuro. Ver
  // `PUEDE_ESCRIBIR_PROYECTOS` en `lib/roles.ts`.
  const esVisitante = !PUEDE_ESCRIBIR_PROYECTOS[rol];
  const [nuevoOpen, setNuevoOpen] = useState(false);
  // [0025] El proyecto huerfano que un admin esta a punto de rescatar. `null`
  // = ninguno. Solo un admin llega a poner algo aqui: un KAM nunca ve un
  // huerfano (la rama own del SELECT no alcanza filas con propietario NULL).
  const [aReasignar, setAReasignar] = useState<ProyectoResumen | null>(null);
  // [S-1] La tarjeta anclada al inicio del carril: el sujeto del zoom. Vive
  // aquí y no en la pasarela porque el zoom es hermano del carril, no su hijo.
  const [ancla, setAncla] = useState(0);

  const { data, error, loading, refetch } = useApi<ProyectosResponse>(esVisitante ? null : "/api/proyectos");
  const anclaSegura = Math.min(Math.max(ancla, 0), Math.max((data?.items.length ?? 1) - 1, 0));

  if (esVisitante) {
    return <SinPermiso rolActual={rol} />;
  }

  function handleCreado(proyecto: ProyectoResumen) {
    setNuevoOpen(false);
    router.push(`/proyectos/${proyecto.id}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Proyectos</h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground">Arma proyectos desde tu historial · cada KAM ve y edita los suyos</p>
        </div>
        <Button type="button" onClick={() => setNuevoOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo proyecto
        </Button>
      </div>

      {loading && !data && <ProyectosSkeleton ancho={esAncho} />}
      {error && !data && <EstadoError mensaje={error.message} onRetry={refetch} />}
      {data && (
        <div aria-busy={loading}>
          {data.items.length === 0 ? (
            <ProyectosVacio onNuevo={() => setNuevoOpen(true)} />
          ) : esAncho ? (
            // [2.0.1-B · S-1] De 768 para arriba, PASARELA **CON ZOOM**. La
            // rejilla `auto-fill` dejaba el 57 % del alto vacío a 1704 px, y
            // empeoraba hacia arriba porque añade columnas conforme hay sitio.
            //
            // El zoom NO es un extra del carril: es lo que hace que el carril
            // valga la pena. Medido por el QA, la pasarela sola dejó ~590 px de
            // vacío bajo el carril a 966 px de alto — MÁS hueco que la rejilla
            // que sustituyó. Van juntos o no van.
            <div className="flex flex-col gap-4">
              <ProyectosPasarela
                proyectos={data.items}
                ancla={anclaSegura}
                inventarioEn={data.vigencia?.tomado_en}
                onAnclaCambia={setAncla}
                onReasignar={rol === "admin" ? (p) => setAReasignar(p) : undefined}
              />
              {/*
                `anclaSegura` y no `ancla`: la lista puede encoger bajo los pies
                del índice —un refetch tras reasignar, por ejemplo— y un índice
                fuera de rango dejaría el zoom en blanco. Se acota al pintar, no
                al guardar: acotar al guardar exigiría acordarse en cada sitio
                que mueve el ancla, y ya son dos.
              */}
              <ProyectoZoom proyecto={data.items[anclaSegura]} inventarioEn={data.vigencia?.tomado_en} />
            </div>
          ) : (
            // Bajo 768, LISTA VERTICAL. Decisión de producto: en celular nunca se vio
            // vacío, y un carril para barrer N proyectos es más lento que una
            // lista que se recorre con el pulgar.
            <div className="flex flex-col gap-3.5">
              {data.items.map((p) => (
                // El alto sale del MISMO token que su esqueleto: el criterio de
                // aceptación es que la diferencia al resolver sea cero, y eso no
                // se cumple igualando dos números sino no teniendo dos que igualar.
                <div key={p.id} className={DIMENSIONES_TARJETA_LISTA}>
                  <ProyectoCard
                    proyecto={p}
                    inventarioEn={data.vigencia?.tomado_en}
                    // La portada RECORTADA a banda fija. Aquí la tarjeta es
                    // `w-full`, así que una portada de alto automático haría
                    // que el alto dependiera del ancho del teléfono — y
                    // entonces no habría número que el esqueleto igualara.
                    portadaCompacta
                    // Un proyecto sin responsable es un HUERFANO: su cuenta se
                    // borro y, hasta la 0025, nadie podia editarlo ni borrarlo.
                    // El boton de rescate solo se ofrece a quien puede usarlo.
                    onReasignar={rol === "admin" && p.responsable === null ? () => setAReasignar(p) : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <NuevoProyectoDialog open={nuevoOpen} onOpenChange={setNuevoOpen} onCreated={handleCreado} />

      {aReasignar && (
        <ReasignarHuerfanoDialog
          proyecto={aReasignar}
          open
          onOpenChange={(abierto) => !abierto && setAReasignar(null)}
          onReasignado={() => {
            setAReasignar(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
