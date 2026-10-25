// ============================================================
// [INV-B9.1] n8n/workflows.test.ts — la guarda de los workflows exportados.
//
// POR QUÉ ESTO ES UN TEST Y NO UN PÁRRAFO EN EL README. Porque un párrafo se
// cumple mientras alguien se acuerde, y lo que hay que impedir es que un export
// hecho con prisa —el día que el workflow por fin funcione— traiga la llave
// dentro. Un workflow exportado es un archivo de texto que acaba en el repo, en
// un backup y en la pantalla de quien lo abra.
//
// NO ES HIPOTÉTICO. Es un descuido frecuente: un workflow exportado con la API
// key **literal** en los `headerParameters` de un nodo de envío, en vez de en
// una credencial. Por eso esta guarda existe y corre en cada `npm test`.
//
// LO QUE ESTA GUARDA NO ES: análisis semántico. Reconoce cadenas que PARECEN
// secretos por su forma. Un secreto corto, o partido en dos, se le escapa. No
// sustituye a revisar el export — cierra el caso común.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'n8n');
const archivos = readdirSync(DIR).filter((f) => f.endsWith('.json'));

/**
 * Versiones MEDIDAS leyendo workflows que ya corrían en una instancia de n8n.
 * Un `typeVersion` más alto del que soporta la instancia hace fallar la
 * importación entera, así que no se inventan.
 *
 * Las que NO están medidas van declaradas aquí abajo, no escondidas.
 */
const VERSIONES_MEDIDAS: Record<string, number> = {
  'n8n-nodes-base.webhook': 2.1,
  'n8n-nodes-base.set': 3.4,
  'n8n-nodes-base.code': 2,
  'n8n-nodes-base.googleSheets': 4.5,
  'n8n-nodes-base.gmail': 2.1,
  'n8n-nodes-base.respondToWebhook': 1.1,
  'n8n-nodes-base.httpRequest': 4.2,
  'n8n-nodes-base.if': 2.2,
  'n8n-nodes-base.wait': 1.1,
};

/**
 * Nodos que ESTE repo usa y que ningún workflow medido usaba, así que
 * su `typeVersion` es una suposición razonable, no una medición. Van listados
 * para que la primera importación las verifique — si n8n las rechaza, el número
 * está aquí y se corrige en un sitio.
 */
const VERSIONES_NO_MEDIDAS: Record<string, number> = {
  'n8n-nodes-base.scheduleTrigger': 1.2,
  'n8n-nodes-base.splitOut': 1,
  // [CORREO·C-1] `noOp` no lo usaba ningún workflow de la instancia. Es el nodo
  // más antiguo y estable del catálogo, así que `1` es una suposición de riesgo
  // bajo — pero va declarada aquí y no colada, que es la regla de este archivo.
  'n8n-nodes-base.noOp': 1,
  // [CORREO·C-6] `emailSend` sustituye a `gmail` en el boletín: el nodo de Gmail
  // NO PUEDE ENVIAR DESDE UN ALIAS, y el remitente tiene que ser
  // `notificaciones@example.com` con DKIM propio.
  //
  // ⚠ 2.1 es SUPOSICIÓN, no medición, y aquí es donde se declara: no se pudo
  // leer la versión real de ninguna instancia. Si n8n lo rechaza al importar,
  // el número está en este único sitio.
  'n8n-nodes-base.emailSend': 2.1,
};

/**
 * [CORREO·C-1] Los modos de `onError` de n8n, y por qué UNO de ellos está
 * prohibido en este repo.
 *
 * `continueRegularOutput` saca el ítem **fallido** por la salida **PRINCIPAL**.
 * El nodo siguiente lo recibe igual que uno que salió bien: el fallo se vuelve
 * INDISTINGUIBLE del éxito, y esa indistinguibilidad es justo la forma de falla
 * que INV-B9.1 existe para no repetir.
 *
 * `continueErrorOutput` parte la salida en dos —main[0] éxito, main[1] error—
 * así que el fallo tiene a dónde ir sin contaminar el camino bueno.
 */
const ONERROR_PROHIBIDO = 'continueRegularOutput';

/** Mismo detector de pares clave/valor que usan las pruebas de abajo, para los parámetros de un nodo. */
const PAR_SOSPECHOSO_PARAMS =
  /"(value|apikey|api_key|token|secret|password|authorization|bearer)"\s*:\s*"[A-Za-z0-9_/+=.-]{16,}"/gi;

describe('[INV-B9.1] los workflows exportados', () => {
  it('hay al menos uno: si no, todo lo de abajo pasaría por vacuidad (P17)', () => {
    expect(archivos.length).toBeGreaterThan(0);
  });

  for (const archivo of archivos) {
    const crudo = readFileSync(join(DIR, archivo), 'utf8');
    const wf = JSON.parse(crudo) as {
      name: string;
      active?: boolean;
      nodes: { type: string; typeVersion: number; name: string; onError?: string; credentials?: Record<string, unknown> }[];
      connections?: Record<string, { main?: { node: string; type: string; index: number }[][] }>;
    };

    describe(archivo, () => {
      it('es JSON válido y trae nodos', () => {
        expect(Array.isArray(wf.nodes)).toBe(true);
        expect(wf.nodes.length).toBeGreaterThan(0);
      });

      // ============================================================
      // NINGÚN SECRETO, NUNCA. La forma que se busca es la del hallazgo real:
      // un par clave/valor donde la clave suena a credencial y el valor es una
      // cadena larga sin espacios.
      // ============================================================
      it('no lleva ningún valor que parezca un secreto', () => {
        const sospechoso =
          /"(value|apikey|api_key|token|secret|password|authorization|bearer)"\s*:\s*"[A-Za-z0-9_/+=.-]{16,}"/gi;
        const hallazgos = crudo.match(sospechoso) ?? [];
        // El mensaje NO imprime el valor: si esto se rompe en un CI, el log del
        // CI no puede ser el sitio donde la llave se publique.
        expect(
          hallazgos.map((h) => h.split(':')[0]),
          'hay pares clave/valor con forma de secreto; revisa el export',
        ).toEqual([]);
      });

      it('no lleva una URL de Supabase ni una llave `eyJ...` (JWT)', () => {
        expect(crudo).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
        expect(crudo).not.toMatch(/\.supabase\.(co|in)\b/);
      });

      // ============================================================
      // Las credenciales NO viajan en el export: se asignan al importar. Un nodo
      // que autentica con `genericCredentialType` y lleva la llave en sus
      // parámetros es el defecto que esta guarda existe para impedir.
      // ============================================================
      // [CORREO·C-1] Esta prueba TENÍA UNA CLÁUSULA MUERTA, y se quita.
      //
      // El filtro recogía `n8n-nodes-base.gmail`, pero la aserción de adentro
      // sólo corría `if (JSON.stringify(n).includes('genericCredentialType'))`
      // — y un nodo Gmail NUNCA incluye esa cadena: usa su propio tipo de
      // credencial. O sea que Gmail entraba al conjunto y salía sin que se le
      // mirara nada. Un filtro que recoge lo que después no comprueba **cuenta
      // cobertura que no existe**: el conjunto se ve más grande de lo que la
      // aserción alcanza.
      //
      // Se reescribe con la frontera dicha: se exige `credentials` a quien
      // declara `genericCredentialType`, y se dice POR ESCRITO por qué Gmail
      // queda fuera y qué lo cubre en su lugar.
      it('ningún nodo lleva un bloque `credentials`: se asignan al importar', () => {
        const conBloque = wf.nodes.filter((n) => n.credentials !== undefined).map((n) => n.name);
        expect(conBloque, 'el export no debe traer ids ni nombres de credenciales de una instancia').toEqual([]);
      });

      it('todo nodo con `genericCredentialType` declara su tipo de autenticación y no lleva la llave en sus parámetros', () => {
        const declaranGenerica = wf.nodes.filter((n) => JSON.stringify(n).includes('genericCredentialType'));
        for (const n of declaranGenerica) {
          const cadena = JSON.stringify((n as { parameters?: unknown }).parameters ?? {});
          expect(cadena, `${n.name} no declara su tipo de autenticación genérica`).toContain('httpHeaderAuth');
          expect(cadena.match(PAR_SOSPECHOSO_PARAMS) ?? [], `${n.name} lleva un valor con forma de secreto`).toEqual([]);
        }
      });

      // La otra mitad de la frontera, explícita en vez de implícita: a un nodo
      // de correo NO se le puede exigir el bloque `credentials` —se resuelve al
      // importar y el export legítimamente puede venir sin él—, así que lo que
      // se le exige es lo único que sí importa: que no traiga la llave escrita.
      //
      // [CORREO·C-6] SE GENERALIZA, Y POR UN MOTIVO MEDIDO. En C-1 esta prueba
      // decía `n8n-nodes-base.gmail` y llevaba un `if (length === 0) return`.
      // Al cambiar el boletín a `emailSend` ese `return` se activó y la prueba
      // pasó a **no mirar nada**: verde sobre un archivo que ya no tiene el nodo
      // que decía vigilar. Una guarda atada a UN tipo concreto caduca el día que
      // el tipo cambia, **y caduca en verde** — que es la peor forma.
      //
      // Ahora mira TODO nodo que mande correo, sea cual sea el proveedor.
      const TIPOS_QUE_MANDAN_CORREO = ['n8n-nodes-base.gmail', 'n8n-nodes-base.emailSend'];

      // ============================================================
      // [CORREO·C-6] Y SE CORRIGE EL DETECTOR, que era MÍO y era PEOR que el
      // que ya vivía diez líneas más arriba.
      //
      // En C-1 escribí `not.toMatch(/[A-Za-z0-9_-]{32,}/)` — «32 caracteres
      // seguidos sin espacios». Esa es la forma de **cualquier prosa en
      // kebab-case**: mordió sobre `REMITENTE-SIN-ALINEAMIENTO-DMARC`, el
      // nombre de una deuda escrito en las notas del nodo, que mide exactamente
      // 32. Un falso positivo que obliga a renombrar una deuda para que un gate
      // se calle es un gate que enseña a desactivarlo.
      //
      // El detector de INV-B9.1 (`no lleva ningún valor que parezca un
      // secreto`) ya tenía la forma correcta: **par clave/valor** — una clave
      // que suena a credencial JUNTO A un valor largo. Se reusa esa forma en vez
      // de escribir una tercera. El mensaje no imprime el valor.
      // ============================================================
      const PAR_SOSPECHOSO =
        /"(value|apikey|api_key|token|secret|password|authorization|bearer)"\s*:\s*"[A-Za-z0-9_/+=.-]{16,}"/gi;

      it('el nodo que manda correo no lleva ningún valor con forma de secreto', () => {
        const correo = wf.nodes.filter((n) => TIPOS_QUE_MANDAN_CORREO.includes(n.type));
        if (correo.length === 0) return; // este archivo no manda correo: nada que decir
        for (const n of correo) {
          const hallazgos = JSON.stringify(n).match(PAR_SOSPECHOSO) ?? [];
          expect(hallazgos.map((h) => h.split(':')[0]), `${n.name}`).toEqual([]);
        }
      });

      // ============================================================
      // [CORREO·C-6] LA CREDENCIAL SE ASIGNA AL IMPORTAR: EL EXPORT NO LLEVA NINGUNA.
      //
      // Un id real de credencial en el repo ata este archivo a UNA instancia
      // concreta y se rompe en silencio al importarlo en otra; un nombre de
      // credencial delata qué proveedor se usa. El nodo de envío no debe traer
      // bloque `credentials` de ningún tipo.
      // ============================================================
      it('el nodo que manda correo no lleva bloque `credentials`: se asigna al importar', () => {
        const correo = wf.nodes.filter((n) => TIPOS_QUE_MANDAN_CORREO.includes(n.type));
        if (correo.length === 0) return;
        for (const n of correo) {
          expect(n.credentials, `${n.name}: el export no debe traer credenciales`).toBeUndefined();
        }
      });

      it('los `typeVersion` son los MEDIDOS en esta instancia', () => {
        for (const n of wf.nodes) {
          const medida = VERSIONES_MEDIDAS[n.type];
          if (medida === undefined) continue;
          expect(n.typeVersion, `${n.name} (${n.type})`).toBe(medida);
        }
      });

      it('los nodos con versión NO medida están declarados, no colados', () => {
        const sinRespaldo = wf.nodes.filter(
          (n) => VERSIONES_MEDIDAS[n.type] === undefined && VERSIONES_NO_MEDIDAS[n.type] === undefined,
        );
        expect(
          sinRespaldo.map((n) => `${n.name} (${n.type})`),
          'nodo cuyo typeVersion no está medido ni declarado como suposición',
        ).toEqual([]);
      });

      // ============================================================
      // Un workflow que llega ACTIVO se pone a correr en cuanto se importa. El
      // primer envío tiene que ser a mano y confirmado a mano — lo pide el
      // runbook, porque la alarma del canal callado no vigila un canal que
      // nunca ha enviado nada.
      // ============================================================
      it('llega DESACTIVADO: el primer envío es a mano', () => {
        expect(wf.active ?? false).toBe(false);
      });

      it('se llama `Demo - ...`: es lo único que lo separa de los otros de la instancia', () => {
        expect(wf.name).toMatch(/^Demo - /);
      });

      // ============================================================
      // [CORREO·C-1] UN ENVÍO FALLIDO NO PUEDE CONFIRMARSE.
      //
      // Esto no es higiene: es el arreglo de un defecto MEDIDO. El nodo «Enviar el correo»
      // llevaba `onError: continueRegularOutput` y su salida principal iba
      // derecho a «Confirmar que salio». Un envío reventado quedaba
      // `estado='enviado'` con su `confirmado_en`, sin reintento — y con eso
      // CALLABA la alarma del canal 14 días (`canalDeCorreoCallado`,
      // `src/lib/correo.ts`). La nota del propio nodo afirmaba lo contrario.
      //
      // Es la falla que INV-B9.1 existe para no repetir, dentro del arreglo de
      // INV-B9.1. Por eso la guarda vive en el gate y no en un párrafo.
      // ============================================================
      it('ningún nodo sigue por la salida PRINCIPAL cuando falla', () => {
        const culpables = wf.nodes
          .filter((n) => n.onError === ONERROR_PROHIBIDO)
          .map((n) => `${n.name} (${n.type})`);
        expect(
          culpables,
          'con `continueRegularOutput` el ítem FALLIDO sale por main[0] y el nodo siguiente lo trata como éxito',
        ).toEqual([]);
      });

      // ============================================================
      // Lo anterior prohíbe el modo; esto comprueba el CABLEADO. Son dos cosas
      // distintas: se puede declarar `continueErrorOutput` y aun así llevar la
      // salida de error al mismo sitio que la de éxito, que deshace el arreglo
      // sin tocar el campo que la otra prueba mira.
      // ============================================================
      it('la salida de ERROR nunca desemboca donde la de ÉXITO', () => {
        for (const n of wf.nodes) {
          if (n.onError !== 'continueErrorOutput') continue;
          const salidas = wf.connections?.[n.name]?.main ?? [];
          expect(salidas.length, `${n.name}: declara continueErrorOutput y no tiene salida de error cableada`).toBeGreaterThanOrEqual(2);
          const exito = new Set((salidas[0] ?? []).map((c) => c.node));
          const error = (salidas[1] ?? []).map((c) => c.node);
          const solapan = error.filter((d) => exito.has(d));
          expect(solapan, `${n.name}: su salida de ERROR llega a un nodo del camino de ÉXITO`).toEqual([]);
        }
      });
    });
  }

  // ============================================================
  // [CORREO·C-1] CONTROL ANTI-VACUIDAD DE LAS DOS PRUEBAS DE ARRIBA (P17).
  //
  // `toEqual([])` sobre un filtro vacío pasa igual de verde cuando NINGÚN nodo
  // declara `onError`. Este control va a nivel de CORPUS y no por archivo,
  // porque un workflow sin nodos que puedan fallar es legítimo — lo que no es
  // legítimo es que el corpus ENTERO no ejercite nunca la aserción.
  // ============================================================
  // ============================================================
  // [CORREO·C-6] CONTROL ANTI-VACUIDAD DE LA PRUEBA DEL NODO DE CORREO.
  //
  // Esa prueba lleva `if (correo.length === 0) return`, que es correcto por
  // archivo —no todo workflow manda correo— y **vacuo por corpus**: si ningún
  // archivo tuviera un nodo de envío, la prueba pasaría sin mirar nada. Es
  // exactamente lo que ocurrió al cambiar `gmail` por `emailSend`, con la
  // versión anterior atada a un solo tipo.
  // ============================================================
  it('al menos un nodo del corpus manda correo: si no, su prueba sería vacua', () => {
    const TIPOS = ['n8n-nodes-base.gmail', 'n8n-nodes-base.emailSend'];
    const manda = archivos.flatMap((archivo) => {
      const wf = JSON.parse(readFileSync(join(DIR, archivo), 'utf8')) as { nodes: { name: string; type: string }[] };
      return wf.nodes.filter((n) => TIPOS.includes(n.type)).map((n) => `${archivo}:${n.name} (${n.type})`);
    });
    expect(manda.length).toBeGreaterThan(0);
  });

  // ============================================================
  // [C-11] `solo_perfiles` ES EL UNICO FRENO ENTRE UN ENSAYO Y LOS
  // DESTINATARIOS REALES.
  //
  // Sin acotar, una corrida manda un correo a cada perfil con avisos. El campo
  // viaja en el `jsonBody` del nodo HTTP, pero lo DEFINE el nodo «Ventana», y
  // solo en una corrida de ensayo — con la clave ausente, `JSON.stringify` la
  // omite y el cuerpo sale identico al de produccion.
  //
  // Las dos aserciones son las dos mitades de eso, y hacen falta las dos:
  // que el canal exista, y que el archivo de PRODUCCION no lo active.
  // ============================================================
  // ============================================================
  // [C-17] LAS DOS COSAS QUE EL BUZON CONTESTO, FIJADAS EN EL REPO.
  //
  // C-1 dejo escrito que no estaba medido «si ese nodo, con options: {}, añade
  // la firma "Sent automatically with n8n"», y que NADA en este archivo lo
  // fijaba. Un correo real contesto que SI: en ingles, debajo del pie firmado
  // y fuera del copy de la plantilla.
  //
  // El default del nodo es `true` — leido del esquema, no supuesto — asi que
  // **la ausencia de la clave es la firma encendida**. Por eso la asercion exige
  // el `false` explicito y no «que no diga true».
  //
  // ⚠ Y se afirma sobre el JSON DEL REPO a proposito: que una instancia viva lo
  // tenga no lo prueba, porque la instancia no esta versionada.
  // ============================================================
  it('la firma de n8n va APAGADA, y explicitamente: el default del nodo es encenderla', () => {
    const wf = JSON.parse(readFileSync(join(DIR, 'boletin-semanal.json'), 'utf8')) as {
      nodes: { type: string; parameters?: { options?: Record<string, unknown> } }[];
    };
    const envio = wf.nodes.find((n) => n.type === 'n8n-nodes-base.emailSend');
    expect(envio).toBeDefined();
    expect(envio!.parameters?.options?.appendAttribution).toBe(false);
  });

  // [C-17] El reloj del trigger. `scheduleTrigger` no declara huso, asi que
  // hereda el del workflow — y si el workflow tampoco lo declara, el de la
  // INSTANCIA, que puede ser otro (p. ej. America/New_York). «Lunes 08:00»
  // serian entonces las 06:00 en Ciudad de Mexico, y ademas DERIVARIA con el
  // horario de verano de la zona de la instancia, que Mexico ya no tiene.
  it('el workflow declara su huso: sin esto, «Lunes 08:00» es el reloj de la instancia', () => {
    const wf = JSON.parse(readFileSync(join(DIR, 'boletin-semanal.json'), 'utf8')) as {
      settings?: { timezone?: string };
    };
    expect(wf.settings?.timezone).toBe('America/Mexico_City');
  });

  it('el boletin PASA `solo_perfiles` en su cuerpo: sin eso, no se puede acotar', () => {
    const wf = JSON.parse(readFileSync(join(DIR, 'boletin-semanal.json'), 'utf8')) as {
      nodes: { name: string; parameters?: Record<string, unknown> }[];
    };
    const http = wf.nodes.find((n) => n.name === 'Pedir los envios al portal');
    expect(http).toBeDefined();
    expect(String(http!.parameters?.jsonBody)).toContain('solo_perfiles: $json.solo_perfiles');
  });

  it('pero el archivo de PRODUCCION no lo define: acotar es un acto manual, no el default', () => {
    const wf = JSON.parse(readFileSync(join(DIR, 'boletin-semanal.json'), 'utf8')) as {
      nodes: { name: string; parameters?: Record<string, unknown> }[];
    };
    const ventana = wf.nodes.find((n) => n.name === 'Ventana');
    expect(ventana).toBeDefined();
    expect(JSON.stringify(ventana!.parameters)).not.toContain('solo_perfiles');
  });

  it('al menos un nodo del corpus declara `onError`: si no, las dos pruebas de arriba serían vacuas', () => {
    const conOnError = archivos.flatMap((archivo) => {
      const wf = JSON.parse(readFileSync(join(DIR, archivo), 'utf8')) as {
        nodes: { name: string; onError?: string }[];
      };
      return wf.nodes.filter((n) => typeof n.onError === 'string').map((n) => `${archivo}:${n.name}`);
    });
    expect(conOnError.length).toBeGreaterThan(0);
  });
});
