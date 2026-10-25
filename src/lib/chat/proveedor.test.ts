// ============================================================
// [CHAT-B1] Qué proveedor corre NO puede decidirlo la máquina.
//
// La pregunta «¿qué modelo está razonando de verdad?» ya se contestó mal una
// vez en este proyecto: el código traía `gpt-5.6-luna` por omisión y nadie lo
// había medido. La respuesta salió de `consumo_chat`, no de lo que alguien creía
// tener exportado — **una variable de entorno es otra copia** (P33), y cotejar
// dos copias detecta divergencia, nunca obsolescencia compartida.
//
// Estas pruebas fijan la ÚNICA regla que decide, y la fijan con el entorno
// puesto a mano: si dependieran de lo que tenga esta máquina, medirían otra cosa
// en cada equipo.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProveedorChat } from '@/lib/env';
import { PROVEEDORES, nombreDelModelo } from './proveedor';

vi.mock('server-only', () => ({}));

const LLAVE = 'k'.repeat(40);
const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.CHAT_PROVEEDOR;
  delete process.env.OPENAI_MODELO;
  delete process.env.DEEPSEEK_MODELO;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('[CHAT-B1] la precedencia del proveedor', () => {
  it('sin ninguna llave, no hay proveedor — y eso es `config_error`, no un 500', () => {
    expect(getProveedorChat()).toBeNull();
  });

  it('solo OpenAI ⇒ OpenAI', () => {
    process.env.OPENAI_API_KEY = LLAVE;
    expect(getProveedorChat()?.proveedor).toBe('openai');
  });

  it('PONER la llave de DeepSeek ES el interruptor', () => {
    process.env.OPENAI_API_KEY = LLAVE;
    process.env.DEEPSEEK_API_KEY = LLAVE;
    expect(getProveedorChat()?.proveedor).toBe('deepseek');
  });

  it('LO EXPLÍCITO GANA: se vuelve a OpenAI SIN borrar la llave de DeepSeek', () => {
    process.env.OPENAI_API_KEY = LLAVE;
    process.env.DEEPSEEK_API_KEY = LLAVE;
    process.env.CHAT_PROVEEDOR = 'openai';
    expect(getProveedorChat()?.proveedor).toBe('openai');
    // Ésa es toda la razón de que haya dos reglas y no una: con solo la
    // presencia de la llave, retroceder habría exigido BORRAR un secreto — que
    // es justo la operación que no se quiere hacer con prisa.
  });

  it('pedir un proveedor SIN su llave devuelve null, no cae al otro en silencio', () => {
    process.env.OPENAI_API_KEY = LLAVE;
    process.env.CHAT_PROVEEDOR = 'deepseek';
    expect(getProveedorChat()).toBeNull();
  });

  it('un `CHAT_PROVEEDOR` con un nombre que no existe se ignora y manda la presencia', () => {
    process.env.OPENAI_API_KEY = LLAVE;
    process.env.CHAT_PROVEEDOR = 'zeta-llm';
    expect(getProveedorChat()?.proveedor).toBe('openai');
  });

  it('una llave demasiado corta no cuenta como llave', () => {
    process.env.DEEPSEEK_API_KEY = 'corta';
    process.env.OPENAI_API_KEY = LLAVE;
    expect(getProveedorChat()?.proveedor).toBe('openai');
  });

  it('el id del modelo se puede fijar por variable, y si no sale del catálogo', () => {
    process.env.OPENAI_API_KEY = LLAVE;
    expect(getProveedorChat()?.modelo).toBeNull();
    process.env.OPENAI_MODELO = 'otro-modelo';
    expect(getProveedorChat()?.modelo).toBe('otro-modelo');
  });
});

describe('[CHAT-B1] el nombre que va a `consumo_chat`', () => {
  it('lleva el proveedor dentro: con dos, «qué modelo razonó» deja de ser respondible sin él', () => {
    expect(
      nombreDelModelo({ proveedor: 'deepseek', endpoint: 'x', modelo: 'deepseek-flash', apiKey: 'k' }),
    ).toBe('deepseek/deepseek-flash');
  });

  it('⚠️ ROMPE la forma de las filas anteriores, que dicen `gpt-5.6-luna` a secas', () => {
    const nuevo = nombreDelModelo({ proveedor: 'openai', endpoint: 'x', modelo: 'gpt-5.6-luna', apiKey: 'k' });
    expect(nuevo).toBe('openai/gpt-5.6-luna');
    expect(nuevo).not.toBe('gpt-5.6-luna');
    // No se hace backfill: reescribir el registro para que parezca que siempre
    // fue así borraría la única evidencia de cuándo cambió el proveedor.
  });
});

describe('[CHAT-B1] el catálogo de proveedores', () => {
  it('guarda el NOMBRE de la variable, nunca su valor', () => {
    expect(PROVEEDORES.openai.variable).toBe('OPENAI_API_KEY');
    expect(PROVEEDORES.deepseek.variable).toBe('DEEPSEEK_API_KEY');
    for (const p of Object.values(PROVEEDORES)) {
      expect(p.variable).toMatch(/^[A-Z_]+$/);
    }
  });

  it('los dos hablan el mismo contrato: `/v1/chat/completions`', () => {
    // Es lo que permite UN cliente y no dos. Dos clientes habrían sido dos
    // copias del mismo contrato — el patrón que este repo ya pagó cuatro veces.
    for (const p of Object.values(PROVEEDORES)) {
      expect(p.endpoint).toMatch(/\/v1\/chat\/completions$/);
    }
  });

  it('✅ el id de DeepSeek es el que la API DICE tener, no el que pedía el brief', () => {
    // El bloque pedía «DeepSeek V4.1 Flash» y ese id NO EXISTE: un GET a
    // /v1/models con la llave real devuelve exactamente dos —deepseek-flash y
    // deepseek-v4-pro— y pedir el otro da 400. Medido el 21-sep con
    // `scripts/chat-sonda-proveedor.mjs`. Esta prueba fija el id correcto para
    // que nadie lo «corrija» de vuelta al del brief.
    expect(PROVEEDORES.deepseek.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(PROVEEDORES.deepseek.modeloPorOmision).toBe('deepseek-flash');
    expect(PROVEEDORES.deepseek.modeloPorOmision).not.toBe('deepseek-v4.1-flash');
  });
});
