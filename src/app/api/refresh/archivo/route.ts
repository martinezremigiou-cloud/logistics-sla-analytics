// ============================================================
// [RECEPCION] POST /api/refresh/archivo — recibe el .xlsx y hace el mismo
// trabajo que `/api/refresh`.
//
// QUÉ CAMBIA respecto de la ruta hermana: solo QUÉ ENTRA. Aquí entra el
// archivo; allá entra el JSON ya convertido. De la conversión en adelante
// —mapeo de hojas, ETL, cuarentena, idempotencia, snapshots— es
// literalmente el mismo código. La ruta vieja NO se sustituye: sigue
// siendo el camino manual de respaldo de `scripts/ingesta-mensual.mjs`.
//
// POR QUÉ CUELGA DE `/api/refresh/` Y NO ES UNA RUTA SUELTA. Tres
// exenciones que la ingesta necesita están escritas contra ese prefijo,
// las tres anclando por segmento (`=== ruta || startsWith(ruta + '/')`):
//   1. `src/middleware.ts` — el matcher excluye `api/refresh(?:$|/)`, así
//      que no se paga `auth.getUser()` en cada carga.
//   2. `esRutaExentaDeMantenimiento` — la ingesta no se detiene porque el
//      PORTAL esté en mantenimiento.
//   3. `src/lib/api/origin.ts` — Power Automate no manda `Origin` nunca;
//      sin la exención, esta ruta daría 403 a todas las cargas.
// Colgando de ese prefijo, las tres se heredan por CONSTRUCCIÓN. La
// alternativa (`/api/ingesta`, por ejemplo) exigía acordarse de editar
// tres listas en tres archivos distintos, y olvidar cualquiera de ellas
// rompía la ingesta de formas que ningún test unitario ve.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ingestaAutorizada } from '@/lib/api/ingest-auth';
import { apiError, internalError } from '@/lib/api/errors';
import { leerForzadoUniversoReducido } from '@/lib/api/forzar-universo';
import { RefreshBody } from '@/schemas/refresh.schema';
import { toIngestJob } from '@/services/etl/adapter';
import { runEtl } from '@/services/etl.service';
import { EtlContractError, UniversoReducidoError } from '@/services/etl/errors';
import { DatasetsStockFaltantesError } from '@/services/ingesta/motor';
import {
  construirBodyDesdeArchivo,
  ArchivoIlegibleError,
  type FuenteArchivo,
} from '@/services/ingesta/desde-archivo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// [RECEPCION] O4 · maxDuration=60s, el mismo tramo que `/api/refresh`.
// Justificación propia, no copiada: esta ruta hace TODO lo que hace
// aquella MÁS abrir el .xlsx. Ese tramo extra está MEDIDO sobre los
// archivos vivos — fracciones de segundo, bytes→grids. Es un agregado de fracción de segundo
// sobre un presupuesto que ya tenía ~85× de holgura sobre su tramo
// medido, así que no hay razón para pedir más ni margen para pedir menos.
// 60 cabe tanto en el plan Hobby como en Pro de Vercel.
export const maxDuration = 60;

/**
 * Tope del archivo recibido. Los libros vivos pesan unos cientos de KB;
 * 15 MB deja una holgura de decenas de veces sobre el mayor y es el
 * MISMO tope que ya usa `/api/refresh` para su JSON — dos puertas a la
 * misma ingesta con dos topes distintos sería una asimetría sin razón.
 *
 * El sobre base64 de Power Automate infla ~4/3, y eso está contemplado:
 * el tope se aplica al CUERPO recibido (ya inflado), no al archivo
 * decodificado.
 */
const MAX_ARCHIVO_BYTES = 15_000_000;

function fuenteValida(valor: string | null): valor is FuenteArchivo {
  return valor === 'stock' || valor === 'aduana';
}

export async function POST(req: Request) {
  let serverEnv: ReturnType<typeof getServerEnv>;
  try {
    serverEnv = getServerEnv();
  } catch (e) {
    console.error('[api/refresh/archivo] configuración de servidor inválida', e);
    return apiError('config_error');
  }

  if (!ingestaAutorizada(req, serverEnv.INGEST_SECRET)) {
    return apiError('unauthorized');
  }

  // Corte BARATO por `Content-Length` declarado: rechaza ANTES de
  // materializar el cuerpo en memoria. Best-effort — el header lo declara
  // el cliente (mismo criterio y mismo límite conocido que `bodyTooLarge`
  // en `src/lib/api/body.ts`).
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_ARCHIVO_BYTES) {
    return apiError('payload_too_large');
  }

  const source = new URL(req.url).searchParams.get('source');
  if (!fuenteValida(source)) {
    return apiError('invalid_query', {
      message: 'Falta el parámetro "source" con valor "stock" o "aduana" (p.ej. /api/refresh/archivo?source=stock).',
    });
  }

  let crudo: Uint8Array;
  try {
    crudo = new Uint8Array(await req.arrayBuffer());
  } catch {
    return apiError('invalid_body', { message: 'No se pudo leer el cuerpo de la petición.' });
  }

  // Segundo corte, ya con los bytes REALES: cubre el caso en que el
  // `Content-Length` faltó, mintió o venía `chunked`. Va ANTES de entregar
  // el búfer al parser de xlsx, que es el tramo caro — materializar el
  // cuerpo es inevitable, descomprimir un ZIP gigante no.
  if (crudo.byteLength > MAX_ARCHIVO_BYTES) {
    return apiError('payload_too_large');
  }

  const nombreArchivo =
    req.headers.get('x-archivo-nombre')?.trim() ||
    (source === 'stock' ? 'inventario.xlsx' : 'embarques.xlsx');

  let armado: ReturnType<typeof construirBodyDesdeArchivo>;
  try {
    armado = construirBodyDesdeArchivo(crudo, {
      source,
      nombreArchivo,
      capturedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (e instanceof ArchivoIlegibleError) {
      // El mensaje de `ArchivoIlegibleError` es propio y seguro (redactado
      // para el operador de PA). El error ORIGINAL de la librería queda
      // solo en el log: los mensajes de `xlsx` mencionan internals del
      // formato y de su ruta de parseo.
      console.error('[api/refresh/archivo] archivo ilegible', e.causa ?? e);
      return apiError('invalid_body', { message: e.message });
    }
    if (e instanceof DatasetsStockFaltantesError) {
      // [RECEPCION] O5 · la compuerta de INV-B8 aplica IGUAL por esta
      // puerta. Se responde 400, no 500: el archivo llegó bien, lo que
      // falla es que una hoja obligatoria no se reconoció — es
      // accionable por quien mantiene el Excel, no un fallo del servidor.
      //
      // El `message` del error NO se reenvía tal cual (decisión de producto
      // sobre el hallazgo E de la auditoría). Ese mensaje es diagnóstico
      // rico —incluye la ruta del archivo de configuración y el volcado
      // de la clasificación hoja por hoja, con los motivos de exclusión—
      // y sigue siendo el correcto para el CLI y para el log del
      // servidor, donde el lector ya está dentro. Por HTTP se responde
      // solo lo que Power Automate necesita para diagnosticar: CUÁLES
      // datasets faltaron. El nombre del dataset se conserva a propósito
      // — sin él, el operador no sabe qué pestaña revisar y el 400 se
      // vuelve inaccionable.
      console.error('[api/refresh/archivo] datasets de stock faltantes', e.faltantes, e.message);
      const cuales = e.faltantes.join(', ');
      const frase =
        e.faltantes.length === 1
          ? `no se encontró el dataset obligatorio "${cuales}"`
          : `no se encontraron los datasets obligatorios "${cuales}"`;
      return apiError('invalid_body', {
        message:
          `No se procesó el archivo: ${frase} en el libro. ` +
          'Revisa que las pestañas del Excel conserven sus nombres.',
      });
    }
    return internalError('api/refresh/archivo', e);
  }

  // Diagnóstico de drift: si mañana renombran una pestaña, esta línea del
  // log dice cuál se reconoció y cuál no, sin tener que reproducirlo.
  console.info(
    `[api/refresh/archivo] source=${source} forma=${armado.forma} hojas=[${armado.hojas.join(', ')}] ` +
      `lectura=${armado.msLectura.toFixed(0)}ms mapeo=${armado.msMapeo.toFixed(0)}ms bytes=${crudo.byteLength}`,
  );

  // [RECEPCION] · La MISMA validación de contrato que protege `/api/refresh`,
  // aplicada al body que acabamos de construir.
  //
  // Por qué hace falta, y por qué NO estaba: la protección de INV-B8 contra
  // "dataset vacío reportado como éxito" (P10) tiene DOS mitades, y solo una
  // vive en el motor:
  //   · `DatasetsStockFaltantesError` atrapa la hoja NO MAPEADA (renombrada,
  //     ausente) — esa sí se hereda, porque la lanza `construirDatasets`.
  //   · el `.min(1)` de `refresh.schema.ts` atrapa el dataset VACÍO — una hoja
  //     que SÍ existe, con el nombre correcto, y sin una sola fila.
  // La primera versión de esta ruta heredaba solo la primera mitad. Un .xlsx
  // con `Inventario`, `Reserva` e `INV WEST` bien nombradas pero vacías
  // pasaba entero: las 3 hojas SE ASIGNAN, así que el gate del motor no
  // dispara; y la guarda de `runEtl.ts:114` es `!job.inventario`, que con `[]`
  // da `false` porque un arreglo vacío es truthy (la guarda de aduana sí
  // compara `.length === 0`; la de stock no). El differ habría emitido una
  // BAJA por cada producto del snapshot vigente y `runEtl` habría PERSISTIDO
  // ese vaciado devolviendo 200 — el peor modo de fallo posible para una
  // ingesta, y exactamente el que INV-B8 existe para impedir.
  //
  // Hallado por la auditoría adversarial de seguridad del bloque, y
  // reproducido antes de corregir: la puerta vieja rechazaba el mismo body
  // con tres issues, la nueva lo aceptaba.
  const contrato = RefreshBody.safeParse(armado.body);
  if (!contrato.success) {
    console.error('[api/refresh/archivo] body construido que viola el contrato', contrato.error.issues);
    return apiError('invalid_body', { issues: contrato.error.issues });
  }

  // [REPRODUCIBILIDAD · S7-A] Escape hatch — se lee ANTES de correr el
  // ETL, pero el forzado solo se APLICA si la guarda de universo
  // reducido llega a dispararse (ver runEtl.ts). `intentoInvalido` no
  // rechaza aquí por sí solo: solo importa si `UniversoReducidoError`
  // termina saliendo del `try` de abajo (Enmienda 2(b): "si falta una,
  // el rechazo se sostiene y el mensaje dice CUÁL falta").
  const { forzado, intentoInvalido } = leerForzadoUniversoReducido(req);

  try {
    const job = toIngestJob(contrato.data);
    const result = await runEtl(job, { db: createSupabaseServerClient(), forzado: forzado ?? undefined });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof EtlContractError) {
      return apiError('invalid_body', { message: e.message });
    }
    if (e instanceof UniversoReducidoError) {
      const message = intentoInvalido
        ? `${e.message} Intento de forzado incompleto: ${intentoInvalido}.`
        : e.message;
      return apiError('universo_reducido', { message });
    }
    // Postgres/PostgREST pueden filtrar nombres de columna/constraint:
    // se registran server-side, NUNCA viajan al cliente.
    return internalError('api/refresh/archivo', e);
  }
}
