import { useState } from 'react';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Filters } from './components/Filters';
import { SummaryStats } from './components/SummaryStats';
import { TaskForm } from './components/TaskForm';
import { TaskList } from './components/TaskList';
import { useTaskFilters } from './hooks/useTaskFilters';
import {
  useCreateTask,
  useDeleteTask,
  useTaskStatsQuery,
  useTasksQuery,
  useUpdateTask,
} from './hooks/useTasks';
import type { Task, TaskInput } from './types';
import { describeError } from './utils/errors';

/** Wires the pieces together: filters → data → screen. Each piece lives in its own file. */
export default function App() {
  const filters = useTaskFilters();
  const [editing, setEditing] = useState<Task | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);

  const tasksQuery = useTasksQuery(filters.filters);
  const stats = useTaskStatsQuery().data;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const tasks = tasksQuery.data?.data ?? [];
  const meta = tasksQuery.data?.meta;

  // If the current page no longer exists (e.g. its last task was deleted elsewhere), step back
  // to the last real page instead of leaving the user on an empty one with no pagination.
  if (meta && !tasksQuery.isPlaceholderData && filters.page > meta.totalPages) {
    filters.setPage(meta.totalPages);
  }

  const handleEditSubmit = async (input: TaskInput) => {
    if (!editing) return;
    await updateTask.mutateAsync({ id: editing.id, patch: input });
    setEditing(null);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    if (editing?.id === pendingDelete.id) setEditing(null);
    // Deleting the last item on a page steps back to the previous page.
    if (tasks.length === 1 && filters.page > 1) filters.setPage(filters.page - 1);
    updateTask.reset();
    deleteTask.mutate(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>Task Manager</h1>
          <p className="tagline">Plan it, do it, tick it off.</p>
        </div>
        {stats && <SummaryStats stats={stats} />}
      </header>

      <main>
        {editing ? (
          <TaskForm
            key={editing.id}
            task={editing}
            submitting={updateTask.isPending}
            error={updateTask.isError ? describeError(updateTask.error) : null}
            onSubmit={handleEditSubmit}
            onCancel={() => {
              setEditing(null);
              updateTask.reset();
            }}
          />
        ) : (
          <TaskForm
            submitting={createTask.isPending}
            error={createTask.isError ? describeError(createTask.error) : null}
            onSubmit={(input) => createTask.mutateAsync(input)}
          />
        )}

        <Filters
          search={filters.search}
          status={filters.status}
          priority={filters.priority}
          sort={filters.sort}
          stats={stats}
          onSearchChange={filters.setSearch}
          onStatusChange={filters.setStatus}
          onPriorityChange={filters.setPriority}
          onSortChange={filters.setSort}
        />

        {(deleteTask.isError || (updateTask.isError && !editing)) && (
          <p className="banner banner-error" role="alert">
            {describeError(deleteTask.error ?? updateTask.error)}
          </p>
        )}

        <TaskList
          query={tasksQuery}
          hasFilters={filters.hasFilters}
          onClearFilters={filters.clearFilters}
          onStatusChange={(id, next) => {
            deleteTask.reset();
            updateTask.mutate({ id, patch: { status: next } });
          }}
          onEdit={(task) => {
            setEditing(task);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          onDelete={setPendingDelete}
          onPageChange={filters.setPage}
        />
      </main>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this task?"
          message={`"${pendingDelete.title}" will be permanently removed. This can't be undone.`}
          confirmLabel="Delete task"
          danger
          onConfirm={confirmDelete}
          onCancel={() => {
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
