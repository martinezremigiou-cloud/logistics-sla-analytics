// ============================================================
// [INV-B9.1] /api/avisos/envios — el endpoint que consume n8n.
//
// ⚠️ ES UN LEE-TODO. Para armar el correo de cada quien devuelve los avisos de
// **todas** las personas. `AVISOS_SECRET` no es un secreto de bajo privilegio
// porque «solo lee»: quien lo tenga saca de una sola llamada qué sigue cada
// usuario y qué le está pasando a cada uno de sus SKU.
//
// DE AHÍ SALEN LAS CUATRO REGLAS DE ESTA RUTA:
//
//   1. **Solo cabecera, sin respaldo por sesión.** No hay `requireSession` ni
//      cookie que valga. Si aceptara una sesión, cualquier usuario autenticado
//      podría leer desde su navegador los avisos de todos. Es el rechazo que la
//      prueba de seguridad exige explícitamente.
//   2. **Same-origin NO aplica.** Al revés que las rutas del portal: quien
//      llama es n8n desde otro host, y `requireSameOrigin` lo rechazaría
//      siempre. La defensa aquí es el secreto, no el origen.
//   3. **Hace lo mínimo.** Corre con `service_role`; toda la protección real la
//      hace el secreto. Cuanto más chica sea esta superficie, menos cuesta una
//      fuga. Nada de consultas de conveniencia.
//   4. **Los DATOS son el contrato.** Cada correo viaja con sus avisos crudos.
//      Quien entrega no tiene que reconstruir nada.
//
// ────────────────────────────────────────────────────────────
// [INV-B9.1 · corrección] SOBRE EL HTML — cambié de opinión y va dicho.
//
// La versión anterior de esta cabecera decía «no devuelve HTML» con este
// motivo: «si esta ruta renderizara, el correo y la campana tendrían dos
// generadores del mismo contenido». **Ese motivo estaba mal razonado.** La
// campana no genera HTML de correo: genera React. Lo que las dos comparten es
// `derivarAvisos()`, y eso ya está compartido pase lo que pase aquí.
//
// El riesgo REAL era el contrario: con la plantilla dentro de un nodo Code de
// n8n, existirían dos copias del mismo HTML —una versionada y probada, otra
// editable en una interfaz web— y divergirían. Es exactamente la falla de
// `piezas_en_camino`: cuatro implementaciones, ninguna compartida, nada que las
// compare.
//
// Ahora la ruta devuelve `asunto` y `html` YA RENDERIZADOS, **además** de los
// datos. Es aditivo: nadie que consumiera `avisos` deja de recibirlo.
//
// Y NO rompe el invariante del bloque. «n8n ENTREGA, n8n no DECIDE» se refiere
// a *a quién le toca qué*; una plantilla es presentación, no decisión. Si
// acaso, esto lo refuerza: n8n queda con el calendario, el canal, el reintento
// y el registro — y con cero opiniones sobre el contenido.
//
// **El copy sigue siendo decisión de producto.** Lo que cambia es dónde se
// edita: en `src/lib/correo-plantilla.ts`, con sus 34 pruebas y un gate que
// impide que vuelva a colarse un `display:flex`, en vez de en un textarea.
// Si se prefiere poder cambiar el texto sin desplegar, esto se revierte
// dejando de leer `html` — los datos siguen ahí.
//
// LA VENTANA Y LA CLAVE LAS PONE EL LLAMADOR — el portal no tiene calendario
// (reparto del §0 del brief). Hoy n8n manda `semanal-<año>-W<semana>`; mañana un
// segundo workflow mandará `evento-<sku>-<snapshot>` con otra ventana, y esta
// ruta no cambia ni una línea.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAvisosSecret } from '@/lib/env';
import { secretoDeCabeceraAutorizado } from '@/lib/api/ingest-auth';
import { apiError, internalError } from '@/lib/api/errors';
import { prepararEnvios } from '@/services/correo.service';
import { resumenDeCorreo } from '@/lib/correo';
import { asuntoDeCorreo, cuerpoDeCorreo } from '@/lib/correo-plantilla';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Varias lecturas acotadas a la ventana y a los SKU seguidos, más una escritura.
// Se iguala al resto del repo en vez de afinar un número sin medirlo.
export const maxDuration = 30;

/**
 * La ventana es OBLIGATORIA y explícita. Sin default: un default aquí sería el
 * portal teniendo calendario a escondidas, que es justo lo que el reparto
 * prohíbe. `clave_intento` se valida como CADENA, no como formato — el portal
 * no interpreta lo que dice.
 */
const cuerpoSchema = z
  .object({
    desde: z.string().datetime(),
    hasta: z.string().datetime(),
    clave_intento: z.string().trim().min(1).max(120),
    /**
     * Base del portal para los enlaces del correo, sin diagonal final. La manda
     * quien entrega porque **es quien sabe bajo qué dominio está publicado
     * esto**; hornearla en el servidor sería una segunda verdad que se rompe el
     * día que cambie. Ausente ⇒ el correo sale sin enlaces, que es una
     * degradación correcta.
     */
    url_portal: z.string().url().max(200).optional(),
    /**
     * [C-11] Acota los destinatarios. **Ausente ⇒ no acota**, que es el
     * comportamiento de producción. Existe para las corridas de verificación —
     * aquellas en las que n8n ejecuta el workflow real contra el portal local —
     * donde mandar a todos los perfiles significaría escribirle a compañeros de verdad.
     *
     * `min(1)`: un arreglo vacío sería ambiguo entre «a nadie» y «no acotes», y
     * la ambigüedad en esta posición se paga con correos a gente real. Se
     * rechaza con `invalid_body` en vez de elegir por el llamador.
     */
    solo_perfiles: z.array(z.string().uuid()).min(1).max(20).optional(),
  })
  .refine((v) => new Date(v.hasta) > new Date(v.desde), {
    message: 'La ventana está invertida: `hasta` tiene que ser posterior a `desde`.',
  });

export async function POST(req: Request) {
  try {
    const secreto = getAvisosSecret();
    if (!secreto) {
      // Falta la variable o es demasiado corta. `config_error` y no 401: el
      // problema es del despliegue, no de quien llama, y confundirlos manda a
      // n8n a revisar su credencial cuando lo que falta es la del servidor.
      return apiError('config_error', { message: 'AVISOS_SECRET no está configurado en el servidor.' });
    }

    if (!secretoDeCabeceraAutorizado(req, 'x-avisos-secret', secreto.AVISOS_SECRET)) {
      return apiError('unauthorized');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = cuerpoSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const db = createSupabaseServerClient();
    const { correos, yaEnviados, pulso, ventana, catalogo, ordenDeEtapa, cifras, proyectosPorPerfil } =
      await prepararEnvios(db, parsed.data, { soloPerfiles: parsed.data.solo_perfiles });

    return NextResponse.json(
      {
        ventana,
        pulso,
        // Ya vienen filtrados: quien aparece aquí, se envía. n8n no tiene que
        // volver a decidir nada — es el invariante del bloque. Y ya vienen
        // renderizados: tampoco tiene que maquetar nada.
        correos: correos.map((c) => {
          const r = resumenDeCorreo(c);
          return {
            ...c,
            resumen: r,
            asunto: asuntoDeCorreo(c),
            html: cuerpoDeCorreo(c, pulso, ventana, {
              urlPortal: parsed.data.url_portal,
              // [C-5] El preencabezado es lo que el cliente enseña junto al
              // asunto. Sin él, Outlook toma las primeras palabras del cuerpo —
              // que eran el remitente repetido. Se deriva del MISMO resumen que
              // alimenta el asunto: dos textos que se contradijeran sobre el
              // mismo correo serían dos verdades.
              preencabezado: r.soloPulso
                ? 'El panorama de la operación de esta semana.'
                : `${r.skus} de tus SKU se movieron. Abre para ver cuáles.`,
              ordenDeEtapa,
              cifras,
              catalogo: catalogo ?? undefined,
              proyectos: proyectosPorPerfil.get(c.perfil_id),
            }),
          };
        }),
        // Se reportan los que ya estaban confirmados para que el registro no
        // mienta por omisión: «no salieron» y «no les tocaba» son distintos.
        ya_enviados: yaEnviados,
        // [C-11] Se devuelve el acotamiento APLICADO, no el pedido. Quien corre
        // la verificación tiene que poder comprobar que mordió **leyendo la
        // respuesta**, no confiando en que el parámetro llegó — es la misma
        // regla de R-4: un 200 dice que la API aceptó, no dice qué hizo.
        acotado_a: parsed.data.solo_perfiles ?? null,
      },
      { status: 200 },
    );
  } catch (e) {
    return internalError('api/avisos/envios', e);
  }
}
