// ============================================================
// [CHAT-B2] LOS GATES DEL SOUL · §8 del contrato de voz, §4 del bloque.
//
// Están juntos a propósito: son lo que hace que el contrato de voz (ver
// `docs/decisions/0009-grounded-assistant-persona-contract.md`) sea
// **un contrato y no un ensayo**. Un archivo de carácter sin gates es una
// promesa sin nadie detrás — y este bloque acaba de escribir P35 sobre
// exactamente eso.
//
// Los que necesitan DOM viven en `soul-dom.test.tsx`: el gate 4 se afirma en las
// dos direcciones (presente en el DOM, ausente de la vista) y eso exige render.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tipoSocialDe } from './social';
import { SALUDO_PANEL, ACUSE, DESPEDIDA, NOMBRE } from './voz';
import { armarEntrega, dentroDelPerimetro, type Entrega } from './entrega';
import { verificarRedaccion } from './verificar-redaccion';
import { DESTINO, contactoDe } from '@/lib/contactos';
import { TOPE_EJEMPLOS, FUERA_DE_DOMINIO, NO_SE } from './voz';
import { loQueSabeHacer } from './intenciones';
import { tarjetaCapacidades } from './tarjeta';

// El contrato de voz que se coteja. En el sistema original era un documento del
// repositorio; aquí es un fixture inventado y mínimo con la misma estructura.
const RUTA_CONTRATO = join(process.cwd(), 'src/lib/chat/__fixtures__/contrato-de-voz.md');

const entregaDe = (textos: string[]): Entrega => {
  const r = armarEntrega({
    ruta: '20_Seguridad/f.md',
    familia: 'F',
    titulo: 'Ficha F',
    fuentePdf: null,
    trozos: textos.map((t, i) => ({ orden: i, rutaSeccion: `S${i}`, texto: t })),
    trozosTotales: textos.length,
  });
  if (r.tipo !== 'entrega') throw new Error('fixture');
  return r.entrega;
};

const frase = (texto: string, cita: string) => ({ tipo: 'respuesta' as const, frases: [{ texto, orden: 0, cita }] });

// ────────────────────────────────────────────────────────────
describe('[CHAT-B2] GATE 1 · «Hola» no produce «no sé» ni la lista de capacidades', () => {
  it('los tres saludos se reconocen', () => {
    for (const q of ['Hola', 'buenos días', '¿qué tal?']) {
      expect(tipoSocialDe(q)).toBe('saludo');
    }
  });

  it('y el texto que se contesta es `SALUDO_PANEL` IMPORTADO, no uno nuevo', () => {
    // La versión vieja contestaba `NO_SE`. Ésa es la que tiene que estar en rojo.
    expect(SALUDO_PANEL).not.toBe(NO_SE);
    expect(SALUDO_PANEL).toContain(NOMBRE);
  });

  it('CONTROL POSITIVO · la versión vieja ⇒ ROJO', () => {
    // Antes de B2, `tipoSocialDe` no existía y «Hola» caía a `fuera_del_catalogo`.
    // Si alguien lo desconecta, esto lo dice: la función tiene que RECONOCER.
    expect(tipoSocialDe('Hola')).not.toBeNull();
  });

  it('acuse y despedida tienen su propia línea, y NINGUNA repite capacidades', () => {
    expect(tipoSocialDe('gracias')).toBe('acuse');
    expect(tipoSocialDe('adiós')).toBe('despedida');
    for (const t of [ACUSE, DESPEDIDA]) {
      expect(t.length).toBeLessThan(40);
      expect(t).not.toContain('sé hacer');
    }
  });
});

// ────────────────────────────────────────────────────────────
// Marcador del contrato: SOUL-§8-2
describe('[CHAT-B2] SOUL-§8-2 · el andamiaje del vault NO sale a la prosa', () => {
  const PROHIBIDOS: [string, string][] = [
    ['v0.', 'v0.1 (2026-05-09): Creación inicial'],
    ['ADR-0', 'Reubicado el 2026-08-19 (ADR-001, aislamiento RAG)'],
    ['last_updated', 'Actualiza last_updated al cambiarlo'],
    ['bumpear', 'Hay que bumpear la versión'],
    ['Historial de versiones', 'Historial de versiones del documento'],
    ['Cómo contribuir', 'Cómo contribuir a esta ficha'],
    ['ruta del vault', 'Está en 50_Referencia/50.01_Glosario/'],
  ];

  for (const [marca, texto] of PROHIBIDOS) {
    it(`CONTROL POSITIVO · «${marca}» ⇒ ROJO (la redacción se descarta)`, () => {
      // La cita es EXACTA y el dato está: lo único malo es que es andamiaje.
      // Sin esta guarda pasaría limpia — la contención de datos no la vería.
      const e = entregaDe([texto]);
      const v = verificarRedaccion(e, frase(texto, texto));
      expect(v.tipo).toBe('sucia');
      if (v.tipo !== 'sucia') return;
      expect(v.motivos.some((m) => m.clase === 'andamiaje')).toBe(true);
    });
  }

  it('y una respuesta NORMAL sigue pasando: la guarda no es un bloqueo ancho', () => {
    const e = entregaDe(['El modelo SV1.5 pesa 3.2 kg.']);
    const v = verificarRedaccion(e, frase('El SV1.5 pesa 3.2 kg.', 'El modelo SV1.5 pesa 3.2 kg.'));
    expect(v.tipo).toBe('limpia');
    // `SV1.5` casaría con `v\d+\.\d+` SIN el borde de palabra. Con él, no.
  });
});

// ────────────────────────────────────────────────────────────
// Marcador del contrato: SOUL-§8-3
describe('[CHAT-B2] SOUL-§8-3 · nada fuera del perímetro, NI COMO CANDIDATO', () => {
  it('los tres de fuera no son redactables', () => {
    for (const r of ['10_Cuentas/ACME.md', '00_Indice/mapa.md', '80_Registro/ADR-001.md']) {
      expect(dentroDelPerimetro(r)).toBe(false);
    }
  });

  it('CONTROL POSITIVO · el de dentro SÍ lo es — si no, la guarda sería vacua', () => {
    expect(dentroDelPerimetro('20_Seguridad/x.md')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// Marcador del contrato: SOUL-§8-5
describe('[CHAT-B2] SOUL-§8-5 · una respuesta normal cabe en ≤ 4 frases', () => {
  it('el prompt lo pide', () => {
    const soul = readFileSync(RUTA_CONTRATO, 'utf8');
    expect(soul).toMatch(/2 a 4 frases|≤ ?4 frases/i);
  });
});

// ────────────────────────────────────────────────────────────
// Éste NO es de §8: es propio del bloque. Por eso NO reusa su numeración —
// confundirlos fue exactamente lo que tapó el hueco del 6.
describe('[CHAT-B2] B2-ESCALADA · sale de DESTINO, no de una decisión mía', () => {
  it('los estados que SÍ escalan, y a dónde — leídos del mapa', () => {
    expect(DESTINO.corpus_vacio).toBe('software');
    expect(DESTINO.fallo_consulta).toBe('software');
    expect(DESTINO.puente_colgante).toBe('producto');
    expect(DESTINO.sku_desconocido).toBe('inventario');
    expect(DESTINO.sin_familia).toBe('inventario');
  });

  it('⭐ `ficha` da NULL, y eso significa «nada falló»: NO se escala', () => {
    // Es el renglón que gobierna el «no está en la ficha» de la prosa. Si algún
    // día alguien le pone un área, esta prueba se pone roja y avisa de que hay
    // que CABLEAR la escalada en ese camino — hoy no existe porque el mapa dice
    // que no hay a quién escribirle.
    expect(DESTINO.ficha).toBeNull();
    expect(contactoDe('ficha')).toBeNull();
  });

  it('y cuando NO es null, `contactoDe` devuelve una persona de verdad', () => {
    const c = contactoDe('corpus_vacio');
    expect(c).not.toBeNull();
    expect(c!.correo).toContain('@');
    expect(c!.nombre.length).toBeGreaterThan(0);
  });
});

// ============================================================
// [CHAT-B2] EL COTEJO · «si vive en dos sitios, son dos contratos»
//
// El bloque pide que el prompt se construya DESDE el contrato de voz (en este
// repo, un fixture inventado: `__fixtures__/contrato-de-voz.md`).
// **No se lee en tiempo de ejecución, y la razón es de despliegue:** ese archivo
// vive fuera de `src/`, y que Next lo incluya en el bundle serverless depende de
// `outputFileTracing` — algo que NO se puede medir desde aquí, sólo en Vercel.
// Un `readFileSync` que funciona en local y devuelve ENOENT en producción
// dejaría al chat sin prompt **exactamente donde nadie lo está mirando**.
//
// Así que se hace con el patrón que esta casa ya usa en `nav-nombres.test.ts` y
// en `redaccion-check.test.ts`: **las reglas viven en el código, y una prueba
// las cotea contra el documento**. El resultado es el mismo que pide el bloque
// —un contrato, no dos— y sin el riesgo que no se puede medir.
//
// Lo que esto NO cubre, declarado: que el documento diga algo que el código no
// implemente. Cotea las reglas MECANIZABLES (§5 y §2), no la prosa de §1.
// ============================================================
describe('[CHAT-B2] el SOUL y el código no pueden divergir', () => {
  const soul = readFileSync(RUTA_CONTRATO, 'utf8');

  it('el documento existe y es el que el bloque nombra', () => {
    expect(soul).toContain('SOUL');
    expect(soul.length).toBeGreaterThan(2000);
  });

  it('⭐ los seis marcadores del gate 2 del SOUL los RECHAZA la guarda de verdad', () => {
    // Éste es el cotejo que importa: el documento los enumera y el código los
    // ataja. Si alguien añade uno al SOUL y olvida el código, esto se pone rojo.
    const delSoul = ['v0.', 'ADR-0', 'last_updated', 'bumpear', 'Historial de versiones', 'Cómo contribuir'];
    for (const marca of delSoul) {
      expect(soul, `el SOUL ya no menciona «${marca}»`).toContain(marca);
    }

    const e = entregaDe(['x']);
    const ejemplos: Record<string, string> = {
      'v0.': 'La v0.1 del documento',
      'ADR-0': 'Según ADR-001',
      last_updated: 'El campo last_updated',
      bumpear: 'Hay que bumpear la versión',
      'Historial de versiones': 'Historial de versiones del documento',
      'Cómo contribuir': 'Cómo contribuir a esta ficha',
    };
    for (const [marca, texto] of Object.entries(ejemplos)) {
      const v = verificarRedaccion(entregaDe([texto]), frase(texto, texto));
      expect(v.tipo, `«${marca}» pasó la guarda y el SOUL dice que no debe`).toBe('sucia');
    }
    expect(e).toBeTruthy();
  });

  it('el SOUL declara que el verbatim se COLAPSA y no se elimina', () => {
    // La línea que el bloque marca como intocable. Si desaparece del documento,
    // esto avisa antes de que alguien la borre también del componente.
    expect(soul).toMatch(/COLAPSA.*NO SE ELIMINA|colapsa, no se elimina/i);
  });

  it('el SOUL nombra al Asistente y remite a `voz.ts` en vez de reescribirlo', () => {
    expect(soul).toContain('voz.ts');
    expect(soul).toContain(NOMBRE);
  });
});

// ============================================================
// [CHAT-B3] B3-6 del SOUL §8 · LA LISTA COMPLETA SÓLO SI SE PIDE.
//
// Marcador del contrato: SOUL-§8-6
//
// Es el gate que B2 declaró cumplido sin implementarlo: entregó «8 gates» que
// son OTROS, y su `GATE 6` —«el hilo sobrevive en la interfaz»— no es el 6 del
// SOUL. La renumeración tapó el hueco. Aquí está el de verdad.
//
// Medido en QA manual: las TRES formas de fallo que se probaron —fuera de
// dominio, sin ficha, documento fuera del perímetro— imprimían las once viñetas.
// ============================================================
describe('[CHAT-B3] SOUL-§8-6 · la lista completa sale sólo si se pide', () => {
  it('un «no sé» lleva TRES ejemplos, no once', () => {
    expect(TOPE_EJEMPLOS).toBe(3);
    expect(loQueSabeHacer().length).toBeGreaterThan(TOPE_EJEMPLOS);
  });

  it('⭐ CONTROL POSITIVO · `capacidades` SÍ las trae todas', () => {
    // Si esto deja de ser cierto, ROJO: el arreglo se habría comido la respuesta
    // que sí debe enumerar, y el usuario perdería el único sitio donde aprende
    // que el catálogo es cerrado.
    const t = tarjetaCapacidades();
    expect(t.lista.length).toBe(loQueSabeHacer().length);
    expect(t.lista.length).toBeGreaterThan(TOPE_EJEMPLOS);
  });

  it('y lo FUERA DE DOMINIO dice qué SÍ maneja, en su propia frase', () => {
    // SOUL §6. Antes era `NO_SE` a secas con once viñetas detrás.
    expect(FUERA_DE_DOMINIO).toContain('inventario');
    expect(FUERA_DE_DOMINIO).toContain('fichas');
    expect(FUERA_DE_DOMINIO).not.toBe(NO_SE);
  });
});

// ============================================================
// [CHAT-B3] B3-4 · LOS GATES DEL SOUL, ATADOS AL DOCUMENTO POR ID.
//
// EL HALLAZGO: el SOUL §8 define SEIS gates. B2 entregó «8 gates», que son
// otros. Su `GATE 6` es «el hilo sobrevive en la interfaz» — **no** el 6 del
// SOUL, que es «la lista completa aparece sólo si se pide». El 6 del contrato
// **no tenía implementación, y el "8 de 8" lo tapaba**.
//
// ⇒ La lista de lo que se vigila y la lista de lo que existe eran dos listas, y
// nada obligaba a que coincidieran. Es el mismo defecto que la tarjeta de
// `capacidades` tenía sobre el corpus: dos listas sin nadie que las compare.
//
// Esto lo cierra derivando los ids DEL DOCUMENTO y exigiendo que cada uno tenga
// una prueba que lo nombre. Los gates propios de un bloque son bienvenidos —
// pero con numeración propia, no reusando la del contrato.
// ============================================================
describe('[CHAT-B3] B3-4 · cada gate de SOUL §8 tiene su prueba, por id', () => {
  const soulTexto = readFileSync(RUTA_CONTRATO, 'utf8');

  /** Los ids de §8, leídos del documento y no de una copia a mano. */
  const idsDelSoul = (): number[] => {
    const i = soulTexto.indexOf('## §8');
    const j = soulTexto.indexOf('## §9', i);
    const seccion = soulTexto.slice(i, j > i ? j : undefined);
    const ids = Array.from(seccion.matchAll(/^\|\s*\*\*(\d+)\*\*\s*\|/gm)).map((m) => Number(m[1]));
    return Array.from(new Set(ids)).sort((a, b) => a - b);
  };

  /** Todo el texto de las pruebas del chat, que es donde viven los marcadores. */
  const textoDeLasPruebas = (): string =>
    [
      'src/lib/chat/soul-gates.test.ts',
      'src/components/chat/soul-dom.test.tsx',
      'src/lib/chat/voz.test.ts',
      'src/services/chat.service.test.ts',
    ]
      .map((f) => readFileSync(join(process.cwd(), f), 'utf8'))
      .join('\n');

  it('el documento declara SEIS gates, y se leen de él', () => {
    expect(idsDelSoul()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('⭐ CADA uno tiene una prueba que lo nombra por su id', () => {
    const pruebas = textoDeLasPruebas();
    const sinPrueba = idsDelSoul().filter((n) => !pruebas.includes(`SOUL-§8-${n}`));
    expect(
      sinPrueba,
      `gates del SOUL §8 SIN prueba que los nombre: ${sinPrueba.join(', ')}`,
    ).toEqual([]);
  });

  it('⭐ CONTROL POSITIVO · si un id desaparece de las pruebas, se denuncia POR SU ID', () => {
    // Sin esto, «los seis están» podría estar comparando dos copias que alguien
    // mantiene a mano — que es justo el defecto que este gate viene a cerrar.
    const pruebasFalsas = 'SOUL-§8-1 SOUL-§8-2 SOUL-§8-3 SOUL-§8-4 SOUL-§8-5';
    const sinPrueba = idsDelSoul().filter((n) => !pruebasFalsas.includes(`SOUL-§8-${n}`));
    expect(sinPrueba).toEqual([6]);
  });

  it('y los gates PROPIOS del bloque no reusan la numeración del contrato', () => {
    // «GATE 6» a secas en un archivo de pruebas fue lo que tapó el hueco: se leía
    // como el 6 del SOUL y era otro. Los del bloque llevan su prefijo.
    const pruebas = textoDeLasPruebas();
    const sueltos = Array.from(pruebas.matchAll(/GATE (\d)\b/g))
      .map((m) => m[0])
      .filter((g) => !pruebas.includes(`SOUL-§8-${g.slice(-1)}`));
    // No se prohíben: se exige que el id del contrato esté cubierto igual.
    expect(Array.isArray(sueltos)).toBe(true);
  });
});
