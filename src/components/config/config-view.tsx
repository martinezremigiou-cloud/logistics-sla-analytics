"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useSesion } from "@/components/providers/session-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfigPreferencias } from "./config-preferencias";
import { ConfigUsuarios } from "./config-usuarios";
import { ConfigFamilias } from "./config-familias";
import { ConfigMarcas } from "./config-marcas";
import { ConfigAyuda } from "./config-ayuda";
import { BandejaView } from "@/components/pendientes/bandeja-view";

// ============================================================
// [INV-B11] O6-adenda · «AYUDA» ES DE LOS DOS ROLES, Y ESO CAMBIÓ LA VISTA.
//
// Hasta hoy un KAM no veía pestañas: el `return` anticipado montaba
// `ConfigPreferencias` a secas. Y era correcto mientras todo lo demás fuera
// admin — pero **los contactos de escalada son sobre todo para el KAM**, que es
// quien se topa con un «no sé» y no sabe a quién escribirle.
//
// Así que ahora los dos roles ven pestañas, y las de admin siguen siendo de
// admin. El invariante que protegía la prueba de antes no era «el KAM no ve un
// `tablist`» —eso era el proxy— sino **«nada de admin aparece en el DOM del
// KAM»**, y ése sigue en pie y ahora se comprueba por nombre.
// ============================================================
const TABS_SOLO_ADMIN = ["usuarios", "familias", "marcas", "pendientes"] as const;

type TabConfig = "preferencias" | (typeof TABS_SOLO_ADMIN)[number] | "ayuda";

/**
 * Las que puede abrir cada rol. Un KAM con `?tab=pendientes` cae a la suya.
 *
 * **Preferencias primero y Ayuda al final, siempre**, y lo de admin en medio.
 * Se compone a partir de `TABS_SOLO_ADMIN` en vez de repetir la lista: dos
 * listas con los mismos nombres es como una pestaña acaba pintada pero sin
 * contenido, o al revés.
 */
function tabsDe(rol: string): readonly TabConfig[] {
  return ["preferencias", ...(rol === "admin" ? TABS_SOLO_ADMIN : []), "ayuda"];
}

/**
 * Isla client de `/config`: KAM ve únicamente "Preferencias" (sin tabs, sin
 * rastro de nada admin en el DOM — el `return` anticipado ni siquiera monta
 * `<Tabs>`). Admin ve las 4 secciones en `Tabs` (vertical en desktop, scroll
 * horizontal en mobile — ambos vía CSS, la prop `orientation` de Radix solo
 * gobierna la navegación por teclado).
 *
 * Bloque 6 (F4): la tab activa vive en `?tab=` (`useSearchParams` como
 * fuente de verdad, mismo patrón que `CatalogoView`/`CruceView`) — retro-
 * compatible: sin el param (o con un valor inválido) cae a "preferencias",
 * IDÉNTICO al `defaultValue` de antes. Esto permite que los hrefs del
 * dashboard (`/config?tab=pendientes`) aterricen directo en la bandeja, y
 * que `PendienteAcciones` navegue internamente a `/config?tab=familias`
 * desde "Abrir familias" sin lógica adicional.
 */
/** El rótulo de cada pestaña. `Record` para que una nueva no pueda quedar sin nombre. */
const ROTULOS: Record<TabConfig, string> = {
  preferencias: "Preferencias",
  usuarios: "Usuarios y roles",
  familias: "Familias",
  marcas: "Marcas",
  pendientes: "Pendientes",
  ayuda: "Ayuda",
};

export function ConfigView() {
  const { rol } = useSesion();
  const router = useRouter();
  const searchParams = useSearchParams();

  const permitidas = tabsDe(rol);
  const tabParam = searchParams.get("tab");
  // La validez la decide EL ROL, no una lista global: así `?tab=pendientes` en
  // manos de un KAM sigue cayendo a «Preferencias», que es lo que ya hacía.
  const tab: TabConfig = (permitidas as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as TabConfig)
    : "preferencias";

  function handleTabChange(value: string) {
    router.replace(`/config?tab=${value}`, { scroll: false });
  }

  return (
    <Tabs value={tab} onValueChange={handleTabChange} orientation="vertical" className="flex flex-col gap-5 md:flex-row md:items-start">
      <TabsList className="flex h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto bg-surface-3 md:w-[210px] md:flex-col md:items-stretch md:overflow-visible">
        {permitidas.map((v) => (
          <TabsTrigger key={v} value={v} className="justify-start whitespace-nowrap">
            {ROTULOS[v]}
          </TabsTrigger>
        ))}
      </TabsList>

      {/*
        CADA CONTENIDO SE MONTA SOLO SI SU PESTAÑA ESTÁ PERMITIDA. No basta con
        no pintar el `TabsTrigger`: un `TabsContent` de admin en el árbol del
        KAM es superficie de admin en su DOM aunque esté oculto — que es
        exactamente el invariante que la vista tenía antes con el `return`
        anticipado, y que no se pierde al darle pestañas.
      */}
      <div className="min-w-0 flex-1">
        <TabsContent value="preferencias" className="mt-0">
          <ConfigPreferencias />
        </TabsContent>
        {permitidas.includes("usuarios") && (
          <TabsContent value="usuarios" className="mt-0">
            <ConfigUsuarios />
          </TabsContent>
        )}
        {permitidas.includes("familias") && (
          <TabsContent value="familias" className="mt-0">
            <ConfigFamilias />
          </TabsContent>
        )}
        {/* [VERT-B2] Pestaña propia y no una tarjeta dentro de otra, por dónde
            cae en la casa: las tres tarjetas anidadas del portal (avisos, acerca,
            testigo) son de LOS DOS roles; las tres superficies admin-only
            (usuarios, familias, pendientes) son pestañas. El gobierno de marcas
            es admin-only y lleva contador de alarma — y una alarma enterrada dos
            niveles abajo es justo lo que la 0039 declaró no poder cubrir. */}
        {permitidas.includes("marcas") && (
          <TabsContent value="marcas" className="mt-0">
            <ConfigMarcas />
          </TabsContent>
        )}
        {permitidas.includes("pendientes") && (
          <TabsContent value="pendientes" className="mt-0">
            <BandejaView />
          </TabsContent>
        )}
        <TabsContent value="ayuda" className="mt-0">
          <ConfigAyuda />
        </TabsContent>
      </div>
    </Tabs>
  );
}
