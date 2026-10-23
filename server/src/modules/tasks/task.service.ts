import { CacheKey, readCache } from '../../cache/index.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { HttpStatus } from '../../utils/http.js';
import {
  ErrorCode,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskSort,
  TaskStatus,
  type TaskStats,
} from 'shared';
import { Task, type ITask } from './task.model.js';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schema.js';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const notFound = () => new AppError(HttpStatus.NotFound, ErrorCode.TaskNotFound, 'Task not found');

type Direction = 1 | -1;

/**
 * Sorting by something MongoDB cannot order natively goes through an aggregation that computes a
 * helper key first. The helper keys are removed again, and results are hydrated so they serialise
 * exactly like documents from `find` (`id` instead of `_id`).
 *
 * These sorts happen in memory over every matching document (no index can serve a computed key),
 * which is fine at this scale and measured in DECISIONS.md. Every sort ends in `_id` (and the
 * priority sort in `createdAt`) so the order is total and pagination never skips or repeats rows.
 */
async function aggregateSorted(
  filter: Record<string, unknown>,
  helperFields: Record<string, unknown>,
  sort: Record<string, Direction>,
  skip: number,
  limit: number,
) {
  const rows = await Task.aggregate<ITask>([
    { $match: filter },
    { $addFields: helperFields },
    { $sort: sort },
    { $skip: skip },
    { $limit: limit },
    { $project: Object.fromEntries(Object.keys(helperFields).map((field) => [field, 0])) },
    // The in-memory sort stage is capped at 100 MB; this lets it spill to disk instead of failing.
  ]).allowDiskUse(true);
  return rows.map((row) => Task.hydrate(row));
}

/** MongoDB sorts null/missing first when ascending; tasks without a due date should always be last. */
const byDueDate = (
  filter: Record<string, unknown>,
  direction: Direction,
  skip: number,
  limit: number,
) =>
  aggregateSorted(
    filter,
    { hasNoDueDate: { $cond: [{ $eq: ['$dueDate', null] }, 1, 0] } },
    { hasNoDueDate: 1, dueDate: direction, _id: direction },
    skip,
    limit,
  );

/**
 * Priority is stored as text, and alphabetical order (high, low, medium) is wrong, so each task is
 * ranked by its position in `TASK_PRIORITIES` (low = 0, medium = 1, high = 2). Within one priority
 * the newest task comes first, whichever way the priorities themselves are ordered.
 */
const byPriority = (
  filter: Record<string, unknown>,
  direction: Direction,
  skip: number,
  limit: number,
) =>
  aggregateSorted(
    filter,
    { priorityRank: { $indexOfArray: [[...TASK_PRIORITIES], '$priority'] } },
    { priorityRank: direction, createdAt: -1, _id: -1 },
    skip,
    limit,
  );

export async function listTasks(query: ListTasksQuery) {
  const { status, priority, q, page, limit, sort } = query;

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (q) {
    // Escaped so user input can never be interpreted as a regex (ReDoS / injection).
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: pattern }, { description: pattern }];
  }

  const direction = sort.startsWith('-') ? -1 : 1;
  const sortField = sort.replace(/^-/, '');
  const skip = (page - 1) * limit;

  const find = () => {
    switch (sort) {
      case TaskSort.DueDateAsc:
      case TaskSort.DueDateDesc:
        return byDueDate(filter, direction, skip, limit);
      case TaskSort.PriorityAsc:
      case TaskSort.PriorityDesc:
        return byPriority(filter, direction, skip, limit);
      default:
        // Plain field sorts use the indexes; `_id` is the stable tiebreaker.
        return Task.find(filter)
          .sort({ [sortField]: direction, _id: direction })
          .skip(skip)
          .limit(limit);
    }
  };

  const [data, total] = await Promise.all([find(), Task.countDocuments(filter)]);

  return {
    data,
    meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getTask(id: string) {
  const task = await Task.findById(id);
  if (!task) throw notFound();
  return task;
}

export async function createTask(input: CreateTaskInput) {
  const task = await Task.create(input);
  await readCache.invalidate(CacheKey.allTasks);
  return task;
}

export async function updateTask(id: string, input: UpdateTaskInput) {
  const task = await Task.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  );
  if (!task) throw notFound();
  await readCache.invalidate(CacheKey.allTasks);
  return task;
}

export async function deleteTask(id: string) {
  const task = await Task.findByIdAndDelete(id);
  if (!task) throw notFound();
  await readCache.invalidate(CacheKey.allTasks);
}

/**
 * Headline counts. The aggregation scans every task, so the result is cached briefly. It is
 * dropped whenever a task is created, updated or deleted through this API, so the TTL only
 * bounds staleness from other writers (another instance with its own in-memory cache, a script).
 */
export async function getStats(today?: string): Promise<TaskStats> {
  const day = today ?? new Date().toISOString().slice(0, 10);
  return readCache.getOrLoad(CacheKey.stats(day), env.STATS_CACHE_TTL_MS, () => loadStats(day));
}

async function loadStats(day: string): Promise<TaskStats> {
  // Due dates are stored as midnight UTC of their calendar day, so compare against the same.
  const startOfToday = new Date(`${day}T00:00:00.000Z`);

  const [grouped, overdue] = await Promise.all([
    Task.aggregate<{ _id: TaskStatus; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // `$lt` never matches a null/missing dueDate, so tasks without one are never overdue.
    Task.countDocuments({ status: { $ne: TaskStatus.Done }, dueDate: { $lt: startOfToday } }),
  ]);

  const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >;
  for (const { _id, count } of grouped) byStatus[_id] = count;

  const total = TASK_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);
  return { total, open: total - byStatus[TaskStatus.Done], overdue, byStatus };
}
