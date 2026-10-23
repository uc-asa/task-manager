import { useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTask, deleteTask, fetchTaskStats, fetchTasks, updateTask } from '../api/tasks';
import { todayLocal } from '../utils/date';
import type { Task, TaskFilters, TaskInput, TaskPage, TaskPatch } from '../types';

const TASKS_KEY = ['tasks'] as const;
// A separate root, so the optimistic list updates below never touch the stats cache.
const STATS_KEY = ['task-stats'] as const;

export function useTasksQuery(filters: TaskFilters) {
  return useQuery({
    queryKey: [...TASKS_KEY, filters],
    // TanStack aborts the request when the query becomes stale, e.g. while typing in search.
    queryFn: ({ signal }) => fetchTasks(filters, signal),
    // Keep showing the previous page while the next one loads (no flicker when filtering).
    placeholderData: keepPreviousData,
  });
}

/**
 * One idempotency key per logical create. A retry of the *same* data (e.g. after a timeout whose
 * request actually reached the server) reuses the key, so the server returns the original task
 * instead of creating a duplicate. If the user edits the data first, it is a new action and gets
 * a new key. The key is dropped once the create succeeds.
 */
export function useTaskStatsQuery() {
  const today = todayLocal();
  return useQuery({
    queryKey: [...STATS_KEY, today],
    queryFn: ({ signal }) => fetchTaskStats(today, signal),
    placeholderData: keepPreviousData,
  });
}

/** Lists and the headline counts both change whenever a task does. */
const refreshAll = (queryClient: ReturnType<typeof useQueryClient>) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
    queryClient.invalidateQueries({ queryKey: STATS_KEY }),
  ]);

export function useCreateTask() {
  const queryClient = useQueryClient();
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  return useMutation({
    mutationFn: (input: TaskInput) => {
      const fingerprint = JSON.stringify(input);
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = { fingerprint, key: crypto.randomUUID() };
      }
      return createTask(input, attempt.current.key);
    },
    onSuccess: () => {
      attempt.current = null;
      return refreshAll(queryClient);
    },
  });
}

type Snapshot = [readonly unknown[], TaskPage | undefined][];

/**
 * Optimistic update: the UI changes instantly, and is rolled back from a snapshot if the
 * request fails. The server response is always the final source of truth (invalidate).
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const snapshot: Snapshot = queryClient.getQueriesData<TaskPage>({ queryKey: TASKS_KEY });
      queryClient.setQueriesData<TaskPage>({ queryKey: TASKS_KEY }, (page) =>
        page
          ? { ...page, data: page.data.map((t): Task => (t.id === id ? { ...t, ...patch } : t)) }
          : page,
      );
      return { snapshot };
    },
    onError: (_error, _vars, context) => {
      context?.snapshot.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => refreshAll(queryClient),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const snapshot: Snapshot = queryClient.getQueriesData<TaskPage>({ queryKey: TASKS_KEY });
      queryClient.setQueriesData<TaskPage>({ queryKey: TASKS_KEY }, (page) =>
        page ? { ...page, data: page.data.filter((t) => t.id !== id) } : page,
      );
      return { snapshot };
    },
    onError: (_error, _id, context) => {
      context?.snapshot.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSettled: () => refreshAll(queryClient),
  });
}
