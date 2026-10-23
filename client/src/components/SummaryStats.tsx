import type { TaskStats } from '../types';

/** The "10 open · 2 overdue · 2 done" chips in the header. */
export function SummaryStats({ stats }: { stats: TaskStats }) {
  return (
    <ul className="stats" aria-label="Summary">
      <li className="stat">{stats.open} open</li>
      {stats.overdue > 0 && <li className="stat stat-danger">{stats.overdue} overdue</li>}
      <li className="stat stat-success">{stats.byStatus.done} done</li>
    </ul>
  );
}
