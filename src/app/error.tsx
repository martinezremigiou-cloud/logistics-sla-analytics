"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl items-center justify-center py-16">
      <Card className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-warn/40 bg-surface px-8 py-12 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-warn-bg text-warn">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-ink">Algo salió mal</p>
          <p className="text-[13px] text-muted-foreground">Ocurrió un error al cargar esta sección.</p>
        </div>
        <Button variant="outline" onClick={reset}>Reintentar</Button>
      </Card>
    </div>
  );
}
