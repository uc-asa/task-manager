import { describe, expect, it } from 'vitest';
import { maskSecrets, REDACTED } from '../src/logging/redact.js';

describe('maskSecrets', () => {
  it('masks sensitive fields at any depth, including inside arrays', () => {
    const masked = maskSecrets({
      password: 'a',
      user: { password: 'b' },
      request: { body: { password: 'c' } },
      items: [{ token: 'd' }, { nested: [{ secret: 'e' }] }],
    });

    expect(masked).toEqual({
      password: REDACTED,
      user: { password: REDACTED },
      request: { body: { password: REDACTED } },
      items: [{ token: REDACTED }, { nested: [{ secret: REDACTED }] }],
    });
  });

  it.each([
    'password',
    'PASSWORD',
    'passwd',
    'token',
    'refreshToken',
    'access_token',
    'secret',
    'clientSecret',
    'authorization',
    'Authorization',
    'cookie',
    'Set-Cookie',
    'apiKey',
    'api_key',
    'x-api-key',
    'Idempotency-Key',
  ])('masks a field called "%s"', (key) => {
    expect(maskSecrets({ [key]: 'value' })).toEqual({ [key]: REDACTED });
  });

  it('leaves ordinary fields untouched, including look-alikes', () => {
    const harmless = {
      title: 'Pay rent',
      status: 200,
      durationMs: 3.2,
      path: '/api/tasks',
      passed: true, // "pass" alone is not "password"
      bypass: 'no',
      requestId: 'abc-123',
    };
    expect(maskSecrets(harmless)).toEqual(harmless);
  });

  it('does not modify the object it was given', () => {
    const original = { user: { password: 'keep-me' } };
    maskSecrets(original);
    expect(original.user.password).toBe('keep-me');
  });

  it('keeps Errors, Dates and Buffers as they are, for the logger to serialise', () => {
    const error = new Error('boom');
    const date = new Date();
    const masked = maskSecrets({ err: error, at: date, bytes: Buffer.from('x') });
    expect(masked.err).toBe(error);
    expect(masked.at).toBe(date);
    expect(Buffer.isBuffer(masked.bytes)).toBe(true);
  });

  it('survives circular references', () => {
    const loop: Record<string, unknown> = { name: 'loop', password: 'x' };
    loop.self = loop;
    const masked = maskSecrets(loop);
    expect(masked).toEqual({ name: 'loop', password: REDACTED, self: '[Circular]' });
  });

  it('does not mistake the same object used twice for a cycle', () => {
    const shared = { id: 1 };
    expect(maskSecrets({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } });
  });

  it('never logs structures deeper than it inspects', () => {
    let deep: Record<string, unknown> = { password: 'too-deep' };
    for (let i = 0; i < 20; i += 1) deep = { next: deep };
    expect(JSON.stringify(maskSecrets(deep))).not.toContain('too-deep');
  });

  it('passes primitives through', () => {
    expect(maskSecrets('text')).toBe('text');
    expect(maskSecrets(42)).toBe(42);
    expect(maskSecrets(null)).toBeNull();
  });
});
