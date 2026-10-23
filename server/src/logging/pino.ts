import { pino, type DestinationStream } from 'pino';
import type { Logger, LogContext } from './logger.js';
import { maskSecrets } from './redact.js';

export interface PinoLoggerOptions {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Human-readable, coloured output for local development. JSON otherwise. */
  pretty: boolean;
  /** Where lines are written. Defaults to stdout; tests pass an in-memory stream. */
  destination?: DestinationStream;
}

/**
 * Adapts a pino instance to our `Logger` interface (pino takes `(fields, message)`).
 * Every context object and every child binding passes through `maskSecrets` first, so nothing
 * sensitive can reach pino whatever the caller logged.
 */
function adapt(instance: pino.Logger): Logger {
  const write =
    (level: 'debug' | 'info' | 'warn' | 'error') => (message: string, context?: LogContext) => {
      if (context) instance[level](maskSecrets(context), message);
      else instance[level](message);
    };

  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (bindings) => adapt(instance.child(maskSecrets(bindings))),
  };
}

export function createPinoLogger({ level, pretty, destination }: PinoLoggerOptions): Logger {
  const options: pino.LoggerOptions = {
    level,
    // `level` as a label ("info") rather than a number (30) is friendlier to log search tools.
    formatters: { level: (label) => ({ level: label }) },
    base: { service: 'task-manager-api' },
  };

  if (destination) return adapt(pino(options, destination));
  // `pino-pretty` is a dev dependency, so it is only loaded (in a worker) when asked for.
  if (pretty) {
    return adapt(
      pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, ignore: 'pid,hostname,service' },
        },
      }),
    );
  }
  return adapt(pino(options));
}
