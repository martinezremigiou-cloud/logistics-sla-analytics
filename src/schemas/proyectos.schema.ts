// ============================================================
// [INV-B8] schemas/proyectos.schema.ts — contratos de entrada.
//
// Los topes de longitud son ESPEJO de los CHECK de la migración 0024. Si
// divergen, la validación de zod pasa y Postgres rechaza con 23514, y el
// usuario recibe un 500 genérico en vez de un mensaje útil. Se declaran
// aquí en una constante por campo para que el espejo sea leíble de un
// vistazo y falsificable de un grep.
// ============================================================
import { z } from 'zod';

/** Espejo de `CHECK (length(btrim(titulo)) BETWEEN 1 AND 120)` en 0024. */
export const MAX_TITULO = 120;
/** Espejo de `CHECK (length(descripcion) <= 500)`. */
export const MAX_DESCRIPCION = 500;
/** Espejo de `CHECK (length(notas) <= 1000)`. */
export const MAX_NOTAS = 1000;
/** Espejo de los CHECK de `tipo` e `intencion`. */
export const MAX_CLASIFICADOR = 40;

/**
 * Tope de partidas por proyecto. NO tiene espejo en la base (un CHECK no
 * puede contar filas de otra tabla sin un trigger, y un trigger por cada
 * alta es peor negocio que este límite).
 *
 * No es un número decorativo, acota tres cosas medibles: (i) la lista de
 * SKUs viaja en un `.in()` de PostgREST, que va en la URL; (ii) el
 * generador de documentos empotra hasta una imagen por SKU y el bucket
 * permite 2 MB por objeto, así que 200 partidas ya son un techo de 400 MB
 * si algún día todas tuvieran foto; (iii) un "proyecto" con más de 200
 * renglones distintos dejó de ser un proyecto.
 */
export const MAX_PARTIDAS = 200;

/**
 * Tope de piezas de UNA partida. **No es espejo de nada**: el CHECK de 0024
 * sobre `cantidad` solo exige `> 0`, sin techo. Se declara aquí porque el
 * volcado SUMA sobre lo que ya hay, y una suma sin tope acaba desbordando el
 * `integer` de Postgres — que no es un error de validación sino un 22003 en
 * medio de la operación. Con el tope explícito, el desborde se convierte en un
 * conflicto que el usuario puede leer.
 */
export const MAX_CANTIDAD = 1_000_000;

const texto = (max: number) => z.string().trim().min(1).max(max);

/**
 * `propietario` NO aparece aquí, y es deliberado: lo pone el DEFAULT
 * `auth.uid()` de la tabla y lo verifica el `WITH CHECK` de la policy. Si
 * el schema lo aceptara, existiría un camino de código donde el cliente
 * propone de quién es el proyecto — y la única defensa sería que la policy
 * lo rechace. Es más barato que ese campo no exista.
 */
export const crearProyectoSchema = z.object({
  titulo: texto(MAX_TITULO),
  descripcion: texto(MAX_DESCRIPCION).nullish(),
  notas: texto(MAX_NOTAS).nullish(),
  /** `YYYY-MM-DD`. Ausente → la base pone hoy en zona México. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tipo: texto(MAX_CLASIFICADOR).nullish(),
  intencion: texto(MAX_CLASIFICADOR).nullish(),
});
export type CrearProyectoInput = z.infer<typeof crearProyectoSchema>;

/** Edición parcial. Al menos un campo — un PATCH vacío es un error del llamador, no un no-op silencioso. */
export const editarProyectoSchema = crearProyectoSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nada que actualizar: el cuerpo no trae ningún campo.' },
);
export type EditarProyectoInput = z.infer<typeof editarProyectoSchema>;

/**
 * El SKU se normaliza a `trim + UPPER`, mismo criterio que `skuParamSchema`
 * y que el ETL al escribir `productos.sku`. Sin esto, `suj500-f` sería una
 * partida distinta de `SUJ500-F` para el UNIQUE (proyecto_id, sku) y el
 * "sin duplicados" de la maqueta se rompería por capitalización.
 */
export const agregarPartidaSchema = z.object({
  sku: z.string().trim().min(1).max(120).transform((s) => s.toUpperCase()),
  cantidad: z.coerce.number().int().min(1).max(MAX_CANTIDAD),
});
export type AgregarPartidaInput = z.infer<typeof agregarPartidaSchema>;

export const cambiarCantidadSchema = z.object({
  cantidad: z.coerce.number().int().min(1).max(MAX_CANTIDAD),
});
export type CambiarCantidadInput = z.infer<typeof cambiarCantidadSchema>;

// ============================================================
// [INV-B8.2] EL VOLCADO DE LA SELECCIÓN.
//
// Sumar es lo que el usuario quiere: si un SKU ya está en el proyecto con 10 y
// vuelca 40, el proyecto queda en 50 — y la respuesta se lo dice. Pero «sumar»
// es la operación menos idempotente que existe, y el invariante acordado
// es exactamente ése: **volcar dos veces la misma Selección no puede sumar dos
// veces.** Vaciar la Selección dentro de la operación cubre el doble clic; NO
// cubre el caso que de verdad duele, que es la respuesta perdida — el servidor
// aplicó, la red se cayó, el usuario reintenta.
//
// POR ESO CADA RENGLÓN VIAJA CON `cantidadVista`: lo que el cliente TENÍA
// ENFRENTE cuando armó el envío. No es una instrucción, es una AFIRMACIÓN
// sobre el estado del mundo, y el servidor la comprueba contra la base antes
// de tocar nada. Con ella los tres desenlaces se distinguen sin ambigüedad:
//
//   base == vista            → primera vez. Aplica: base + cantidad.
//   base == vista + cantidad → ya se aplicó. NO vuelve a sumar (reintento).
//   cualquier otra cosa      → alguien más lo movió. Conflicto, y se dice cuál.
//
// Las tres ramas son mutuamente excluyentes porque `cantidad >= 1`: que las dos
// primeras coincidieran exigiría `cantidad == 0`, que el schema no admite.
//
// El cliente NO manda la cantidad final. Manda lo que seleccionó y lo que vio;
// **la suma la hace el servidor**. Si mandara el total, un cliente manipulado
// podría escribir cualquier cifra pasando por «ya lo sumé yo».
// ============================================================

/** Un renglón del volcado. `sku` se normaliza igual que en `agregarPartidaSchema`. */
const volcarItemSchema = z.object({
  sku: z.string().trim().min(1).max(120).transform((s) => s.toUpperCase()),
  /** Piezas a AGREGAR. Nunca el total. */
  cantidad: z.coerce.number().int().min(1).max(MAX_CANTIDAD),
  /** Lo que el cliente vio en el proyecto al armar el envío; `0` si el SKU no estaba. */
  cantidadVista: z.coerce.number().int().min(0).max(MAX_CANTIDAD),
});

export const volcarSeleccionSchema = z
  .object({
    items: z.array(volcarItemSchema).min(1).max(MAX_PARTIDAS),
  })
  // Dos renglones del MISMO SKU se pisarían entre sí dentro de la operación (y
  // el `ON CONFLICT` de Postgres ni siquiera admite dos filas iguales en el
  // mismo statement: falla con 21000). Es un envío mal formado, no un caso
  // válido que haya que resolver: se rechaza y se dice cuál.
  .superRefine((valor, ctx) => {
    const vistos = new Set<string>();
    valor.items.forEach((item, i) => {
      if (vistos.has(item.sku)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', i, 'sku'],
          message: `El SKU ${item.sku} viene repetido en el volcado.`,
        });
      }
      vistos.add(item.sku);
    });
  });
export type VolcarSeleccionInput = z.infer<typeof volcarSeleccionSchema>;
export type VolcarItemInput = z.infer<typeof volcarItemSchema>;

/** Formato del documento. `formato` inválido → 400, nunca un default silencioso a xlsx. */
export const documentoQuerySchema = z.object({
  formato: z.enum(['xlsx', 'pdf']),
});
export type DocumentoQuery = z.infer<typeof documentoQuerySchema>;

/**
 * [INV-B8 · 0025] Reasignación del dueño de un proyecto HUÉRFANO — la vía de
 * rescate. Solo la usa un admin, y la policy
 * `proyectos_update_huerfano_admin` es la que de verdad la acota: este schema
 * valida la forma, no el permiso.
 *
 * Es el ÚNICO sitio del módulo donde `propietario` entra por el cuerpo de una
 * petición. En el alta NO existe a propósito (lo pone el DEFAULT `auth.uid()`),
 * y esa asimetría es deliberada: aquí el llamador SÍ tiene que decir a quién,
 * porque el dueño anterior ya no existe.
 */
export const reasignarProyectoSchema = z.object({
  propietario: z.string().uuid(),
});
export type ReasignarProyectoInput = z.infer<typeof reasignarProyectoSchema>;
