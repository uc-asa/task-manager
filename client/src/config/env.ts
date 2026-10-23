/**
 * The single place the app reads its environment. Vite inlines `VITE_*` variables at build time,
 * so values differ per build (`.env.development`, `.env.production`, CI variables), not at runtime.
 *
 * Invalid values throw on startup instead of failing later in a request.
 */

export const AppMode = {
  Development: 'development',
  Production: 'production',
  Test: 'test',
} as const;
export type AppMode = (typeof AppMode)[keyof typeof AppMode];

export interface AppConfig {
  mode: AppMode;
  isDev: boolean;
  isProd: boolean;
  api: {
    baseUrl: string;
    timeoutMs: number;
    logRequests: boolean;
  };
  ui: {
    pageSize: number;
    searchDebounceMs: number;
  };
  query: {
    staleTimeMs: number;
    retries: number;
  };
}

const DEFAULTS = {
  apiUrl: '/api',
  apiTimeoutMs: 10_000,
} as const;

const toMode = (value: string): AppMode =>
  (Object.values(AppMode) as string[]).includes(value) ? (value as AppMode) : AppMode.Development;

const parseBaseUrl = (raw: string | undefined): string => {
  const value = (raw?.trim() ?? '') || DEFAULTS.apiUrl;
  if (!value.startsWith('/') && !/^https?:\/\//.test(value)) {
    throw new Error(`VITE_API_URL must start with "/" or "http(s)://", got "${value}"`);
  }
  return value.replace(/\/+$/, '');
};

const parsePositiveInt = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
};

/** Pure (takes the env as an argument) so it can be unit-tested for every mode. */
export function parseConfig(env: ImportMetaEnv & { MODE: string }): AppConfig {
  const mode = toMode(env.MODE);
  const isDev = mode === AppMode.Development;

  return {
    mode,
    isDev,
    isProd: mode === AppMode.Production,
    api: {
      baseUrl: parseBaseUrl(env.VITE_API_URL),
      timeoutMs: parsePositiveInt(
        'VITE_API_TIMEOUT_MS',
        env.VITE_API_TIMEOUT_MS,
        DEFAULTS.apiTimeoutMs,
      ),
      logRequests: isDev || env.VITE_LOG_REQUESTS === 'true',
    },
    ui: { pageSize: 8, searchDebounceMs: 300 },
    // Dev retries nothing so failures show up immediately; production retries once.
    query: { staleTimeMs: 15_000, retries: isDev ? 0 : 1 },
  };
}

export const config: AppConfig = Object.freeze(parseConfig(import.meta.env));
