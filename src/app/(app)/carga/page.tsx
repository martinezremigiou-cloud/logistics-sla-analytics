import { CargaView } from "@/components/carga/carga-view";

export default function CargaPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Carga de imágenes</h1>
        <p className="text-[13.5px] text-muted-foreground">Imágenes de producto por SKU.</p>
      </header>
      <CargaView />
    </div>
  );
}
