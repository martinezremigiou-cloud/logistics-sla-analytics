import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTACTOS } from './contactos';

// ============================================================
// [ROL-SOPORTE · limpieza] LA ESCOTILLA DE RESCATE NO PUEDE APUNTAR A UN
// FANTASMA.
//
// ────────────────────────────────────────────────────────────
// DE DÓNDE SALE ESTA PRUEBA.
//
// `scripts/bootstrap-admin.mjs` es el ÚNICO camino para recuperar un
// administrador si el portal se queda sin ninguno — el producto sabe suspender
// pero no sabe crear ni eliminar admins (A1-14). Ese camino se elige por una
// constante escrita a mano, `EMAIL_ADMIN_FUNDADOR`.
//
// El 22-sep-2026 se dio de baja `admin@example.com`, que era
// justo el valor de esa constante. Nada en el repo lo habría denunciado: el
// script no corre en cada deploy (por eso la deuda B5-10 decía «sin acción»), y
// `tsc` no mira dentro de un `.mjs`. El fallo se habría descubierto el día en
// que hiciera falta la escotilla, que por definición es el día en que ya no hay
// otro camino.
//
// ────────────────────────────────────────────────────────────
// QUÉ COTEA, Y CONTRA QUÉ.
//
// Contra `CONTACTOS.software.correo` — el directorio de escalada de
// `src/lib/contactos.ts`, que es quien responde por el portal. Ese archivo dice
// de sí mismo por qué vive en el repo y no en variables de entorno: *«si
// vivieran en variables, la lista dejaría de estar bajo revisión de código y
// nadie notaría que un contacto se fue de la empresa»*. Exactamente el mismo
// argumento, aplicado a la escotilla.
//
// ⚠ EL LÍMITE, DICHO AQUÍ Y NO EN UN DOCUMENTO: esto cotea DOS COPIAS (P33).
// Detecta que se separen; **no detecta que las dos envejezcan juntas**. Si esa
// persona se va de la empresa y nadie toca ninguno de los dos archivos, las dos
// copias siguen de acuerdo y las dos siguen mal. Lo único que esta prueba
// promete es que **mover una obliga a mover la otra**.
// ============================================================

// Mismo molde que `control-layout/gate.test.tsx:109`, que ya lee este mismo
// directorio: `process.cwd()` y no `import.meta.url`, porque bajo la
// transformación de Vitest esa URL no siempre es de esquema `file:`.
const FUENTE = readFileSync(join(process.cwd(), 'scripts/bootstrap-admin.mjs'), 'utf8');
const DECLARACIONES = Array.from(FUENTE.matchAll(/^const EMAIL_ADMIN_FUNDADOR = '([^']+)';$/gm));

describe('la escotilla de rescate (bootstrap-admin.mjs)', () => {
  // ── anti-vacuidad ───────────────────────────────────────────
  // Sin esto, un renombre de la constante dejaría `DECLARACIONES` vacío y las
  // pruebas de abajo compararían `undefined` con `undefined` — verdes, y sin
  // haber mirado el archivo. Es el molde de P19: una guarda que no puede
  // fallar no es una guarda.
  it('el archivo declara EXACTAMENTE UNA constante, y la prueba la encontró', () => {
    expect(FUENTE.length).toBeGreaterThan(500);
    expect(DECLARACIONES).toHaveLength(1);
    expect(DECLARACIONES[0][1]).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
  });

  it('apunta al MISMO correo que el contacto de software en contactos.ts', () => {
    expect(DECLARACIONES[0][1]).toBe(CONTACTOS.software.correo);
  });

  // ── el invariante nuevo, estrenado el 22-sep ─────────
  // La llave del portal es de la EMPRESA, no de una persona. El valor anterior
  // era un gmail personal, y por eso la baja de una cuenta personal se llevaba
  // por delante la recuperación de todo el portal.
  it('es una cuenta corporativa, no un correo personal', () => {
    expect(DECLARACIONES[0][1]).toMatch(/@example\.com$/);
    expect(CONTACTOS.software.correo).toMatch(/@example\.com$/);
  });
});
