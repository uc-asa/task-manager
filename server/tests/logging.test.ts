import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type LogContext, type Logger } from '../src/logging/index.js';
import { createPinoLogger } from '../src/logging/pino.js';
import { errorHandler } from '../src/middleware/error.js';
import { requestId } from '../src/middleware/requestId.js';
import { accessLog } from '../src/middleware/requestLogger.js';

interface Entry {
  level: string;
  message: string;
  context: LogContext;
  bindings: LogContext;
}

/** An in-memory Logger: proves the app only depends on our interface, not on pino. */
function captureLogger(
  bindings: LogContext = {},
  entries: Entry[] = [],
): Logger & { entries: Entry[] } {
  const write =
    (level: string) =>
    (message: string, context: LogContext = {}) => {
      entries.push({ level, message, context, bindings });
    };
  return {
    entries,
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: (extra) => captureLogger({ ...bindings, ...extra }, entries),
  };
}

describe('access log', () => {
  it('writes one line per request with method, path, status, duration and the request id', async () => {
    const logger = captureLogger();
    const res = await request(createApp({ logger }))
      .get('/api/nope')
      .set('X-Request-Id', 'trace-me-123');

    const line = logger.entries.find((entry) => entry.message.startsWith('request'));
    expect(res.status).toBe(404);
    expect(line).toMatchObject({
      level: 'warn', // 4xx
      message: 'request rejected',
      bindings: { requestId: 'trace-me-123' },
      context: { method: 'GET', path: '/api/nope', status: 404 },
    });
    expect(typeof line?.context.durationMs).toBe('number');
  });

  it('never logs the query string (it may contain what the user searched for)', async () => {
    const logger = captureLogger();
    await request(createApp({ logger })).get('/api/nope').query({ q: 'secret search' });

    expect(JSON.stringify(logger.entries)).not.toContain('secret search');
  });

  it('keeps health probes at debug so they do not flood the logs', async () => {
    const logger = captureLogger();
    await request(createApp({ logger })).get('/api/health');

    expect(logger.entries.filter((e) => e.level === 'info')).toHaveLength(0);
    expect(logger.entries.find((e) => e.context.path === '/api/health')?.level).toBe('debug');
  });
});

describe('error logging', () => {
  it('logs unexpected errors with the request id and the error, and hides them from the client', async () => {
    const logger = captureLogger();
    const app = express();
    app.use(requestId, accessLog(logger));
    app.get('/boom', () => {
      throw new Error('database exploded');
    });
    app.use(errorHandler);
    // The shared error handler logs through the request's logger, which is bound to the request.
    const res = await request(app).get('/boom').set('X-Request-Id', 'req-500-abc');

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('database exploded');
    const unhandled = logger.entries.find((entry) => entry.message === 'Unhandled error');
    expect(unhandled?.bindings).toMatchObject({ requestId: 'req-500-abc' });
    expect((unhandled?.context.err as Error).message).toBe('database exploded');
    expect(logger.entries.find((entry) => entry.message === 'request failed')?.level).toBe('error');
  });
});

describe('pino adapter', () => {
  const capture = () => {
    const lines: Record<string, unknown>[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        callback();
      },
    });
    return { lines, destination };
  };

  it('writes JSON with a level label, the message, the context and child bindings', () => {
    const { lines, destination } = capture();
    const logger = createPinoLogger({ level: 'debug', pretty: false, destination });

    logger.child({ requestId: 'abc' }).info('hello', { port: 4000 });

    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'hello',
      port: 4000,
      requestId: 'abc',
      service: 'task-manager-api',
    });
  });

  it('serialises errors under `err` with their message and stack', () => {
    const { lines, destination } = capture();
    createPinoLogger({ level: 'info', pretty: false, destination }).error('failed', {
      err: new Error('kaput'),
    });

    expect(lines[0]?.err).toMatchObject({ message: 'kaput', type: 'Error' });
    expect(String((lines[0]?.err as { stack: string }).stack)).toContain('kaput');
  });

  it('redacts secrets wherever they appear', () => {
    const { lines, destination } = capture();
    createPinoLogger({ level: 'info', pretty: false, destination }).info('incoming', {
      headers: { authorization: 'Bearer top-secret', cookie: 'session=abc' },
      password: 'hunter2',
    });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('top-secret');
    expect(serialised).not.toContain('session=abc');
    expect(serialised).not.toContain('hunter2');
    expect(serialised).toContain('[Redacted]');
  });

  it('masks secrets at any depth, under any name, and in child bindings', () => {
    const { lines, destination } = capture();
    const logger = createPinoLogger({ level: 'info', pretty: false, destination });

    logger.child({ requestId: 'r1', apiKey: 'binding-secret' }).info('deep', {
      request: { body: { password: 'deep-secret' } },
      headers: { Authorization: 'Bearer cased-secret' },
      items: [{ token: 'array-secret' }],
    });

    const serialised = JSON.stringify(lines[0]);
    for (const secret of ['binding-secret', 'deep-secret', 'cased-secret', 'array-secret']) {
      expect(serialised).not.toContain(secret);
    }
    expect(lines[0]).toMatchObject({ requestId: 'r1' }); // harmless bindings still pass through
  });

  it('respects the configured level', () => {
    const { lines, destination } = capture();
    const logger = createPinoLogger({ level: 'warn', pretty: false, destination });

    logger.info('too quiet');
    logger.warn('loud enough');

    expect(lines.map((line) => line.msg)).toEqual(['loud enough']);
  });
});
