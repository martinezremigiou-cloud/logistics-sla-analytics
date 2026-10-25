import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

/**
 * `VERCEL_DEPLOYMENT_ID` / `VERCEL_SKEW_PROTECTION_ENABLED` se leen en
 * vivo de `process.env` en cada request (ver route.ts) — se respaldan y
 * limpian en cada test, mismo patrón que `src/lib/api/origin.test.ts`,
 * para que ninguno dependa de lo que haya (o no) en la máquina que
 * corre `vitest` ni contamine al siguiente. `NEXT_PUBLIC_DEPLOY_ID` ya
 * NO aplica aquí (ronda 2, punto D: se eliminó `builtId` de esta ruta,
 * que era su único consumidor server-side — sigue viva del lado
 * cliente, ver `aviso-version-nueva.test.tsx`).
 */
const CLAVES_ENV = ['VERCEL_DEPLOYMENT_ID', 'VERCEL_SKEW_PROTECTION_ENABLED'] as const;
let respaldo: Record<(typeof CLAVES_ENV)[number], string | undefined>;

beforeEach(() => {
  respaldo = Object.fromEntries(CLAVES_ENV.map((k) => [k, process.env[k]])) as typeof respaldo;
  for (const k of CLAVES_ENV) delete process.env[k];
});

afterEach(() => {
  for (const k of CLAVES_ENV) {
    if (respaldo[k] === undefined) delete process.env[k];
    else process.env[k] = respaldo[k];
  }
});

describe('GET /api/version', () => {
  it('sin variables de Vercel (dev local): deploymentId cae a "dev", skewProtection false', async () => {
    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deploymentId: 'dev', skewProtection: false });
  });

  it('Cache-Control: no-store en la respuesta (nunca cachear la metadata de skew)', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('deploymentId refleja VERCEL_DEPLOYMENT_ID leído EN RUNTIME (no un valor horneado)', async () => {
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_live_123';
    const { GET } = await import('./route');
    const res = await GET();
    expect((await res.json()).deploymentId).toBe('dpl_live_123');
  });

  it('la respuesta NO incluye `builtId` (ronda 2, punto D: eliminado — en Vercel siempre coincidía con deploymentId, cero señal diagnóstica real)', async () => {
    process.env.VERCEL_DEPLOYMENT_ID = 'dpl_live_123';
    const { GET } = await import('./route');
    const body = await (await GET()).json();

    expect(body).toEqual({ deploymentId: 'dpl_live_123', skewProtection: false });
    expect(body).not.toHaveProperty('builtId');
  });

  it('skewProtection es true solo si VERCEL_SKEW_PROTECTION_ENABLED es exactamente "1"', async () => {
    process.env.VERCEL_SKEW_PROTECTION_ENABLED = '1';
    const { GET } = await import('./route');
    expect((await (await GET()).json()).skewProtection).toBe(true);
  });

  it.each(['0', 'true', ''])('skewProtection es false si VERCEL_SKEW_PROTECTION_ENABLED="%s"', async (valor) => {
    process.env.VERCEL_SKEW_PROTECTION_ENABLED = valor;
    const { GET } = await import('./route');
    expect((await (await GET()).json()).skewProtection).toBe(false);
  });

  it('responde 200 sin exigir sesión (sin mockear Supabase/auth): es metadata pública de build', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
