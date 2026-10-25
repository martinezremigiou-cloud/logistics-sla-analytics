// ============================================================
// [CHAT-B1] EL COTEJO QUE LA `0040` DECLARÓ NO PODER HACER.
//
// Su `RAISE NOTICE` final dice, con esas palabras, que no puede comprobar «que
// los nueve valores del CHECK sean los mismos nueve de EstadoRedaccion en el
// codigo — son dos copias del mismo hecho y solo una prueba de aplicacion las
// cotea». Ésta es esa prueba.
//
// **Es un trinquete en las DOS direcciones**, y por eso se compara conjunto
// contra conjunto y no `length`: un estado nuevo en el código sin su valor en
// el CHECK produciría un `INSERT` que revienta **en producción, y sólo cuando
// ese estado ocurra** — que es el peor sitio y el peor momento para enterarse.
// Y un valor de más en el CHECK sería un estado que la base acepta y el código
// no sabe producir: código muerto en una restricción, que es donde menos se ve.
//
// Lee el `.sql` APLICADO y no una copia: si alguien edita la migración después
// de aplicarla, esto no lo detecta —el libro guarda el sha256, no esta prueba—
// pero sí detecta el caso que importa, que es el de la deriva al añadir.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESTADOS_REDACCION } from './redaccion';

const DIR = join(process.cwd(), 'supabase', 'migrations');

function checkDeLaMigracion(): string[] {
  const archivo = readdirSync(DIR).find((f) => f.includes('chatb1_consumo_redaccion'));
  if (!archivo) throw new Error('no encuentro la migración del registro de redacción en ' + DIR);
  const sql = readFileSync(join(DIR, archivo), 'utf8');

  // El bloque `CHECK (redaccion_estado IS NULL OR redaccion_estado IN ( ... ))`.
  const i = sql.indexOf('redaccion_estado IN (');
  if (i < 0) throw new Error('no encuentro el CHECK de redaccion_estado en ' + archivo);
  const bloque = sql.slice(i, sql.indexOf('))', i));

  // Sólo las cadenas entre comillas simples: los comentarios `--` de cada línea
  // quedan fuera por construcción, sin tener que quitarlos.
  return Array.from(bloque.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
}

describe('[CHAT-B1] los estados del código y los del CHECK son los MISMOS', () => {
  const enSql = checkDeLaMigracion();

  it('la migración declara nueve, sin repetir', () => {
    expect(enSql).toHaveLength(9);
    expect(new Set(enSql).size).toBe(9);
  });

  it('y el CÓDIGO declara los mismos nueve — el conteo deja de poder mentir solo', () => {
    // La cabecera de `redaccion.ts` decía «Siete estados» y eran nueve: P35 en
    // el archivo que inventó P35. Un conteo escrito a mano es justo la clase de
    // afirmación que nadie vuelve a comprobar — se lee, suena razonable y se cree.
    expect(ESTADOS_REDACCION).toHaveLength(9);
    expect(new Set(ESTADOS_REDACCION).size).toBe(9);
  });

  it('TODO estado del código está en el CHECK — si no, el INSERT revienta en producción', () => {
    const faltan = ESTADOS_REDACCION.filter((e) => !enSql.includes(e));
    expect(faltan).toEqual([]);
  });

  it('TODO valor del CHECK existe en el código — si no, es código muerto en una restricción', () => {
    const sobran = enSql.filter((e) => !(ESTADOS_REDACCION as readonly string[]).includes(e));
    expect(sobran).toEqual([]);
  });

  it('el tipo se DERIVA del arreglo: con un union de literales esta prueba no se podría escribir', () => {
    // Los tipos se borran al compilar. Lo que hace cotejable el contrato es que
    // haya un valor en tiempo de ejecución del que el tipo cuelga, y no al revés.
    expect(Array.isArray(ESTADOS_REDACCION)).toBe(true);
    expect(ESTADOS_REDACCION).toContain('fuera_del_perimetro');
  });
});
