import { describe, it, expect } from 'vitest';
import {
  armarCorreos,
  acotarAPerfiles,
  resumenDeCorreo,
  canalDeCorreoCallado,
  CICLO_BOLETIN_DIAS,
  CICLOS_ANTES_DE_AVISAR,
  type SeguimientoCorreo,
  type DestinatarioPosible,
} from './correo';
import type { Aviso } from './avisos';

const aviso = (perfil_id: string, sku: string, tipo: Aviso['tipo'] = 'llegada'): Aviso => ({
  perfil_id,
  tipo,
  sku,
  de: '0',
  a: '40',
  detectado_en: '2026-08-14T16:00:00.000Z',
  snapshot_id: 's1',
});

const sigue = (perfil_id: string, sku: string, av_correo: boolean): SeguimientoCorreo => ({ perfil_id, sku, av_correo });

const dest = (perfil_id: string, boletin_correo = true): DestinatarioPosible => ({
  perfil_id,
  correo: `${perfil_id}@example.com`,
  boletin_correo,
});

// ============================================================
// [C-11] EL ACOTAMIENTO DE LAS CORRIDAS DE VERIFICACION.
//
// Medido el 15-sep: sin acotar, una corrida de verificacion manda varios correos y algunos van
// a companeros que no son el perfil de prueba. Este filtro es lo unico que lo
// impide, asi que su gate tiene que cubrir la rama PERMISIVA, no solo la que
// corta — un filtro que no muerde se ve identico a uno que si.
// ============================================================
describe('[CORREO·C-11] acotarAPerfiles', () => {
  const P = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('sin acotar (undefined) devuelve a todos: es el comportamiento de produccion', () => {
    expect(acotarAPerfiles(P, undefined).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('acotado a uno, devuelve SOLO ese', () => {
    expect(acotarAPerfiles(P, ['b']).map((p) => p.id)).toEqual(['b']);
  });

  it('un id que no existe NO se convierte en todos: devuelve vacio', () => {
    expect(acotarAPerfiles(P, ['no-existe'])).toEqual([]);
  });

  // La que importa y casi nadie escribe: si `[]` cayera en la rama permisiva,
  // un filtro mal construido rio arriba mandaria a todos los perfiles.
  it('un arreglo VACIO acota a NADIE, no a todos', () => {
    expect(acotarAPerfiles(P, [])).toEqual([]);
  });

  it('no muta la lista que recibe', () => {
    const original = [...P];
    acotarAPerfiles(P, ['a']);
    expect(P).toEqual(original);
  });
});

describe('[INV-B9.1] armarCorreos · la regla del correo vacío', () => {
  it('sin nada personal y sin pulso, NO sale correo — nunca uno que diga «no pasó nada»', () => {
    expect(armarCorreos([dest('a')], [], [], false)).toEqual([]);
  });

  it('sin nada personal pero con pulso y boletín encendido, sale el boletín', () => {
    const r = armarCorreos([dest('a')], [], [], true);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ perfil_id: 'a', avisos: [], incluyePulso: true });
  });

  it('con el boletín APAGADO y nada personal, no sale correo aunque el pulso traiga algo', () => {
    expect(armarCorreos([dest('a', false)], [], [], true)).toEqual([]);
  });

  it('con el boletín apagado pero con algo personal, SÍ sale — y sin el pulso', () => {
    const r = armarCorreos([dest('a', false)], [sigue('a', 'SUJ500-F', true)], [aviso('a', 'SUJ500-F')], true);
    expect(r).toHaveLength(1);
    expect(r[0].avisos).toHaveLength(1);
    expect(r[0].incluyePulso).toBe(false);
  });

  it('el que aparece en la lista SE ENVÍA: el llamador no tiene que volver a filtrar', () => {
    const r = armarCorreos([dest('a'), dest('b', false), dest('c')], [], [], true);
    expect(r.map((x) => x.perfil_id)).toEqual(['a', 'c']);
  });
});

describe('[INV-B9.1] armarCorreos · el interruptor decide SI, no QUÉ', () => {
  // ============================================================
  // Lo que se manda por correo es lo que el usuario ya eligió para la campana.
  // `av_correo` no lleva su propia lista de tipos — preguntarlo dos veces
  // mataría la función con 30 SKU.
  // ============================================================
  it('solo viajan los avisos de SKU con `av_correo`; los demás se quedan en la campana', () => {
    const r = armarCorreos(
      [dest('a')],
      [sigue('a', 'CON-CORREO', true), sigue('a', 'SOLO-CAMPANA', false)],
      [aviso('a', 'CON-CORREO'), aviso('a', 'SOLO-CAMPANA')],
      false,
    );
    expect(r[0].avisos.map((x) => x.sku)).toEqual(['CON-CORREO']);
  });

  it('un SKU con correo conserva TODOS sus tipos de aviso, no solo uno', () => {
    const r = armarCorreos(
      [dest('a')],
      [sigue('a', 'SUJ500-F', true)],
      [aviso('a', 'SUJ500-F', 'estatus'), aviso('a', 'SUJ500-F', 'reservado')],
      false,
    );
    expect(r[0].avisos.map((x) => x.tipo)).toEqual(['estatus', 'reservado']);
  });

  // ============================================================
  // El par (perfil, sku) es la llave completa, igual que la PK de
  // `seguimientos`. Si se indexara solo por SKU, el interruptor de una persona
  // encendería el correo de otra que sigue el mismo SKU.
  // ============================================================
  it('el interruptor de una persona NO enciende el correo de otra sobre el mismo SKU', () => {
    const r = armarCorreos(
      [dest('a'), dest('b')],
      [sigue('a', 'SUJ500-F', true), sigue('b', 'SUJ500-F', false)],
      [aviso('a', 'SUJ500-F'), aviso('b', 'SUJ500-F')],
      false,
    );
    expect(r.map((x) => x.perfil_id)).toEqual(['a']);
    expect(r[0].avisos).toHaveLength(1);
  });

  it('los avisos de otra persona nunca se cruzan', () => {
    const r = armarCorreos(
      [dest('a')],
      [sigue('a', 'SUJ500-F', true)],
      [aviso('b', 'SUJ500-F')],
      false,
    );
    expect(r).toEqual([]);
  });

  it('un aviso de un SKU que ya no se sigue no viaja', () => {
    const r = armarCorreos([dest('a')], [], [aviso('a', 'SUJ500-F')], false);
    expect(r).toEqual([]);
  });
});

describe('[INV-B9.1] resumenDeCorreo', () => {
  // ============================================================
  // Se cuentan SKU, no avisos — la unidad que percibe un humano. Es la misma
  // corrección que el gate del grano forzó en el panel de la campana (P23).
  // ============================================================
  it('un SKU con dos avisos es UNA novedad, no dos', () => {
    const r = armarCorreos(
      [dest('a')],
      [sigue('a', 'SUJ500-F', true)],
      [aviso('a', 'SUJ500-F', 'estatus'), aviso('a', 'SUJ500-F', 'reservado')],
      false,
    );
    expect(resumenDeCorreo(r[0])).toEqual({ skus: 1, avisos: 2, soloPulso: false });
  });

  it('un correo que solo lleva el pulso se marca como tal', () => {
    const r = armarCorreos([dest('a')], [], [], true);
    expect(resumenDeCorreo(r[0])).toEqual({ skus: 0, avisos: 0, soloPulso: true });
  });
});

// ============================================================
// EL CANAL CALLADO. La misma falla de la ingesta, en el canal nuevo — y la
// trampa que el diseño obvio tiene: una alarma que nace encendida.
// ============================================================
describe('[INV-B9.1] canalDeCorreoCallado', () => {
  const ahora = new Date('2026-08-16T12:00:00.000Z');

  it('SIN NINGÚN ENVÍO NUNCA no avisa: sería una alarma encendida desde el día del despliegue', () => {
    // «Nunca se ha enviado» es indistinguible de «todavía no está configurado».
    // Si esto avisara, gritaría antes de que n8n exista y se aprendería a ignorar.
    expect(canalDeCorreoCallado(null, ahora)).toBeNull();
  });

  it('con un envío reciente, silencio', () => {
    expect(canalDeCorreoCallado('2026-08-14T12:00:00.000Z', ahora)).toBeNull();
  });

  it('un ciclo perdido NO avisa: puede ser un festivo o un reintento tardío', () => {
    // 8 días: pasó un ciclo semanal, pero no dos.
    expect(canalDeCorreoCallado('2026-08-08T12:00:00.000Z', ahora)).toBeNull();
  });

  it('DOS ciclos sin envío confirmado SÍ avisan, y dicen desde cuándo', () => {
    const r = canalDeCorreoCallado('2026-08-01T12:00:00.000Z', ahora);
    expect(r).not.toBeNull();
    expect(r).toMatchObject({ dias: 15, ultimo: '2026-08-01T12:00:00.000Z' });
  });

  it('el umbral es exactamente 2 ciclos, y el ciclo es un PARÁMETRO', () => {
    expect(CICLO_BOLETIN_DIAS).toBe(7);
    expect(CICLOS_ANTES_DE_AVISAR).toBe(2);
    // Justo por debajo de 14 días: silencio. Justo por encima: avisa.
    expect(canalDeCorreoCallado('2026-08-02T13:00:00.000Z', ahora)).toBeNull();
    expect(canalDeCorreoCallado('2026-08-02T11:00:00.000Z', ahora)).not.toBeNull();
    // Con un ciclo distinto —el correo por evento— el umbral se mueve con él.
    expect(canalDeCorreoCallado('2026-08-14T12:00:00.000Z', ahora, 1)).not.toBeNull();
  });

  it('una fecha basura no avisa ni lanza: un aviso no puede nacer de un dato ilegible', () => {
    expect(canalDeCorreoCallado('no es una fecha', ahora)).toBeNull();
  });
});
