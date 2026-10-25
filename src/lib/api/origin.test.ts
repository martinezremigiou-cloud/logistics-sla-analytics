import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireSameOrigin } from './origin';

/**
 * `PORT` / `NEXT_PUBLIC_SITE_URL` / `VERCEL_URL` / `VERCEL` /
 * `VERCEL_PROJECT_PRODUCTION_URL` se leen en vivo de `process.env` en
 * cada llamada (ver `origin.ts`) — se respaldan y limpian en cada test
 * para que ninguno dependa de lo que haya (o no) en la máquina que
 * corre `vitest` (p.ej. si algún día CI corre esto EN Vercel, `VERCEL`
 * vendría seteado en la máquina misma), y para que un test no contamine
 * al siguiente.
 */
const CLAVES_ENV = ['PORT', 'NEXT_PUBLIC_SITE_URL', 'VERCEL_URL', 'VERCEL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const;
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

function req(method: string, url: string, origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.Origin = origin;
  return new Request(url, { method, headers });
}

const URL_BASE = 'http://localhost:3000/api/color';

describe('requireSameOrigin — métodos', () => {
  it('GET pasa (null) aunque no haya Origin', () => {
    expect(requireSameOrigin(req('GET', URL_BASE))).toBeNull();
  });

  it('HEAD pasa (null) aunque no haya Origin', () => {
    expect(requireSameOrigin(req('HEAD', URL_BASE))).toBeNull();
  });

  it('GET pasa (null) aunque el Origin sea de otro dominio (no hay CSRF de lectura)', () => {
    expect(requireSameOrigin(req('GET', URL_BASE, 'http://evil.com'))).toBeNull();
  });

  it('DELETE es mutante: sin Origin → 403 forbidden_origin', async () => {
    const res = requireSameOrigin(req('DELETE', URL_BASE));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
  });

  it('PATCH es mutante: con Origin de la allowlist → null (pasa)', () => {
    expect(requireSameOrigin(req('PATCH', URL_BASE, 'http://localhost:3000'))).toBeNull();
  });
});

describe('requireSameOrigin — allowlist base (http://localhost:3000)', () => {
  it('POST con Origin http://localhost:3000 → null (pasa)', () => {
    expect(requireSameOrigin(req('POST', URL_BASE, 'http://localhost:3000'))).toBeNull();
  });

  it('PUT con Origin http://localhost:3000 → null (pasa)', () => {
    expect(requireSameOrigin(req('PUT', URL_BASE, 'http://localhost:3000'))).toBeNull();
  });
});

describe('requireSameOrigin — Origin ausente (fail-closed)', () => {
  it('POST sin header Origin → 403 forbidden_origin', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
  });

  it('POST con Origin vacío → 403 forbidden_origin', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, ''));
    expect(res!.status).toBe(403);
  });

  it('POST con Origin no parseable como URL absoluta → 403 forbidden_origin (fail-closed, no revienta)', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'no-es-una-url'));
    expect(res!.status).toBe(403);
  });

  it('POST con Origin: "null" (contexto sandboxed/file://, lo mandan navegadores reales) → 403', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'null'));
    expect(res!.status).toBe(403);
  });
});

describe('requireSameOrigin — origen cruzado', () => {
  it('POST con Origin de otro dominio → 403 forbidden_origin', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'https://evil.com'));
    expect(res!.status).toBe(403);
    expect((await res!.json()).error).toBe('forbidden_origin');
  });

  it('POST con Origin del mismo host pero otro esquema (http vs https) → 403', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://inventory.example.com';
    const res = requireSameOrigin(req('POST', URL_BASE, 'http://inventory.example.com'));
    expect(res!.status).toBe(403);
  });
});

describe('requireSameOrigin — mayúsculas/minúsculas', () => {
  it('POST con Origin en mayúsculas (HTTP://LOCALHOST:3000) → null (normaliza y pasa)', () => {
    expect(requireSameOrigin(req('POST', URL_BASE, 'HTTP://LOCALHOST:3000'))).toBeNull();
  });

  it('NEXT_PUBLIC_SITE_URL en mayúsculas también normaliza al comparar', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'HTTPS://Inventory.Example.COM';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://inventory.example.com'))).toBeNull();
  });
});

describe('requireSameOrigin — puerto distinto', () => {
  it('POST con Origin en un puerto no listado (4000) y sin PORT en env → 403', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'http://localhost:4000'));
    expect(res!.status).toBe(403);
  });

  it('con process.env.PORT=4000 (el puerto REAL con el que arrancó el server), Origin en ese puerto → null (pasa)', () => {
    process.env.PORT = '4000';
    expect(requireSameOrigin(req('POST', URL_BASE, 'http://localhost:4000'))).toBeNull();
  });

  it('con process.env.PORT=3100 (p.ej. "next start -p 3100" para verificar producción) → ese puerto pasa', () => {
    process.env.PORT = '3100';
    expect(requireSameOrigin(req('POST', 'http://localhost:3100/api/color', 'http://localhost:3100'))).toBeNull();
  });

  it('process.env.PORT=4000 NO abre otros puertos (5000 sigue fuera) → 403', async () => {
    process.env.PORT = '4000';
    const res = requireSameOrigin(req('POST', URL_BASE, 'http://localhost:5000'));
    expect(res!.status).toBe(403);
  });

  it('http://localhost:3000 (base) sigue pasando aunque PORT tenga otro valor', () => {
    process.env.PORT = '4000';
    expect(requireSameOrigin(req('POST', URL_BASE, 'http://localhost:3000'))).toBeNull();
  });
});

describe('requireSameOrigin — NEXT_PUBLIC_SITE_URL (dominio público)', () => {
  it('Origin exacto del sitio configurado → null (pasa)', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://inventory.example.com';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://inventory.example.com'))).toBeNull();
  });
});

describe('requireSameOrigin — VERCEL_URL (sin protocolo, convención de la plataforma)', () => {
  it('VERCEL_URL="host.example.com" habilita https://host.example.com', () => {
    process.env.VERCEL_URL = 'app-xyz.example.com';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://app-xyz.example.com'))).toBeNull();
  });

  it('VERCEL_URL nunca habilita el mismo host en http:// (Vercel siempre sirve en https)', async () => {
    process.env.VERCEL_URL = 'app-xyz.example.com';
    const res = requireSameOrigin(req('POST', URL_BASE, 'http://app-xyz.example.com'));
    expect(res!.status).toBe(403);
  });
});

describe('requireSameOrigin — VERCEL_PROJECT_PRODUCTION_URL (A1, alias de producción estable)', () => {
  it('VERCEL_PROJECT_PRODUCTION_URL="host.example.com" (sin protocolo, mismo formato que VERCEL_URL) habilita https://host.example.com', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'portal.example.com';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://portal.example.com'))).toBeNull();
  });

  it('nunca habilita el mismo host en http:// (Vercel siempre sirve en https)', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'portal.example.com';
    const res = requireSameOrigin(req('POST', URL_BASE, 'http://portal.example.com'));
    expect(res!.status).toBe(403);
  });

  it('normaliza mayúsculas/minúsculas igual que las demás fuentes', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'Portal.Example.COM';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://portal.example.com'))).toBeNull();
  });

  it('defensivo: si el valor YA trae esquema (no documentado por Vercel, pero "no asumas"), no lo duplica y sigue normalizando bien', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'https://portal.example.com';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://portal.example.com'))).toBeNull();
  });

  it('convive con VERCEL_URL: ambos quedan habilitados a la vez (deployment actual + alias de producción)', () => {
    process.env.VERCEL_URL = 'portal-git-main-abc.example.com';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'portal.example.com';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://portal-git-main-abc.example.com'))).toBeNull();
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://portal.example.com'))).toBeNull();
  });
});

describe('requireSameOrigin — localhost:3000 acotado a fuera de Vercel (A2)', () => {
  it('sin process.env.VERCEL (dev local / next start local) → localhost:3000 pasa', () => {
    expect(requireSameOrigin(req('POST', URL_BASE, 'http://localhost:3000'))).toBeNull();
  });

  it('con process.env.VERCEL="1" (deployment real, producción o preview) → localhost:3000 YA NO pasa → 403', async () => {
    process.env.VERCEL = '1';
    const res = requireSameOrigin(req('POST', URL_BASE, 'http://localhost:3000'));
    expect(res!.status).toBe(403);
  });

  it('con VERCEL="1", el puerto derivado de process.env.PORT NO se acota (solo A2 tocó el localhost:3000 hardcodeado) — sigue pasando', () => {
    process.env.VERCEL = '1';
    process.env.PORT = '3100';
    expect(requireSameOrigin(req('POST', 'http://localhost:3100/api/color', 'http://localhost:3100'))).toBeNull();
  });

  it('con VERCEL="1", NEXT_PUBLIC_SITE_URL sigue pasando sin cambios (A2 no afecta otras fuentes de la allowlist)', () => {
    process.env.VERCEL = '1';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://inventory.example.com';
    expect(requireSameOrigin(req('POST', URL_BASE, 'https://inventory.example.com'))).toBeNull();
  });
});

describe('requireSameOrigin — subdominio parecido que NO debe pasar', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://inventory.example.com';
  });

  it('subdominio agregado ANTES del host permitido (prefijo) → 403', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'https://evil.inventory.example.com'));
    expect(res!.status).toBe(403);
  });

  it('dominio permitido usado como subdominio de otro (sufijo) → 403', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'https://inventory.example.com.evil.com'));
    expect(res!.status).toBe(403);
  });

  it('host que solo contiene el permitido como substring (sin separador de dominio) → 403', async () => {
    const res = requireSameOrigin(req('POST', URL_BASE, 'https://notinventory.example.com'));
    expect(res!.status).toBe(403);
  });
});

describe('requireSameOrigin — exención contractual de /api/refresh', () => {
  it('POST a /api/refresh SIN Origin → null (pasa): lo llama Power Automate, nunca un navegador', () => {
    const sinOrigin = new Request('http://localhost:3000/api/refresh', { method: 'POST' });
    expect(requireSameOrigin(sinOrigin)).toBeNull();
  });

  it('la exención es por ruta exacta (ancla por segmento): /api/refresh-token NO queda exenta → 403', async () => {
    const res = requireSameOrigin(new Request('http://localhost:3000/api/refresh-token', { method: 'POST' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('/api/refresh/algo (subpath) también queda exenta (mismo criterio que el matcher de middleware.ts)', () => {
    const sub = new Request('http://localhost:3000/api/refresh/algo', { method: 'POST' });
    expect(requireSameOrigin(sub)).toBeNull();
  });
});

describe('requireSameOrigin — shape de la respuesta 403', () => {
  it('regresa un NextResponse real (no un objeto plano) con status 403 y el código forbidden_origin', () => {
    const res = requireSameOrigin(req('POST', URL_BASE));
    expect(res).not.toBeNull();
    expect(typeof res!.json).toBe('function');
    expect(res!.status).toBe(403);
  });
});
