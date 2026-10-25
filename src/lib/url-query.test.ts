import { describe, it, expect } from 'vitest';
import { construirUrlApi, aplicarActualizacion } from './url-query';

describe('construirUrlApi', () => {
  it('sin ningún campo presente en searchParams: regresa base sin "?"', () => {
    expect(construirUrlApi('/api/embarques', ['q', 'page'], new URLSearchParams())).toBe('/api/embarques');
  });

  it('reenvía SOLO los campos listados presentes en searchParams', () => {
    const sp = new URLSearchParams('q=cand&marca=BRAND1&otro=ignorado');
    expect(construirUrlApi('/api/inventory', ['q', 'marca'], sp)).toBe('/api/inventory?q=cand&marca=BRAND1');
  });

  it('skip-empty: un valor "" en searchParams se omite (no viaja como q=)', () => {
    const sp = new URLSearchParams('q=&page=2');
    expect(construirUrlApi('/api/embarques', ['q', 'page'], sp)).toBe('/api/embarques?page=2');
  });

  it('respeta el orden de la lista `campos`, no el orden de aparición en la URL de origen', () => {
    const sp = new URLSearchParams('page=2&q=cand');
    expect(construirUrlApi('/api/inventory', ['q', 'page'], sp)).toBe('/api/inventory?q=cand&page=2');
  });
});

describe('aplicarActualizacion', () => {
  it('agrega un campo nuevo sobre una URL vacía', () => {
    expect(aplicarActualizacion(new URLSearchParams(), { marca: 'BRAND1' })).toBe('?marca=BRAND1');
  });

  it('actualiza un campo existente sin tocar los demás', () => {
    const current = new URLSearchParams('marca=BRAND1&familia=CANDADOS');
    expect(aplicarActualizacion(current, { marca: 'EAS' })).toBe('?marca=EAS&familia=CANDADOS');
  });

  it('null borra el campo', () => {
    const current = new URLSearchParams('marca=BRAND1&familia=CANDADOS');
    expect(aplicarActualizacion(current, { marca: null })).toBe('?familia=CANDADOS');
  });

  it('"" (string vacío) borra el campo igual que null', () => {
    const current = new URLSearchParams('marca=BRAND1');
    expect(aplicarActualizacion(current, { marca: '' })).toBe('');
  });

  it('si el resultado queda vacío, regresa "" (sin "?" suelto)', () => {
    const current = new URLSearchParams('marca=BRAND1');
    expect(aplicarActualizacion(current, { marca: null })).toBe('');
  });

  it('resetPage:true borra `page` además de aplicar los updates', () => {
    const current = new URLSearchParams('marca=BRAND1&page=3');
    expect(aplicarActualizacion(current, { familia: 'CANDADOS' }, { resetPage: true })).toBe('?marca=BRAND1&familia=CANDADOS');
  });

  it('resetPage no especificado (default false): conserva `page`', () => {
    const current = new URLSearchParams('marca=BRAND1&page=3');
    expect(aplicarActualizacion(current, { familia: 'CANDADOS' })).toBe('?marca=BRAND1&page=3&familia=CANDADOS');
  });

  it('100% pura: no muta el URLSearchParams `current` recibido', () => {
    const current = new URLSearchParams('marca=BRAND1');
    aplicarActualizacion(current, { marca: 'EAS' });
    expect(current.get('marca')).toBe('BRAND1');
  });
});
