// ============================================================
// [INV-B8] /api/proyectos/[id]/documento?formato=xlsx|pdf
//
// SE GENERA EN SERVIDOR, y la razón es la reproducibilidad, no el gusto. En
// cliente, el documento se armaría con lo que la página tenga cargado: como
// `/api/inventory` es paginada, dos KAMs con distinta caché producirían
// archivos DISTINTOS del mismo proyecto (medido en la investigación §R6-30).
// Aquí los dos formatos salen del MISMO `obtenerProyecto` y del MISMO
// modelo, pinneados al mismo snapshot, así que coinciden cifra por cifra por
// construcción y no por cuidado.
//
// CONTRATO BINARIO. Es la única ruta del repo que no responde JSON en el
// camino feliz, y eso obliga a decir tres cosas que ninguna otra necesita:
//   · `Content-Type` propio de cada formato.
//   · `Content-Disposition: attachment` con nombre en es-MX que lleva el
//     FOLIO — un archivo llamado `documento.xlsx` en la carpeta de descargas
//     de un KAM no se puede devolver a su proyecto.
//   · `Cache-Control: no-store`. El documento lleva disponibilidad y quién
//     lo generó: no debe quedar en una caché intermedia.
//
// Los errores SIGUEN siendo JSON. Es una asimetría deliberada y conviene
// tenerla escrita: si el `<a download>` recibe un 404, el navegador guardará
// un archivo con JSON adentro. La UI por eso NO usa un ancla desnuda —pide
// la ruta, revisa el status y solo entonces materializa la descarga.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { documentoQuerySchema } from '@/schemas/proyectos.schema';
import { obtenerProyecto } from '@/services/proyectos.service';
import { armarModelo } from '@/services/documento/modelo';
import { renderizarXlsx } from '@/services/documento/xlsx';
import { renderizarPdf, FORMATOS_PDF } from '@/services/documento/pdf';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { searchParamsToObject } from '@/lib/api/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// maxDuration=60s, el único de todo el dominio de LECTURA que sube de 30, y
// con motivo: esta ruta suma al detalle completo del proyecto un render y,
// en el PDF, hasta 12 descargas de imagen del bucket. Es el mismo tramo que
// `/api/refresh` (60), reservado hasta hoy para rutas con trabajo pesado. El
// presupuesto de imágenes de `pdf.ts` es lo que mantiene ese techo acotado:
// sin él, 40 fotos de 2 MB podrían pasarse de cualquier límite.
export const maxDuration = 60;

const idSchema = z.string().uuid();

/** El nombre del archivo, con el folio dentro. Se sanea porque el título lo escribe el usuario y viaja en una cabecera HTTP. */
function nombreDeArchivo(folio: string, titulo: string, extension: string): string {
  const limpio = titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${folio}${limpio ? `-${limpio}` : ''}.${extension}`;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    const idParsed = idSchema.safeParse(params.id);
    if (!idParsed.success) {
      return apiError('invalid_query', { issues: idParsed.error.issues });
    }

    const parsed = documentoQuerySchema.safeParse(searchParamsToObject(req));
    if (!parsed.success) {
      return apiError('invalid_query', { issues: parsed.error.issues });
    }

    const detalle = await obtenerProyecto(db, idParsed.data);
    if (detalle === null) {
      return apiError('proyecto_no_encontrado', { message: 'El proyecto no existe o no es tuyo.' });
    }

    const esPdf = parsed.data.formato === 'pdf';

    // La identidad del firmante sale de la SESIÓN (D3), nunca de `kams`.
    // `user_metadata.full_name` es la capa 1 de la cadena: hoy ninguna cuenta
    // la tiene poblada, así que todas firman con su correo — y la cadena lo
    // declara en vez de inventar un nombre.
    const modelo = armarModelo({
      detalle,
      sesion: {
        nombre: (gate.user.user_metadata?.full_name as string | undefined) ?? null,
        correo: gate.user.email ?? null,
        cuenta: gate.user.id,
      },
      entorno: entornoActual(),
      ahora: new Date(),
      formatosEmpotrables: esPdf ? FORMATOS_PDF : [],
    });

    const cuerpo = esPdf ? await renderizarPdf(modelo) : renderizarXlsx(modelo);
    const extension = esPdf ? 'pdf' : 'xlsx';

    return new NextResponse(new Uint8Array(cuerpo), {
      status: 200,
      headers: {
        'Content-Type': esPdf
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombreDeArchivo(detalle.folio, detalle.titulo, extension)}"`,
        'Content-Length': String(cuerpo.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return internalError('api/proyectos/[id]/documento', e);
  }
}

/**
 * El entorno que firma el documento. Vercel expone `VERCEL_ENV`
 * (`production` | `preview` | `development`); fuera de Vercel se cae a
 * NODE_ENV. Se traduce a es-MX porque lo lee una persona, no un script.
 *
 * No es adorno: un documento generado desde una vista previa con datos
 * reales es indistinguible de uno de producción si no lo dice.
 */
function entornoActual(): string {
  const vercel = process.env.VERCEL_ENV;
  if (vercel === 'production') return 'Producción';
  if (vercel === 'preview') return 'Vista previa';
  if (vercel === 'development') return 'Desarrollo';
  return process.env.NODE_ENV === 'production' ? 'Producción' : 'Desarrollo';
}
