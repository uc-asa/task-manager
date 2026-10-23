/**
 * The logging contract the application depends on. Nothing outside `src/logging/` imports a
 * logging library, so replacing pino (with Winston, Bunyan, a cloud SDK, ...) means writing one
 * new adapter that implements `Logger` and changing one line in `logging/index.ts`.
 */

/** Structured fields attached to a log line. Put an `Error` under the `err` key. */
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A logger that adds `bindings` (e.g. `{ requestId }`) to every line it writes. */
  child(bindings: LogContext): Logger;
}
