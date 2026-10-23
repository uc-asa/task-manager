import type { UseQueryResult } from '@tanstack/react-query';
import type { Task, TaskPage, TaskStatus } from '../types';
import { describeError } from '../utils/errors';
import { EmptyState } from './EmptyState';
import { Pagination } from './Pagination';
import { TaskItem } from './TaskItem';

interface TaskListProps {
  query: UseQueryResult<TaskPage>;
  hasFilters: boolean;
  onClearFilters: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onPageChange: (page: number) => void;
}

const SKELETON_ROWS = [0, 1, 2];

/** Everything below the filters: loading, error, empty, the tasks themselves, and paging. */
export function TaskList({
  query,
  hasFilters,
  onClearFilters,
  onStatusChange,
  onEdit,
  onDelete,
  onPageChange,
}: TaskListProps) {
  const tasks = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <>
      {query.isPending && (
        <div role="status">
          <span className="sr-only">Loading tasks…</span>
          <ul className="task-list" aria-hidden="true">
            {SKELETON_ROWS.map((row) => (
              <li key={row} className="card skeleton" />
            ))}
          </ul>
        </div>
      )}

      {query.isError && (
        <div className="banner banner-error" role="alert">
          <p>{describeError(query.error)}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </button>
        </div>
      )}

      {query.isSuccess && tasks.length === 0 && (
        <EmptyState filtered={hasFilters} onClearFilters={onClearFilters} />
      )}

      <ul className={`task-list ${query.isPlaceholderData ? 'is-stale' : ''}`}>
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            onStatusChange={onStatusChange}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>

      {meta && <Pagination meta={meta} onPageChange={onPageChange} />}
    </>
  );
}
