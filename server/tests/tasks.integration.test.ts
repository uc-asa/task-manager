import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  IDEMPOTENCY_LEASE_MS,
  IdempotencyRecord,
} from '../src/modules/idempotency/idempotency.model.js';
import { hashRequest } from '../src/modules/idempotency/idempotency.middleware.js';
import { CacheKey, readCache } from '../src/cache/index.js';
import { Task } from '../src/modules/tasks/task.model.js';

const app = createApp();
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Task.init();
  await IdempotencyRecord.init(); // builds the unique index the idempotency guarantee relies on
});

afterEach(async () => {
  await Task.deleteMany({});
  await IdempotencyRecord.deleteMany({});
  await readCache.invalidate(CacheKey.allTasks); // tests wipe the database behind the cache's back
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const createTask = (body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/tasks')
    .send({ title: 'Write tests', ...body });

describe('POST /api/tasks', () => {
  it('creates a task with sensible defaults and exposes `id` instead of `_id`', async () => {
    const res = await createTask();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
    });
    expect(res.body.data.id).toMatch(/^[a-f\d]{24}$/);
    expect(res.body.data._id).toBeUndefined();
    expect(res.body.data.__v).toBeUndefined();
  });

  it('reports ready once the database is connected', async () => {
    const res = await request(app).get('/api/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('trims the title', async () => {
    const res = await createTask({ title: '  padded  ' });
    expect(res.body.data.title).toBe('padded');
  });

  it('normalises any accepted due date to midnight UTC of its UTC day', async () => {
    const dateOnly = await createTask({ dueDate: '2026-03-07' });
    expect(dateOnly.body.data.dueDate).toBe('2026-03-07T00:00:00.000Z');

    const withOffset = await createTask({ dueDate: '2026-03-07T23:30:00+05:30' });
    expect(withOffset.body.data.dueDate).toBe('2026-03-07T00:00:00.000Z');

    const leapDay = await createTask({ dueDate: '2028-02-29' });
    expect(leapDay.body.data.dueDate).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('GET /api/tasks', () => {
  it('paginates and reports totals', async () => {
    for (let i = 1; i <= 5; i += 1) await createTask({ title: `Task ${i}` });

    const res = await request(app).get('/api/tasks').query({ page: 2, limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });

  it('returns newest first by default', async () => {
    await createTask({ title: 'first' });
    await createTask({ title: 'second' });

    const res = await request(app).get('/api/tasks');
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(['second', 'first']);
  });

  it('filters by status and priority', async () => {
    await createTask({ title: 'a', status: 'done', priority: 'high' });
    await createTask({ title: 'b', status: 'todo', priority: 'high' });
    await createTask({ title: 'c', status: 'todo', priority: 'low' });

    const byStatus = await request(app).get('/api/tasks').query({ status: 'todo' });
    expect(byStatus.body.meta.total).toBe(2);

    const both = await request(app).get('/api/tasks').query({ status: 'todo', priority: 'high' });
    expect(both.body.data.map((t: { title: string }) => t.title)).toEqual(['b']);
  });

  it('searches title and description, treating input literally (no regex injection)', async () => {
    await createTask({ title: 'Buy milk' });
    await createTask({ title: 'Plan trip', description: 'Book flights to Goa' });
    await createTask({ title: 'Fix (bug' });

    const bySearch = await request(app).get('/api/tasks').query({ q: 'goa' });
    expect(bySearch.body.meta.total).toBe(1);

    const withSpecialChars = await request(app).get('/api/tasks').query({ q: '(bug' });
    expect(withSpecialChars.status).toBe(200);
    expect(withSpecialChars.body.meta.total).toBe(1);
  });

  it('returns an empty page, with correct totals, when the page is past the end', async () => {
    await createTask();

    const res = await request(app).get('/api/tasks').query({ page: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ total: 1, page: 50, totalPages: 1 });
  });

  it('sorts by due date with tasks that have no due date always last', async () => {
    await createTask({ title: 'none' });
    await createTask({ title: 'late', dueDate: '2026-12-01' });
    await createTask({ title: 'early', dueDate: '2026-01-01' });

    const titles = async (sort: string) => {
      const res = await request(app).get('/api/tasks').query({ sort });
      return res.body.data.map((t: { title: string }) => t.title) as string[];
    };

    expect(await titles('dueDate')).toEqual(['early', 'late', 'none']);
    expect(await titles('-dueDate')).toEqual(['late', 'early', 'none']);
  });

  describe('sorting by priority', () => {
    const seed = async () => {
      // Created in this order, so within one priority "newest first" means the later ones.
      await createTask({ title: 'low-1', priority: 'low' });
      await createTask({ title: 'high-1', priority: 'high' });
      await createTask({ title: 'medium-1', priority: 'medium' });
      await createTask({ title: 'high-2', priority: 'high' });
      await createTask({ title: 'low-2', priority: 'low' });
    };
    const titles = async (query: Record<string, unknown>) => {
      const res = await request(app).get('/api/tasks').query(query);
      expect(res.status).toBe(200);
      return res.body.data.map((t: { title: string }) => t.title) as string[];
    };

    it('puts high first, then medium, then low (not alphabetical), newest first within a priority', async () => {
      await seed();
      expect(await titles({ sort: '-priority' })).toEqual([
        'high-2',
        'high-1',
        'medium-1',
        'low-2',
        'low-1',
      ]);
    });

    it('can put low first instead, still newest first within a priority', async () => {
      await seed();
      expect(await titles({ sort: 'priority' })).toEqual([
        'low-2',
        'low-1',
        'medium-1',
        'high-2',
        'high-1',
      ]);
    });

    it('combines with filters', async () => {
      await seed();
      await createTask({ title: 'done-high', priority: 'high', status: 'done' });
      expect(await titles({ sort: '-priority', status: 'todo', priority: 'high' })).toEqual([
        'high-2',
        'high-1',
      ]);
    });

    it('paginates without skipping or repeating tasks', async () => {
      await seed();
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        seen.push(...(await titles({ sort: '-priority', limit: 2, page })));
      }
      expect(seen).toEqual(['high-2', 'high-1', 'medium-1', 'low-2', 'low-1']);
    });

    it('serialises like any other list (id, no _id or helper fields)', async () => {
      await seed();
      const res = await request(app).get('/api/tasks').query({ sort: '-priority' });
      const first = res.body.data[0];
      expect(first.id).toMatch(/^[a-f\d]{24}$/);
      expect(first._id).toBeUndefined();
      expect(first.priorityRank).toBeUndefined();
    });
  });

  it('keeps pagination stable when sorting by due date', async () => {
    for (let i = 1; i <= 5; i += 1) await createTask({ title: `T${String(i)}` });

    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      const res = await request(app).get('/api/tasks').query({ sort: 'dueDate', limit: 2, page });
      for (const task of res.body.data) seen.add(task.id);
    }
    expect(seen.size).toBe(5);
  });

  it('serialises due-date-sorted results like regular ones (id, no _id)', async () => {
    await createTask({ dueDate: '2026-05-05' });
    const res = await request(app).get('/api/tasks').query({ sort: 'dueDate' });
    expect(res.body.data[0].id).toMatch(/^[a-f\d]{24}$/);
    expect(res.body.data[0]._id).toBeUndefined();
    expect(res.body.data[0].__v).toBeUndefined();
  });
});

describe('GET /api/tasks/stats', () => {
  const stats = (today?: string) =>
    request(app)
      .get('/api/tasks/stats')
      .query(today ? { today } : {});

  it('counts tasks by status and open tasks, ignoring filters', async () => {
    await createTask({ status: 'todo' });
    await createTask({ status: 'todo' });
    await createTask({ status: 'in_progress' });
    await createTask({ status: 'done' });

    const res = await stats();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      total: 4,
      open: 3,
      overdue: 0,
      byStatus: { todo: 2, in_progress: 1, done: 1 },
    });
  });

  it('is all zeros for an empty list', async () => {
    expect((await stats()).body.data).toEqual({
      total: 0,
      open: 0,
      overdue: 0,
      byStatus: { todo: 0, in_progress: 0, done: 0 },
    });
  });

  it('counts overdue by the caller’s calendar day: strictly before today, open tasks only', async () => {
    await createTask({ title: 'yesterday', dueDate: '2026-06-14' });
    await createTask({ title: 'today', dueDate: '2026-06-15' });
    await createTask({ title: 'tomorrow', dueDate: '2026-06-16' });
    await createTask({ title: 'no date' });
    await createTask({ title: 'finished late', dueDate: '2026-01-01', status: 'done' });

    expect((await stats('2026-06-15')).body.data.overdue).toBe(1);
    // Same data, one day later in the caller's calendar: "today" becomes overdue too.
    expect((await stats('2026-06-16')).body.data.overdue).toBe(2);
  });
});

describe('caching', () => {
  it('serves stats from memory, and drops them as soon as a task changes through the API', async () => {
    await createTask({ status: 'todo' });
    const first = await request(app).get('/api/tasks/stats');
    expect(first.body.data.total).toBe(1);

    // A write the API doesn't know about: the cached value is still served (that is the cache).
    await Task.create({ title: 'inserted behind the cache' });
    expect((await request(app).get('/api/tasks/stats')).body.data.total).toBe(1);

    // Any write through the API invalidates, so the very next read is fresh.
    await createTask({ title: 'via the API' });
    expect((await request(app).get('/api/tasks/stats')).body.data.total).toBe(3);
  });

  it('invalidates on update and delete too', async () => {
    const created = await createTask({ status: 'todo' });
    const id = created.body.data.id as string;
    expect((await request(app).get('/api/tasks/stats')).body.data.byStatus.todo).toBe(1);

    await request(app).patch(`/api/tasks/${id}`).send({ status: 'done' });
    const afterUpdate = await request(app).get('/api/tasks/stats');
    expect(afterUpdate.body.data.byStatus).toMatchObject({ todo: 0, done: 1 });

    await request(app).delete(`/api/tasks/${id}`);
    expect((await request(app).get('/api/tasks/stats')).body.data.total).toBe(0);
  });

  it('keeps separate cache entries per caller-supplied day', async () => {
    await createTask({ dueDate: '2026-06-14' });
    expect(
      (await request(app).get('/api/tasks/stats').query({ today: '2026-06-15' })).body.data.overdue,
    ).toBe(1);
    expect(
      (await request(app).get('/api/tasks/stats').query({ today: '2026-06-14' })).body.data.overdue,
    ).toBe(0);
  });

  it('tells clients to revalidate, and answers an unchanged list with a bodyless 304', async () => {
    await createTask();
    const first = await request(app).get('/api/tasks');
    expect(first.headers['cache-control']).toBe('no-cache');
    expect(first.headers.etag).toBeTruthy();

    const revalidated = await request(app)
      .get('/api/tasks')
      .set('If-None-Match', first.headers.etag!);
    expect(revalidated.status).toBe(304);
    expect(revalidated.text).toBe('');

    await createTask({ title: 'changes the list' });
    const changed = await request(app).get('/api/tasks').set('If-None-Match', first.headers.etag!);
    expect(changed.status).toBe(200);
  });

  it('does not add cache headers to writes', async () => {
    const res = await createTask();
    expect(res.headers['cache-control']).toBeUndefined();
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns a task, 404 when missing, 400 for a malformed id', async () => {
    const created = await createTask();
    const id = created.body.data.id as string;

    expect((await request(app).get(`/api/tasks/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/tasks/${new mongoose.Types.ObjectId()}`)).status).toBe(
      404,
    );
    expect((await request(app).get('/api/tasks/not-an-id')).status).toBe(400);
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('updates only the provided fields', async () => {
    const created = await createTask({ priority: 'high' });
    const id = created.body.data.id as string;

    const res = await request(app).patch(`/api/tasks/${id}`).send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'done', priority: 'high', title: 'Write tests' });
  });

  it('sets and clears the due date', async () => {
    const created = await createTask();
    const id = created.body.data.id as string;

    const set = await request(app)
      .patch(`/api/tasks/${id}`)
      .send({ dueDate: '2026-12-01T00:00:00.000Z' });
    expect(set.body.data.dueDate).toBe('2026-12-01T00:00:00.000Z');

    const cleared = await request(app).patch(`/api/tasks/${id}`).send({ dueDate: null });
    expect(cleared.body.data.dueDate).toBeNull();
  });

  it('rejects invalid values and does not modify the task', async () => {
    const created = await createTask({ title: 'keep me' });
    const id = created.body.data.id as string;

    expect((await request(app).patch(`/api/tasks/${id}`).send({ title: null })).status).toBe(400);
    expect(
      (await request(app).patch(`/api/tasks/${id}`).send({ dueDate: 'tomorrow' })).status,
    ).toBe(400);
    expect((await request(app).patch(`/api/tasks/${id}`).send({ isAdmin: true })).status).toBe(400);

    const after = await request(app).get(`/api/tasks/${id}`);
    expect(after.body.data.title).toBe('keep me');
  });

  it('bumps updatedAt on change', async () => {
    const created = await createTask();
    const id = created.body.data.id as string;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await request(app).patch(`/api/tasks/${id}`).send({ status: 'done' });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.body.data.updatedAt as string).getTime(),
    );
  });

  it('rejects an empty body and unknown tasks', async () => {
    const created = await createTask();
    const id = created.body.data.id as string;

    expect((await request(app).patch(`/api/tasks/${id}`).send({})).status).toBe(400);
    expect(
      (await request(app).patch(`/api/tasks/${new mongoose.Types.ObjectId()}`).send({ title: 'x' }))
        .status,
    ).toBe(404);
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('deletes a task, then 404s on repeat', async () => {
    const created = await createTask();
    const id = created.body.data.id as string;

    expect((await request(app).delete(`/api/tasks/${id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/tasks/${id}`)).status).toBe(404);
    expect(await Task.countDocuments()).toBe(0);
  });
});

describe('Idempotency-Key on POST /api/tasks', () => {
  const withKey = (key: string, body: Record<string, unknown> = { title: 'Pay rent' }) =>
    request(app).post('/api/tasks').set('Idempotency-Key', key).send(body);

  it('creates the task once and replays the original response on a retry', async () => {
    const first = await withKey('key-retry-0001');
    const retry = await withKey('key-retry-0001');

    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body); // same id, same timestamps
    expect(await Task.countDocuments()).toBe(1);
  });

  it('treats a reordered but identical body as the same request', async () => {
    await withKey('key-order-0001', { title: 'A', priority: 'high' });
    const retry = await withKey('key-order-0001', { priority: 'high', title: 'A' });
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await Task.countDocuments()).toBe(1);
  });

  it('rejects the same key with a different body (422) without creating anything', async () => {
    await withKey('key-reuse-0001', { title: 'First' });
    const res = await withKey('key-reuse-0001', { title: 'Something else' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await Task.countDocuments()).toBe(1);
  });

  it('creates only one task when the same key arrives concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => withKey('key-race-00001')));

    expect(await Task.countDocuments()).toBe(1);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((status) => status === 201).length).toBeGreaterThanOrEqual(1);
    // Everyone else either got the replayed response or was told to retry (409).
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
  });

  it('releases the key after a failed request so it can be fixed and retried', async () => {
    const invalid = await withKey('key-fix-000001', { title: '   ' });
    expect(invalid.status).toBe(400);

    const fixed = await withKey('key-fix-000001', { title: '   ' });
    expect(fixed.status).toBe(400); // still validated, not blocked by a stale record

    const ok = await withKey('key-fix-000001', { title: 'Now valid' });
    // Different body than the failed attempts: allowed because errors are never stored.
    expect(ok.status).toBe(201);
  });

  it('is optional: requests without a key are never deduplicated', async () => {
    await createTask({ title: 'Same' });
    await createTask({ title: 'Same' });
    expect(await Task.countDocuments()).toBe(2);
  });

  it('rejects malformed keys', async () => {
    const res = await withKey('short');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect((await withKey('has spaces in it!!')).status).toBe(400);
  });

  describe('a request that died before answering (crash, kill, deploy)', () => {
    const body = { title: 'Pay rent' };
    // The same fingerprint a real POST /api/tasks with this body produces.
    const stuckRecord = (key: string, ageMs: number) =>
      IdempotencyRecord.create({
        key,
        requestHash: hashRequest('POST', '/api/tasks/', body),
        lockedAt: new Date(Date.now() - ageMs),
      });

    it('answers 409 while the original may still be running (lease not expired)', async () => {
      await stuckRecord('key-fresh-0001', 5_000);

      const res = await withKey('key-fresh-0001', body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
      expect(await Task.countDocuments()).toBe(0);
    });

    it('lets a retry take over once the lease has expired, and replays afterwards', async () => {
      await stuckRecord('key-stale-0001', IDEMPOTENCY_LEASE_MS + 5_000);

      const retry = await withKey('key-stale-0001', body);
      expect(retry.status).toBe(201);
      expect(await Task.countDocuments()).toBe(1);

      const again = await withKey('key-stale-0001', body);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body).toEqual(retry.body);
      expect(await Task.countDocuments()).toBe(1);
    });

    it('lets exactly one of several concurrent retries take over an abandoned key', async () => {
      await stuckRecord('key-race-stale1', IDEMPOTENCY_LEASE_MS + 5_000);

      const results = await Promise.all(
        Array.from({ length: 6 }, () => withKey('key-race-stale1', body)),
      );

      expect(await Task.countDocuments()).toBe(1);
      expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
      expect(results.some((r) => r.status === 201)).toBe(true);
    });

    it('does not take over for a different request body (still 422)', async () => {
      await stuckRecord('key-other-0001', IDEMPOTENCY_LEASE_MS + 5_000);
      const res = await withKey('key-other-0001', { title: 'Something else' });
      expect(res.status).toBe(422);
    });
  });

  it('expires stored keys automatically (TTL index exists)', async () => {
    const indexes = await IdempotencyRecord.collection.indexes();
    const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);
    expect(ttl?.expireAfterSeconds).toBe(24 * 60 * 60);
  });
});
