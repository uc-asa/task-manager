// Enum-like `as const` objects instead of TS `enum`s: plain JavaScript (works with esbuild,
// isolatedModules, Zod and Mongoose), and the value type is a string-literal union, so
// `'todo'` and `TaskStatus.Todo` are interchangeable.

export const TaskStatus = {
  Todo: 'todo',
  InProgress: 'in_progress',
  Done: 'done',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus);

/** Declared from lowest to highest: the order is meaningful (it is the rank used to sort by priority). */
export const TaskPriority = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];
export const TASK_PRIORITIES = Object.values(TaskPriority);

export const TaskSort = {
  CreatedDesc: '-createdAt',
  CreatedAsc: 'createdAt',
  DueDateAsc: 'dueDate',
  DueDateDesc: '-dueDate',
  /** High priority first. */
  PriorityDesc: '-priority',
  /** Low priority first. */
  PriorityAsc: 'priority',
} as const;
export type TaskSort = (typeof TaskSort)[keyof typeof TaskSort];
export const TASK_SORTS = Object.values(TaskSort);

export const TaskLimits = {
  TitleMax: 120,
  DescriptionMax: 1000,
  SearchMax: 100,
  PageSizeDefault: 10,
  PageSizeMax: 100,
  DueYearMin: 1900,
  DueYearMax: 2999,
} as const;

// ---- API shapes (what travels over the wire as JSON) ----

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** ISO string at 00:00 UTC, or null when there is no due date. */
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
}

export type TaskPatch = Partial<TaskInput>;

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Headline numbers for the whole task list (independent of any filter). */
export interface TaskStats {
  total: number;
  /** Everything not done. */
  open: number;
  /** Open tasks whose due day is before today. */
  overdue: number;
  byStatus: Record<TaskStatus, number>;
}

export interface TaskPage {
  data: Task[];
  meta: PageMeta;
}
