// ============================================================
// [INV-B9] schemas/avisos.schema.ts — contratos de entrada del seguimiento.
//
// Los topes son ESPEJO de la 0026, con la misma disciplina que
// `proyectos.schema.ts`: si divergen, zod deja pasar y Postgres rechaza con un
// 23514, y el usuario recibe un 500 genérico en vez de un mensaje útil.
// ============================================================
import { z } from 'zod';

/** Espejo del `text` de `seguimientos.sku` y del criterio de `agregarPartidaSchema`. */
export const MAX_SKU = 120;

/**
 * Qué quiere saber alguien de un SKU. **Espejo del CHECK
 * `seguimientos_al_menos_un_aviso` de la 0026**: seguir un SKU sin querer
 * saber nada de él es una fila sin sentido, y una fila sin sentido acaba
 * siendo un aviso que nadie sabe explicar.
 *
 * «Todo» no existe como valor: son los cuatro en `true`. Un quinto valor sería
 * un estado que significa dos cosas.
 */
export const avisosSchema = z
  .object({
    av_estatus: z.boolean(),
    av_disponible: z.boolean(),
    av_reservado: z.boolean(),
    av_llegada: z.boolean(),
  })
  .refine((v) => v.av_estatus || v.av_disponible || v.av_reservado || v.av_llegada, {
    message: 'Elige al menos una cosa que quieras saber de este SKU.',
  });
export type AvisosInput = z.infer<typeof avisosSchema>;

/**
 * Seguir un SKU. `avisos` es OPCIONAL a propósito: cuando el usuario tiene
 * puesto «usar esto para los siguientes» —el default— el cliente no manda
 * nada y el servidor aplica las preferencias del perfil. Es lo que hace que
 * seguir 30 SKU no sea responder 30 veces la misma pregunta.
 *
 * `perfil_id` NO aparece, igual que `propietario` no aparece en
 * `crearProyectoSchema`: lo pone el DEFAULT `auth.uid()` de la tabla y lo
 * verifica el `WITH CHECK` de la policy. Si el schema lo aceptara, existiría
 * un camino donde el cliente propone de quién es la fila.
 */
export const seguirSkuSchema = z.object({
  sku: z.string().trim().min(1).max(MAX_SKU).transform((s) => s.toUpperCase()),
  avisos: avisosSchema.optional(),
  /**
   * [INV-B9.1] El segundo nivel de criticidad. Opcional y ausente ⇒ se
   * conserva lo que ya hubiera (o `false` si es un seguimiento nuevo).
   *
   * NO viaja dentro de `avisosSchema` a propósito: ese objeto también describe
   * las preferencias del perfil, que no tienen canal. Meterlo ahí obligaría a
   * las preferencias a cargar un campo que no significa nada para ellas.
   */
  av_correo: z.boolean().optional(),
});
export type SeguirSkuInput = z.infer<typeof seguirSkuSchema>;

/**
 * Preferencias del perfil. Todo opcional, pero al menos un campo — un PATCH
 * vacío es un error del llamador, no un no-op silencioso (mismo criterio que
 * `editarProyectoSchema`).
 *
 * **`visto_hasta` NO viaja en el cuerpo.** El cliente pide `marcar_visto: true`
 * y el SERVIDOR estampa la hora. Dejar que el cliente proponga el instante
 * abriría un camino para silenciarse con una marca en el futuro, y ningún
 * mensaje del cliente merece esa confianza — es la misma regla que en el
 * volcado de B8.2 hizo que la suma la hiciera el servidor.
 */
export const preferenciasSchema = z
  .object({
    av_estatus: z.boolean().optional(),
    av_disponible: z.boolean().optional(),
    av_reservado: z.boolean().optional(),
    av_llegada: z.boolean().optional(),
    preguntar_por_sku: z.boolean().optional(),
    /**
     * [INV-B9.1] El apagador del boletín. Vive AQUÍ y no en `avisosSchema`
     * porque no es «qué me importa» sino «por dónde me buscas» — la misma
     * frontera por la que `av_correo` tampoco entró en ese objeto.
     */
    boletin_correo: z.boolean().optional(),
    marcar_visto: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Nada que actualizar: el cuerpo no trae ningún campo.',
  })
  .refine(
    (v) => {
      const tocaAvisos =
        v.av_estatus !== undefined ||
        v.av_disponible !== undefined ||
        v.av_reservado !== undefined ||
        v.av_llegada !== undefined;
      // Si toca los cuatro, tienen que dejar al menos uno en true — espejo del
      // CHECK `preferencias_al_menos_un_aviso`. Si toca solo algunos, el
      // servicio los mezcla con los que ya hay y el CHECK de la base es la
      // última línea.
      if (!tocaAvisos) return true;
      const todos =
        v.av_estatus !== undefined &&
        v.av_disponible !== undefined &&
        v.av_reservado !== undefined &&
        v.av_llegada !== undefined;
      if (!todos) return true;
      return Boolean(v.av_estatus || v.av_disponible || v.av_reservado || v.av_llegada);
    },
    { message: 'Deja al menos un tipo de aviso encendido.' },
  );
export type PreferenciasInput = z.infer<typeof preferenciasSchema>;
