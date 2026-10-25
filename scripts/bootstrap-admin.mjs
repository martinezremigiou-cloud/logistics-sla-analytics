// ============================================================
// bootstrap-admin.mjs — utilidad ONE-OFF (Bloque 5).
// Da de alta (o adopta, si ya existe) la cuenta admin fundadora y le
// asigna rol='admin' en `perfiles`. Después de esto, el resto de altas
// de usuario se hacen desde /config (POST /api/usuarios), no desde
// este script.
//
// Uso: node scripts/bootstrap-admin.mjs
// Lee NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de
// `process.env` si están presentes, si no de `.env.local`. NINGUNO de los dos se imprime jamás.
//
// NO es código de producto: no se importa desde `src/`, y este archivo
// corre con `node` plano (.mjs, sin paso de build de TS) — por eso
// `generarContrasenaTemporal` se duplica aquí en vez de importar
// `src/lib/passwords.ts` (mismo algoritmo; ver ese archivo para el
// original documentado, consumido por la app vía TypeScript).
// ============================================================
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ENV_LOCAL = new URL('../.env.local', import.meta.url);
// ────────────────────────────────────────────────────────────
// LA ESCOTILLA DE RESCATE, Y POR QUÉ SU CORREO ES UNA CUENTA DE EMPRESA.
//
// Éste es el ÚNICO camino para volver a tener un administrador si el portal se
// queda sin ninguno: el producto sabe SUSPENDER pero no sabe crear ni eliminar
// admins (deuda A1-14, decidido así desde la `0002`). O sea que el valor de
// esta constante no es un detalle del script — es a quién se le devuelve la
// llave del portal el día peor.
//
// Por eso es una cuenta de la EMPRESA y no una personal: dar de baja una cuenta
// personal sin mover esta línea dejaría la escotilla apuntando a un usuario
// inexistente, y no se notaría hasta el día en que hiciera falta usarla, que
// por definición es el día en que ya no hay otro camino.
//
// ⚠ EL LÍMITE DE ESTE ARREGLO, DICHO AQUÍ: un correo escrito a mano en un
// archivo versionado es OTRA COPIA (P33), y una copia puede envejecer. Lo que
// impide que diverja NO es este comentario: es `src/lib/admin-fundador.test.ts`,
// que cotea esta constante contra `CONTACTOS.software.correo` —el directorio de
// escalada, que sí está bajo revisión de código— y sale ROJO si divergen. Ese
// cotejo detecta DIVERGENCIA, no obsolescencia compartida.
//
// En este repo de ejemplo el valor es un correo de dominio reservado
// (`example.com`): el script NO se ejecuta contra ningún servicio.
// ────────────────────────────────────────────────────────────
const EMAIL_ADMIN_FUNDADOR = 'truiz@example.com';

/** Lee `nombre=valor` de `process.env` primero, si no de `.env.local` (sin imprimir el valor). */
function leerEnv(nombre) {
  if (process.env[nombre]) return process.env[nombre];
  const linea = readFileSync(ENV_LOCAL, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nombre}=`));
  const valor = linea?.slice(`${nombre}=`.length).trim();
  if (!valor) {
    console.error(`[ERROR] ${nombre} no encontrado (ni en env ni en .env.local).`);
    process.exit(1);
  }
  return valor;
}

/** Duplicado intencional de `src/lib/passwords.ts` (ver ese archivo para la documentación completa del algoritmo). */
function generarContrasenaTemporal() {
  const cruda = randomBytes(36).toString('base64url').replace(/[0Oo1lI]/g, '');
  return cruda.length < 14 ? generarContrasenaTemporal() : cruda.slice(0, 14);
}

function esEmailDuplicado(error) {
  if (!error) return false;
  if (error.status === 422) return true;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already.*(registered|exists)/i.test(error.message ?? '');
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const url = leerEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = leerEnv('SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Sin el workaround `cache:'no-store'` de `src/lib/supabase/server.ts`:
  // ese parche existe porque Next.js monkey-patchea el `fetch` global
  // dentro de su propio runtime de request handling; un script `node`
  // plano como este nunca pasa por ahí.
});

let passwordTemporal = null;

process.stdout.write(`\n=== bootstrap-admin: ${EMAIL_ADMIN_FUNDADOR}\n`);

const nuevaPassword = generarContrasenaTemporal();
const { data: creado, error: createError } = await admin.auth.admin.createUser({
  email: EMAIL_ADMIN_FUNDADOR,
  password: nuevaPassword,
  email_confirm: true,
});

if (createError) {
  if (!esEmailDuplicado(createError)) {
    console.error('[ERROR] auth.admin.createUser falló de forma inesperada:', createError.message);
    process.exit(1);
  }
  console.log('[INFO] El usuario ya existía en auth.users — no se generó una contraseña nueva.');
  console.log('[INFO] Continuando para asegurar rol=\'admin\' en perfiles...');
} else {
  passwordTemporal = nuevaPassword;
  console.log('[INFO] Usuario creado en auth.users (email_confirm=true).');
}

// Espera/verifica el perfil creado por el trigger `handle_new_user` (carrera
// posible si PostgREST tarda en ver el commit del INSERT en auth.users).
let perfil = null;
for (let intento = 1; intento <= 10 && !perfil; intento++) {
  const { data, error } = await admin.from('perfiles').select('id,rol').eq('email', EMAIL_ADMIN_FUNDADOR).maybeSingle();
  if (error) {
    console.error('[ERROR] perfiles (lookup):', error.message);
    process.exit(1);
  }
  perfil = data;
  if (!perfil) await dormir(300);
}

if (!perfil) {
  console.error('[ERROR] El trigger handle_new_user no creó el perfil a tiempo. Revisa 0002_rls.sql.');
  process.exit(1);
}

if (perfil.rol !== 'admin') {
  const { error: updateError } = await admin.from('perfiles').update({ rol: 'admin' }).eq('email', EMAIL_ADMIN_FUNDADOR);
  if (updateError) {
    console.error('[ERROR] perfiles (update rol=admin):', updateError.message);
    process.exit(1);
  }
  console.log('[INFO] perfiles.rol actualizado a \'admin\'.');
} else {
  console.log('[INFO] perfiles.rol ya era \'admin\' — nada que actualizar.');
}

console.log('\n=== Listo ===');
console.log(`Email: ${EMAIL_ADMIN_FUNDADOR}`);
if (passwordTemporal) {
  console.log(`Contraseña temporal (se muestra UNA sola vez): ${passwordTemporal}`);
  console.log('Cámbiala de inmediato en /config al iniciar sesión.');
} else {
  console.log('Cuenta ya existente: no se generó/mostró ninguna contraseña.');
  console.log('Si necesitas una nueva, usa PATCH /api/usuarios/[id] {accion:"reset_password"} desde /config.');
}

process.exit(0);
