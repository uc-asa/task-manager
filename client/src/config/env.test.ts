import { describe, expect, it } from 'vitest';
import { AppMode, parseConfig } from './env';

const env = (overrides: Record<string, string | undefined> = {}) =>
  ({ MODE: 'development', ...overrides }) as Parameters<typeof parseConfig>[0];

describe('parseConfig', () => {
  it('uses safe defaults when nothing is set', () => {
    const config = parseConfig(env());
    expect(config.api).toEqual({ baseUrl: '/api', timeoutMs: 10_000, logRequests: true });
    expect(config.isDev).toBe(true);
  });

  it('differs between development and production', () => {
    const dev = parseConfig(env({ MODE: 'development' }));
    const prod = parseConfig(env({ MODE: 'production' }));

    expect(prod.mode).toBe(AppMode.Production);
    expect(prod.isProd).toBe(true);
    expect(prod.api.logRequests).toBe(false);
    expect(prod.query.retries).toBeGreaterThan(dev.query.retries);
  });

  it('lets production opt in to request logging', () => {
    expect(
      parseConfig(env({ MODE: 'production', VITE_LOG_REQUESTS: 'true' })).api.logRequests,
    ).toBe(true);
  });

  it('accepts a full API url and strips trailing slashes', () => {
    expect(parseConfig(env({ VITE_API_URL: 'https://api.example.com/api//' })).api.baseUrl).toBe(
      'https://api.example.com/api',
    );
  });

  it('treats an empty value like an unset one', () => {
    expect(parseConfig(env({ VITE_API_URL: '  ', VITE_API_TIMEOUT_MS: '' })).api).toMatchObject({
      baseUrl: '/api',
      timeoutMs: 10_000,
    });
  });

  it('fails fast on invalid values', () => {
    expect(() => parseConfig(env({ VITE_API_URL: 'api.example.com' }))).toThrow(/VITE_API_URL/);
    expect(() => parseConfig(env({ VITE_API_TIMEOUT_MS: 'abc' }))).toThrow(/VITE_API_TIMEOUT_MS/);
    expect(() => parseConfig(env({ VITE_API_TIMEOUT_MS: '-5' }))).toThrow(/VITE_API_TIMEOUT_MS/);
  });

  it('falls back to development for an unknown mode (e.g. a custom staging mode)', () => {
    expect(parseConfig(env({ MODE: 'staging' })).mode).toBe(AppMode.Development);
  });
});
