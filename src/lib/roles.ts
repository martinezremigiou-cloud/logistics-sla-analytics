// ============================================================
// Bloque 7-A · FASE ROL VISITANTE · lib/roles.ts
// Fuente ÚNICA de las etiquetas es-MX de rol y del listado de roles
// válidos — antes duplicadas ad-hoc como ternarios sueltos en
// `sidebar.tsx`, `sin-permiso.tsx` y `config-usuarios.tsx` (los 3
// etiquetaban CUALQUIER rol distinto de 'admin' como "KAM", un bug
// real una vez que existe un tercer rol).
//
// `ETIQUETA_ROL` es un `Record<Rol, string>` a propósito: agregar un
// rol futuro al tipo `Rol` (en `types/enums.ts`) ROMPE la
// compilación aquí hasta que se le dé una etiqueta — no puede
// olvidarse en silencio como pasaba con los ternarios.
// ============================================================
import type { Rol } from '@/types/enums';

// ============================================================
// [ROL-SOPORTE · 22-sep-2026] EL PERMISO DE ESTA CASA TIENE DOS EJES, y
// confundirlos ya produjo DOS afirmaciones falsas el mismo dia — una en el
// COMMENT del catalogo de la base y otra en lo que se comunico sobre el rol.
//
//   eje 1 · dato COMPARTIDO — catalogo, clasificacion, familias, marcas,
//           usuarios, imagenes, pendientes, override. La regla es `is_admin()`.
//           => kam, visitante y soporte SOLO LEEN.
//   eje 2 · dato PROPIO — proyectos, partidas, seguimientos, preferencias.
//           La regla es «es tuyo», NO el rol: medido, hay 12 policies de
//           escritura sin `is_admin()`, y solo UNA mira el rol: el INSERT de
//           proyectos (lista blanca de 0042). Las otras 11 piden propiedad
//           (`propietario` o `perfil_id` = `auth.uid()`) y nada mas.
//           => admin, kam y soporte ESCRIBEN. visitante NO CREA proyectos
//           (0042), pero SI escribe sus seguimientos y sus preferencias: esas
//           policies no miran el rol (0026) y sus rutas usan `requireSession`,
//           por decision de producto. Y una cuenta degradada a visitante
//           conserva UPDATE/DELETE sobre lo que ya posee (B8-11).
//
// `soporte` es GEMELO DE `kam` en los DOS ejes. **No es un rol de solo lectura**,
// y esa frase no debe volver a escribirse sin decir de que eje habla — una
// asercion de «solo lectura» sobre una ruta del eje 1 es correcta, y generalizarla
// al rol es el error que costo este arreglo.
// ============================================================

export const ETIQUETA_ROL: Record<Rol, string> = {
  admin: 'Admin',
  kam: 'KAM',
  visitante: 'Visitante',
  soporte: 'Soporte',
};

/**
 * Roles válidos, en el orden en que deben listarse en la UI (alta, cambio
 * de rol). `kam, visitante, admin` (fix I21, ronda 2 de revisor-codigo):
 * el orden anterior (`admin, kam, visitante`) ponía la opción MÁS
 * destructiva primero, tanto en el select de alta (`AltaUsuarioDialog`,
 * cuyo default sigue siendo `'kam'` — solo cambia el orden de las
 * opciones) como en el menú de cambio de rol de cada fila
 * (`ConfigUsuarios`). Dejar "Admin" al final reduce el riesgo de un click
 * accidental en la opción de mayor privilegio.
 */
/**
 * TODOS los roles que EXISTEN en el tipo. Se DERIVA de `ETIQUETA_ROL`, que es un
 * `Record<Rol, string>`: un rol nuevo entra aquí solo, sin que nadie se acuerde.
 */
export const ROLES_TODOS = Object.keys(ETIQUETA_ROL) as readonly Rol[];

/**
 * Los roles que la interfaz OFRECE hoy — el `select` del alta y el menú de
 * cambio de rol. **NO es lo mismo que `ROLES_TODOS`, y la diferencia es el
 * arreglo de un defecto medido el 22-sep-2026.**
 *
 * 🔴 EL DEFECTO: este arreglo alimenta DOS superficies —`config-usuarios.tsx`
 * (los dos `ROLES.map`) y `ROL_ENUM` de `schemas/usuarios.schema.ts`— y al meter
 * `soporte` aquí quedó ofrecido en la UI y aceptado por zod **mientras el CHECK
 * vivo de `perfiles` seguía en tres valores**, porque la `0043` no está
 * aplicada. El camino completo, trazado: un admin elige «Soporte» → zod lo
 * acepta → `crearUsuario` llama a `auth.admin.createUser` y **la cuenta queda
 * creada y confirmada** → el trigger `handle_new_user` le clava `rol='kam'` →
 * el UPDATE a `'soporte'` choca con `perfiles_rol_check` (23514) → 500 → el
 * admin lee «No se pudo crear el usuario» y **nunca ve la contraseña
 * temporal**, mientras en el portal vive una cuenta **kam** que sí escribe
 * proyectos. La escritura en GoTrue va ANTES del UPDATE que revienta y nada la
 * revierte.
 *
 * Es la misma forma que el candado de la ingesta: **código en un sitio, base en
 * otro.** Y la regla que este bloque ya había aplicado entre la `0042` y la
 * `0043` —cerrar la condición antes de crear el caso— se me escapó una capa más
 * arriba: el TIPO puede ganar el rol antes que la base (eso es lo que obliga a
 * decidir en cada `Record<Rol, X>`), pero **la UI no puede ofrecerlo antes que
 * la base lo admita**.
 *
 * ✅ DISPARADOR CUMPLIDO EL 22-sep-2026: la `0043` está en
 * `supabase_migrations.schema_migrations` (su `version` registrada, y el CHECK
 * vivo admite los cuatro valores — comprobado por consulta, no por el resultado
 * de la llamada). `soporte` pasa a ofrecerse.
 *
 * ⚠ Y EL DISPARADOR NO ESTÁ MECANIZADO, dicho aquí para que nadie lo suponga:
 * NINGUNA prueba se pone roja cuando la migración aterriza. Se midió — con las
 * tres aplicadas, la suite seguía verde 14 de 14 — y no se puede cerrar desde
 * `vitest` sin que `npm run verificar` vuelva a leer la base, que es lo que
 * `GATE-B1` está cerrando. Hueco con nombre en `docs/known-limitations.md`:
 * `DISPARADOR-DE-DESESTACIONAR-UN-ROL-NO-ESTA-MECANIZADO`.
 *
 * ⚠ Y SU SITIO EN LA LISTA CAMBIÓ CON ÉL, porque la razón que lo ponía junto a
 * `visitante` era «los dos de solo lectura» — y eso dejó de ser verdad. Va junto
 * a `kam`, que es su gemelo real en los dos ejes. Admin sigue AL FINAL por el
 * motivo de siempre: la opción más destructiva no va primero (fix I21).
 *
 * Lo que NO cambia es el mecanismo: `ROLES_SIN_CARRIL_EN_LA_BASE` sigue
 * existiendo, vacía, para el rol que venga. Vaciarla no la vuelve inútil — el
 * reparto que exige `roles.test.ts` es lo que impide que un rol nuevo se quede
 * sin decidir en ninguna de las dos.
 */
export const ROLES: readonly Rol[] = ['kam', 'soporte', 'visitante', 'admin'] as const;

/**
 * Roles que EXISTEN en el tipo pero que la base todavía RECHAZA, así que la
 * interfaz no puede ofrecerlos. `roles.test.ts` exige que cada rol esté en
 * EXACTAMENTE una de las dos listas: un rol nuevo no puede quedar en ninguna.
 *
 * **VACÍA desde el 22-sep-2026**, y que esté vacía es información, no ausencia
 * de ella: dice que hoy no hay ningún rol escrito en el tipo esperando a la
 * base. El `Rol[]` explícito —en vez de `as const`— es a propósito: un
 * `[] as const` se infiere como `never[]` y el día que haya que estacionar un
 * rol habría que cambiar el tipo además del valor.
 *
 * CÓMO SE USA: un rol nuevo entra AQUÍ el mismo commit en que entra al tipo, y
 * se muda a `ROLES` cuando su migración esté en el ledger. Nunca al revés — ese
 * orden es el arreglo de un defecto medido: ofrecer un rol que el CHECK rechaza
 * CREA la cuenta en GoTrue y luego revienta el UPDATE, dejando un `kam` vivo y
 * un «No se pudo crear el usuario» en pantalla.
 *
 * Y cada entrada DECLARA la migración que la desestaciona. Es un campo
 * obligatorio del tipo, así que estacionar un rol sin decir qué lo libera **no
 * compila** — eso sí es mecánico. Lo que NO se puede mecanizar desde aquí es el
 * otro lado: que alguien se dé cuenta de que la migración ya aterrizó. Ver
 * `DISPARADOR-DE-DESESTACIONAR-UN-ROL-NO-ESTA-MECANIZADO` en la deuda.
 */
export interface RolEstacionado {
  /** El rol que existe en el tipo y la base todavía rechaza. */
  rol: Rol;
  /**
   * El basename EXACTO del `.sql` que lo desestaciona, sin extensión. Es un
   * campo OBLIGATORIO del tipo y ahí está su valor: la parte de este mecanismo
   * que **sí** es mecánica no es la de acordarse de mudar el rol —eso no se
   * puede cerrar desde `vitest`— sino que **estacionar un rol sin nombrar su
   * migración no compila**. `roles.test.ts` comprueba además que el archivo
   * exista, y prueba que ese comprobador NO es un no-op.
   */
  migracion: string;
}

export const ROLES_SIN_CARRIL_EN_LA_BASE: readonly RolEstacionado[] = [];

/**
 * [MVP-2 · frente E, vocabulario] Visibilidad del vocabulario técnico
 * "clasificación v2" en la UI (badges, pill, alertas y sub-enlaces que lo
 * nombran) — decisión de producto: Admin lo conserva; KAM y Visitante dejan de
 * verlo (comparten `false` a propósito: la distinción KAM vs Visitante
 * sigue pendiente, `types/enums.ts:2-7`, y este bloque no la abre).
 * `Record<Rol, boolean>` a propósito, mismo molde que `ETIQUETA_ROL`: un rol
 * nuevo rompe la compilación aquí hasta decidir explícitamente si hereda el
 * vocabulario técnico.
 */
export const MUESTRA_CLASIFICACION_V2: Record<Rol, boolean> = {
  admin: true,
  kam: false,
  visitante: false,
  // Gemelo de `visitante`: el vocabulario tecnico de la v2 no es suyo.
  soporte: false,
};

/**
 * ¿Este rol ve las «preguntas de tecnología por resolver» del tablero?
 *
 * 🔴 NACE DE UN DEFECTO MEDIDO [FIX-B1 · T3]: el KPI de tecnología del
 * Dashboard salía de la RPC `contar_pendientes()` (0009), que cuenta la
 * bandeja de pendientes — dato del EJE 1 (`is_admin()`), sólo visible para
 * `admin`. Para cualquier otro rol la RPC devuelve `abiertos: 0` de forma
 * legítima (RLS, no un bug de la consulta), y el tablero servía ese 0 como
 * si fuera la cifra real: un KAM veía «0 sin tecnología asignada» y
 * «Pendientes de datos» en 0 con pendientes abiertas de verdad. No era P17 (universo
 * vacío) — era un 0 FABRICADO por el permiso, servido sin decir de dónde
 * salía.
 *
 * `Record<Rol, boolean>`, mismo molde que `MUESTRA_CLASIFICACION_V2` y
 * `PUEDE_ESCRIBIR_PROYECTOS`: un rol nuevo no compila hasta decidir
 * explícitamente si hereda esta bandeja.
 *
 * La corrección NO es calcular un número alternativo para los demás roles:
 * es OCULTAR la superficie entera para quien la RPC no le cuenta la verdad
 * — la tarjeta «Pendientes de datos» y los dos renglones de tecnología en
 * «SKUs en catálogo» (`dashboard-kpis.tsx`). Se oculta POR ROL, nunca
 * porque el valor dé cero: un cero real (KAM sin nada pendiente) y un cero
 * fabricado (KAM sin permiso) se ven idénticos en pantalla, así que la
 * única forma honesta de no mentir es no mostrar nada donde el dato no es
 * de fiar.
 */
export const MUESTRA_PREGUNTAS_POR_RESOLVER: Record<Rol, boolean> = {
  admin: true,
  kam: false,
  visitante: false,
  // Gemelo de `visitante` y `kam` en ESTE eje (dato COMPARTIDO, `is_admin()`)
  // aunque `soporte` sea gemelo de `kam` en el eje de escritura — los dos
  // ejes no se mueven juntos (ver la cabecera de este archivo).
  soporte: false,
};

/**
 * ¿Este rol puede CREAR y EDITAR proyectos?
 *
 * 🔴 NACE DE UN DEFECTO MEDIDO, y hay que contarlo entero porque el defecto no
 * era un descuido: era la FORMA del permiso.
 *
 * `types/enums.ts` declara desde el Bloque 7-A que «ningún permiso se concede
 * jamás comparando contra 'kam'/'visitante' directamente». Medido el
 * 22-sep-2026, esa frase era **falsa en SEIS sitios**, y los seis estaban
 * escritos como LISTA NEGRA —«todos menos visitante»— en vez de lista blanca:
 *
 *   src/lib/api/auth.ts            `rol === 'visitante'`  (el gate de escritura)
 *   proyectos-view.tsx                 `rol === "visitante"`
 *   proyecto-detalle-view.tsx          `rol === "visitante"`
 *   reasignar-huerfano-dialog.tsx      `u.rol !== "visitante"`
 *   migración 0024, policy de INSERT   `p.rol <> 'visitante'`
 *   migración 0025, policy de rescate  `p.rol <> 'visitante'`
 *
 * **Una lista negra deja al rol SIGUIENTE fallando en ABIERTO.** Cualquier rol
 * nuevo «no es visitante», así que pasa los seis y nace con permiso de
 * ESCRITURA — en las dos capas a la vez, así que ninguna tapa a la otra. Y
 * `tsc` no denuncia ni uno: las comparaciones contra un literal compilan
 * perfectamente con un tipo ampliado.
 *
 * Con `Record<Rol, boolean>` —mismo molde que `ETIQUETA_ROL` y
 * `MUESTRA_CLASIFICACION_V2`— el rol siguiente **no compila** hasta que alguien
 * decida explícitamente si escribe. Falla en CERRADO, y falla ruidosamente.
 *
 * ⚠ Para los tres roles de hoy el resultado es IDÉNTICO al de la lista negra:
 * `admin` y `kam` escriben, `visitante` no. Esto no cambia ni un permiso
 * vigente — cambia quién tiene que decidir la próxima vez.
 *
 * ────────────────────────────────────────────────────────────
 * 🔴 Y LA PRÓXIMA VEZ FUE EL MISMO DÍA. El 22-sep-2026, unas horas después de
 * escribir esto, se firmó **«soporte escribe»** — y este Record es justo el
 * sitio donde esa firma se teclea. Lo que hay que retener no es el valor nuevo:
 * es que **la lista blanca funcionó como se esperaba en el caso que menos se
 * espera**. No hubo que buscar seis sitios; hubo que cambiar UNO y `tsc` guió
 * al resto.
 *
 * ⚠ Y LA TENTACIÓN QUE HAY QUE NOMBRAR PARA NO CAER EN ELLA: con `soporte`
 * escribiendo, la lista negra vieja (`rol <> 'visitante'`) **daría hoy
 * exactamente el mismo resultado** que esta lista blanca, así que parece que ya
 * no hace falta. Es P25 en su forma pura: **el resultado correcto por la razón
 * equivocada.** La lista blanca no vale por lo que decide hoy — vale porque el
 * rol NÚMERO CINCO no hereda permiso por no estar nombrado. Volver a la lista
 * negra ahora sería deshacer `x0lv9g3` a cambio de nada.
 */
export const PUEDE_ESCRIBIR_PROYECTOS: Record<Rol, boolean> = {
  admin: true,
  kam: true,
  visitante: false,
  // `soporte` ESCRIBE, y es GEMELO EXACTO DE `kam` en los DOS ejes. Firma del
  // 22-sep-2026, después de que la medición desmontara la frase con la
  // que se le había presentado el rol:
  //
  //   eje 1 · dato COMPARTIDO (catálogo, clasificación, familias, marcas,
  //           usuarios) -> cuelga de `is_admin()` -> soporte SÓLO LEE
  //   eje 2 · dato PROPIO (proyectos, partidas, seguimientos, preferencias)
  //           -> la regla es «es tuyo», no el rol -> soporte ESCRIBE
  //
  // 🔴 Este valor era `false`, y el `false` venía de haber dicho que el
  // rol era «de sólo lectura». Eso era falso, y el defecto de método está
  // nombrado: se contaron las 18 policies que MENCIONAN un rol y se concluyó
  // sobre el universo entero — las 12 sin `is_admin()`, que son
  // precisamente las que deciden el eje 2, no estaban en la consulta. Es
  // `UN-CERO-SIN-UNIVERSO-NO-ES-UNA-MEDICION`.
  //
  // «Gemelo de `kam`» era literalmente cierto desde el principio; lo que estaba
  // mal era la traducción de esa frase a «sólo lectura».
  soporte: true,
};
