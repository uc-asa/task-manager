import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSort, type TaskFilters } from '../types';
import { createTask, fetchTaskStats, fetchTasks } from './tasks';

// These tests look at the request that is actually SENT. Component tests mock `fetchTasks` itself,
// so on their own they cannot notice a filter or sort that is never put into the URL.
vi.mock('./client', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const { http } = await import('./client');
const get = vi.mocked(http.get);
const post = vi.mocked(http.post);

const filters = (overrides: Partial<TaskFilters> = {}): TaskFilters => ({
  status: '',
  priority: '',
  q: '',
  sort: TaskSort.CreatedDesc,
  page: 1,
  ...overrides,
});

const requestedParams = () => {
  const path = get.mock.calls.at(-1)?.[0] ?? '';
  expect(path.startsWith('/tasks?')).toBe(true);
  return new URLSearchParams(path.split('?')[1]);
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: [], meta: {} });
});

describe('fetchTasks request', () => {
  it('always sends the page, page size and sort', async () => {
    await fetchTasks(filters({ page: 3 }));
    const params = requestedParams();
    expect(params.get('page')).toBe('3');
    expect(params.get('limit')).toBe('8');
    expect(params.get('sort')).toBe('-createdAt');
  });

  it.each(Object.values(TaskSort))('sends the %s sort to the server', async (sort) => {
    await fetchTasks(filters({ sort }));
    expect(requestedParams().get('sort')).toBe(sort);
  });

  it('sends status, priority and a trimmed search only when they are set', async () => {
    await fetchTasks(filters());
    expect([...requestedParams().keys()].sort()).toEqual(['limit', 'page', 'sort']);

    await fetchTasks(filters({ status: 'done', priority: 'high', q: '  milk  ' }));
    const params = requestedParams();
    expect(params.get('status')).toBe('done');
    expect(params.get('priority')).toBe('high');
    expect(params.get('q')).toBe('milk');
  });

  it('does not send a blank search', async () => {
    await fetchTasks(filters({ q: '   ' }));
    expect(requestedParams().has('q')).toBe(false);
  });

  it('passes the abort signal through, so stale searches can be cancelled', async () => {
    const controller = new AbortController();
    await fetchTasks(filters(), controller.signal);
    expect(get.mock.calls.at(-1)?.[1]).toBe(controller.signal);
  });
});

describe('other requests', () => {
  it('sends the idempotency key as a header when creating', async () => {
    post.mockResolvedValue({ data: {} });
    await createTask(
      { title: 'x', description: '', status: 'todo', priority: 'low', dueDate: null },
      'key-12345678',
    );
    expect(post.mock.calls[0]?.[2]).toEqual({ 'Idempotency-Key': 'key-12345678' });
  });

  it("sends the viewer's day when asking for stats", async () => {
    get.mockResolvedValue({ data: {} });
    await fetchTaskStats('2026-10-23');
    expect(get.mock.calls.at(-1)?.[0]).toBe('/tasks/stats?today=2026-10-23');
  });
});
