import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

describe("scaffold smoke", () => {
  it("cn() combina clases y resuelve conflictos de Tailwind", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("renderiza un componente shadcn (Button) con su texto", () => {
    render(<Button>Actualizar</Button>);
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeInTheDocument();
  });

  it("instancia el cliente Supabase de navegador sin lanzar", () => {
    const client = createSupabaseBrowserClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });
});
