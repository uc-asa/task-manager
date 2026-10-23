import {
  TaskPriority,
  TaskStatus,
  type PageMeta,
  type Task,
  type TaskPage,
  type TaskStats,
} from '../types';

let counter = 0;

export function makeTask(overrides: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: String(counter).padStart(24, '0'),
    title: `Task ${String(counter)}`,
    description: '',
    status: TaskStatus.Todo,
    priority: TaskPriority.Medium,
    dueDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makePage(tasks: Task[], meta: Partial<PageMeta> = {}): TaskPage {
  return {
    data: tasks,
    meta: { total: tasks.length, page: 1, limit: 8, totalPages: 1, ...meta },
  };
}

export function makeStats(overrides: Partial<TaskStats> = {}): TaskStats {
  return {
    total: 4,
    open: 3,
    overdue: 0,
    byStatus: { todo: 2, in_progress: 1, done: 1 },
    ...overrides,
  };
}

/** A promise you resolve/reject from the test, to observe the UI while a request is in flight. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
