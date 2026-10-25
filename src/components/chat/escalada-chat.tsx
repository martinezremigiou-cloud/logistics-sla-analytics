// ============================================================
// [INV-B11] O6-adenda · EL CONTACTO, DENTRO DE LA RESPUESTA QUE LO HIZO FALTA.
//
// El invariante de producto, literal:
//
//     > El usuario no navega un menú de contactos: el contacto correcto
//     > aparece en la respuesta que lo hizo falta.
//
// Y la razón por la que esto vale más que la tabla de Ajustes: **el momento**.
// Quien acaba de recibir «no tengo ficha de esa familia» está mirando la
// pantalla con la pregunta fresca. Mandarlo a Ajustes a buscar a quién
// escribirle es pedirle que traduzca su problema a una categoría, que es
// justo lo que no sabe hacer — si supiera, no habría preguntado al chat.
//
// ────────────────────────────────────────────────────────────
// NO DECIDE NADA. Recibe un área y la pinta. La decisión de QUÉ área
// corresponde a cada estado vive en `src/lib/contactos.ts`, en un mapa con
// una fila por estado, y llega hasta aquí como DATO — igual que `causaNuestra`,
// y por el mismo motivo que se escribió allá: *un texto se reescribe; un
// booleano no deriva*.
// ============================================================
import { Mail } from "lucide-react";
import { CONTACTOS, type AreaEscalada } from "@/lib/contactos";
import { escalada } from "@/lib/chat/voz";

export function EscaladaChat({ area, tono = "neutro" }: { area: AreaEscalada; tono?: "neutro" | "aviso" }) {
  const c = CONTACTOS[area];
  // El tono lo decide quien llama, porque la MISMA escalada aparece dentro de
  // una caja de aviso (un fallo nuestro) y dentro de una caja neutra (un hecho
  // del catálogo). Pintarla siempre en ámbar teñiría de alarma un «esa familia
  // no tiene ficha», que no es una alarma.
  const color = tono === "aviso" ? "text-warn" : "text-ink-muted";

  return (
    <p className={`mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-snug ${color}`}>
      <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{escalada(c.nombre)}</span>
      <a
        href={`mailto:${c.correo}`}
        className="break-all font-mono text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
      >
        {c.correo}
      </a>
    </p>
  );
}
