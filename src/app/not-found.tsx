import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center py-16">
      <Card className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface px-8 py-12 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-surface-app text-ink/40">
          <Compass className="h-6 w-6" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-ink">Página no encontrada</p>
          <p className="text-[13px] text-muted-foreground">La ruta que buscas no existe.</p>
        </div>
        <Button asChild variant="outline"><Link href="/">Volver al Dashboard</Link></Button>
      </Card>
    </div>
  );
}
