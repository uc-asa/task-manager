// Domain types and constants come from the `shared` package (the same ones the API uses).
import { TaskPriority, TaskSort, TaskStatus } from 'shared';

export * from 'shared';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.Todo]: 'To do',
  [TaskStatus.InProgress]: 'In progress',
  [TaskStatus.Done]: 'Done',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.Low]: 'Low',
  [TaskPriority.Medium]: 'Medium',
  [TaskPriority.High]: 'High',
};

export const SORT_LABELS: Record<TaskSort, string> = {
  [TaskSort.CreatedDesc]: 'Newest first',
  [TaskSort.CreatedAsc]: 'Oldest first',
  [TaskSort.DueDateAsc]: 'Due date (soonest)',
  [TaskSort.DueDateDesc]: 'Due date (latest)',
  [TaskSort.PriorityDesc]: 'Priority (high first)',
  [TaskSort.PriorityAsc]: 'Priority (low first)',
};

export interface TaskFilters {
  status: TaskStatus | '';
  priority: TaskPriority | '';
  q: string;
  sort: TaskSort;
  page: number;
}
