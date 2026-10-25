"use client";

// ============================================================
// [2.0.1-B · S-4] proyecto-fotografias.tsx — las fotografías de las partidas.
//
// ────────────────────────────────────────────────────────────
// ES VISUAL PURA, y por eso cabe en este bloque.
//
// `PartidaItem.imagen_url` YA viaja al cliente: lo pone el detalle en el DTO
// (`proyectos.service.ts`). Esta pestaña no pide nada nuevo al servidor ni
// deriva una sola cifra — reagrupa lo que ya está.
//
// ⚠ Una versión anterior de esta cabecera justificaba lo mismo diciendo que el
// campo «lo usa la tabla de partidas». **Es falso y está medido**: ni
// `proyecto-partidas.tsx` ni `proyecto-partida-fila.tsx` lo leen. Hasta hoy su
// único consumidor era el GENERADOR de documentos, en el SERVIDOR; esta pantalla
// es **el primero del lado del cliente**. El argumento se sostiene igual —el
// campo ya viaja— pero la evidencia que citaba no existía.
//
// ────────────────────────────────────────────────────────────
// ⚠ LO QUE **NO** PUEDE DECIR, y es el límite que el bloque declaró.
//
// Por qué una partida no tiene fotografía propia —si su formato no se puede
// incrustar, si su marca no tiene banner, si el SKU no tiene nada cargado— vive
// en `ImagenResuelta.capa` y `.motivos`, que son del GENERADOR de documentos y
// **no viajan al cliente**. Traerlos aquí cruzaría de presentación a lógica.
//
// Así que esta pantalla dice lo único que puede saber con lo que tiene: si hay
// imagen o no. **El PORQUÉ lo dice el documento**, que sí tiene la cadena
// resuelta, y la pestaña de al lado lo enseña. Decirlo a medias aquí sería
// inventar una explicación con datos que no existen en este lado.
// ============================================================
import Image from "next/image";
import type { ProyectoDetalle } from "@/types/proyectos";

export interface ProyectoFotografiasProps {
  detalle: ProyectoDetalle;
}

export function ProyectoFotografias({ detalle }: ProyectoFotografiasProps) {
  const total = detalle.partidas.length;
  const conFoto = detalle.partidas.filter((p) => p.imagen_url);
  const sinFoto = detalle.partidas.filter((p) => !p.imagen_url);

  if (total === 0) {
    return <p className="text-[13px] text-ink-muted">Este proyecto todavía no tiene partidas.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/*
        La cifra concuerda con el DENOMINADOR, no con el numerador («1 de 3
        partidas», no «1 de 3 partida»), y la segunda frase solo se dice si
        «las demás» existen: una oración sobre un conjunto vacío es una
        afirmación que nadie puede comprobar.
      */}
      <p className="text-[12.5px] text-ink-muted">
        {conFoto.length} de {total} {total === 1 ? "partida" : "partidas"} con fotografía cargada.
        {sinFoto.length > 0 && " El documento explica por qué las demás no la llevan."}
      </p>

      {conFoto.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3.5">
          {conFoto.map((partida) => (
            <li key={partida.partida_id} className="overflow-hidden rounded-[15px] border border-line bg-surface">
              <div className="relative h-[130px] w-full bg-surface-3">
                <Image
                  src={partida.imagen_url as string}
                  alt={`Fotografía de ${partida.sku}`}
                  fill
                  sizes="200px"
                  className="object-contain"
                />
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="truncate font-mono text-[11px] font-semibold text-ink" title={partida.sku}>
                  {partida.sku}
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-ink-muted">{partida.descripcion ?? "Sin descripción"}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sinFoto.length > 0 && (
        <div className="rounded-[15px] border border-line bg-surface-3 px-4 py-3">
          <p className="text-[12px] font-semibold text-ink-2">
            Sin fotografía cargada ({sinFoto.length})
          </p>
          {/*
            Lista compacta y no una rejilla de huecos: una tarjeta vacía por
            partida ocuparía el mismo sitio que una con foto y no diría más.
          */}
          <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-ink-muted">
            {sinFoto.map((p) => p.sku).join(" · ")}
          </p>
        </div>
      )}
    </div>
  );
}
