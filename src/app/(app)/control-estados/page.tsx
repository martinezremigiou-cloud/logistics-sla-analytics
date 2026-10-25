import { notFound } from "next/navigation";
import { ControlEstados } from "./control-estados";

// ============================================================
// [2.0.1-B · S-1] /control-estados — LOS ESTADOS DE `/proyectos`, VISIBLES.
//
// ────────────────────────────────────────────────────────────
// EL PROBLEMA QUE RESUELVE, medido: la base tiene pocos proyectos, y
// **no hay forma de ver «0 proyectos» ni «1» sin tocarla**. O sea que el estado
// vacío —el que más diseño necesitaba, y el que más se nota porque es lo primero
// que ve quien no sabe usar la app— era el único que nadie podía mirar. Un
// estado que se firma a ciegas es un estado que se firma mal.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ESTA VÍA Y NO UN `?estado=vacio` EN `/proyectos`.
//
// Un parámetro de query viajaría ACTIVO a producción: una pantalla real que
// finge estar vacía a petición es una interfaz fantasma (P7), y encima
// alcanzable por cualquiera que copie una URL. Esta ruta reusa el precedente que
// se aprobó en D1 de 2.0.1-A: `/control-layout` vive detrás de
// `LAYOUT_CHECK=1` y fuera de una corrida del gate es un 404.
//
// GATE DE ENTORNO, con el modo de fallo correcto: si alguien olvidara la
// variable, esta página no se sirve y el `layout-check` reporta sus casos como
// no medidos — nunca un verde falso. (El layout de `(app)` es `force-dynamic`,
// así que la lectura de entorno es de REQUEST y no de build.)
//
// NO ESTÁ EN `NAV_ITEMS` ni se enlaza desde ningún sitio, por la misma razón que
// `/control-layout`: no es un destino de usuario, y prometerlo en la navegación
// sería el reverso de P7.
//
// ────────────────────────────────────────────────────────────
// ESTE ARCHIVO ES SOLO EL GATE. El árbol vive en `control-estados.tsx`, que es
// client, y la razón es un defecto que ya costó una ronda de QA: **un Server
// Component no puede pasar una función a un Client Component**. La primera
// versión pasaba `onNuevo={() => {}}` desde aquí y el síntoma no fue un 500
// legible — el documento NUNCA TERMINABA y el renderer se colgaba. Este archivo
// tiene que seguir siendo server (lee `process.env`), así que por la frontera
// solo cruzan datos y los manejadores nacen del otro lado.
//
// Lo vigila `sin-handlers-en-server.test.ts`, y hace falta una guarda de FUENTE
// porque en vitest `Page()` se llama como una función corriente: **la frontera
// RSC no existe ahí**, y por eso nueve pruebas del gate estaban verdes con la
// ruta colgada.
// ============================================================

export const metadata = { robots: { index: false, follow: false } };

export default function ControlEstadosPage() {
  if (process.env.LAYOUT_CHECK !== "1") notFound();

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">Instrumento</span>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Control de estados</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Los estados de Proyectos con datos sembrados. No es una pantalla del producto.
        </p>
      </header>

      <ControlEstados />
    </div>
  );
}
