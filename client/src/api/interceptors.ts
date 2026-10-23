import { HttpHeader } from 'shared';
import type { ErrorReporter } from '../observability';
import {
  ApiErrorCode,
  type ErrorInterceptor,
  type RequestInterceptor,
  type ResponseInterceptor,
} from './http';

/** Adds `X-Request-Id`, which the API echoes back and logs, so one request can be traced end to end. */
export const requestIdInterceptor: RequestInterceptor = (config) => {
  config.headers.set(HttpHeader.RequestId, crypto.randomUUID());
  return config;
};

/** Attaches a bearer token when one exists. Unused until the API has authentication. */
export const authInterceptor =
  (getToken: () => string | null): RequestInterceptor =>
  (config) => {
    const token = getToken();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);
    return config;
  };

/** Central place to react to an expired session (clear state, redirect to login, refresh a token). */
export const unauthorizedInterceptor =
  (onUnauthorized: () => void): ErrorInterceptor =>
  (error) => {
    if (error.status === 401) onUnauthorized();
    return error;
  };

/** Development-only request timing; swap for real telemetry (Sentry, Datadog RUM) in production. */
export const timingInterceptor: ResponseInterceptor = (ctx) => {
  console.debug(
    `${ctx.config.method} ${ctx.config.path} → ${String(ctx.response.status)} (${ctx.durationMs.toFixed(0)}ms)`,
  );
  return ctx;
};

/**
 * Sends failures that are not the user's fault (server errors and timeouts) to the error reporter,
 * tagged with the request id so an alert can be traced to the exact server log lines. Expected
 * client errors (validation, not found) are not reported: they are part of normal use.
 */
export const errorReportingInterceptor =
  (reporter: ErrorReporter): ErrorInterceptor =>
  (error, config) => {
    if (error.status >= 500 || error.code === ApiErrorCode.Timeout) {
      reporter.report(error, {
        source: 'http',
        method: config.method,
        path: config.path.split('?')[0], // never the query string: it can contain search text
        status: error.status,
        code: error.code,
        requestId: error.requestId,
      });
    }
    return error;
  };
