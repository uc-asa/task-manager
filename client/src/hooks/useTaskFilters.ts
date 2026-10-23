import { useState } from 'react';
import { config } from '../config/env';
import { TaskSort, type TaskFilters, type TaskPriority, type TaskStatus } from '../types';
import { useDebouncedValue } from './useDebouncedValue';

/**
 * Everything the user can change about the list: search, status, priority, sort and page.
 * Any filter change goes back to page 1, so that rule lives here, once.
 */
export function useTaskFilters() {
  const [search, setSearchText] = useState('');
  const [status, setStatusFilter] = useState<TaskStatus | ''>('');
  const [priority, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [sort, setSortOrder] = useState<TaskSort>(TaskSort.CreatedDesc);
  const [page, setPage] = useState(1);

  // The search box updates instantly; the request waits until typing pauses.
  const debouncedSearch = useDebouncedValue(search, config.ui.searchDebounceMs);

  /** What the server is asked for. */
  const filters: TaskFilters = { status, priority, q: debouncedSearch, sort, page };

  const resetPageAnd =
    <T>(update: (value: T) => void) =>
    (value: T) => {
      update(value);
      setPage(1);
    };

  return {
    // what the controls show
    search,
    status,
    priority,
    sort,
    // what the request uses
    filters,
    page,
    hasFilters: Boolean(status || priority || debouncedSearch),
    // changes
    setSearch: resetPageAnd(setSearchText),
    setStatus: resetPageAnd(setStatusFilter),
    setPriority: resetPageAnd(setPriorityFilter),
    setSort: resetPageAnd(setSortOrder),
    setPage,
    clearFilters: () => {
      setSearchText('');
      setStatusFilter('');
      setPriorityFilter('');
      setPage(1);
    },
  };
}
