import type { Task, TaskFilters, TaskInput, TaskPage, TaskPatch, TaskStats } from '../types';
import { config } from '../config/env';
import { HttpHeader } from 'shared';
import { http } from './client';

export function fetchTasks(filters: TaskFilters, signal?: AbortSignal): Promise<TaskPage> {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: String(config.ui.pageSize),
    sort: filters.sort,
  });
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  return http.get<TaskPage>(`/tasks?${params.toString()}`, signal);
}

/**
 * `idempotencyKey` identifies one logical "create" action. Retrying with the same key (after a
 * timeout, a dropped connection or a double click) can never create a second task.
 */
export async function createTask(input: TaskInput, idempotencyKey: string): Promise<Task> {
  const { data } = await http.post<{ data: Task }>('/tasks', input, {
    [HttpHeader.IdempotencyKey]: idempotencyKey,
  });
  return data;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  const { data } = await http.patch<{ data: Task }>(`/tasks/${id}`, patch);
  return data;
}

export function deleteTask(id: string): Promise<void> {
  return http.delete(`/tasks/${id}`);
}

/** `today` is the viewer's calendar day, so "overdue" matches what they see on screen. */
export async function fetchTaskStats(today: string, signal?: AbortSignal): Promise<TaskStats> {
  const { data } = await http.get<{ data: TaskStats }>(`/tasks/stats?today=${today}`, signal);
  return data;
}
