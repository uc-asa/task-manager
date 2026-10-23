import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { openApiDocument } from './docs/openapi.js';
import { errorHandler, notFound } from './middleware/error.js';
import { accessLog } from './middleware/requestLogger.js';
import { requestId } from './middleware/requestId.js';
import { logger as rootLogger, type Logger } from './logging/index.js';
import { ErrorCode, HttpHeader } from 'shared';
import { HttpStatus } from './utils/http.js';
import { taskRouter } from './modules/tasks/task.routes.js';

/** Built as a factory (no side effects) so tests can mount it without opening a port. */
export interface AppOptions {
  /** Serve the API documentation. Defaults to on outside production. */
  docs?: boolean;
  /** Where access and error logs go. Tests inject their own. */
  logger?: Logger;
}

export function createApp({
  docs = env.API_DOCS ?? env.NODE_ENV !== 'production',
  logger = rootLogger,
}: AppOptions = {}) {
  const app = express();

  app.disable('x-powered-by');
  // Number of reverse proxies in front of the app (0 = none). Needed so the rate limiter sees
  // the real client IP instead of the load balancer's.
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(requestId);
  app.use(accessLog(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
      exposedHeaders: [HttpHeader.RequestId, HttpHeader.IdempotentReplayed],
    }),
  );
  // Rate limit before parsing bodies so abusive clients are rejected cheaply.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: ErrorCode.RateLimited, message: 'Too many requests, slow down' } },
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  // Liveness: the process is up. Readiness: it can actually serve requests (DB connected).
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === mongoose.ConnectionStates.connected;
    res
      .status(ready ? HttpStatus.Ok : HttpStatus.ServiceUnavailable)
      .json({ status: ready ? 'ready' : 'unavailable' });
  });
  if (docs) {
    app.get('/api/openapi.json', (_req, res) => {
      res.json(openApiDocument);
    });
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument, { customSiteTitle: 'Task Manager API' }),
    );
  }

  app.use('/api/tasks', taskRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
