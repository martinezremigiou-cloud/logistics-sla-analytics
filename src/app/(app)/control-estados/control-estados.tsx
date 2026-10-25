"use client";

// ============================================================
// [2.0.1-B · S-1] control-estados.tsx — el ÁRBOL de la página de control, del
// lado CLIENT.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ESTÁ PARTIDO EN DOS ARCHIVOS, y no es preferencia de estilo.
//
// `page.tsx` tiene que seguir siendo Server Component: lee
// `process.env.LAYOUT_CHECK` y ése es el gate. Si fuera client, el valor se
// inlinearía en el bundle y la variable dejaría de ser un secreto de servidor —
// el gate se volvería decorativo.
//
// Pero los estados que hay que mirar necesitan manejadores (`onNuevo`,
// `onReasignar`), y **un Server Component no puede pasar una función a un
// Client Component**: React no puede serializarla. Es un error de ejecución, no
// de compilación.
//
// Así que los manejadores nacen AQUÍ, de este lado de la frontera, y por la
// frontera solo cruzan datos.
//
// ────────────────────────────────────────────────────────────
// EL DEFECTO QUE ESTO ARREGLA, y por qué mis pruebas no lo vieron.
//
// La primera versión pasaba `onNuevo={() => {}}` desde el servidor. El síntoma
// no fue un 500 legible: **el documento nunca terminaba**. El título de la
// pestaña se quedaba en la URL cruda y el renderer se colgaba —
// `captureScreenshot` a 30 s, `executeScript` a 45 s— mientras el log del server
// repetía «Event handlers cannot be passed to Client Component props».
//
// Y las nueve pruebas del gate estaban VERDES, porque llaman a `Page()` como
// una función corriente: **en vitest nunca se cruza la frontera RSC**. Probaron
// que el gate deja pasar o no; jamás que la página se renderice. Es la misma
// forma que la geometría en jsdom —el entorno de prueba no puede reproducir la
// condición— y por eso la contramedida es una guarda de FUENTE, no otra prueba
// de render: `sin-handlers-en-server.test.ts`.
// ============================================================
import { ProyectosVacio } from "@/components/proyectos/proyectos-vacio";
import { ProyectosSkeleton } from "@/components/proyectos/proyectos-skeleton";
import { ProyectosPasarela } from "@/components/proyectos/proyectos-pasarela";
import type { ProyectoResumen } from "@/types/proyectos";

/** Sembrado en memoria. Ni base ni red: los datos que la pantalla necesita para tener forma. */
function proyecto(over: Partial<ProyectoResumen> = {}): ProyectoResumen {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: "Despliegue de Series2 en 40 tiendas Retailer9 zona centro.",
    notas: null,
    fecha: "2026-04-30",
    tipo: "Rollout",
    intencion: "Cotización",
    responsable: "kam@example.com",
    creado_en: "2026-04-01T12:00:00.000Z",
    skus: 3,
    piezas: 400,
    ...over,
  };
}

const MUCHOS: ProyectoResumen[] = Array.from({ length: 9 }, (_, i) =>
  proyecto({
    id: `00000000-0000-0000-0000-00000000000${i + 1}`,
    folio: `PRJ-00${i + 1}`,
    // Uno huérfano: es la pieza que más alto añade y la que estira el renglón.
    responsable: i === 2 ? null : "kam@example.com",
    titulo: i === 5 ? "Proyecto con un título deliberadamente largo para ver dónde se corta" : `Rollout ${i + 1}`,
  }),
);

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-muted">{titulo}</h2>
      {children}
    </section>
  );
}

/** Los manejadores no hacen nada A PROPÓSITO: esta página retrata estados, no ejecuta acciones. */
const sinEfecto = () => {};

export function ControlEstados() {
  return (
    <>
      <Bloque titulo="0 proyectos">
        <ProyectosVacio onNuevo={sinEfecto} />
      </Bloque>

      <Bloque titulo="1 proyecto — las flechas quedan deshabilitadas">
        <ProyectosPasarela proyectos={[proyecto()]} />
      </Bloque>

      <Bloque titulo="Muchos — uno huérfano, uno de título largo">
        <ProyectosPasarela proyectos={MUCHOS} onReasignar={sinEfecto} />
      </Bloque>

      <Bloque titulo="Carga · pasarela">
        <ProyectosSkeleton ancho />
      </Bloque>

      <Bloque titulo="Carga · lista vertical">
        <ProyectosSkeleton ancho={false} />
      </Bloque>
    </>
  );
}
