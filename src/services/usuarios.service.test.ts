import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

const generarContrasenaTemporalMock = vi.fn(() => 'TEMP_PASS_FIJA');
vi.mock('@/lib/passwords', () => ({
  generarContrasenaTemporal: () => generarContrasenaTemporalMock(),
}));

import { listarUsuarios, crearUsuario, actualizarUsuario } from './usuarios.service';

type Resp = { data: unknown; error: { message: string; status?: number; code?: string } | null };

/**
 * Fake `from('perfiles')`: soporta `select().eq().maybeSingle()`, `select()`
 * awaited directo, y `update().eq()` — awaited directo (rama `actualizarUsuario`
 * accion:'rol') O con `.select(cols)` encadenado (rama `crearUsuario`, que
 * verifica filas afectadas — FIX H3). Por defecto `.select()` resuelve al mismo
 * `updateResult`; `updateSelectResult` lo overridea cuando un test necesita que
 * la representación devuelta (filas) difiera de lo que ve la rama sin `.select()`.
 */
function makeFromPerfiles(cfg: { selectAll?: Resp; selectOne?: Resp; updateResult?: Resp; updateSelectResult?: Resp }) {
  const eqCalls: [string, unknown][] = [];

  const updateSpy = vi.fn((patch: unknown) => ({
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      const base = cfg.updateResult ?? { data: null, error: null };
      return {
        select: vi.fn(() => Promise.resolve(cfg.updateSelectResult ?? base)),
        then: (onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(base).then(onF, onR),
      };
    }),
    __patch: patch,
  }));

  const selectSpy = vi.fn((cols: string) => {
    const node = {
      __cols: cols,
      eq: vi.fn((col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return {
          maybeSingle: vi.fn(() => Promise.resolve(cfg.selectOne ?? { data: null, error: null })),
        };
      }),
      then(onF: (v: Resp) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(cfg.selectAll ?? { data: [], error: null }).then(onF, onR);
      },
    };
    return node;
  });

  return { select: selectSpy, update: updateSpy, eqCalls };
}

function makeAdmin(
  perfilesCfg: { selectAll?: Resp; selectOne?: Resp; updateResult?: Resp },
  authAdmin: Partial<{
    listUsers: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
    updateUserById: ReturnType<typeof vi.fn>;
    getUserById: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const fromPerfiles = makeFromPerfiles(perfilesCfg);
  const admin = {
    auth: {
      admin: {
        listUsers: vi.fn(),
        createUser: vi.fn(),
        updateUserById: vi.fn(),
        getUserById: vi.fn(),
        ...authAdmin,
      },
    },
    from: vi.fn((table: string) => {
      if (table !== 'perfiles') throw new Error(`tabla inesperada en el fake admin: ${table}`);
      return fromPerfiles;
    }),
  };
  return { admin: admin as unknown as SupabaseClient, fromPerfiles, authAdmin: admin.auth.admin };
}

beforeEach(() => {
  generarContrasenaTemporalMock.mockClear();
  generarContrasenaTemporalMock.mockReturnValue('TEMP_PASS_FIJA');
});

describe('listarUsuarios', () => {
  it('join en memoria (GoTrue × perfiles), ordenado por email ASC', async () => {
    const { admin, authAdmin } = makeAdmin({
      selectAll: {
        data: [
          { id: 'u-1', rol: 'admin' },
          { id: 'u-2', rol: 'kam' },
        ],
        error: null,
      },
    });
    authAdmin.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: 'u-2', email: 'zeta@example.com' },
          { id: 'u-1', email: 'alfa@example.com' },
        ],
        aud: 'authenticated',
      },
      error: null,
    });

    const result = await listarUsuarios(admin);

    expect(result).toEqual([
      { id: 'u-1', email: 'alfa@example.com', rol: 'admin', suspendido: false },
      { id: 'u-2', email: 'zeta@example.com', rol: 'kam', suspendido: false },
    ]);
    expect(authAdmin.listUsers).toHaveBeenCalledWith({ page: 1, perPage: 100 });
  });

  it('suspendido:true cuando banned_until cae en el futuro; false cuando ya venció o falta', async () => {
    const futuro = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
    const pasado = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: [], error: null } });
    authAdmin.listUsers.mockResolvedValueOnce({
      data: {
        users: [
          { id: 'u-1', email: 'a@example.com', banned_until: futuro },
          { id: 'u-2', email: 'b@example.com', banned_until: pasado },
          { id: 'u-3', email: 'c@example.com' },
        ],
        aud: 'authenticated',
      },
      error: null,
    });

    const result = await listarUsuarios(admin);

    expect(result.find((u) => u.id === 'u-1')?.suspendido).toBe(true);
    expect(result.find((u) => u.id === 'u-2')?.suspendido).toBe(false);
    expect(result.find((u) => u.id === 'u-3')?.suspendido).toBe(false);
  });

  it('perfil ausente (carrera con el trigger) → rol "visitante" por defecto (fail-closed: el rol menos privilegiado)', async () => {
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: [], error: null } });
    authAdmin.listUsers.mockResolvedValueOnce({
      data: { users: [{ id: 'u-1', email: 'nuevo@example.com' }], aud: 'authenticated' },
      error: null,
    });

    const result = await listarUsuarios(admin);

    expect(result).toEqual([{ id: 'u-1', email: 'nuevo@example.com', rol: 'visitante', suspendido: false }]);
  });

  it('error de listUsers → lanza (el route responde 500 sin fuga)', async () => {
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: [], error: null } });
    authAdmin.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: 'gotrue caído' } });

    await expect(listarUsuarios(admin)).rejects.toThrow(/gotrue caído/);
  });

  it('error de perfiles → lanza', async () => {
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: null, error: { message: 'constraint boom secreto' } } });
    authAdmin.listUsers.mockResolvedValueOnce({ data: { users: [] }, aud: 'authenticated', error: null } as never);

    await expect(listarUsuarios(admin)).rejects.toThrow(/constraint boom secreto/);
  });

  function paginaLlena(offset: number) {
    return Array.from({ length: 100 }, (_, i) => ({ id: `u-${offset + i}`, email: `u${offset + i}@example.com` }));
  }

  it('pagina mientras listUsers devuelve páginas LLENAS (perPage 100); se detiene en la primera incompleta', async () => {
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: [], error: null } });
    authAdmin.listUsers
      .mockResolvedValueOnce({ data: { users: paginaLlena(0) }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ id: 'u-100', email: 'u100@example.com' }] }, error: null });

    const result = await listarUsuarios(admin);

    expect(result).toHaveLength(101);
    expect(authAdmin.listUsers).toHaveBeenCalledTimes(2);
    expect(authAdmin.listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 100 });
    expect(authAdmin.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 100 });
  });

  it('cap defensivo de 10 páginas: no hace un 11º llamado aunque todas vengan llenas', async () => {
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: [], error: null } });
    for (let p = 0; p < 10; p++) {
      authAdmin.listUsers.mockResolvedValueOnce({ data: { users: paginaLlena(p * 100) }, error: null });
    }

    const result = await listarUsuarios(admin);

    expect(result).toHaveLength(1000);
    expect(authAdmin.listUsers).toHaveBeenCalledTimes(10);
  });

  it('error de listUsers en una página intermedia (page 2) → lanza igual que en la primera', async () => {
    const { admin, authAdmin } = makeAdmin({ selectAll: { data: [], error: null } });
    authAdmin.listUsers
      .mockResolvedValueOnce({ data: { users: paginaLlena(0) }, error: null })
      .mockResolvedValueOnce({ data: { users: [] }, error: { message: 'gotrue caído en la página 2' } });

    await expect(listarUsuarios(admin)).rejects.toThrow(/gotrue caído en la página 2/);
  });
});

describe('crearUsuario', () => {
  const input = { email: 'nuevo@example.com', rol: 'kam' as const };

  it('rol kam (default): crea en GoTrue, NO toca perfiles, regresa password_temporal', async () => {
    const { admin, authAdmin, fromPerfiles } = makeAdmin({});
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'nuevo-1', email: 'nuevo@example.com' } },
      error: null,
    });

    const result = await crearUsuario(admin, input);

    expect(result).toEqual({
      ok: true,
      usuario: { id: 'nuevo-1', email: 'nuevo@example.com', rol: 'kam' },
      password_temporal: 'TEMP_PASS_FIJA',
    });
    expect(authAdmin.createUser).toHaveBeenCalledWith({
      email: 'nuevo@example.com',
      password: 'TEMP_PASS_FIJA',
      email_confirm: true,
    });
    expect(fromPerfiles.update).not.toHaveBeenCalled();
  });

  it('rol admin: promueve en perfiles tras crear en GoTrue', async () => {
    const { admin, authAdmin, fromPerfiles } = makeAdmin({ updateResult: { data: [{ id: 'nuevo-2' }], error: null } });
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'nuevo-2', email: 'admin-nuevo@example.com' } },
      error: null,
    });

    const result = await crearUsuario(admin, { email: 'admin-nuevo@example.com', rol: 'admin' });

    expect(result).toEqual({
      ok: true,
      usuario: { id: 'nuevo-2', email: 'admin-nuevo@example.com', rol: 'admin' },
      password_temporal: 'TEMP_PASS_FIJA',
    });
    expect(fromPerfiles.update).toHaveBeenCalledWith({ rol: 'admin' });
  });

  it('rol visitante: promueve en perfiles tras crear en GoTrue (mismo tratamiento que admin — cualquier rol distinto del default "kam" del trigger se persiste explícitamente; regresión del bug real fijado en Bloque 7-A)', async () => {
    const { admin, authAdmin, fromPerfiles } = makeAdmin({ updateResult: { data: [{ id: 'nuevo-3' }], error: null } });
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'nuevo-3', email: 'visitante-nuevo@example.com' } },
      error: null,
    });

    const result = await crearUsuario(admin, { email: 'visitante-nuevo@example.com', rol: 'visitante' });

    expect(result).toEqual({
      ok: true,
      usuario: { id: 'nuevo-3', email: 'visitante-nuevo@example.com', rol: 'visitante' },
      password_temporal: 'TEMP_PASS_FIJA',
    });
    expect(fromPerfiles.update).toHaveBeenCalledWith({ rol: 'visitante' });
  });

  it('correo duplicado (status 422) → {ok:false, motivo:"duplicado"}, sin filtrar el mensaje crudo', async () => {
    const { admin, authAdmin, fromPerfiles } = makeAdmin({});
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered', status: 422 },
    });

    const result = await crearUsuario(admin, input);

    expect(result).toEqual({ ok: false, motivo: 'duplicado' });
    expect(fromPerfiles.update).not.toHaveBeenCalled();
  });

  it('correo duplicado detectado por code "email_exists"', async () => {
    const { admin, authAdmin } = makeAdmin({});
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Email exists', code: 'email_exists' },
    });

    const result = await crearUsuario(admin, input);

    expect(result).toEqual({ ok: false, motivo: 'duplicado' });
  });

  it('error genérico de GoTrue (no duplicado) → lanza', async () => {
    const { admin, authAdmin } = makeAdmin({});
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'servicio caído secreto', status: 500 },
    });

    await expect(crearUsuario(admin, input)).rejects.toThrow(/servicio caído secreto/);
  });

  it('error al promover a admin en perfiles → lanza', async () => {
    const { admin, authAdmin } = makeAdmin({ updateResult: { data: null, error: { message: 'constraint boom' } } });
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'nuevo-3', email: 'x@example.com' } },
      error: null,
    });

    await expect(crearUsuario(admin, { email: 'x@example.com', rol: 'admin' })).rejects.toThrow(/constraint boom/);
  });

  it('promoción a rol distinto de "kam" que no afecta ninguna fila (perfil ausente, ej. carrera con handle_new_user) → lanza nombrando el rol pedido (H3: sin esta verificación, PostgREST regresa 204/error:null y la respuesta mentiría el rol)', async () => {
    const { admin, authAdmin, fromPerfiles } = makeAdmin({ updateResult: { data: [], error: null } });
    authAdmin.createUser.mockResolvedValueOnce({
      data: { user: { id: 'nuevo-4', email: 'huerfano@example.com' } },
      error: null,
    });

    await expect(crearUsuario(admin, { email: 'huerfano@example.com', rol: 'admin' })).rejects.toThrow(/admin/);
    expect(fromPerfiles.update).toHaveBeenCalledWith({ rol: 'admin' });
  });
});

describe('actualizarUsuario', () => {
  function cfgConUsuarioFresco(rol: Rol) {
    return {
      selectOne: { data: { rol }, error: null },
    };
  }

  it('accion "rol": UPDATE en perfiles, no toca GoTrue admin ban/password', async () => {
    const { admin, fromPerfiles, authAdmin } = makeAdmin(cfgConUsuarioFresco('admin'));
    authAdmin.getUserById.mockResolvedValueOnce({ data: { user: { id: 'u-1', email: 'a@example.com' } }, error: null });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'rol', rol: 'admin' });

    expect(fromPerfiles.update).toHaveBeenCalledWith({ rol: 'admin' });
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
    expect(result).toEqual({ usuario: { id: 'u-1', email: 'a@example.com', rol: 'admin', suspendido: false } });
  });

  it('accion "rol" con rol:"visitante": UPDATE en perfiles igual que con "admin" (Bloque 7-A)', async () => {
    const { admin, fromPerfiles, authAdmin } = makeAdmin(cfgConUsuarioFresco('visitante'));
    authAdmin.getUserById.mockResolvedValueOnce({ data: { user: { id: 'u-1', email: 'a@example.com' } }, error: null });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'rol', rol: 'visitante' });

    expect(fromPerfiles.update).toHaveBeenCalledWith({ rol: 'visitante' });
    expect(authAdmin.updateUserById).not.toHaveBeenCalled();
    expect(result).toEqual({ usuario: { id: 'u-1', email: 'a@example.com', rol: 'visitante', suspendido: false } });
  });

  it('accion "suspender": ban_duration largo vía GoTrue', async () => {
    const { admin, authAdmin } = makeAdmin(cfgConUsuarioFresco('kam'));
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: {} }, error: null });
    authAdmin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@example.com', banned_until: '2099-01-01T00:00:00.000Z' } },
      error: null,
    });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'suspender' });

    expect(authAdmin.updateUserById).toHaveBeenCalledWith('u-1', { ban_duration: '876000h' });
    expect(result.usuario?.suspendido).toBe(true);
    expect(result.password_temporal).toBeUndefined();
  });

  it('accion "reactivar": ban_duration "none" vía GoTrue', async () => {
    const { admin, authAdmin } = makeAdmin(cfgConUsuarioFresco('kam'));
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: {} }, error: null });
    authAdmin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
      error: null,
    });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'reactivar' });

    expect(authAdmin.updateUserById).toHaveBeenCalledWith('u-1', { ban_duration: 'none' });
    expect(result.usuario?.suspendido).toBe(false);
  });

  it('perfil ausente en la lectura post-mutación (construirUsuarioItem) → rol "visitante" por defecto (fail-closed, Bloque 7-A)', async () => {
    const { admin, authAdmin } = makeAdmin({ selectOne: { data: null, error: null } });
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: {} }, error: null });
    authAdmin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
      error: null,
    });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'reactivar' });

    expect(result.usuario).toEqual({ id: 'u-1', email: 'a@example.com', rol: 'visitante', suspendido: false });
  });

  it('accion "reset_password": nueva temporal vía GoTrue, regresa password_temporal', async () => {
    const { admin, authAdmin } = makeAdmin(cfgConUsuarioFresco('kam'));
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: {} }, error: null });
    authAdmin.getUserById.mockResolvedValueOnce({
      data: { user: { id: 'u-1', email: 'a@example.com' } },
      error: null,
    });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'reset_password' });

    expect(authAdmin.updateUserById).toHaveBeenCalledWith('u-1', { password: 'TEMP_PASS_FIJA' });
    expect(result.password_temporal).toBe('TEMP_PASS_FIJA');
    expect(result.usuario).toEqual({ id: 'u-1', email: 'a@example.com', rol: 'kam', suspendido: false });
  });

  it('error de GoTrue en updateUserById → lanza', async () => {
    const { admin, authAdmin } = makeAdmin(cfgConUsuarioFresco('kam'));
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'user not found secreto' } });

    await expect(actualizarUsuario(admin, 'u-x', { accion: 'suspender' })).rejects.toThrow(/user not found secreto/);
  });

  it('error de perfiles en accion "rol" → lanza', async () => {
    const { admin } = makeAdmin({ updateResult: { data: null, error: { message: 'constraint boom' } } });

    await expect(actualizarUsuario(admin, 'u-1', { accion: 'rol', rol: 'admin' })).rejects.toThrow(/constraint boom/);
  });

  it('accion "reset_password": si la LECTURA post-mutación falla, NO se pierde la contraseña ya rotada (usuario:null — YA NO se fabrica un UsuarioItem falso) y se loggea el error tragado (ronda 3, FIX ALTO-1)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin, authAdmin } = makeAdmin({});
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: {} }, error: null });
    authAdmin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'gotrue caído secreto' } });

    const result = await actualizarUsuario(admin, 'u-1', { accion: 'reset_password' });

    expect(result).toEqual({ usuario: null, password_temporal: 'TEMP_PASS_FIJA' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[usuarios.service]'),
      expect.anything(),
    );
    consoleErrorSpy.mockRestore();
  });

  it('accion "suspender": si la LECTURA post-mutación falla, SÍ lanza (no hay contraseña que proteger, comportamiento intacto)', async () => {
    const { admin, authAdmin } = makeAdmin({});
    authAdmin.updateUserById.mockResolvedValueOnce({ data: { user: {} }, error: null });
    authAdmin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'gotrue caído secreto' } });

    await expect(actualizarUsuario(admin, 'u-1', { accion: 'suspender' })).rejects.toThrow(/gotrue caído secreto/);
  });
});
