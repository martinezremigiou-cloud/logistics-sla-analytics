import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider } from "@/components/providers/session-provider";
import type { DashboardResponse } from "@/types/api";
import { useApi, type UseApiResult } from "@/lib/hooks/use-api";
import { DashboardView } from "./dashboard-view";
import { agruparPipeline } from '@/services/dashboard.service';

// ------------------------------------------------------------
// GATE ANTI-REMOUNT (docs/engineering/failure-patterns.md (P3)) — candado de regresión
// dedicado, en un archivo APARTE de `dashboard-view.test.tsx`.
//
// Por qué un archivo aparte y por qué se mockea `useApi` (a diferencia de
// `dashboard-view.test.tsx`, que usa `fetch` real): hoy `DashboardView` NO
// tiene NINGÚN disparador de refetch alcanzable con `data` ya poblada — la
// URL es fija (`/api/dashboard`, sin filtros) y el único `refetch` expuesto
// vive en `<EstadoError onRetry={refetch}/>`, que solo se monta cuando
// `!data`. Es decir: con el código real de `useApi` no hay forma, desde la
// UI, de reproducir "loading=true con data ya en mano" — el bug es real
// (la condición del render lo permite) pero hoy está DORMIDO. Mockear
// `useApi` reproduce exactamente ese estado intermedio (el que si produce
// `useApi` real ante cualquier futuro refetch — un filtro, un polling, un
// botón "Actualizar") sin depender de que exista ya un botón para
// disparaido, y sin tocar `use-api.ts` (fuera de alcance de este bloque).
// ------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-api", () => ({ useApi: vi.fn() }));

const useApiMock = vi.mocked(useApi);

const ALMACENES = ["NORTH", "SOUTH", "EAST", "TRAN", "BO", "WEST"] as const;
const NOMBRES_ETAPA = [
  "Producto Solicitado",
  "En Preparación",
  "En Recolección",
  "En Almacén FW",
  "En Tránsito Aéreo",
  "En Tránsito Marítimo",
  "En Aduana",
  "En Tránsito Terrestre",
  "En Almacén Fiscal",
  "En Almacén North",
  "Producto Disponible",
];

function respuestaFixture(): DashboardResponse {
  return {
    snapshot: {
      stock: { id: "snap-stock", created_at: "2026-07-10T00:00:00.000Z", filas: 900, archivo: "stock.xlsx", vigente: true },
      aduana: { id: "snap-aduana", created_at: "2026-07-09T00:00:00.000Z", filas: 40, archivo: "aduana.xlsx", vigente: true },
    },
    periodos: { actual: "2026-07", anterior: "2026-04" },
    kpis: {
      catalogo_total: { valor: 764, delta: null },
      piezas_disponibles: { valor: 24850, delta: null },
      piezas_disponibles_neto: { valor: 24850, delta: null },
      piezas_sobre_reservadas: { valor: 0, delta: null },
      skus_disponibles: { valor: 700, delta: null },
      sobre_reservados: { valor: 12, delta: null },
      piezas_en_camino: { valor: 3200, delta: null },
      retrasados: { valor: 4, delta: null },
      sin_v2: { valor: 22, delta: null },
      sin_tecnologia: { valor: 37, delta: null },
      productos_sin_tecnologia: { valor: 44, delta: null },
      pendientes: { valor: 5, delta: null },
    },
    heatmap: {
      eje_y: "marca",
      eje_x: "almacen",
      filas: ["NACIONAL"],
      columnas: [...ALMACENES],
      celdas: [{ fila: "NACIONAL", columna: "NORTH", valor: 100 }],
      max: 100,
      tecnologia_activa: null,
      tecnologias: [],
      total_marcas: 1,
    },
    radar: { series: [{ marca: "BRAND1", ejes: { disponible: 100, reservado: 20, en_aduana: 10, en_riesgo: 0 } }], total_marcas: 1 },
    top_sobre_reservados: [],
    reservas_por_kam: { items: [], total_piezas: 0, total_kams: 0 },
    pipeline: NOMBRES_ETAPA.map((nombre, i) => ({ orden: i + 1, nombre, activos: 0, piezas: 0 })),
    pipeline_grupos: agruparPipeline(NOMBRES_ETAPA.map((nombre, i) => ({ orden: i + 1, nombre, activos: 0, piezas: 0 }))),
    tendencia: [{ periodo: "2026-07", piezas: 24850, cortes: 1 }],
    alertas: [
      { tipo: "sobre_reservado", conteo: 12, href: "/catalogo?badge=sobre_reservado" },
      { tipo: "retrasado", conteo: 4, href: "/embarques?retrasado=1" },
      { tipo: "sin_v2", conteo: 22, href: "/catalogo?sinV2=1" },
      { tipo: "descuadre_reservas", conteo: 0, href: "/config?tab=pendientes" },
      { tipo: "pendientes", conteo: 5, href: "/config?tab=pendientes" },
    ],
  };
}

function resultado(overrides: Partial<UseApiResult<DashboardResponse>>): UseApiResult<DashboardResponse> {
  return { data: null, error: null, loading: false, refetch: vi.fn(), ...overrides };
}

function arbol() {
  return (
    <SessionProvider sesion={{ id: "u-1", email: "lara@example.com", rol: "admin" }}>
      <DashboardView />
    </SessionProvider>
  );
}

describe("DashboardView — GATE anti-remount (docs/engineering/failure-patterns.md (P3))", () => {
  it("MUTANTE: durante un refetch con data ya presente (loading:true, useApi conserva data), el cuerpo real sigue montado —mismo nodo, aria-busy— en vez de caer al skeleton", () => {
    useApiMock.mockReturnValue(resultado({ data: respuestaFixture(), loading: false }));
    const { rerender } = render(arbol());

    const nodoAntes = screen.getByText("SKUs en catálogo");
    expect(nodoAntes).toBeInTheDocument();

    // Simula EXACTAMENTE el estado intermedio que produce `useApi` real
    // durante un refetch: `loading` vuelve a `true`, `data` NO se vacía.
    useApiMock.mockReturnValue(resultado({ data: respuestaFixture(), loading: true }));
    rerender(arbol());

    // Con el código viejo (`if (loading) cuerpo = <DashboardSkeleton/>` a
    // secas) esta línea lanza: "SKUs en catálogo" desaparece del DOM,
    // reemplazado por el esqueleto, aunque `data` siga poblada. Con el
    // código nuevo, el mismo nodo del DOM sigue ahí (sin remount).
    const nodoDespues = screen.getByText("SKUs en catálogo");
    expect(nodoDespues).toBe(nodoAntes);
    expect(screen.queryByRole("status", { name: "Cargando panel…" })).not.toBeInTheDocument();

    const cuerpo = nodoDespues.closest("[aria-busy]");
    expect(cuerpo).toHaveAttribute("aria-busy", "true");
  });

  it("estado real sin refetch en vuelo: el cuerpo queda marcado aria-busy=\"false\" (no solo ausente)", () => {
    useApiMock.mockReturnValue(resultado({ data: respuestaFixture(), loading: false }));
    render(arbol());

    const cuerpo = screen.getByText("SKUs en catálogo").closest("[aria-busy]");
    expect(cuerpo).toHaveAttribute("aria-busy", "false");
  });
});
