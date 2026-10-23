import type { Server } from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logging/index.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

// Graceful shutdown: stop accepting requests, then close the DB connection. A timer forces the
// exit if keep-alive connections or a stuck request prevent a clean close.
function shutdown(server: Server, signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal });

  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close(() => {
    void mongoose.disconnect().then(() => process.exit(exitCode));
  });
  server.closeIdleConnections();
}

async function main() {
  // Fail fast (instead of buffering for 30s) when MongoDB is unreachable.
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
  logger.info('MongoDB connected');

  const server = createApp().listen(env.PORT, () => {
    logger.info('API listening', { port: env.PORT, url: `http://localhost:${String(env.PORT)}` });
  });

  process.on('SIGTERM', () => {
    shutdown(server, 'SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown(server, 'SIGINT');
  });
  // An unhandled rejection means the process is in an unknown state: log it and exit cleanly
  // so the supervisor (Docker, systemd, PM2) restarts it.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { err: reason });
    shutdown(server, 'unhandledRejection', 1);
  });
}

main().catch((error: unknown) => {
  logger.error('Failed to start server', { err: error });
  process.exit(1);
});
