import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// These tests never reach the database: every request is rejected (or answered) before
// a query is issued, so they run instantly and without MongoDB.
const app = createApp();
const validId = new mongoose.Types.ObjectId().toString();

describe('platform behaviour', () => {
  it('answers the health check and hides the framework header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('echoes a safe X-Request-Id and replaces an unsafe one', async () => {
    const echoed = await request(app).get('/api/health').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');

    const generated = await request(app).get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[\w-]{36}$/);

    const unsafe = await request(app).get('/api/health').set('X-Request-Id', 'bad id;<script>');
    expect(unsafe.headers['x-request-id']).not.toContain('<script>');
  });

  it('reports not-ready while the database is disconnected', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  it('answers 413 (not 500) for an oversized body', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'x', description: 'y'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /api/tasks validation', () => {
  it('rejects a blank title with field-level details', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
  });

  it.each([
    ['unknown field', { title: 'x', isAdmin: true }],
    ['invalid status', { title: 'x', status: 'blocked' }],
    ['invalid priority', { title: 'x', priority: 'urgent' }],
    ['invalid due date', { title: 'x', dueDate: 'tomorrow-ish' }],
    ['loose due date that Date.parse accepts', { title: 'x', dueDate: '1' }],
    ['due date with a month name', { title: 'x', dueDate: 'March 7, 2026' }],
    ['non-existent calendar day', { title: 'x', dueDate: '2026-02-31' }],
    ['due date out of the supported years', { title: 'x', dueDate: '0000-01-01' }],
    ['due date far in the future', { title: 'x', dueDate: '+275760-09-13T00:00:00.000Z' }],
    ['title of only zero-width characters', { title: '\u200b\u200b' }],
    ['title of only non-breaking spaces', { title: '\u00a0\u00a0' }],
    ['non-string title', { title: ['a'] }],
    ['null title', { title: null }],
    ['title too long', { title: 'x'.repeat(121) }],
  ])('rejects %s', async (_name, body) => {
    const res = await request(app).post('/api/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/tasks/stats validation', () => {
  it('is its own route, not mistaken for a task id', async () => {
    const res = await request(app).get('/api/tasks/stats').query({ today: 'not-a-date' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('today'); // not "id"
  });

  it('rejects unknown parameters and impossible dates', async () => {
    expect((await request(app).get('/api/tasks/stats').query({ nope: 1 })).status).toBe(400);
    expect((await request(app).get('/api/tasks/stats').query({ today: '2026-02-31' })).status).toBe(
      400,
    );
  });
});

describe('id and query validation', () => {
  it('rejects malformed ids on every :id route', async () => {
    expect((await request(app).get('/api/tasks/not-an-id')).status).toBe(400);
    expect((await request(app).patch('/api/tasks/not-an-id').send({ title: 'x' })).status).toBe(
      400,
    );
    expect((await request(app).delete('/api/tasks/not-an-id')).status).toBe(400);
  });

  it('rejects an empty PATCH body', async () => {
    const res = await request(app).patch(`/api/tasks/${validId}`).send({});
    expect(res.status).toBe(400);
  });

  it.each([
    ['limit above the cap', { limit: 1000 }],
    ['page below 1', { page: 0 }],
    ['unknown sort', { sort: 'password' }],
    ['unknown status filter', { status: 'archived' }],
    ['status operator injection', { 'status[$ne]': 'todo' }],
    ['repeated q parameter', { q: ['a', 'b'] }],
    ['non-numeric page', { page: 'abc' }],
    ['fractional limit', { limit: 1.5 }],
  ])('rejects %s', async (_name, query) => {
    const res = await request(app).get('/api/tasks').query(query);
    expect(res.status).toBe(400);
  });
});

describe('priority ranking', () => {
  it('declares priorities from lowest to highest, because sorting by priority ranks by this order', async () => {
    const { TASK_PRIORITIES } = await import('shared');
    expect(TASK_PRIORITIES).toEqual(['low', 'medium', 'high']);
  });
});
