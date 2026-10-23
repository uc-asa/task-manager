import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiErrorCode, createHttpClient } from './http';
import {
  authInterceptor,
  errorReportingInterceptor,
  requestIdInterceptor,
  unauthorizedInterceptor,
} from './interceptors';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const mockFetch = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const fn = vi.fn((url: string, init: RequestInit) => Promise.resolve(impl(url, init)));
  vi.stubGlobal('fetch', fn);
  return fn;
};

const makeClient = () => createHttpClient({ baseUrl: '/api', timeoutMs: 50 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requests', () => {
  it('prefixes the base url and parses JSON', async () => {
    const fetchMock = mockFetch(() => json({ ok: true }));
    expect(await makeClient().get('/tasks')).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tasks');
  });

  it('sends JSON bodies with a content type, and none on GET', async () => {
    const fetchMock = mockFetch(() => json({}));
    const client = makeClient();
    await client.post('/tasks', { title: 'x' });
    await client.get('/tasks');

    const [post, get] = fetchMock.mock.calls.map((call) => call[1]);
    expect(post?.body).toBe('{"title":"x"}');
    expect((post?.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(get?.body).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    expect(await makeClient().delete('/tasks/1')).toBeUndefined();
  });
});

describe('errors', () => {
  it('maps API error bodies to ApiError with the first field detail', async () => {
    mockFetch(() =>
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ path: 'title', message: 'Title is required' }],
          },
        },
        400,
      ),
    );
    const error = await makeClient()
      .post('/tasks', {})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'title: Title is required',
    });
  });

  it('gives friendly messages for non-JSON gateway responses', async () => {
    mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(makeClient().get('/tasks')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('server had a problem') as string,
    });

    mockFetch(() => new Response('slow down', { status: 429 }));
    await expect(makeClient().get('/tasks')).rejects.toMatchObject({ status: 429 });
  });

  it('reports network failures as ApiError status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(makeClient().get('/tasks')).rejects.toMatchObject({
      status: 0,
      code: ApiErrorCode.Network,
    });
  });

  it('times out slow requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    );
    await expect(makeClient().get('/tasks')).rejects.toMatchObject({ code: ApiErrorCode.Timeout });
  });

  it('lets caller cancellation propagate as-is (not as an ApiError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    );
    const controller = new AbortController();
    const pending = makeClient().get('/tasks', controller.signal);
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe('AbortError');
  });
});

describe('interceptors', () => {
  it('run request interceptors in registration order', async () => {
    const fetchMock = mockFetch(() => json({}));
    const client = makeClient();
    client.interceptors.request.use((config) => {
      config.headers.set('X-Order', 'first');
      return config;
    });
    client.interceptors.request.use((config) => {
      config.headers.set('X-Order', `${config.headers.get('X-Order') ?? ''}+second`);
      return config;
    });

    await client.get('/tasks');
    expect((fetchMock.mock.calls[0]?.[1].headers as Headers).get('X-Order')).toBe('first+second');
  });

  it('add a request id and a bearer token', async () => {
    const fetchMock = mockFetch(() => json({}));
    const client = makeClient();
    client.interceptors.request.use(requestIdInterceptor);
    client.interceptors.request.use(authInterceptor(() => 'secret'));

    await client.get('/tasks');
    const headers = fetchMock.mock.calls[0]?.[1].headers as Headers;
    expect(headers.get('X-Request-Id')).toMatch(/^[\w-]{36}$/);
    expect(headers.get('Authorization')).toBe('Bearer secret');
  });

  it('can be removed again', async () => {
    const fetchMock = mockFetch(() => json({}));
    const client = makeClient();
    const eject = client.interceptors.request.use(authInterceptor(() => 'secret'));
    eject();

    await client.get('/tasks');
    expect((fetchMock.mock.calls[0]?.[1].headers as Headers).has('Authorization')).toBe(false);
  });

  it('run response interceptors with timing information', async () => {
    mockFetch(() => json({ n: 1 }));
    const client = makeClient();
    const seen = vi.fn();
    client.interceptors.response.use((ctx) => {
      seen(ctx.response.status, typeof ctx.durationMs);
      return ctx;
    });

    await client.get('/tasks');
    expect(seen).toHaveBeenCalledWith(200, 'number');
  });

  it('route 401 responses to the unauthorized handler, and may remap errors', async () => {
    mockFetch(() => json({ error: { code: 'UNAUTHORIZED', message: 'Nope' } }, 401));
    const client = makeClient();
    const onUnauthorized = vi.fn();
    client.interceptors.error.use(unauthorizedInterceptor(onUnauthorized));
    client.interceptors.error.use(
      (error) => new ApiError('Please sign in again.', error.status, error.code),
    );

    await expect(client.get('/tasks')).rejects.toMatchObject({
      message: 'Please sign in again.',
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('error reporting', () => {
  const setup = (response: () => Response) => {
    mockFetch(response);
    const client = makeClient();
    const reporter = { report: vi.fn() };
    client.interceptors.request.use(requestIdInterceptor);
    client.interceptors.error.use(errorReportingInterceptor(reporter));
    return { client, reporter };
  };

  it('reports server errors with the request id, and never the query string', async () => {
    const { client, reporter } = setup(
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
    );

    const error = await client.get('/tasks?q=private%20search').catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502 });
    expect((error as ApiError).requestId).toMatch(/^[\w-]{36}$/);
    expect(reporter.report).toHaveBeenCalledOnce();
    const [reported, context] = reporter.report.mock.calls[0] as [
      ApiError,
      Record<string, unknown>,
    ];
    expect(reported.status).toBe(502);
    expect(context).toMatchObject({ source: 'http', method: 'GET', path: '/tasks', status: 502 });
    expect(context.requestId).toBe((error as ApiError).requestId);
    expect(JSON.stringify(context)).not.toContain('private');
  });

  it('does not report expected client errors', async () => {
    for (const status of [400, 404, 422, 429]) {
      const { client, reporter } = setup(() =>
        json({ error: { code: 'X', message: 'no' } }, status),
      );
      await client.get('/tasks').catch(() => undefined);
      expect(reporter.report).not.toHaveBeenCalled();
    }
  });

  it('reports timeouts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    );
    const client = makeClient();
    const reporter = { report: vi.fn() };
    client.interceptors.error.use(errorReportingInterceptor(reporter));

    await client.get('/tasks').catch(() => undefined);
    expect(reporter.report).toHaveBeenCalledOnce();
  });
});
