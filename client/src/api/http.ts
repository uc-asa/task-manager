/**
 * A tiny fetch-based HTTP client with Axios-style interceptors and no extra dependency.
 *
 * Everything cross-cutting (auth headers, request ids, logging, 401 handling, retries, metrics)
 * is added by registering an interceptor in `client.ts`, so feature modules such as `tasks.ts`
 * never change when those needs grow.
 */

import { HttpHeader } from 'shared';

export const HttpMethod = {
  Get: 'GET',
  Post: 'POST',
  Patch: 'PATCH',
  Put: 'PUT',
  Delete: 'DELETE',
} as const;
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export const ApiErrorCode = {
  Network: 'NETWORK_ERROR',
  Timeout: 'TIMEOUT',
} as const;

const NO_CONTENT = 204;

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when no response was received (network failure, timeout). */
    public readonly status: number,
    /** Machine-readable code from the API (`error.code`) or one of `ApiErrorCode`. */
    public readonly code?: string,
    public readonly details?: { path: string; message: string }[],
    /** The `X-Request-Id` of the request, matching the id in the server logs. */
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestConfig {
  method: HttpMethod;
  /** Path relative to `baseUrl`, including any query string. */
  path: string;
  headers: Headers;
  /** Serialised as JSON. */
  body?: unknown;
  /** Caller cancellation (TanStack Query passes one). */
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface ResponseContext {
  config: RequestConfig;
  response: Response;
  /** Parsed JSON body (undefined for 204). */
  data: unknown;
  durationMs: number;
}

/** Runs before the request is sent. Return the (possibly modified) config. */
export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
/** Runs after a successful response is parsed. */
export type ResponseInterceptor = (
  ctx: ResponseContext,
) => ResponseContext | Promise<ResponseContext>;
/** Runs for every failed request. Return the error to throw (typically the same one, or a mapped one). */
export type ErrorInterceptor = (
  error: ApiError,
  config: RequestConfig,
) => ApiError | Promise<ApiError>;

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { path: string; message: string }[] };
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Proxies and gateways answer with HTML/plain text, so fall back to a status-based message. */
function fallbackMessage(status: number): string {
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The server had a problem. Please try again shortly.';
  return 'Request failed';
}

function withRequestId(error: ApiError, requestId: string | null): ApiError {
  if (error.requestId || !requestId) return error;
  return new ApiError(error.message, error.status, error.code, error.details, requestId);
}

export function createHttpClient({
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  defaultHeaders = {},
}: HttpClientOptions) {
  const requestInterceptors: RequestInterceptor[] = [];
  const responseInterceptors: ResponseInterceptor[] = [];
  const errorInterceptors: ErrorInterceptor[] = [];

  /** Interceptors run in registration order. `use` returns a function that removes it again. */
  const registrar = <T>(list: T[]) => ({
    use(interceptor: T) {
      list.push(interceptor);
      return () => {
        const index = list.indexOf(interceptor);
        if (index !== -1) list.splice(index, 1);
      };
    },
  });

  async function send(config: RequestConfig): Promise<ResponseContext> {
    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
    const startedAt = performance.now();

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${config.path}`, {
        method: config.method,
        headers: config.headers,
        body: config.body === undefined ? undefined : JSON.stringify(config.body),
        signal,
      });
    } catch (error) {
      // A cancellation by the caller is not a failure: let it propagate untouched.
      if (config.signal?.aborted) throw error;
      if (timeout.aborted) {
        throw new ApiError('The request took too long. Please try again.', 0, ApiErrorCode.Timeout);
      }
      throw new ApiError(
        'Cannot reach the server. Check your connection and try again.',
        0,
        ApiErrorCode.Network,
      );
    }

    const data: unknown =
      response.status === NO_CONTENT ? undefined : await response.json().catch(() => null);

    if (!response.ok) {
      const body = data as ErrorBody | null;
      const detail = body?.error?.details?.[0];
      const message = detail ? `${detail.path}: ${detail.message}` : body?.error?.message;
      throw new ApiError(
        message ?? fallbackMessage(response.status),
        response.status,
        body?.error?.code,
        body?.error?.details,
      );
    }

    return { config, response, data, durationMs: performance.now() - startedAt };
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    options: { body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {},
  ): Promise<T> {
    let config: RequestConfig = {
      method,
      path,
      headers: new Headers({ Accept: 'application/json', ...defaultHeaders, ...options.headers }),
      body: options.body,
      signal: options.signal,
      timeoutMs,
    };
    if (options.body !== undefined) config.headers.set('Content-Type', 'application/json');

    try {
      for (const intercept of requestInterceptors) config = await intercept(config);

      let ctx = await send(config);
      for (const intercept of responseInterceptors) ctx = await intercept(ctx);
      return ctx.data as T;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      let mapped = withRequestId(error, config.headers.get(HttpHeader.RequestId));
      for (const intercept of errorInterceptors) mapped = await intercept(mapped, config);
      throw mapped;
    }
  }

  return {
    interceptors: {
      request: registrar(requestInterceptors),
      response: registrar(responseInterceptors),
      error: registrar(errorInterceptors),
    },
    get: <T>(path: string, signal?: AbortSignal) => request<T>(HttpMethod.Get, path, { signal }),
    post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
      request<T>(HttpMethod.Post, path, { body, headers }),
    patch: <T>(path: string, body: unknown) => request<T>(HttpMethod.Patch, path, { body }),
    delete: <T = void>(path: string) => request<T>(HttpMethod.Delete, path),
  };
}
