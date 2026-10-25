import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Rol } from '@/types/enums';
import {
  ETIQUETA_ROL,
  MUESTRA_CLASIFICACION_V2,
  MUESTRA_PREGUNTAS_POR_RESOLVER,
  PUEDE_ESCRIBIR_PROYECTOS,
  ROLES,
  ROLES_SIN_CARRIL_EN_LA_BASE,
  ROLES_TODOS,
} from './roles';

describe('ROLES', () => {
  // Fix I21 (revisor-codigo, ronda 2): `kam, visitante, admin` — la opción
  // más destructiva (Admin) va AL FINAL, tanto en el alta como en el menú
  // de cambio de rol (antes: `admin, kam, visitante`, con Admin primero).
  it('OFRECE los cuatro roles, con `soporte` junto a su gemelo `kam` y Admin al final', () => {
    expect(ROLES).toEqual(['kam', 'soporte', 'visitante', 'admin']);
  });

  // ⚠ LA PRUEBA QUE CIERRA EL DEFECTO, y la razón de que `ROLES` ya no sea
  // «todos los roles»: este arreglo alimenta el `select` del alta y el
  // `ROL_ENUM` de zod. Ofrecer un rol que el CHECK de `perfiles` rechaza crea
  // la cuenta en GoTrue y luego revienta el UPDATE — deja un KAM vivo y un
  // «No se pudo crear el usuario» en pantalla.
  it('cada rol del tipo está en EXACTAMENTE una de las dos listas: ni en las dos, ni en ninguna', () => {
    const repartidos = [...ROLES, ...ROLES_SIN_CARRIL_EN_LA_BASE.map((e) => e.rol)].sort();
    expect(repartidos).toEqual([...ROLES_TODOS].sort());
    // Anti-vacuidad: si las dos listas se vaciaran, la línea de arriba pasaría
    // comparando dos arreglos vacíos. Los dos lados tienen que tener gente.
    expect(ROLES.length).toBeGreaterThan(0);
    expect(ROLES_TODOS.length).toBe(ROLES.length + ROLES_SIN_CARRIL_EN_LA_BASE.length);
  });

  // 🔴 AQUÍ IBA UNA AFIRMACIÓN FALSA, Y LA PRUEBA LA DESMINTIÓ EN EL ACTO.
  //
  // Escribí que esta prueba «se puso roja en el momento exacto en que la 0043
  // entró al ledger». **No se puso roja.** Con las tres migraciones ya aplicadas
  // la suite seguía en VERDE, y lo comprobé corriéndola antes de editar nada:
  // 14 de 14. La versión anterior aseveraba `ROLES` sin `soporte` y la lista de
  // estacionamiento con él — y las dos cosas seguían siendo ciertas del CÓDIGO,
  // porque el ledger es estado de EJECUCIÓN y una prueba estática no lo ve.
  //
  // ⚠ CONSECUENCIA, y hay que decirla porque es un hueco y no un detalle: **el
  // disparador de este movimiento NO ESTÁ MECANIZADO.** Nada se pone rojo
  // cuando la migración aterriza; mudar el rol de una lista a la otra depende de
  // que alguien se acuerde. Y NO se puede mecanizar desde aquí: exigiría que
  // `vitest` leyera `supabase_migrations.schema_migrations`, o sea que
  // `npm run verificar` volviera a tocar la base — justo lo que `GATE-B1` está
  // cerrando. Queda como hueco CON NOMBRE en `docs/known-limitations.md`
  // (`DISPARADOR-DE-DESESTACIONAR-UN-ROL-NO-ESTA-MECANIZADO`), no como promesa.
  //
  // Lo que SÍ sostiene el mecanismo, y es la otra mitad: el reparto de arriba
  // —cada rol en EXACTAMENTE una de las dos listas— sí es mecánico, y ése es el
  // que impide que un rol nuevo nazca sin decidir. Vaciar la lista de
  // estacionamiento es el estado correcto de hoy, no la desaparición de nada.
  it('la lista de estacionamiento está VACÍA: no hay ningún rol esperando a la base', () => {
    expect(ROLES_SIN_CARRIL_EN_LA_BASE).toEqual([]);
    expect(ROLES).toContain('soporte');
  });

  // ============================================================
  // LA MITAD MECANIZABLE DEL DISPARADOR, y el límite dicho al lado.
  //
  // No se puede cerrar «alguien tiene que darse cuenta de que la migración
  // aterrizó» — eso exigiría leer el ledger desde `vitest`, o sea devolver a
  // `npm run verificar` la escritura en producción que `G1-1` está quitando.
  //
  // Lo que SÍ se cierra: que un rol se estacione **sin decir qué lo libera**.
  // El campo `migracion` es obligatorio en el tipo —eso lo exige `tsc`— y aquí
  // se comprueba que el archivo exista de verdad.
  //
  // ⚠ Y HOY LA LISTA ESTÁ VACÍA, así que comprobarla sería una guarda sobre un
  // universo vacío (P17): pasaría en verde sin haber mirado nada, y ese verde
  // se leería como «las marcas están bien». Por eso el comprobador se ejercita
  // contra un caso SINTÉTICO en los dos sentidos: eso es lo que demuestra que
  // no es un no-op el día que la lista tenga gente.
  // ============================================================
  const MIGRACIONES = readdirSync(join(process.cwd(), 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''));

  const declaraMigracionQueExiste = (e: { migracion: string }) => MIGRACIONES.includes(e.migracion);

  it('el comprobador de marcas NO es un no-op (se ejercita en los dos sentidos)', () => {
    // 🔴 AQUI DECIA `toBeGreaterThan(40)` Y SE PUSO ROJO EN OTRA RAMA.
    //
    // La intencion era anti-vacuidad: probar que el directorio SI se leyo. Pero
    // el 40 no medía eso — medía CUANTAS migraciones hay, que es un numero de
    // otra cosa y cambia entre ramas. Medido el 23-sep-2026: en `main` sin los
    // commits del carril de CHAT hay exactamente 40, y `40 > 40` es falso. Una
    // prueba de este archivo se puso roja por una migracion que no le incumbe.
    //
    // `UN-PISO-ANTI-VACUIDAD-NO-SE-CALIBRA-CON-UN-NUMERO-DE-OTRA-COSA`. Lo que
    // hace falta es que la lectura no haya salido vacia; que el comprobador
    // FUNCIONA lo demuestran los dos casos sinteticos de abajo, no el tamaño.
    expect(MIGRACIONES.length).toBeGreaterThan(0);
    // (a) una migración que SÍ existe — la del propio rol `soporte`
    expect(declaraMigracionQueExiste({ migracion: '0043_rolsoporte_cuarto_rol_de_solo_lectura' })).toBe(true);
    // (b) una que NO existe: si esto diera true, el comprobador no comprueba
    expect(declaraMigracionQueExiste({ migracion: '9999_esta_migracion_no_existe' })).toBe(false);
  });

  it('todo rol estacionado declara una migración que EXISTE en disco', () => {
    for (const e of ROLES_SIN_CARRIL_EN_LA_BASE) {
      expect(declaraMigracionQueExiste(e), `el rol ${e.rol} declara '${e.migracion}', que no está en supabase/migrations/`).toBe(true);
    }
    // El universo, declarado: hoy son CERO entradas, así que el `for` no corre.
    // Se dice en vez de disimularlo — el comprobador queda probado arriba.
    expect(ROLES_SIN_CARRIL_EN_LA_BASE.length).toBe(0);
  });
});

describe('ETIQUETA_ROL', () => {
  it('trae una etiqueta es-MX correcta para cada rol', () => {
    expect(ETIQUETA_ROL.admin).toBe('Admin');
    expect(ETIQUETA_ROL.kam).toBe('KAM');
    expect(ETIQUETA_ROL.visitante).toBe('Visitante');
  });

  it('tiene EXACTAMENTE una entrada por rol de ROLES (ninguno de más, ninguno de menos)', () => {
    // Guardrail de sincronía: si `Rol` (types/enums.ts) gana un rol nuevo,
    // `Record<Rol,string>` ya obliga a TS a rechazar el build hasta que
    // `ETIQUETA_ROL` le dé etiqueta — este test fija además, en runtime,
    // que `ROLES` (el listado usado por la UI) no se quede desincronizado.
    const clavesEtiqueta = Object.keys(ETIQUETA_ROL).sort();
    const clavesRoles = [...ROLES_TODOS].sort();
    expect(clavesEtiqueta).toEqual(clavesRoles);
  });

  it('cada valor es un string no vacío (sin etiquetas huecas)', () => {
    for (const rol of ROLES_TODOS) {
      expect(typeof ETIQUETA_ROL[rol]).toBe('string');
      expect(ETIQUETA_ROL[rol].trim().length).toBeGreaterThan(0);
    }
  });

  it('type-check: ETIQUETA_ROL acepta indexar con cualquier Rol sin cast', () => {
    const rol: Rol = 'visitante';
    const etiqueta: string = ETIQUETA_ROL[rol];
    expect(etiqueta).toBe('Visitante');
  });
});

describe('MUESTRA_CLASIFICACION_V2', () => {
  // [MVP-2 · frente E] Decisión de producto: Admin conserva el vocabulario
  // técnico "clasificación v2"; KAM y Visitante dejan de verlo (mismo
  // `false` para ambos — la distinción KAM vs Visitante sigue pendiente).
  // ⚠ EL VALOR, NO SOLO LA CLAVE. `Record<Rol, boolean>` obliga a que la clave
  // EXISTA; no dice nada de su contenido. La cabecera de la `0043` afirmaba que
  // `tsc` había exigido «una por una» las tres decisiones sobre `soporte`, y eso
  // era falso para dos de ellas: cambiar este `false` a `true` salía VERDE.
  // `soporte` se queda en `false` AUNQUE ESCRIBA: el vocabulario técnico de la
  // v2 es del eje de la INTERFAZ, no del permiso, y ahí es gemelo de `kam`, que
  // también es `false`. Los dos ejes no se mueven juntos.
  it('admin: true; kam, visitante y soporte: false', () => {
    expect(MUESTRA_CLASIFICACION_V2.admin).toBe(true);
    expect(MUESTRA_CLASIFICACION_V2.kam).toBe(false);
    expect(MUESTRA_CLASIFICACION_V2.visitante).toBe(false);
    expect(MUESTRA_CLASIFICACION_V2.soporte).toBe(false);
  });

  it('tiene EXACTAMENTE una entrada por rol de ROLES (mismo guardrail de sincronía que ETIQUETA_ROL)', () => {
    const clavesVisibilidad = Object.keys(MUESTRA_CLASIFICACION_V2).sort();
    const clavesRoles = [...ROLES_TODOS].sort();
    expect(clavesVisibilidad).toEqual(clavesRoles);
  });
});

// ============================================================
// [FIX-B1 · T3] MUESTRA_PREGUNTAS_POR_RESOLVER — el molde que evita que el
// próximo rol herede un 0 fabricado por el permiso de la RPC.
// ============================================================
describe('MUESTRA_PREGUNTAS_POR_RESOLVER', () => {
  it('admin: true; kam, visitante y soporte: false', () => {
    expect(MUESTRA_PREGUNTAS_POR_RESOLVER.admin).toBe(true);
    expect(MUESTRA_PREGUNTAS_POR_RESOLVER.kam).toBe(false);
    expect(MUESTRA_PREGUNTAS_POR_RESOLVER.visitante).toBe(false);
    expect(MUESTRA_PREGUNTAS_POR_RESOLVER.soporte).toBe(false);
  });

  it('tiene EXACTAMENTE una entrada por rol de ROLES (mismo guardrail de sincronía que ETIQUETA_ROL)', () => {
    const claves = Object.keys(MUESTRA_PREGUNTAS_POR_RESOLVER).sort();
    const clavesRoles = [...ROLES_TODOS].sort();
    expect(claves).toEqual(clavesRoles);
  });
});

// ============================================================
// [ROL-SOPORTE] PUEDE_ESCRIBIR_PROYECTOS · la lista blanca que sustituyó a
// seis listas negras.
//
// El defecto que la motiva: seis sitios preguntaban «¿es visitante?» en vez de
// «¿puede escribir?» — cuatro en TypeScript y dos en policies de la base. Un
// rol NUEVO no es visitante, así que pasaba los seis y nacía con permiso de
// ESCRITURA, en las dos capas a la vez. Y `tsc` no denunciaba ninguno: una
// comparación contra un literal compila igual con el tipo ampliado.
// ============================================================
describe('PUEDE_ESCRIBIR_PROYECTOS', () => {
  // ⚠ EL VALOR DE `soporte`, que cambió el mismo día que se creó el rol. Firma
  // de producto: escribe, gemelo de `kam`. Sin esta aserción, `Record<Rol, boolean>`
  // deja el valor al gusto de quien edite — es la lección de M5.
  it('soporte ESCRIBE (gemelo de kam), y visitante no', () => {
    expect(PUEDE_ESCRIBIR_PROYECTOS.soporte).toBe(true);
    expect(PUEDE_ESCRIBIR_PROYECTOS.kam).toBe(true);
    expect(PUEDE_ESCRIBIR_PROYECTOS.visitante).toBe(false);
  });

  // ⚠ ESTA ES LA PRUEBA QUE IMPORTA, y no la cubre `tsc`: `Record<Rol, boolean>`
  // obliga a que estén los roles del TIPO, pero `ROLES` es un `readonly Rol[]`
  // —un arreglo— y un arreglo no se invalida por ampliar el tipo. Si alguien
  // añade un rol al tipo y a `ROLES` pero olvida este Record, TS lo caza; si lo
  // añade al tipo y al Record pero olvida `ROLES`, esto lo caza.
  it('tiene EXACTAMENTE una entrada por rol de ROLES (ninguno de más, ninguno de menos)', () => {
    expect(Object.keys(PUEDE_ESCRIBIR_PROYECTOS).sort()).toEqual([...ROLES_TODOS].sort());
  });

  // EQUIVALENCIA CON LA LISTA NEGRA QUE SUSTITUYE, acotada a los TRES roles que
  // existían cuando se hizo el cambio. Para ellos tenía que ser un cambio de
  // FORMA y no de permisos, y si alguno se movió es un defecto.
  const ANTERIORES_AL_CAMBIO = ['kam', 'admin', 'visitante'] as const;

  it('para los tres roles ANTERIORES da lo mismo que la lista negra que reemplazó', () => {
    for (const rol of ANTERIORES_AL_CAMBIO) {
      expect(PUEDE_ESCRIBIR_PROYECTOS[rol], `el rol ${rol} cambió de permiso: esto debía ser un cambio de forma`).toBe(
        rol !== 'visitante',
      );
    }
  });

  // ⚠ ESTA PRUEBA SE REESCRIBIÓ EL 22-sep, Y LA RAZÓN VALE MÁS QUE SU CONTENIDO.
  //
  // Decía: «`soporte` es justo donde las dos formas divergen — la lista negra
  // le habría dado escritura y la lista blanca se la niega», y se puso roja sola
  // al crear el rol. Horas después se acordó que **`soporte` ESCRIBE**, y la
  // prueba se puso roja otra vez — pero ahora contra la decisión correcta.
  //
  // El defecto era el TESTIGO: un rol CONCRETO. Una prueba cuyo testigo es un
  // rol concreto caduca en cuanto ese rol cambia de lado, y entonces estorba en
  // vez de vigilar. Es el mismo defecto que tenía la guarda (b) de la `0042`, y
  // se arregla igual en los dos sitios.
  //
  // LO QUE HAY QUE AFIRMAR, y es incómodo porque suena a que la migración no
  // sirvió: **para los cuatro roles de hoy la lista negra daría EXACTAMENTE lo
  // mismo.** O sea que la garantía NO puede venir de los valores. Viene de la
  // FORMA — `Record<Rol, boolean>` no compila con un rol sin decidir— y esa
  // propiedad la vigila `tsc` más la prueba de arriba, no una comparación de
  // permisos. Afirmarlo aquí es lo que impide que alguien lea «da lo mismo» y
  // concluya «entonces vuelvo a la lista negra»: P25, el resultado correcto por
  // la razón equivocada.
  it('para los CUATRO roles de hoy la lista negra daría lo mismo — por eso la garantía es la FORMA, no los valores', () => {
    for (const rol of ROLES_TODOS) {
      expect(
        PUEDE_ESCRIBIR_PROYECTOS[rol],
        `${rol}: hoy coincide con la lista negra. Eso NO autoriza a volver a ella — lo que compra la lista blanca es que el rol NÚMERO CINCO no herede permiso por no estar nombrado.`,
      ).toBe(rol !== 'visitante');
    }
    // Anti-vacuidad: si `ROLES_TODOS` quedara vacío, el `for` no correría y esto
    // saldría verde sin haber comprobado nada.
    expect(ROLES_TODOS.length).toBe(4);
  });

  it('visitante NO escribe; admin, kam y soporte SÍ (el contenido, no sólo la forma)', () => {
    expect(PUEDE_ESCRIBIR_PROYECTOS.visitante).toBe(false);
    expect(PUEDE_ESCRIBIR_PROYECTOS.soporte).toBe(true);
    expect(PUEDE_ESCRIBIR_PROYECTOS.admin).toBe(true);
    expect(PUEDE_ESCRIBIR_PROYECTOS.kam).toBe(true);
  });
});
