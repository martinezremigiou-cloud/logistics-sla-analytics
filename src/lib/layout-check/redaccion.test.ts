// ============================================================
// [DASH-E · C-DASH·13] redaccion.test.ts — la contramedida de §7.1, ejercida
// sobre mensajes REALES de Playwright con credenciales dentro.
//
// El `.slice(0, 160)` que esto reemplaza no era una contramedida rota: era una
// contramedida que **acorta y no garantiza**. La diferencia solo se ve poniéndola
// contra el mensaje que el incidente produjo, y eso es lo que hay aquí.
// ============================================================
import { describe, it, expect } from 'vitest';
import { CAMPOS_PROHIBIDOS_EN_LOG, MARCA_OMITIDA, sinUrls } from './redaccion';

/**
 * El mensaje que Playwright imprime cuando `waitForURL` agota su tope tras un
 * envío por GET. Es la forma exacta del incidente del 2026-09-02: la URL —con
 * usuario y contraseña serializados— aparece **dentro de los primeros 160
 * caracteres**, que es justo lo que el recorte viejo dejaba pasar.
 */
const MENSAJE_DEL_INCIDENTE =
  'page.waitForURL: Timeout 30000ms exceeded.\n' +
  '=========================== logs ===========================\n' +
  'waiting for navigation to "http://127.0.0.1:3210/" until "load"\n' +
  '  navigated to "http://127.0.0.1:3210/login?email=parche%40example.com&password=Sup3rS3creta!"\n' +
  '============================================================';

describe('[C-DASH·13] sinUrls · ninguna URL sobrevive a un log de fallo', () => {
  it('el mensaje REAL del incidente sale sin la URL y sin las credenciales', () => {
    const limpio = sinUrls(MENSAJE_DEL_INCIDENTE);
    expect(limpio).not.toContain('127.0.0.1');
    expect(limpio).not.toContain('parche%40example.com');
    expect(limpio).not.toContain('Sup3rS3creta');
    for (const campo of CAMPOS_PROHIBIDOS_EN_LOG) {
      expect(limpio.toLowerCase(), `«${campo}=» no puede quedar en el log`).not.toContain(`${campo}=`);
    }
    expect(limpio).toContain(MARCA_OMITIDA);
  });

  // CONTROL POSITIVO DEL CONTROL POSITIVO: si el fixture no tuviera credenciales,
  // la prueba de arriba pasaría con una función que no hace nada. Se exige que el
  // mensaje de partida SÍ las traiga.
  it('control positivo · el mensaje de partida SÍ trae la credencial', () => {
    expect(MENSAJE_DEL_INCIDENTE).toContain('password=Sup3rS3creta!');
    expect(MENSAJE_DEL_INCIDENTE.indexOf('password=')).toBeLessThan(300);
  });

  // Y LA COMPARACIÓN CONTRA LO QUE HABÍA, que es lo que justifica el cambio.
  it('el `.slice(0, 160)` viejo DEJABA PASAR la URL en este mismo mensaje', () => {
    const viejo = MENSAJE_DEL_INCIDENTE.slice(0, 160);
    expect(viejo, 'si esto no contuviera la URL, el cambio no haría falta').toContain('http://127.0.0.1:3210/');
  });

  it('URL sin esquema (host:puerto/ruta) tampoco sobrevive — una regex de `http` la dejaría pasar', () => {
    const limpio = sinUrls('falló en 127.0.0.1:3210/login?email=a@example.test&password=zzz al navegar');
    expect(limpio).not.toContain('127.0.0.1');
    expect(limpio).not.toContain('password');
    expect(limpio).toContain('al navegar');
  });

  it('un query string SUELTO tampoco — es lo que produce recortar una URL a medias', () => {
    const limpio = sinUrls('?email=a%40example.test&password=zzz');
    expect(limpio).not.toContain('password');
    expect(limpio).toBe(MARCA_OMITIDA);
  });

  it('EL RECORTE VA AL FINAL: recortar primero parte la URL y deja la credencial dentro', () => {
    // Con el orden invertido, un tope corto cortaría la URL por la mitad y lo que
    // quedara —`…?email=x&passw`— ya no casaría con ninguna regex de URL.
    const largo = `${'x'.repeat(280)} http://h/login?email=a@example.test&password=zzz`;
    const limpio = sinUrls(largo, 300);
    expect(limpio).not.toContain('password');
    expect(limpio).not.toContain('email=');
  });

  it('un mensaje SIN URL pasa intacto — la redacción no puede comerse el diagnóstico', () => {
    // Si `sinUrls` borrara de más, el arnés perdería la única pista que le queda
    // cuando el login falla por otra causa. La contramedida no puede ser un
    // borrador universal.
    const normal = 'locator.fill: Target closed. El servidor devolvió 500 en el intento 2.';
    expect(sinUrls(normal)).toBe(normal);
  });

  it('acota DESPUÉS de redactar, y lo dice con puntos suspensivos', () => {
    const limpio = sinUrls('a'.repeat(500), 100);
    expect(limpio).toHaveLength(101);
    expect(limpio.endsWith('…')).toBe(true);
  });
});
