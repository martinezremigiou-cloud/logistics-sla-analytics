// ============================================================
// [RECEPCION] API · ingest-auth.ts
// Gate de `x-ingest-secret` compartido por las DOS puertas de ingesta:
//   - `POST /api/refresh`          (JSON ya convertido — camino de B2)
//   - `POST /api/refresh/archivo`  (.xlsx crudo — camino de este bloque)
//
// Por qué compartido y no copiado: es una comparación timing-safe, o sea
// una primitiva de seguridad. Dos copias son dos lugares donde arreglar el
// día que una esté mal, y nada garantiza que alguien recuerde el segundo.
// Este archivo NO cambia el contrato de `/api/refresh`: es exactamente la
// misma función que vivía privada en ese route handler, movida de sitio.
// ============================================================
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Comparación timing-safe del secreto de ingesta, sin fuga de longitud.
 *
 * Se comparan los DIGESTS sha256 (32 bytes fijos), no los secretos en
 * crudo: `timingSafeEqual` exige que ambos búferes midan lo mismo — si se
 * le pasaran los valores tal cual, lanzaría con longitudes distintas y esa
 * excepción (o el 500 resultante) revelaría la longitud del secreto real.
 * Con el digest de por medio, el largo del valor recibido no es observable.
 *
 * Header ausente ⇒ `''` ⇒ digest de la cadena vacía ⇒ no coincide. Nunca
 * se abre paso solo.
 */
export function ingestaAutorizada(req: Request, ingestSecret: string): boolean {
  return secretoDeCabeceraAutorizado(req, 'x-ingest-secret', ingestSecret);
}

/**
 * [INV-B9.1] La misma comparación, con el nombre de la cabecera como
 * parámetro. Se generaliza en vez de copiarse porque **este archivo ya dice por
 * qué**: es una primitiva de seguridad, y dos copias son dos lugares donde
 * arreglar el día que una esté mal. `ingestaAutorizada` queda como envoltorio
 * — su contrato no cambia ni un carácter.
 *
 * La usa `x-avisos-secret`, el gate del endpoint que arma los correos. Ese
 * secreto es de ALTO PRIVILEGIO por la misma razón que el de ingesta, aunque
 * «solo lea»: quien lo tenga saca de una llamada qué sigue cada usuario y qué
 * le está pasando a cada uno de sus SKU.
 *
 * **NO hay respaldo por sesión**: si la cabecera falta o no coincide, se
 * rechaza. Un endpoint que además aceptara una cookie sería alcanzable desde
 * el navegador de cualquier usuario autenticado, y este devuelve los avisos de
 * TODOS.
 */
export function secretoDeCabeceraAutorizado(req: Request, cabecera: string, secreto: string): boolean {
  const provided = req.headers.get(cabecera) ?? '';
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(secreto).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
