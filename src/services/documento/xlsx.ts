// ============================================================
// [INV-B8] documento/xlsx.ts — el renderizador de Excel.
//
// CERO DEPENDENCIAS NUEVAS: usa la librería `xlsx` (SheetJS 0.18.5) que ya usa la ingesta.
// Decisión de diseño, tomada con la medición enfrente: la variante gratuita **sí** escribe anchos de columna, celdas
// combinadas, formato numérico, autofiltro e HIPERVÍNCULOS —verificado
// escribiendo un libro y releyéndolo— y **no** escribe estilos de celda
// (negritas, colores, bordes) ni imágenes empotradas.
//
// La consecuencia práctica, dicha sin adornos: la foto del SKU viaja como
// ENLACE, no como miniatura. Hoy eso no cambia nada para nadie —muy pocos
// SKU tienen foto— y el bucket es público y sin firmar, así que el
// enlace abre. Cuando esa proporción cambie, la conversación se reabre con
// la librería, no con este archivo.
//
// CÓMO SE CARGA LA LIBRERÍA, y no es un detalle de estilo:
// `createRequire(...)('xlsx')` es lo que ya hace `src/services/ingesta/io.ts`,
// por una razón empírica documentada ahí — el interop ESM↔CJS deja funciones
// del namespace indefinidas en runtime aunque `tsc` las tipe bien. Copiarlo
// no es cargo-cult: es que el mismo paquete falla igual desde aquí.
//
// LAS DOS HOJAS, y por qué son dos. El invariante del bloque pide que el
// archivo se entienda sin instrucciones Y que una máquina pueda releerlo sin
// adivinar dónde empieza la tabla. Un bloque de título encima de los datos
// satisface lo primero y rompe lo segundo. Separarlas satisface ambas: la
// hoja "Partidas" empieza con su encabezado en A1 y no tiene nada más;
// "Documento" lleva la identidad, la vigencia, el firmante y las
// advertencias.
// ============================================================
// Sin `import 'server-only'`: en este repo esa marca vive en los 22 route
// handlers, no en los servicios (ningún `src/services/**` la lleva). El
// handler que importa este módulo ya la tiene, así que la frontera está
// puesta una vez y en la capa que corresponde.
import { createRequire } from 'node:module';
import { celdaComoTexto, type ModeloDocumento } from './modelo';
import { motivoLegible } from './resoluciones';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const XLSX: any = require('xlsx');

/**
 * Qué decir sobre las fotografías EN ESTE FORMATO. Se cuenta por
 * `fotoDelSku` —el hecho— y no por `capa` —la capacidad de pintar—, porque
 * este renderizador no pinta: enlaza. Contarlo por capa fue el bug de B8, que
 * dejaba la columna «Foto» en `—` para SKUs que sí tienen fotografía.
 */
function explicarImagenes(modelo: ModeloDocumento): string {
  if (modelo.filas.length === 0) return 'Sin partidas.';
  const conFoto = modelo.filas.filter((f) => f.imagen.fotoDelSku).length;
  if (conFoto === 0) return `Ninguna de las ${modelo.filas.length} partidas tiene fotografía cargada.`;
  const enlazadas = `${conFoto} de ${modelo.filas.length} partidas tienen fotografía; la columna «Foto» enlaza al archivo original.`;
  if (conFoto === modelo.filas.length) return enlazadas;
  const motivos = new Set(
    modelo.filas.filter((f) => !f.imagen.fotoDelSku).flatMap((f) => f.imagen.motivos.map(motivoLegible)),
  );
  const detalle = motivos.size ? ` Del resto: ${Array.from(motivos).join('; ')}.` : '';
  return `${enlazadas}${detalle}`;
}

/**
 * El libro completo, como bytes listos para responder.
 *
 * Determinista: con el mismo modelo produce el mismo contenido. No consulta
 * el reloj ni la red — todo lo que necesita ya viene resuelto en el modelo.
 */
export function renderizarXlsx(modelo: ModeloDocumento): Buffer {
  const wb = XLSX.utils.book_new();

  // ---------- Hoja 1 · Partidas ----------
  // Encabezado en A1 y datos desde A2. Nada más en la hoja: es la forma de
  // que un script pueda leerla sin heurísticas.
  const encabezado = modelo.columnas.map((c) => c.titulo);
  const filas = modelo.filas.map((fila) =>
    modelo.columnas.map((columna) => {
      // Los números viajan como NÚMERO, no como texto ya formateado: un
      // Excel donde "4,405" es una cadena no se puede sumar, y el KAM que
      // abra el archivo va a querer sumarlo. El separador de miles se aplica
      // con formato de celda (`z`), que es presentación, no dato.
      if (columna.tipo === 'numero') return fila[columna.clave as 'cantidad'];
      return celdaComoTexto(fila, columna);
    }),
  );

  const ws = XLSX.utils.aoa_to_sheet([encabezado, ...filas]);
  ws['!cols'] = modelo.columnas.map((c) => ({ wch: c.ancho }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: modelo.filas.length, c: modelo.columnas.length - 1 } }) };

  modelo.filas.forEach((fila, i) => {
    modelo.columnas.forEach((columna, j) => {
      const ref = XLSX.utils.encode_cell({ r: i + 1, c: j });
      const celda = ws[ref];
      if (!celda) return;
      if (columna.tipo === 'numero') celda.z = '#,##0';
      // El enlace sale del HECHO (`fotoDelSku`), no de la capa resuelta. Un
      // `.webp` no se puede incrustar en un PDF pero SÍ se puede enlazar desde
      // una celda — que es justo lo que B8 no hacía: al pasarle a la cadena una
      // lista vacía de formatos empotrables, toda foto degradaba a `generico` y
      // este `if` no se cumplía nunca. Medido: 0 hipervínculos en el entregable.
      if (columna.clave === 'foto' && fila.imagen.fotoDelSku) {
        celda.l = {
          Target: fila.imagen.fotoDelSku.url,
          Tooltip: `Fotografía de ${fila.sku} (${fila.imagen.fotoDelSku.formato || 'formato desconocido'})`,
        };
      }
    });
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Partidas');

  // ---------- Hoja 2 · Documento ----------
  const meta: string[][] = [
    ['Proyecto', `${modelo.folio} · ${modelo.titulo}`],
    ['Descripción', modelo.descripcion || '—'],
    ['Clasificación', [modelo.tipo, modelo.intencion].filter(Boolean).join(' · ') || '—'],
    ['Fecha del proyecto', modelo.fecha],
    ['Partidas', `${modelo.totalSkus} SKU · ${modelo.totalPiezas.toLocaleString('es-MX')} piezas`],
    // [O6] El DUEÑO del proyecto. Faltaba: el documento solo decía quién lo
    // generó, y en un documento SOBRE un proyecto la pregunta que el lector
    // trae es de quién es el proyecto.
    ['Responsable del proyecto', modelo.responsable ?? 'sin asignar (la cuenta se dio de baja)'],
    [],
    ['DE QUÉ FECHA SON LOS NÚMEROS', modelo.vigencia],
    ['Criterio de agrupación', modelo.agrupacion],
    ['Fotografías', explicarImagenes(modelo)],
    [],
    ['Generado por', modelo.firmante.etiqueta],
    // [O6] El renglón «Correo» solo aparece si AÑADE información. Cuando la
    // cadena D3 degrada a su capa 2 —hoy siempre, porque ninguna cuenta tiene
    // nombre— la etiqueta YA ES el correo, y el documento imprimía el mismo
    // valor dos renglones seguidos. Se leía como un bug aunque fuera la
    // degradación documentada.
    ...(modelo.firmante.capa === 'nombre' && modelo.firmante.correo
      ? ([['Correo', modelo.firmante.correo]] as string[][])
      : []),
    ['Entorno', modelo.firmante.entorno],
    ['Generado el', modelo.generado],
  ];

  if (modelo.notas) {
    meta.push([], ['Notas del proyecto', modelo.notas]);
  }
  if (modelo.advertencias.length) {
    meta.push([], ['ADVERTENCIAS', '']);
    // `.texto`: desde S-5 una advertencia es un objeto que ADEMAS sabe cuales
    // filas la dispararon. El XLSX solo necesita la frase; el superindice del
    // papel y el enlace del pre-vuelo salen del mismo objeto sin re-preguntar.
    for (const advertencia of modelo.advertencias) meta.push(['', advertencia.texto]);
  }

  const wsMeta = XLSX.utils.aoa_to_sheet(meta);
  wsMeta['!cols'] = [{ wch: 30 }, { wch: 96 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Documento');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
