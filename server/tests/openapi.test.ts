import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openApiDocument } from '../src/docs/openapi.js';
import { taskRouter } from '../src/modules/tasks/task.routes.js';

// No database needed: documentation never touches it.
const app = createApp({ docs: true });

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Every `METHOD /path` the task router actually serves, written the way OpenAPI spells it. */
const implementedOperations = () =>
  (taskRouter.stack as unknown as RouteLayer[]).flatMap(({ route }) =>
    route
      ? Object.keys(route.methods).map(
          (method) =>
            `${method.toUpperCase()} /tasks${route.path === '/' ? '' : route.path.replace(/:(\w+)/g, '{$1}')}`,
        )
      : [],
  );

const documentedOperations = () =>
  Object.entries(openApiDocument.paths).flatMap(([path, operations]) =>
    Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
  );

describe('API documentation', () => {
  it('serves the OpenAPI document as JSON', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/tasks', '/tasks/{id}', '/health', '/ready']),
    );
  });

  it('serves the interactive docs page', async () => {
    const res = await request(app).get('/api/docs/').redirects(1);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('swagger-ui');
  });

  it('documents every route the router implements (fails if one is added without docs)', () => {
    const implemented = implementedOperations();
    expect(implemented.length).toBeGreaterThan(0);
    for (const operation of implemented) {
      expect(documentedOperations()).toContain(operation);
    }
  });

  it('is generated from the validation schemas, so limits cannot drift', () => {
    const create = openApiDocument.paths['/tasks'].post.requestBody.content['application/json']
      .schema as {
      properties: { title: { maxLength: number }; status: { enum: string[]; default: string } };
      required: string[];
      additionalProperties: boolean;
    };
    expect(create.properties.title.maxLength).toBe(120);
    expect(create.properties.status).toMatchObject({
      enum: ['todo', 'in_progress', 'done'],
      default: 'todo',
    });
    expect(create.required).toEqual(['title']);
    expect(create.additionalProperties).toBe(false);
  });

  it('documents the idempotency and request-id headers on POST /tasks', () => {
    const names = openApiDocument.paths['/tasks'].post.parameters.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Idempotency-Key', 'X-Request-Id']));
  });

  it('can be switched off (e.g. in production)', async () => {
    const hidden = createApp({ docs: false });
    expect((await request(hidden).get('/api/openapi.json')).status).toBe(404);
    expect((await request(hidden).get('/api/docs/')).status).toBe(404);
  });
});
