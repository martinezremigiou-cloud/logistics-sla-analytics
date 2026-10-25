// ============================================================
// Bloque 5 · API · usuarios.service.ts  (Admin API — WRITE/READ admin)
// GET /api/usuarios (lista) · POST /api/usuarios (alta) ·
// PATCH /api/usuarios/[id] (rol/suspender/reactivar/reset_password).
// Recibe SIEMPRE un cliente `service_role` (`admin`) ya autorizado por
// el gate `requireAdminSession` del route — este servicio no vuelve a
// verificar rol; asume que el caller ya lo hizo con el cliente de
// sesión ANTES de construir el cliente service_role (ver rutas).
// Auth se opera vía `admin.auth.admin.*` (GoTrue Admin API, bypassa
// RLS); `rol` vive en `perfiles` (Postgres) — cada mutación de cuenta
// puede requerir tocar una, la otra, o ambas fuentes.
// `UsuarioItem`/`ActualizarUsuarioResult` viven en `@/types/api` (M2):
// son DTOs de respuesta compartidos con el cliente (`config-usuarios.tsx`).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { generarContrasenaTemporal } from '@/lib/passwords';
import type { AltaUsuarioBody, PatchUsuarioBody } from '@/schemas/usuarios.schema';
import type { UsuarioItem, ActualizarUsuarioResult } from '@/types/api';
import type { Rol } from '@/types/enums';

export type { UsuarioItem, ActualizarUsuarioResult };

/** Alta de usuario (POST): shape reducido, sin `suspendido` (un alta nunca nace suspendida). */
export interface UsuarioBasico {
  id: string;
  email: string;
  rol: Rol;
}

export type CrearUsuarioResult =
  | { ok: true; usuario: UsuarioBasico; password_temporal: string }
  | { ok: false; motivo: 'duplicado' };

/** Fila cruda de `perfiles` (select mínimo: join en memoria contra `auth.admin.listUsers()`). */
interface PerfilRolRow {
  id: string;
  rol: Rol;
}

/**
 * Vista mínima y defensiva del `User` de GoTrue: solo los campos que
 * este servicio consume. `banned_until` (señal de suspensión que deja
 * `auth.admin.updateUserById(id, { ban_duration })`) no está garantizado
 * en el tipo `User` de todas las versiones de `@supabase/supabase-js` —
 * se accede a través de este tipo local documentado en vez de asumir
 * el shape completo (sin `any`; la asignación desde `User` es válida
 * porque aquí todo es opcional salvo `id`, siempre presente).
 */
interface UsuarioAuthRow {
  id: string;
  email?: string;
  banned_until?: string;
}

/** `ban_duration` "indefinido" (~100 años) — reversible en cualquier momento con 'reactivar'. */
const BAN_SUSPENDIDO = '876000h';
const BAN_NINGUNO = 'none';

const USUARIOS_POR_PAGINA = 100;
/**
 * Cap defensivo de páginas de `listUsers` (M3). Este es un portal
 * INTERNO con pocos usuarios esperados (mismo supuesto que la cota de
 * body en `lib/api/body.ts`) — una sola página de 100 basta casi
 * siempre. El loop de abajo sigue paginando mientras la página venga
 * LLENA (`=== USUARIOS_POR_PAGINA`), por si el equipo creciera más
 * allá de eso; este cap es un paracaídas contra un loop indefinido si
 * `listUsers` cambiara de comportamiento — nunca se espera alcanzarlo
 * en este portal.
 */
const USUARIOS_MAX_PAGINAS = 10;

/** Trae TODOS los usuarios de GoTrue, paginando mientras la página venga llena (ver `USUARIOS_MAX_PAGINAS`). */
async function listarTodosUsuariosAuth(admin: SupabaseClient): Promise<UsuarioAuthRow[]> {
  const usuarios: UsuarioAuthRow[] = [];
  for (let page = 1; page <= USUARIOS_MAX_PAGINAS; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USUARIOS_POR_PAGINA });
    if (error) throw new Error('auth.admin.listUsers: ' + error.message);
    const pagina = data.users as UsuarioAuthRow[];
    usuarios.push(...pagina);
    if (pagina.length < USUARIOS_POR_PAGINA) break;
  }
  return usuarios;
}

/** `true` si `bannedUntil` (ISO) existe y cae en el futuro respecto de `ahora` (epoch ms). */
function estaSuspendido(bannedUntil: string | undefined, ahora: number): boolean {
  if (!bannedUntil) return false;
  const t = Date.parse(bannedUntil);
  return Number.isFinite(t) && t > ahora;
}

/**
 * `true` si el error de `auth.admin.createUser` indica que el correo ya
 * está registrado. GoTrue reporta esto con status 422 y (en versiones
 * recientes) `code:'email_exists'`; el chequeo de mensaje es un
 * fallback adicional para versiones que solo difieren en texto — nunca
 * se expone este detalle al cliente (el route solo emite `usuario_duplicado`).
 */
function esEmailDuplicado(error: { status?: number; code?: string; message: string }): boolean {
  if (error.status === 422) return true;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already.*(registered|exists)/i.test(error.message);
}

/** Reconstruye el `UsuarioItem` fresco (post-mutación) desde GoTrue + `perfiles`. */
async function construirUsuarioItem(admin: SupabaseClient, id: string): Promise<UsuarioItem> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error) throw new Error('auth.admin.getUserById: ' + error.message);
  const usuarioAuth = data.user as UsuarioAuthRow;

  const { data: perfilData, error: perfilError } = await admin
    .from('perfiles')
    .select('rol')
    .eq('id', id)
    .maybeSingle();
  if (perfilError) throw new Error('perfiles: ' + perfilError.message);
  const perfilRow = perfilData as { rol: Rol } | null;

  return {
    id: usuarioAuth.id,
    email: usuarioAuth.email ?? '',
    rol: perfilRow?.rol ?? 'visitante',
    suspendido: estaSuspendido(usuarioAuth.banned_until, Date.now()),
  };
}

/**
 * Lista de usuarios (join en memoria `auth.admin.listUsers()` ×
 * `perfiles`), ordenada por email ASC. Perfil ausente (carrera con el
 * trigger `handle_new_user`) → `rol:'visitante'` (fail-closed: degrada
 * SIEMPRE al rol menos privilegiado — hoy 'kam' y 'visitante' tienen
 * exactamente los mismos permisos, así que este cambio es semántico,
 * sin efecto funcional; deja de asumir 'kam' arbitrariamente y
 * prepara B8, donde 'visitante' pierde acceso a "Mis proyectos").
 */
export async function listarUsuarios(admin: SupabaseClient): Promise<UsuarioItem[]> {
  const usuariosAuth = await listarTodosUsuariosAuth(admin);

  const { data: perfilesData, error: perfilesError } = await admin.from('perfiles').select('id,rol');
  if (perfilesError) throw new Error('perfiles: ' + perfilesError.message);

  const rolPorId = new Map<string, Rol>();
  for (const p of (perfilesData ?? []) as PerfilRolRow[]) {
    rolPorId.set(p.id, p.rol);
  }

  const ahora = Date.now();
  const items: UsuarioItem[] = usuariosAuth.map((u) => ({
    id: u.id,
    email: u.email ?? '',
    rol: rolPorId.get(u.id) ?? 'visitante',
    suspendido: estaSuspendido(u.banned_until, ahora),
  }));

  return items.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
}

/**
 * Alta de usuario (admin). Genera una contraseña temporal (se muestra
 * UNA vez en la respuesta; jamás se loggea), crea la cuenta en GoTrue
 * ya confirmada (`email_confirm:true`, sin correo de verificación) —
 * el trigger `handle_new_user` crea el perfil con `rol:'kam'`; si se
 * pidió cualquier rol DISTINTO de 'kam' (hoy 'admin' o 'visitante') se
 * promueve con un UPDATE adicional (Bloque 7-A: antes solo se cubría
 * 'admin' — con un 3er rol en el enum, un alta con `rol:'visitante'`
 * habría devuelto `{rol:'visitante'}` en la respuesta mientras la fila
 * real en `perfiles` se quedaba en 'kam' por el default del trigger, un
 * desajuste que el siguiente refetch de `/api/usuarios` habría revelado
 * mostrando "KAM" en vez de "Visitante"). Ese UPDATE pide `.select('id')`
 * y verifica que devolvió EXACTAMENTE 1 fila (auditoría B7A, hallazgo
 * H3): PostgREST responde 204 con `error:null` incluso si el UPDATE
 * afectó 0 filas (p.ej. el perfil del usuario recién creado aún no
 * existe por una carrera con el trigger `handle_new_user`); sin esta
 * verificación la respuesta reportaría el rol pedido mientras `perfiles`
 * se queda en 'kam' — hoy cosmético (kam ≡ visitante en permisos), pero
 * fail-OPEN en cuanto B8 les dé permisos distintos. 0 filas → lanza,
 * nombrando el rol pedido en el mensaje (nunca expuesto crudo al
 * cliente; ver `internalError` en el route). Duplicado (correo ya
 * registrado) → `{ok:false, motivo:'duplicado'}` sin filtrar el error
 * crudo de GoTrue.
 */
export async function crearUsuario(admin: SupabaseClient, input: AltaUsuarioBody): Promise<CrearUsuarioResult> {
  const { email, rol } = input;
  const password = generarContrasenaTemporal();

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    if (esEmailDuplicado(error)) return { ok: false, motivo: 'duplicado' };
    throw new Error('auth.admin.createUser: ' + error.message);
  }

  const nuevo = data.user;

  if (rol !== 'kam') {
    const { data: filasActualizadas, error: updateError } = await admin
      .from('perfiles')
      .update({ rol })
      .eq('id', nuevo.id)
      .select('id');
    if (updateError) throw new Error('perfiles: ' + updateError.message);
    if (!filasActualizadas || filasActualizadas.length === 0) {
      throw new Error(
        `perfiles: la promoción a rol '${rol}' no afectó ninguna fila para el usuario recién creado en GoTrue (id=${nuevo.id}) — el alta quedó inconsistente (perfil probablemente ausente por una carrera con el trigger handle_new_user).`,
      );
    }
  }

  return {
    ok: true,
    usuario: { id: nuevo.id, email: nuevo.email ?? email, rol },
    password_temporal: password,
  };
}

/**
 * Actualiza una cuenta existente según `patch.accion`:
 * - `rol`: UPDATE en `perfiles` (no toca GoTrue).
 * - `suspender`/`reactivar`: `ban_duration` vía GoTrue (no toca `perfiles`).
 * - `reset_password`: nueva contraseña temporal vía GoTrue (se
 *   regresa en `password_temporal`, mostrada UNA vez; jamás se loggea).
 * Regresa el `UsuarioItem` fresco post-mutación — EXCEPTO si la lectura
 * post-mutación falla justo después de un `reset_password` ya
 * irreversible: ahí regresa `usuario:null` (ronda 3, FIX ALTO-1; ver el
 * `catch` de abajo — nunca se fabrica un `UsuarioItem` con datos
 * inventados). El guardarraíl de "no auto-modificarse" vive en el route
 * (antes de llegar aquí).
 */
export async function actualizarUsuario(
  admin: SupabaseClient,
  id: string,
  patch: PatchUsuarioBody,
): Promise<ActualizarUsuarioResult> {
  let password_temporal: string | undefined;

  switch (patch.accion) {
    case 'rol': {
      const { error } = await admin.from('perfiles').update({ rol: patch.rol }).eq('id', id);
      if (error) throw new Error('perfiles: ' + error.message);
      break;
    }
    case 'suspender': {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_SUSPENDIDO });
      if (error) throw new Error('auth.admin.updateUserById: ' + error.message);
      break;
    }
    case 'reactivar': {
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_NINGUNO });
      if (error) throw new Error('auth.admin.updateUserById: ' + error.message);
      break;
    }
    case 'reset_password': {
      password_temporal = generarContrasenaTemporal();
      const { error } = await admin.auth.admin.updateUserById(id, { password: password_temporal });
      if (error) throw new Error('auth.admin.updateUserById: ' + error.message);
      break;
    }
  }

  let usuario: UsuarioItem;
  try {
    usuario = await construirUsuarioItem(admin, id);
  } catch (e) {
    // Si la mutación fue `reset_password`, la contraseña YA quedó rotada en
    // GoTrue — es irreversible, no existe un "des-rotar". Dejar que este
    // error de LECTURA post-mutación tumbe la respuesta (500) perdería esa
    // contraseña para siempre: el usuario quedaría bloqueado sin que el
    // admin llegue a verla, el mismo bug ya reportado, pero por otra
    // vía. (Ronda 3, FIX ALTO-1): YA NO se fabrica un `UsuarioItem` de
    // respaldo para cubrir este hueco —mentía con datos inventados, p.ej.
    // un admin suspendido se reportaba como KAM activo—; el contrato
    // admite `usuario:null` para este caso exacto y el cliente no lo
    // necesita: revela la temporal usando el `UsuarioItem` que YA tenía
    // de la lista, nunca uno fabricado aquí. El error se loggea porque,
    // de otro modo, esta rama queda 100% invisible (antes se tragaba en
    // silencio sin dejar rastro).
    // Para el resto de acciones (rol/suspender/reactivar) no hay
    // contraseña que proteger: se conserva el comportamiento previo y se
    // relanza el error.
    if (password_temporal === undefined) throw e;
    console.error('[usuarios.service] actualizarUsuario: lectura post-mutación falló tras reset_password', e);
    return { usuario: null, password_temporal };
  }

  return password_temporal ? { usuario, password_temporal } : { usuario };
}
