import { z } from 'zod';

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export const env = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * Secreto propio de ingesta (NO la service_role); header `x-ingest-secret`
   * de `/api/refresh` y `/api/refresh/archivo`.
   *
   * CREDENCIAL DE ALTO PRIVILEGIO — misma disciplina de rotación que
   * `SUPABASE_SERVICE_ROLE_KEY`. No es una etiqueta decorativa: decisión
   * explícita de producto al aceptar el riesgo de `xlsx@0.18.5` (ver
   * `docs/known-limitations.md` (ING-1)). Quien tiene este valor puede (a) sobrescribir
   * el catálogo completo y (b) alimentar bytes arbitrarios al parser de
   * Excel, que corre con dos CVE ALTAS sin parche. El razonamiento que
   * sostiene la aceptación —privilegio incremental nulo— depende de que
   * (a) y (b) queden SIEMPRE en manos del mismo principal.
   *
   * Por eso: si algún día la ingesta la puede llamar algo que no sea Power
   * Automate, la decisión de ING-1 se revisa antes de abrir esa puerta.
   */
  INGEST_SECRET: z.string().min(16),
});

/** Solo invocar desde código server. Nunca desde componentes cliente. */
export function getServerEnv() {
  return serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    INGEST_SECRET: process.env.INGEST_SECRET,
  });
}

/**
 * [INV-B9.1] Secreto del endpoint que arma los correos (`x-avisos-secret`).
 *
 * **CREDENCIAL DE ALTO PRIVILEGIO**, con la misma disciplina de rotación que
 * `INGEST_SECRET` y `SUPABASE_SERVICE_ROLE_KEY`. Y la etiqueta no es
 * decorativa: para armar el correo de cada quien, el endpoint necesita los
 * avisos de **todas** las personas. Quien tenga este valor puede leer, de una
 * sola llamada, **qué sigue cada usuario y qué le está pasando a cada uno de
 * sus SKU**. No es un secreto de bajo privilegio porque «solo lee».
 *
 * ────────────────────────────────────────────────────────────
 * POR QUÉ NO ESTÁ EN `serverSchema`, que sería lo obvio.
 *
 * `getServerEnv()` se parsea entero cada vez que lo llama cualquier ruta. Meter
 * aquí un secreto NUEVO y obligatorio significaría que, hasta que la variable
 * exista en TODOS los entornos, `/api/refresh`, `/api/usuarios` y todo lo demás
 * revientan por una variable que no usan. La app se caería completa por una
 * función que todavía no existe.
 *
 * Se valida aparte y en el punto de uso: si falta, **solo** el endpoint de
 * correos responde `config_error`, y el resto del portal sigue en pie. Es la
 * misma degradación acotada que ya usa `/api/refresh`.
 *
 * `min(16)` es el mismo piso que `INGEST_SECRET`.
 */
const avisosSchema = z.object({ AVISOS_SECRET: z.string().min(16) });

/**
 * `{ AVISOS_SECRET }` si está bien configurado; `null` si falta o es corto —
 * **nunca lanza**. Devolver `null` en vez de propagar el `ZodError` deja que el
 * llamador responda un `config_error` legible en vez de un 500 con traza.
 */
export function getAvisosSecret(): { AVISOS_SECRET: string } | null {
  const parsed = avisosSchema.safeParse({ AVISOS_SECRET: process.env.AVISOS_SECRET });
  return parsed.success ? parsed.data : null;
}

/**
 * [INV-B10] Llave del modelo que clasifica las preguntas del chat.
 *
 * **CREDENCIAL DE ALTO PRIVILEGIO**, con la misma disciplina de rotación que
 * `INGEST_SECRET` y `AVISOS_SECRET`. Aquí «alto privilegio» significa dos cosas
 * distintas y las dos importan: quien la tenga puede **gastar dinero de la
 * cuenta del proveedor**, y puede hacerlo desde fuera de este portal.
 *
 * ────────────────────────────────────────────────────────────
 * NO ESTÁ EN `serverSchema`, por la misma razón que `AVISOS_SECRET`.
 *
 * `getServerEnv()` se parsea entero cada vez que lo llama cualquier ruta. Una
 * variable nueva y obligatoria ahí tumbaría `/api/refresh`, `/api/usuarios` y
 * todo lo demás en cualquier despliegue que aún no la tenga — la ingesta caída
 * por una función de chat que nadie usa.
 *
 * Se valida en el punto de uso: si falta, **solo** el chat responde
 * `config_error`, y el resto del portal sigue en pie.
 *
 * ────────────────────────────────────────────────────────────
 * LA LLAVE DE n8n NO SIRVE AQUÍ, y conviene decirlo donde se va a buscar.
 *
 * Si el entorno tiene además un flujo de n8n con una credencial de OpenAI,
 * esa **vive dentro de n8n**, que es otro proceso en otro host; este chat corre
 * en el portal y necesita la suya, en el entorno del despliegue.
 *
 * `min(20)` es un piso deliberadamente flojo: el formato de las llaves de los
 * proveedores cambia, y un schema que valide su FORMA se rompería el día que
 * cambie sin proteger nada. Lo que se comprueba es que hay algo que parece un
 * secreto, no que sea de un proveedor concreto.
 */
const modeloSchema = z.object({ OPENAI_API_KEY: z.string().min(20) });

/**
 * `{ OPENAI_API_KEY }` si está configurada; `null` si falta — **nunca lanza**,
 * igual que `getAvisosSecret()`, para que el llamador responda un `config_error`
 * legible en vez de un 500 con traza.
 */
export function getModeloSecret(): { OPENAI_API_KEY: string } | null {
  const parsed = modeloSchema.safeParse({ OPENAI_API_KEY: process.env.OPENAI_API_KEY });
  return parsed.success ? parsed.data : null;
}

/**
 * [CHAT-B1] Qué proveedor y con qué llave. `null` si no hay ninguno configurado.
 *
 * ────────────────────────────────────────────────────────────
 * EL ORDEN DE PRECEDENCIA, Y POR QUÉ SON DOS Y NO UNO.
 *
 *   1. `CHAT_PROVEEDOR` si está puesta — **lo explícito gana siempre**. Es lo
 *      que permite volver a OpenAI sin borrar la llave de DeepSeek, que es la
 *      marcha atrás que un cambio de proveedor necesita tener.
 *   2. Si no, DeepSeek cuando su llave existe. **Ponerla ES el interruptor**,
 *      y es un acto deliberado en el entorno del sistema.
 *   3. Si no, OpenAI.
 *
 * Con solo la regla 2, volver atrás habría exigido BORRAR un secreto, que es
 * justo la operación que no se quiere hacer con prisa.
 *
 * ────────────────────────────────────────────────────────────
 * ⚠️ `OPENAI_API_KEY` TIENE UN SEGUNDO CONSUMIDOR, y hay que decirlo aquí.
 *
 * `scripts/corpus-sync.mjs` la lee para el **embebedor** del corpus. O sea
 * que pasarse a DeepSeek en el chat **no la deja libre**: si alguien la borra
 * creyendo que ya no hace falta, el sincronizador del corpus deja de poder
 * embeber. Comprobado con un `grep` sobre el repositorio.
 *
 * `min(20)` sigue siendo un piso deliberadamente flojo, por lo de arriba: lo que
 * se comprueba es que hay algo que parece un secreto, no de qué proveedor es.
 */
export function getProveedorChat(): { proveedor: 'openai' | 'deepseek'; apiKey: string; modelo: string | null } | null {
  const pedido = (process.env.CHAT_PROVEEDOR ?? '').trim().toLowerCase();
  const openai = process.env.OPENAI_API_KEY ?? '';
  const deepseek = process.env.DEEPSEEK_API_KEY ?? '';

  const candidatos: { proveedor: 'openai' | 'deepseek'; apiKey: string; modelo: string | null }[] = [];
  if (deepseek.length >= 20) {
    candidatos.push({ proveedor: 'deepseek', apiKey: deepseek, modelo: process.env.DEEPSEEK_MODELO || null });
  }
  if (openai.length >= 20) {
    candidatos.push({ proveedor: 'openai', apiKey: openai, modelo: process.env.OPENAI_MODELO || null });
  }

  if (pedido === 'openai' || pedido === 'deepseek') {
    return candidatos.find((c) => c.proveedor === pedido) ?? null;
  }
  return candidatos[0] ?? null;
}
