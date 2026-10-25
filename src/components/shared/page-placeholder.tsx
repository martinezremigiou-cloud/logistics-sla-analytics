import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface PagePlaceholderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  icon: LucideIcon;
}

export function PagePlaceholder({ title, eyebrow, subtitle, icon: Icon }: PagePlaceholderProps) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        {eyebrow && <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">{eyebrow}</span>}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-[13.5px] text-muted-foreground">{subtitle}</p>}
      </header>

      <Card className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface py-[54px] text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-surface-app text-ink/40">
          <Icon className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-ink">Sección en construcción</p>
          <p className="text-[13px] text-muted-foreground">Esta sección estará disponible pronto.</p>
        </div>
        <div className="mt-2 flex w-full max-w-md flex-col gap-2 px-6" aria-hidden="true">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Card>
    </div>
  );
}
