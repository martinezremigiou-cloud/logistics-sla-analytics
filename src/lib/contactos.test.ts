// ============================================================
// [INV-B11] O6-adenda · LA PRUEBA DE COBERTURA QUE SE PIDIÓ.
//
//     «Una prueba de cobertura puede exigir que TODO estado tenga destino.»
//
// QUIÉN GARANTIZA QUÉ, porque no lo garantiza todo esta prueba:
//
//   `Record<EstadoEscalable, …>`  garantiza, EN COMPILACIÓN, que no falte
//                                 ninguna clave. Es la guarda fuerte.
//   esta prueba                   garantiza que no SOBRE ninguna, que ningún
//                                 destino apunte a un área que no existe, y
//                                 que las claves de los tres espacios no se
//                                 pisen entre sí — tres cosas que el tipo NO
//                                 puede ver.
//
// Y el acoplamiento que hace que esto no se pudra: la lista de estados de ficha
// está ESCRITA aquí abajo. Si alguien agrega un noveno estado a
// `ResultadoFicha`, el `Record` le obliga a darle destino… y entonces
// `DESTINO` tendrá 18 claves contra las 17 que esta lista espera, y esto se
// pone rojo hasta que la lista se actualice. **Escribir la lista es el punto,
// no el atajo.**
// ============================================================
import { describe, it, expect } from 'vitest';
import { CONTACTOS, DESTINO, ORDEN_AYUDA, contactoDe, type EstadoEscalable } from './contactos';
import { INTENCIONES } from '@/lib/chat/intenciones';

/** Los 8 de `ResultadoFicha`. Escritos a mano A PROPÓSITO (ver la cabecera). */
const TIPOS_FICHA = [
  'corpus_vacio',
  'fallo_consulta',
  'puente_colgante',
  'sku_desconocido',
  'sin_familia',
  'sin_puente',
  'sin_ficha_confirmado',
  'ficha',
] as const;

const TRANSPORTE = ['config_error', 'fallo_transporte'] as const;

describe('[INV-B11] el mapa estado → contacto', () => {
  it('TODA intención tiene destino, y sale del catálogo — no de una lista paralela', () => {
    // Ésta es la mitad totalmente no vacua: `INTENCIONES` es un arreglo real en
    // tiempo de ejecución, así que agregar una octava intención rompe esto sin
    // que nadie tenga que acordarse.
    const sinDestino = INTENCIONES.filter((i) => !(i.id in DESTINO));
    expect(sinDestino.map((i) => i.id), 'una intención se quedó sin a quién escribirle').toEqual([]);
    // Y el control positivo del filtro: si `in` estuviera roto y dijera `true`
    // siempre, la línea de arriba pasaría con el mapa vacío.
    expect('intencion_que_no_existe' in DESTINO).toBe(false);
    expect(INTENCIONES.length).toBeGreaterThan(0);
  });

  it('el mapa tiene EXACTAMENTE los estados que existen: ni falta ni sobra ninguno', () => {
    const esperadas = [...TIPOS_FICHA, ...INTENCIONES.map((i) => i.id), ...TRANSPORTE].sort();
    expect(Object.keys(DESTINO).sort(), 'el mapa y los estados dejaron de cuadrar').toEqual(esperadas);
  });

  it('las claves de los TRES espacios no se pisan entre sí', () => {
    // Si una intención se llamara igual que un estado de ficha, el objeto
    // perdería una fila en silencio y `Object.keys` daría 16 en vez de 17 — el
    // de arriba lo cazaría, pero diciendo la cosa equivocada. Esto lo nombra.
    const todas = [...TIPOS_FICHA, ...INTENCIONES.map((i) => i.id), ...TRANSPORTE];
    const repetidas = todas.filter((k, i) => todas.indexOf(k) !== i);
    expect(repetidas, 'una intención y un estado de ficha se llaman igual').toEqual([]);
  });

  it('ningún destino apunta a un área que no existe', () => {
    for (const [estado, area] of Object.entries(DESTINO)) {
      if (area === null) continue;
      expect(CONTACTOS[area], `«${estado}» apunta al área «${area}», que no está en CONTACTOS`).toBeDefined();
      expect(CONTACTOS[area].area, 'el contacto no coincide con la llave bajo la que vive').toBe(area);
    }
  });

  it('los `null` son EXACTAMENTE dos, y los dos son decisiones', () => {
    // La regla del bloque: cero y no-medido son valores distintos. Un `null`
    // nuevo significaría «este estado no escala», y eso hay que decidirlo, no
    // heredarlo de un descuido — por eso la lista va escrita, y por eso esto se
    // pone rojo cuando aparece uno más.
    //
    //   ficha        hubo respuesta: no hay nada que escalar
    //   capacidades  el sistema contestó entero; ofrecer un contacto ahí diría
    //                que algo salió mal, y no salió
    const sinDestino = Object.entries(DESTINO)
      .filter(([, area]) => area === null)
      .map(([estado]) => estado)
      .sort();
    expect(sinDestino, 'un estado dejó de tener a quién escribirle').toEqual(['capacidades', 'ficha']);
  });

  it('`contactoDe` resuelve de verdad, y devuelve `null` SOLO donde no hay nada que escalar', () => {
    // El control positivo. Sin esto, un `contactoDe` que devolviera `null`
    // siempre pondría en verde todo lo de arriba.
    expect(contactoDe('sin_puente')?.nombre).toBe('Hugo Lara');
    expect(contactoDe('fallo_consulta')?.nombre).toBe('Tomas Ruiz');
    expect(contactoDe('sin_familia')?.nombre).toBe('Paula Soto');
    expect(contactoDe('llegada')?.nombre).toBe('Raquel Vega');
    expect(contactoDe('ficha')).toBeNull();
  });

  it('los cuatro contactos están completos: un renglón a medias es peor que ninguno', () => {
    for (const area of ORDEN_AYUDA) {
      const c = CONTACTOS[area];
      expect(c.nombre.length, `${area}: sin nombre`).toBeGreaterThan(0);
      expect(c.puesto.length, `${area}: sin puesto`).toBeGreaterThan(0);
      expect(c.cuando.length, `${area}: sin la línea de «cuándo escribirle»`).toBeGreaterThan(0);
      expect(c.correo, `${area}: el correo no tiene forma de correo`).toMatch(/^[^\s@]+@example\.com$/);
      // Un teléfono con dígitos de verdad. `toBeGreaterThan(0)` sobre la cadena
      // dejaría pasar un `"—"`, que es exactamente lo que alguien pondría el día
      // que falte el dato.
      expect(c.telefono.replace(/\D/g, '').length, `${area}: el teléfono no trae dígitos`).toBeGreaterThanOrEqual(10);
    }
    expect(ORDEN_AYUDA.length, 'la tabla de Ajustes dejó de listar a los cuatro').toBe(
      Object.keys(CONTACTOS).length,
    );
  });

  it('el tipo `EstadoEscalable` cubre lo que el mapa dice cubrir', () => {
    // Una comprobación de tipo con forma de prueba: si `EstadoEscalable`
    // dejara fuera alguno, esta asignación no compilaría y `tsc` —que corre
    // en el gancho de pre-commit— lo detiene antes que vitest.
    const todas: EstadoEscalable[] = [...TIPOS_FICHA, ...INTENCIONES.map((i) => i.id), ...TRANSPORTE];
    expect(todas.every((e) => e in DESTINO)).toBe(true);
  });
});
