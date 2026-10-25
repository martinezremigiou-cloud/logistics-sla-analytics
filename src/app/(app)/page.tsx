import { DashboardView } from "@/components/dashboard/dashboard-view";

// Server shell delgado: `DashboardView` (isla client) trae su propio
// `useApi<DashboardResponse>` y lee la sesión vía `useSesion()` (contexto ya
// montado por `(app)/layout.tsx`) — sin `useSearchParams`, así que no
// necesita `<Suspense>` (a diferencia de `/catalogo` y `/embarques`).
export default function DashboardPage() {
  return <DashboardView />;
}
