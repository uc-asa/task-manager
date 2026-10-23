import { z } from 'zod';
import { TaskLimits, TaskPriority, TaskSort, TaskStatus } from 'shared';

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid task id'),
});

/**
 * Due dates are calendar days. Clients may send `YYYY-MM-DD` or a full ISO datetime; either way
 * the value is normalised to midnight UTC of its UTC day, so what is stored never depends on the
 * server's timezone. Loose strings that `Date.parse` would accept ("1", "March 7") are rejected.
 */
const dueDate = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value))
  .refine(
    (date) =>
      date.getUTCFullYear() >= TaskLimits.DueYearMin &&
      date.getUTCFullYear() <= TaskLimits.DueYearMax,
    `Year must be between ${String(TaskLimits.DueYearMin)} and ${String(TaskLimits.DueYearMax)}`,
  )
  // Truncate to the UTC day. (Not Date.UTC(y, m, d): it maps years 0-99 to 1900-1999.)
  .transform((date) => {
    date.setUTCHours(0, 0, 0, 0);
    return date;
  });

/** Letters, numbers, punctuation or symbols. Rules out titles made only of spaces/zero-width characters. */
const HAS_VISIBLE_CHARACTER = /[\p{L}\p{N}\p{P}\p{S}]/u;

const fields = {
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(TaskLimits.TitleMax, 'Title is too long')
    .refine((value) => HAS_VISIBLE_CHARACTER.test(value), 'Title must contain visible characters'),
  description: z.string().trim().max(TaskLimits.DescriptionMax, 'Description is too long'),
  status: z.enum(TaskStatus),
  priority: z.enum(TaskPriority),
  dueDate: dueDate.nullable(),
};

/** Unknown keys are rejected so clients can't write fields we don't expose. */
export const createTaskSchema = z.strictObject({
  title: fields.title,
  description: fields.description.default(''),
  status: fields.status.default(TaskStatus.Todo),
  priority: fields.priority.default(TaskPriority.Medium),
  dueDate: fields.dueDate.optional(),
});

export const updateTaskSchema = z
  .strictObject({
    title: fields.title.optional(),
    description: fields.description.optional(),
    status: fields.status.optional(),
    priority: fields.priority.optional(),
    dueDate: fields.dueDate.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

/** Strict like the bodies: unknown query parameters (including `status[$ne]=…`) are rejected. */
export const listTasksQuerySchema = z.strictObject({
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TaskPriority).optional(),
  q: z.string().trim().max(TaskLimits.SearchMax).optional(),
  page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(TaskLimits.PageSizeMax)
    .default(TaskLimits.PageSizeDefault),
  sort: z.enum(TaskSort).default(TaskSort.CreatedDesc),
});

/** `today` is the caller's calendar day, so "overdue" matches what the user sees (not server UTC). */
export const statsQuerySchema = z.strictObject({ today: z.iso.date().optional() });

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
