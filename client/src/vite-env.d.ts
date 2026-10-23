/// <reference types="vite/client" />

/** Every variable the app reads. All are optional; `config/env.ts` supplies and validates defaults. */
interface ImportMetaEnv {
  /** API base URL: a path such as `/api` (same origin / dev proxy) or a full `https://…` URL. */
  readonly VITE_API_URL?: string;
  /** Per-request timeout in milliseconds. */
  readonly VITE_API_TIMEOUT_MS?: string;
  /** `true` logs request timings to the console (always on in dev builds). */
  readonly VITE_LOG_REQUESTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
