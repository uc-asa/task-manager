import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/task-manager'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Serve /api/docs and /api/openapi.json. Defaults to on, except in production.
  API_DOCS: z.stringbool().optional(),
  // How long GET /api/tasks/stats may be served from memory. 0 turns the cache off.
  STATS_CACHE_TTL_MS: z.coerce.number().int().min(0).default(5000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  // Coloured human-readable logs instead of JSON. Defaults to on in development only.
  LOG_PRETTY: z.stringbool().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

/** Validated, typed environment. The process fails fast on bad configuration. */
export const env = envSchema.parse(process.env);
