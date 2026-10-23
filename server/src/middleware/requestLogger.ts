import type { RequestHandler, Response } from 'express';
import { logger as rootLogger, type Logger } from '../logging/index.js';

const QUIET_PATHS = new Set(['/api/health', '/api/ready']);

/** The logger bound to this request (it carries the `requestId`), or the root logger. */
export const requestLogger = (res: Response): Logger =>
  (res.locals.log as Logger | undefined) ?? rootLogger;

/**
 * Gives every request its own child logger and writes one access-log line when the response
 * finishes: method, path, status and duration. Only the path is logged, never the query string,
 * which may contain search text. Health probes are logged at `debug` so they don't drown the rest.
 */
export const accessLog =
  (base: Logger): RequestHandler =>
  (req, res, next) => {
    const log = base.child({ requestId: String(res.locals.requestId) });
    res.locals.log = log;
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const path = req.baseUrl + req.path;
      const fields = {
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - startedAt) / 10_000n) / 100,
      };
      if (QUIET_PATHS.has(path)) log.debug('request completed', fields);
      else if (res.statusCode >= 500) log.error('request failed', fields);
      else if (res.statusCode >= 400) log.warn('request rejected', fields);
      else log.info('request completed', fields);
    });

    next();
  };
