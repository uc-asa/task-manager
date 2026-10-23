import { env } from '../config/env.js';
import { createPinoLogger } from './pino.js';

export type { Logger, LogContext } from './logger.js';

const isTest = env.NODE_ENV === 'test';
const isProduction = env.NODE_ENV === 'production';

/**
 * The application-wide root logger. This is the only place that chooses a logging library.
 * Defaults: silent in tests, JSON at `info` in production, pretty at `debug` in development.
 */
export const logger = createPinoLogger({
  level: env.LOG_LEVEL ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
  pretty: env.LOG_PRETTY ?? (!isTest && !isProduction),
});
