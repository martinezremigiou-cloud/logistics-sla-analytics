import { describe, it, expect } from 'vitest';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from './body';

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/familias', { method: 'POST', headers });
}

describe('bodyTooLarge', () => {
  it('content-length por debajo del máximo → false', () => {
    expect(bodyTooLarge(req({ 'content-length': '100' }), MAX_BODY_BYTES_ESCRITURA)).toBe(false);
  });

  it('content-length por encima del máximo → true', () => {
    expect(bodyTooLarge(req({ 'content-length': '20000000' }), MAX_BODY_BYTES_ESCRITURA)).toBe(true);
  });

  it('content-length exactamente igual al máximo → false (no estrictamente mayor)', () => {
    expect(bodyTooLarge(req({ 'content-length': String(MAX_BODY_BYTES_ESCRITURA) }), MAX_BODY_BYTES_ESCRITURA)).toBe(
      false,
    );
  });

  it('sin header content-length → false (best-effort, no bloquea)', () => {
    expect(bodyTooLarge(req(), MAX_BODY_BYTES_ESCRITURA)).toBe(false);
  });

  it('content-length no numérico → false (best-effort)', () => {
    expect(bodyTooLarge(req({ 'content-length': 'no-es-un-numero' }), MAX_BODY_BYTES_ESCRITURA)).toBe(false);
  });
});
