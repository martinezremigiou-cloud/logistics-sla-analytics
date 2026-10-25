// ============================================================
// [INV-B9.1] correo.service.ts — arma los envíos y lleva el registro.
//
// ESTE ARCHIVO CORRE CON `service_role`, y de eso salen sus dos reglas:
//
//   1. **Hace lo mínimo y nada más.** Lee lo que necesita para armar los
//      correos, escribe la fila del intento, y ya. Ninguna consulta de
//      conveniencia, ningún «ya que estamos aquí». Exigencia de producto, y la razón
//      es que toda la protección real la hace `AVISOS_SECRET`: cuanto más chica
//      sea la superficie que corre con la llave maestra, menos cuesta una fuga.
//   2. **No decide qué avisar.** Eso es `derivarAvisos()`, y no se toca. Aquí
//      solo se le pasan los seguimientos de TODOS en una sola llamada — la
//      función ya etiqueta cada aviso con su `perfil_id`, que es exactamente
//      para lo que se diseñó así.
//
// ────────────────────────────────────────────────────────────
// LA IDEMPOTENCIA VIVE EN EL ÍNDICE, no aquí. `UNIQUE (perfil_id,
// clave_intento)` de la 0027 hace que preparar el mismo intento dos veces no
// pueda crear dos filas. Este archivo solo LEE ese estado y decide:
//
//   fila con estado 'enviado'    → ese perfil NO recibe nada. Ya se le mandó.
//   fila con estado 'preparado'  → se le vuelve a entregar EL MISMO contenido.
//                                  Es el reintento antes de la confirmación.
//   sin fila                     → se prepara y se entrega.
//
// El contenido de un reintento es idéntico porque la ventana y la clave son las
// mismas y el cálculo es determinista: mismos `cambios`, mismas cifras, mismos
// avisos. No se guarda el HTML — guardarlo sería una segunda copia de algo que
// se puede volver a derivar, y ya sabemos cómo terminan las segundas copias.
//
// LO QUE ESTO NO GARANTIZA, y va dicho: si n8n ENTREGA y muere antes de
// confirmar, el siguiente intento vuelve a entregar. Exactamente-una-vez no es
// alcanzable entre dos sistemas sin idempotencia en el transporte. Lo que sí
// queda garantizado: **una ventana confirmada no se vuelve a enviar nunca**, y
// **la misma clave nunca produce dos correos distintos**.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { derivarAvisos, derivarPulso, type Pulso, type SeguimientoLectura } from '@/lib/avisos';
import {
  armarCorreos,
  acotarAPerfiles,
  type CorreoArmado,
  type DestinatarioPosible,
  type SeguimientoCorreo,
} from '@/lib/correo';
import {
  leerCambios,
  leerCifras,
  leerEnCamino,
  leerOrdenEtapas,
  leerResumenCatalogo,
  type ResumenCatalogo,
} from './avisos.service';

export interface VentanaEnvio {
  /** ISO. La decide el llamador: este servicio no tiene calendario. */
  desde: string;
  hasta: string;
  /** Cadena OPACA del llamador. No se construye ni se interpreta aquí. */
  clave_intento: string;
}

export interface EnviosPreparados {
  correos: CorreoArmado[];
  /** Perfiles que ya tenían esta clave confirmada. Se reportan para que el registro no mienta por omisión. */
  yaEnviados: string[];
  pulso: Pulso;
  ventana: VentanaEnvio;
  // ----------------------------------------------------------
  // [CORREO·C-5] Lo que la plantilla necesita y `Pulso` no debe cargar.
  //
  // Van aquí y no dentro de `Pulso` a propósito: `Pulso` es el DELTA de la
  // ventana y esto es el ESTADO de ahora. Mezclarlos bajo un tipo sería el
  // mismo defecto que el correo acaba de arreglar en su cara visible.
  // ----------------------------------------------------------
  /** Estado del catálogo AHORA. `null` si no hay snapshot vigente. */
  catalogo: ResumenCatalogo | null;
  /** `nombre de etapa → orden`: lo único que distingue un avance de una vuelta atrás. */
  ordenDeEtapa: Map<string, number>;
  /** `disponible`/`reservado` de hoy por SKU, para la cifra del renglón. */
  cifras: Map<string, { disponible: number; reservado: number }>;
  /** Proyectos y partidas por perfil. Vacío si nadie tiene. */
  proyectosPorPerfil: Map<string, { proyectos: number; partidas: number }>;
}

interface SeguimientoFila extends SeguimientoLectura {
  av_correo: boolean;
}

/**
 * [CORREO·C-5] Proyectos y partidas por perfil.
 *
 * ⚠ **Se cuenta por `propietario`, que es la CUENTA QUE LO CREÓ, no un KAM
 * asignado.** Medido sobre datos reales: los proyectos eran de admin o sin dueño,
 * y **ninguno de un perfil con rol `kam`**. Así que esta cifra le
 * salía a los admin y a nadie más.
 *
 * ⚠ Y **`proyectos` no tiene columna de estado**: «proyectos activos» no existe
 * como concepto en la base. Por eso el correo dice «proyectos», a secas. Poner
 * «activos» sobre un conteo que incluye todo sería afirmar de más.
 */
async function leerProyectosPorPerfil(
  db: SupabaseClient,
): Promise<Map<string, { proyectos: number; partidas: number }>> {
  const [{ data: proys, error: errP }, { data: parts, error: errPa }] = await Promise.all([
    db.from('proyectos').select('id,propietario'),
    db.from('proyecto_partidas').select('proyecto_id'),
  ]);
  if (errP) throw new Error('proyectos: ' + errP.message);
  if (errPa) throw new Error('proyecto_partidas: ' + errPa.message);

  const duenoDe = new Map<string, string>();
  const salida = new Map<string, { proyectos: number; partidas: number }>();
  for (const p of (proys ?? []) as { id: string; propietario: string | null }[]) {
    if (!p.propietario) continue;
    duenoDe.set(p.id, p.propietario);
    const actual = salida.get(p.propietario) ?? { proyectos: 0, partidas: 0 };
    actual.proyectos++;
    salida.set(p.propietario, actual);
  }
  for (const pa of (parts ?? []) as { proyecto_id: string }[]) {
    const dueno = duenoDe.get(pa.proyecto_id);
    if (!dueno) continue;
    const actual = salida.get(dueno);
    if (actual) actual.partidas++;
  }
  return salida;
}

/**
 * Arma los correos de una ventana y registra el intento.
 *
 * `db` TIENE que ser el cliente de servicio: `seguimientos` y `perfiles` están
 * bajo RLS de dueño, y `envios_aviso` no tiene ninguna policy. Con un cliente
 * de sesión esto devolvería, en silencio, los datos de una sola persona — que
 * es justo el modo de falla que hace falta no tener.
 */
export async function prepararEnvios(
  db: SupabaseClient,
  ventana: VentanaEnvio,
  opciones: {
    /**
     * `false` arma los correos SIN registrar el intento. Existe para UNA cosa:
     * generar una muestra sin ensuciar `envios_aviso`.
     *
     * Una fila `preparado` de mentira no es inocua — el reintento de una clave
     * real la encontraría y creería que ya se armó. Y la alternativa —que el
     * generador de la muestra rehiciera las lecturas por su cuenta— sería una
     * segunda implementación de lo mismo, que es el defecto que este bloque
     * entero existe para no cometer.
     *
     * El default es `true`: quien no diga nada, registra.
     */
    registrar?: boolean;
    /**
     * [C-11] ACOTA LOS DESTINATARIOS A ESTOS PERFILES. Ausente ⇒ no acota, que
     * es el comportamiento de producción y el único que debe existir allí.
     *
     * Existe para **las corridas de verificación**: aquella en la que n8n ejecuta el workflow
     * real contra el portal local. Medido, esa corrida mandaría **varios
     * correos, algunos a compañeros que no son el perfil de prueba** — todos los
     * perfiles heredan el boletín encendido porque
     * `preferencias_notificacion` está vacía, y la ventana trae cambios.
     *
     * **La alternativa que se descartó, y por qué:** apagar el boletín a esas
     * personas en la base. Es reversible, pero si la restauración falla quedan
     * **dadas de baja en silencio** — y el modo de fallo silencioso es justo el
     * que este proyecto persigue. Esto no toca ningún dato de nadie.
     *
     * **Dónde deja de ser un olvido posible:** el parámetro viaja en el nodo
     * «Ventana» del workflow de las corridas de verificación, así que omitirlo exige **editar el
     * workflow**, no simplemente no acordarse. En el de producción no está.
     */
    soloPerfiles?: readonly string[];
  } = {},
): Promise<EnviosPreparados> {
  // ---------- (1) Quién sigue qué, y quién recibe ----------
  const [seguimientosRes, perfilesRes, prefsRes, yaRes] = await Promise.all([
    db.from('seguimientos').select('perfil_id,sku,av_estatus,av_disponible,av_reservado,av_llegada,av_correo'),
    db.from('perfiles').select('id,email'),
    db.from('preferencias_notificacion').select('perfil_id,boletin_correo'),
    db.from('envios_aviso').select('perfil_id,estado').eq('clave_intento', ventana.clave_intento),
  ]);

  if (seguimientosRes.error) throw new Error('seguimientos: ' + seguimientosRes.error.message);
  if (perfilesRes.error) throw new Error('perfiles: ' + perfilesRes.error.message);
  if (prefsRes.error) throw new Error('preferencias_notificacion: ' + prefsRes.error.message);
  if (yaRes.error) throw new Error('envios_aviso: ' + yaRes.error.message);

  const seguimientos = (seguimientosRes.data ?? []) as SeguimientoFila[];
  const perfiles = (perfilesRes.data ?? []) as { id: string; email: string }[];
  const prefs = (prefsRes.data ?? []) as { perfil_id: string; boletin_correo: boolean }[];
  const intentos = (yaRes.data ?? []) as { perfil_id: string; estado: string }[];

  const yaEnviados = intentos.filter((i) => i.estado === 'enviado').map((i) => i.perfil_id);
  const confirmados = new Set(yaEnviados);

  // La fila de preferencias nace perezosa (0026): quien no la tenga hereda el
  // DEFAULT de la tabla, que es el boletín ENCENDIDO.
  const boletinDe = new Map(prefs.map((p) => [p.perfil_id, p.boletin_correo]));

  // El acotamiento va AQUÍ y no más abajo: corta antes de que se arme un solo
  // correo, así que un perfil excluido no llega ni a existir como candidato.
  // La decisión es `acotarAPerfiles`, pura y con gate propio.
  const destinatarios: DestinatarioPosible[] = acotarAPerfiles(perfiles, opciones.soloPerfiles)
    .filter((p) => !confirmados.has(p.id))
    .map((p) => ({ perfil_id: p.id, correo: p.email, boletin_correo: boletinDe.get(p.id) ?? true }));

  // ---------- (2) Los avisos de la ventana, por `derivarAvisos` ----------
  const skus = Array.from(new Set(seguimientos.map((s) => s.sku)));
  const [cambiosMios, cambiosGlobales, enCamino, ordenDeEtapa, catalogo, proyectosPorPerfil] = await Promise.all([
    leerCambios(db, ventana.desde, skus, ventana.hasta),
    leerCambios(db, ventana.desde, null, ventana.hasta),
    leerEnCamino(db),
    leerOrdenEtapas(db),
    leerResumenCatalogo(db),
    leerProyectosPorPerfil(db),
  ]);

  // Candidatos a «llegada» para el pulso: solo los SKU con movimiento de stock
  // en la ventana, más los seguidos. Derivar el catálogo entero sería pagar cientos de
  // SKU por contar unas pocas llegadas.
  const candidatos = new Set<string>(skus);
  for (const c of cambiosGlobales) if (c.entidad === 'stock' && c.sku) candidatos.add(c.sku);
  const cifras = await leerCifras(db, Array.from(candidatos));

  const avisos = derivarAvisos(seguimientos, cambiosMios, cifras);
  const pulso = derivarPulso(cambiosGlobales, enCamino, cifras);
  const pulsoTieneAlgo = pulso.movimientos.length > 0 || pulso.llegadas.length > 0;

  const paraCorreo: SeguimientoCorreo[] = seguimientos.map((s) => ({
    perfil_id: s.perfil_id,
    sku: s.sku,
    av_correo: s.av_correo,
  }));

  const correos = armarCorreos(destinatarios, paraCorreo, avisos, pulsoTieneAlgo);

  // ---------- (3) El registro del intento ----------
  // `ignoreDuplicates` es lo que hace idempotente el PREPARAR: si la fila ya
  // existe —porque es un reintento— no se pisa, y en particular no se degrada
  // un 'enviado' de vuelta a 'preparado'.
  if (correos.length > 0 && opciones.registrar !== false) {
    const { error } = await db.from('envios_aviso').upsert(
      correos.map((c) => ({
        perfil_id: c.perfil_id,
        clave_intento: ventana.clave_intento,
        desde: ventana.desde,
        hasta: ventana.hasta,
        estado: 'preparado',
        avisos: c.avisos.length,
      })),
      { onConflict: 'perfil_id,clave_intento', ignoreDuplicates: true },
    );
    if (error) throw new Error('envios_aviso: ' + error.message);
  }

  return { correos, yaEnviados, pulso, ventana, catalogo, ordenDeEtapa, cifras, proyectosPorPerfil };
}

/**
 * Marca un envío como entregado. **Es lo único que mueve la aguja**: mientras
 * no se confirme, la ventana sigue considerándose no enviada y un intento
 * posterior la vuelve a entregar.
 *
 * Devuelve `false` si no había nada que confirmar — no es un error: puede ser
 * una confirmación repetida, que tiene que dar el mismo resultado que una sola.
 */
export async function confirmarEnvio(
  db: SupabaseClient,
  perfilId: string,
  claveIntento: string,
  ahora: Date,
): Promise<boolean> {
  const { data, error } = await db
    .from('envios_aviso')
    .update({ estado: 'enviado', confirmado_en: ahora.toISOString() })
    .eq('perfil_id', perfilId)
    .eq('clave_intento', claveIntento)
    // Confirmar dos veces tiene que dar el mismo resultado que confirmar una:
    // sin este filtro, la segunda pisaría `confirmado_en` y el registro diría
    // una hora de entrega que no fue.
    .eq('estado', 'preparado')
    .select('perfil_id')
    .maybeSingle();

  if (error) throw new Error('envios_aviso: ' + error.message);
  return data !== null;
}

/**
 * Hasta dónde se le ha enviado a cada perfil. **No es una columna**: es
 * `max(hasta)` de lo confirmado. Una verdad consultada no se puede
 * desincronizar de sí misma.
 *
 * No la consume el envío —la ventana la decide el llamador— sino el registro y
 * el diagnóstico: «¿desde cuándo no le llega nada a esta persona?».
 */
export async function enviadoHasta(db: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('envios_aviso')
    .select('perfil_id,hasta')
    .eq('estado', 'enviado')
    .order('hasta', { ascending: false });

  if (error) throw new Error('envios_aviso: ' + error.message);

  const salida = new Map<string, string>();
  for (const fila of (data ?? []) as { perfil_id: string; hasta: string }[]) {
    if (!salida.has(fila.perfil_id)) salida.set(fila.perfil_id, fila.hasta);
  }
  return salida;
}
