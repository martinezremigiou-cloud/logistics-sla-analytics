// ============================================================
// [2.0.1-A · cierre] arnes-cuentas.test.ts — dos trinquetes sobre el arnés.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ EXISTE, y la historia importa porque es de seguridad.
//
// El `layout-check` necesita una sesión para navegar. Durante la fase 2 esa
// sesión salió de una cuenta DESECHABLE creada al vuelo, promovida a admin y
// —según escribí yo— borrada al terminar «verificado con GET→404». **Era
// falso.** Medido por consulta, la cuenta seguía en las DOS
// capas (`public.perfiles` y `auth.users`), sin `deleted_at` y sin
// `banned_until`: viva, y durante días con rol admin.
//
// De ahí salen las dos reglas que este archivo convierte en guarda:
//
//   1. **El arnés NO CREA CUENTAS.** Hoy no lo hace —exige `PARCHE_ADMIN_*`
//      preexistentes— y eso es correcto por una razón que hay que dejar
//      escrita: el portal sabe SUSPENDER pero no ELIMINAR (no existe ninguna
//      ruta de baja; ver deuda A1-14). Un proceso que da de alta
//      administradores y no puede darlos de baja deja **residuo permanente**,
//      y el residuo de un admin es lo peor que se puede dejar. Mientras esa
//      capacidad no exista, esta prohibición es la única defensa.
//
//   2. **El arnés ASEVERA EL ROL.** Una corrida entera se midió con una sesión
//      de rol `visitante` sin que nada lo señalara, y salió con «0
//      violaciones» sobre 60 casos que ni siquiera eran la pantalla que el
//      veredicto nombraba. La guarda que lo impide es de una línea, y por eso
//      mismo es fácil de borrar sin querer: aquí se exige que siga ahí.
//
// LO QUE ESTAS GUARDAS NO VEN, declarado: leen TEXTO. Que la llamada esté
// escrita no prueba que la policy la deje pasar en runtime — eso solo lo dice
// una corrida. Lo que sí impiden es que la línea desaparezca en silencio, que
// es como desapareció la pregunta la primera vez.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios } from '../guardas/codigo-fuente';

const ARNES = join('scripts', 'layout-check.mjs');
const fuente = readFileSync(join(process.cwd(), ARNES), 'utf8');


/** Las llamadas que CREAN o ALTERAN cuentas, todas de la Admin API o del alta pública. */
const CREA_CUENTAS: Array<{ nombre: string; re: RegExp }> = [
  { nombre: 'auth.admin.* (Admin API)', re: /\.auth\.admin\b/ },
  { nombre: 'createUser', re: /\bcreateUser\b/ },
  { nombre: 'deleteUser', re: /\bdeleteUser\b/ },
  { nombre: 'updateUserById', re: /\bupdateUserById\b/ },
  { nombre: 'signUp', re: /\bsignUp\b/ },
  { nombre: 'llave de servicio', re: /SERVICE_ROLE|service_role/ },
];

describe('[2.0.1-A] el arnés del layout-check no crea cuentas', () => {
  const codigo = sinComentarios(fuente);

  for (const { nombre, re } of CREA_CUENTAS) {
    it(`no usa ${nombre}`, () => {
      expect(
        re.test(codigo),
        `scripts/layout-check.mjs usa ${nombre}. Este arnés debe EXIGIR una cuenta preexistente: ` +
          'el portal no sabe eliminar cuentas (solo suspender, deuda A1-14), así que crear una aquí ' +
          'deja residuo permanente. Ya pasó una vez y el residuo fue un admin.',
      ).toBe(false);
    });
  }

  it('sí exige la credencial del entorno (si no, la prohibición de arriba sería vacua)', () => {
    // P19 sobre esta misma guarda: un arnés que no abriera NINGUNA sesión
    // pasaría las seis de arriba sin merecerlo. Se exige la mitad positiva.
    expect(codigo).toContain('PARCHE_ADMIN_EMAIL');
    expect(codigo).toContain('signInWithPassword');
  });

  it('control positivo · el detector SÍ encuentra las llamadas cuando existen', () => {
    // El troceador que no troceaba: si `sinComentarios` devolviera cadena vacía
    // —o los patrones no casaran nada— las seis pruebas de arriba pasarían sin
    // mirar. Se comprueba en las dos direcciones.
    const malo = "const x = await admin.auth.admin.createUser({ email }); const k = process.env.SUPABASE_SERVICE_ROLE_KEY;";
    expect(CREA_CUENTAS.filter((c) => c.re.test(sinComentarios(malo))).map((c) => c.nombre)).toEqual([
      'auth.admin.* (Admin API)',
      'createUser',
      'llave de servicio',
    ]);
    // Y la prosa NO es código: la cabecera del arnés menciona estas palabras
    // para explicar por qué no las usa, y eso no puede ponerla en rojo.
    expect(sinComentarios('// este arnés jamás llama a createUser ni usa SERVICE_ROLE').trim()).toBe('');
  });
});

describe('[2.0.1-A] el arnés asevera el ROL, no solo que la sesión abra', () => {
  const codigo = sinComentarios(fuente);

  it('lee `perfiles.rol` de la sesión recién abierta', () => {
    // La vía tiene que ser ésta y no la Admin API: la policy
    // `perfiles_select_own_or_admin` es `USING (id = auth.uid() OR is_admin())`,
    // así que basta la llave anon. Si alguien la cambiara por algo que exige la
    // llave de servicio, las pruebas de arriba se pondrían rojas — las dos
    // mitades se sostienen entre sí.
    expect(codigo).toMatch(/from\('perfiles'\)/);
    expect(codigo).toMatch(/select\('rol'\)/);
  });

  it("y sale SIN VEREDICTO —no rojo, no verde— cuando el rol no es admin", () => {
    const bloque = codigo.slice(codigo.indexOf("from('perfiles')"));
    expect(bloque).toMatch(/rol !== 'admin'/);
    expect(bloque.slice(0, 1200)).toContain('[SIN VEREDICTO]');
  });

  it('control positivo · el extractor lee el archivo de verdad', () => {
    // Si `fuente` llegara vacía, los tres `toMatch` de arriba fallarían, pero un
    // `codigo` que casara SIEMPRE los pondría verdes. Se ancla con un negativo.
    expect(codigo.length).toBeGreaterThan(5000);
    expect(codigo).not.toMatch(/from\('tabla_que_no_existe'\)/);
  });
});

// ============================================================
// [C-DASH·13] EL EJE DEL SIDEBAR, en el arnés.
//
// `escenarios.ts` puede declarar el estado `sidebar-colapsado` y el veredicto
// puede exigir su plantado, y aun así el arnés podría no sembrar nada: los casos
// medirían el régimen EXPANDIDO con otro nombre y saldrían VERDES sobre el único
// régimen que ya estaba cubierto. Estas guardas leen TEXTO —lo dicen— y lo que
// impiden es que las tres líneas desaparezcan en silencio.
//
// ────────────────────────────────────────────────────────────
// ⚠ ESTAS GUARDAS LEEN EL FUENTE CRUDO, NO `sinComentarios`, Y HAY QUE DECIR POR
// QUÉ: medido el 15-sep, `sinComentarios` **se come las líneas 18 a 178 de este
// arnés** —160 líneas, entre ellas `PLANTADOS_ESPERADOS` entero y los umbrales—
// porque la cabecera escribe `src/lib/layout-check/*.ts` dentro de un `//`, y ese
// `/*` abre un bloque falso que no cierra hasta el primer `*/` real. Es P34 en
// otro instrumento: el parser lee el TEXTO, y un comentario es texto.
//
// Leer crudo tiene su propio costo y también se dice: una MENCIÓN en prosa
// satisfaría la guarda. Se acota anclando a la LÍNEA DE CÓDIGO COMPLETA, que
// ninguna prosa de este archivo escribe. El arreglo de fondo —quitar los
// comentarios de línea ANTES que los de bloque— es de una línea y vive en
// `src/lib/guardas/codigo-fuente.ts`, que lo comparten SEIS guardas: se reporta
// como `STRIPPER-DE-FUENTE-SE-COME-DESDE-UN-BLOQUE-FALSO`, no se parchea de paso.
// ============================================================
describe('[C-DASH·13] el arnés siembra el régimen colapsado y comprueba que llegó', () => {
  it('siembra la clave con `addInitScript`, antes de que exista React', () => {
    // Tiene que ser `addInitScript` y no un `evaluate` posterior: el script
    // bloqueante de `sidebar-colapso.ts` lee la clave AL CARGAR, así que
    // sembrarla después dejaría el primer pintado en el régimen equivocado.
    const bloque = fuente.slice(fuente.indexOf('ctxColapsado'));
    expect(bloque).toMatch(/await ctxColapsado\.addInitScript\(/);
    expect(bloque).toMatch(/\[CLAVE_SIDEBAR_COLAPSADO\],/);
    expect(bloque).toMatch(/localStorage\.setItem\(clave, '1'\);/);
  });

  it('COMPRUEBA EL EFECTO, no la semilla — y si no llegó, sale SIN MEDIR', () => {
    // Preguntarle a la clave que acabamos de escribir si está escrita sería
    // cotejar una copia consigo misma (P33). Se pregunta por la custom property
    // que el shell aplicó sobre <html>, que es la COSA.
    expect(fuente).toMatch(/getPropertyValue\('--mx-sidebar-w'\)/);
    const bloque = fuente.slice(fuente.indexOf("getPropertyValue('--mx-sidebar-w')"));
    expect(bloque.slice(0, 900)).toContain("resultado: 'SIN_MEDIR'");
  });

  it('declara el plantado del eje con su contrato de DOS direcciones', () => {
    expect(fuente).toContain("{ marca: 'a5', tipo: 'a1_recortado_por_ancestro', calladoEnEstado: 'sidebar-colapsado' },");
    // Y el fantasma que demuestra que A1c SEPARA: asoma a medias y no se denuncia.
    expect(fuente).toContain("const PLANTADOS_SILENCIOSOS = ['a3-fantasma', 'a5-fantasma'];");
  });

  it('control positivo · las guardas leen el arnés de verdad', () => {
    // Sin esto, un `fuente` vacío pondría los tres de arriba en rojo, pero uno
    // que casara SIEMPRE los pondría verdes sin leer nada.
    expect(fuente.length).toBeGreaterThan(20000);
    expect(fuente).not.toContain("marca: 'a9-que-no-existe'");
    expect(fuente).not.toContain('CLAVE_QUE_NO_EXISTE');
  });

  // Y la guarda del propio hallazgo: si alguien arregla `sinComentarios`, esto se
  // pone rojo y hay que volver aquí a usar `codigo` —que es lo correcto— en vez
  // de dejar las guardas leyendo crudo para siempre.
  it('CONTROL DEL HALLAZGO · hoy `sinComentarios` se come la declaración de los plantados', () => {
    expect(
      sinComentarios(fuente).includes("marca: 'a5'"),
      'sinComentarios ya NO se come el bloque: vuelve a usar `codigo` en las guardas de arriba',
    ).toBe(false);
  });
});

// ============================================================
// [C-DASH·13] §7.1 · EL ARNÉS NO PUEDE MANDAR CREDENCIALES POR GET.
//
// La guía de ingeniería del proyecto citaba ESTE archivo como ejemplo de la buena práctica —«no
// conducir el login»— y el 15-sep se midió que era falso: lo conducía, con
// `waitUntil: 'load'`, que no es hidratación. Se corrigió la afirmación y se dejó
// el arreglo **con nombre para este frente**. Aquí está, y aquí queda vigilado.
//
// Estas guardas leen el fuente CRUDO por la misma razón declarada arriba
// (`sinComentarios` se come las líneas 18-178 de este arnés), y se anclan a la
// línea de código completa para que una mención en prosa no las satisfaga.
// ============================================================
describe('[C-DASH·13] §7.1 · ni un `fill` antes de la hidratación, ni una URL en un log', () => {
  it('espera a que el HANDLER exista antes del primer `fill`', () => {
    // Se afirma el ORDEN, no la presencia: una espera escrita DESPUÉS del `fill`
    // dejaría las dos líneas en el archivo y el defecto vivo.
    const iEspera = fuente.indexOf("__reactProps$");
    const iFill = fuente.indexOf("pgLogin.fill('#login-email'");
    expect(iEspera, 'no hay espera de hidratación en el login').toBeGreaterThan(-1);
    expect(iFill, 'ya no se llena el campo de correo: revisa esta guarda').toBeGreaterThan(-1);
    expect(iEspera, 'la espera tiene que ir ANTES del primer fill').toBeLessThan(iFill);

    // Y que lo que se espera sea el HANDLER, no un proxy suyo: la presencia del
    // input no dice nada sobre si un submit ya tiene dónde caer.
    expect(fuente).toContain("typeof form[clave]?.onSubmit === 'function'");
    // Un `waitForTimeout` en el login sería volver a adivinar el reloj. Se ancla a
    // la LLAMADA y no a la palabra: la primera versión de esta línea buscaba
    // `waitForTimeout` a secas y enrojeció contra el COMENTARIO de al lado, que
    // explica justamente que no se usa. P34 dentro de la guarda que lo vigila.
    const bloqueLogin = fuente.slice(fuente.indexOf('login por la página real'), iFill);
    expect(bloqueLogin).not.toContain('await pgLogin.waitForTimeout(');
  });

  it('NINGÚN mensaje de error se imprime sin pasar por `sinUrls`', () => {
    // La regla es sin excepciones a propósito: una regla con excepciones es una
    // regla que alguien tiene que recordar. Si mañana aparece un `.slice` crudo
    // sobre un mensaje de error, esto enrojece.
    const crudos = fuente.match(/String\(e\?\.message \?\? e\)\.slice\(/g) ?? [];
    expect(crudos, 'un mensaje de error se imprime sin redactar la URL').toHaveLength(0);
    const redactados = fuente.match(/sinUrls\(String\(e\?\.message \?\? e\)/g) ?? [];
    expect(redactados.length, 'se esperaban los 5 puntos de error redactados').toBeGreaterThanOrEqual(5);
  });

  it('la redacción vive en TS, donde los tres instrumentos la vigilan', () => {
    // Si volviera al `.mjs`, dejaría de tener control positivo: es exactamente el
    // motivo por el que `decidirPasarela` salió de aquí.
    expect(fuente).toContain("await import(new URL('redaccion.ts', BASE_LIB).href)");
  });
});
