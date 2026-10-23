import {
  PRIORITY_LABELS,
  SORT_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_SORTS,
  TASK_STATUSES,
  type TaskPriority,
  type TaskSort,
  type TaskStats,
  type TaskStatus,
} from '../types';
import { SearchIcon } from './icons';

interface FiltersProps {
  search: string;
  status: TaskStatus | '';
  priority: TaskPriority | '';
  sort: TaskSort;
  /** Counts shown on the status tabs. Omitted while loading. */
  stats?: TaskStats;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: TaskStatus | '') => void;
  onPriorityChange: (value: TaskPriority | '') => void;
  onSortChange: (value: TaskSort) => void;
}

const STATUS_TABS: { value: TaskStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  ...TASK_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
];

export function Filters({
  search,
  status,
  priority,
  sort,
  stats,
  onSearchChange,
  onStatusChange,
  onPriorityChange,
  onSortChange,
}: FiltersProps) {
  return (
    <div className="filters" role="search">
      <div className="search-box">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value);
          }}
        />
      </div>

      <div className="filters-row">
        <div className="segmented" role="group" aria-label="Filter by status">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value || 'all'}
              type="button"
              className="segment"
              aria-pressed={status === tab.value}
              onClick={() => {
                onStatusChange(tab.value);
              }}
            >
              {tab.label}
              {stats && (
                <span className="segment-count">
                  {tab.value ? stats.byStatus[tab.value] : stats.total}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="filters-selects">
          <select
            aria-label="Filter by priority"
            value={priority}
            onChange={(e) => {
              onPriorityChange(e.target.value as TaskPriority | '');
            }}
          >
            <option value="">All priorities</option>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]} priority
              </option>
            ))}
          </select>
          <select
            aria-label="Sort tasks"
            value={sort}
            onChange={(e) => {
              onSortChange(e.target.value as TaskSort);
            }}
          >
            {TASK_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
