"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EstadoError } from "@/components/shared/estado-carga";

// Mismo criterio que `catalogo-filtros.tsx` (enum de almacenes hardcodeado):
// se duplican aquí los límites de `src/lib/imagenes.ts` (que importa `crypto`
// de Node) para no arrastrar ese módulo server-only al bundle de cliente.
// Deben coincidir con `MAX_IMAGEN_BYTES`/`TIPOS_IMAGEN` de ese archivo.
const TIPOS_ACEPTADOS = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

interface CargaDropzoneProps {
  sku: string;
  tieneImagen: boolean;
  onUploaded: () => void;
}

function formatoPeso(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Dropzone de subida de imagen para un SKU elegido en `CargaView`. `<input type=file>` sr-only + drag&drop como mejora progresiva. */
export function CargaDropzone({ sku, tieneImagen, onUploaded }: CargaDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);
  const [confirmarReemplazo, setConfirmarReemplazo] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);

  function validar(file: File): string | null {
    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      return "Formato no válido. Usa PNG, JPG o WEBP.";
    }
    if (file.size > MAX_BYTES) {
      return "El archivo pesa más de 2 MB.";
    }
    return null;
  }

  function elegirArchivo(file: File) {
    const err = validar(file);
    setErrorSubida(null);
    // Revoca el preview anterior (si lo hay) ANTES de crear uno nuevo o de
    // descartar la selección — evita acumular blob: URLs vivas en memoria
    // cada vez que el usuario cambia de archivo.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (err) {
      setErrorValidacion(err);
      setArchivo(null);
      setPreviewUrl(null);
      return;
    }
    setErrorValidacion(null);
    setArchivo(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) elegirArchivo(file);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) elegirArchivo(file);
  }

  function limpiar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setArchivo(null);
    setPreviewUrl(null);
    setErrorValidacion(null);
    setErrorSubida(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Red de seguridad para el desmontaje (navegar fuera de /carga con un
  // preview activo): revoca el último blob: URL vivo aunque no se haya
  // pasado por `elegirArchivo`/`limpiar`.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  async function subir() {
    if (!archivo) return;
    setSubiendo(true);
    setErrorSubida(null);
    try {
      const form = new FormData();
      form.set("sku", sku);
      form.set("archivo", archivo);
      const res = await fetch("/api/imagenes", { method: "POST", body: form });
      if (!res.ok) {
        setErrorSubida("No se pudo subir la imagen. Intenta de nuevo.");
        return;
      }
      toast.success("Imagen actualizada.");
      limpiar();
      onUploaded();
    } catch {
      setErrorSubida("No se pudo subir la imagen. Intenta de nuevo.");
    } finally {
      setSubiendo(false);
      setConfirmarReemplazo(false);
    }
  }

  function handleSubirClick() {
    if (tieneImagen) {
      setConfirmarReemplazo(true);
      return;
    }
    void subir();
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[13.5px] font-semibold text-ink">Subir imagen</h2>

      {!archivo && (
        <label
          htmlFor={`carga-dropzone-input-${sku}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-surface-3 py-10 text-center text-ink-muted transition-colors hover:border-brand"
        >
          <UploadCloud className="h-7 w-7" aria-hidden="true" strokeWidth={1.6} />
          <span className="text-[12.5px]">Arrastra una imagen aquí o haz clic para elegir un archivo</span>
          <span className="text-[11px] text-ink-muted2">PNG, JPG o WEBP · máx. 2 MB</span>
          <input
            ref={inputRef}
            id={`carga-dropzone-input-${sku}`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleInputChange}
            className="sr-only"
          />
        </label>
      )}

      {errorValidacion && (
        <p role="alert" className="text-[12px] text-warn">
          {errorValidacion}
        </p>
      )}

      {archivo && previewUrl && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview local de blob: URL; next/image no admite ese esquema. */}
            <img src={previewUrl} alt={`Vista previa de ${archivo.name}`} className="h-20 w-20 rounded-lg object-cover" />
            <div className="flex flex-col gap-0.5 text-[12.5px] text-ink-2">
              <span className="font-medium">{archivo.name}</span>
              <span className="text-ink-muted">{formatoPeso(archivo.size)}</span>
            </div>
          </div>
          {errorSubida && <EstadoError mensaje={errorSubida} onRetry={subir} />}
          <div className="flex gap-2">
            <Button type="button" onClick={handleSubirClick} disabled={subiendo}>
              {subiendo ? "Subiendo…" : "Subir"}
            </Button>
            <Button type="button" variant="outline" onClick={limpiar} disabled={subiendo}>
              Elegir otra
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmarReemplazo} onOpenChange={setConfirmarReemplazo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reemplazar imagen</AlertDialogTitle>
            <AlertDialogDescription>Este SKU ya tiene una imagen cargada. ¿Quieres reemplazarla?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void subir()}>Reemplazar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
