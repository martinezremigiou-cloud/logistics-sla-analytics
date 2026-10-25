// ============================================================
// [INV-B11] Pinta el markdown de una ficha. **No produce HTML en ningún punto.**
//
// El parser (`lib/corpus/markdown.ts`) devuelve ESTRUCTURA y esto crea
// elementos de React. No hay `dangerouslySetInnerHTML` en el camino, así que un
// `<script>` dentro de una ficha sale como el texto `<script>`. No es un filtro
// que alguien pueda quitar: **es que el mecanismo no existe**.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ SE RENDERIZA Y NO SE MUESTRA CRUDO, que era la decisión anterior.
//
// El argumento del verbatim era «una cita es verificable y renderizarla sería
// reinterpretarla». **Lo que hace verificable a la cita es la procedencia, no
// los asteriscos**: la tarjeta muestra los PDF de origen y mostrará el
// `commit_sha` en cuanto el indexador lea del repo.
//
// Y hay un argumento en contra del verbatim que lo derriba: **una tabla de
// especificaciones mostrada como texto con barras se parece MENOS al documento
// que la renderizada.** El autor escribió una tabla. Pintarla como pipes es
// menos fiel, no más — y es justo el contenido que contesta la pregunta 1.4.
//
// LA TABLA ES LO QUE MÁS IMPORTA AQUÍ, y es el invariante de O3 saliendo a la
// superficie: todo O3 protege que una tabla no se parta, y pintarla como un
// párrafo la parte igual, un paso más adelante.
// ============================================================
import type { Bloque, Inline } from "@/lib/corpus/markdown";

function Tramos({ partes }: { partes: Inline[] }) {
  return (
    <>
      {partes.map((p, i) => {
        if (p.t === "negrita") return <strong key={i} className="font-semibold text-ink">{p.v}</strong>;
        if (p.t === "italica") return <em key={i} className="italic">{p.v}</em>;
        if (p.t === "codigo")
          return (
            <code key={i} className="rounded bg-surface px-1 py-0.5 font-mono text-[10.5px] text-ink">
              {p.v}
            </code>
          );
        return <span key={i}>{p.v}</span>;
      })}
    </>
  );
}

export function MarkdownChat({ bloques }: { bloques: Bloque[] }) {
  return (
    <div className="flex flex-col gap-2">
      {bloques.map((b, i) => {
        switch (b.tipo) {
          case "encabezado":
            // Todos los niveles se pintan igual de tamaño y se distinguen por
            // peso: dentro de una tarjeta de chat, un `#` de la ficha compitiendo
            // en tamaño con el título de la tarjeta confunde qué es qué.
            return (
              <p
                key={i}
                className={
                  b.nivel <= 2
                    ? "text-[12px] font-bold uppercase tracking-wide text-ink"
                    : "text-[11.5px] font-semibold text-ink-2"
                }
              >
                <Tramos partes={b.contenido} />
              </p>
            );

          case "cita":
            return (
              <p key={i} className="border-l-2 border-line pl-2 text-[11.5px] italic leading-snug text-ink-2">
                <Tramos partes={b.contenido} />
              </p>
            );

          case "lista": {
            const Etiqueta = b.ordenada ? "ol" : "ul";
            return (
              <Etiqueta
                key={i}
                className={
                  b.ordenada
                    ? "flex list-decimal flex-col gap-0.5 pl-4 text-[11.5px] leading-snug text-ink-2"
                    : "flex list-disc flex-col gap-0.5 pl-4 text-[11.5px] leading-snug text-ink-2"
                }
              >
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Tramos partes={it} />
                  </li>
                ))}
              </Etiqueta>
            );
          }

          case "tabla":
            // `overflow-x-auto` en su propio contenedor: una tabla de 6 columnas
            // en 390 px no cabe, y sin esto empujaría el panel entero y sacaría
            // la caja de texto de la pantalla.
            return (
              <div key={i} className="-mx-0.5 overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      {b.encabezados.map((c, j) => (
                        <th
                          key={j}
                          className="whitespace-nowrap border-b border-line px-1.5 py-1 text-left font-semibold text-ink"
                        >
                          <Tramos partes={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.filas.map((f, j) => (
                      <tr key={j}>
                        {f.map((c, k) => (
                          <td key={k} className="border-b border-line-soft px-1.5 py-1 align-top text-ink-2">
                            <Tramos partes={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "codigo":
            return (
              <pre key={i} className="overflow-x-auto rounded-md bg-surface px-2 py-1.5">
                <code className="font-mono text-[10.5px] leading-relaxed text-ink-2">{b.texto}</code>
              </pre>
            );

          case "parrafo":
          default:
            return (
              <p key={i} className="text-[11.5px] leading-snug text-ink-2">
                <Tramos partes={b.contenido} />
              </p>
            );
        }
      })}
    </div>
  );
}
