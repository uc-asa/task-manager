import { TaskStatus } from '../types';

/**
 * Due dates are calendar days, not moments in time. The API stores them as midnight UTC
 * and the UI always reads/writes them as UTC so the displayed day never shifts with the
 * viewer's timezone.
 */

export const dateInputToIso = (value: string): string | null =>
  value ? `${value}T00:00:00.000Z` : null;

export const isoToDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

export const formatDueDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Today's calendar day in the viewer's local timezone, as YYYY-MM-DD. */
export function todayLocal(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${String(now.getFullYear())}-${month}-${day}`;
}

export const isOverdue = (iso: string | null, status: TaskStatus, now = new Date()): boolean =>
  iso !== null && status !== TaskStatus.Done && isoToDateInput(iso) < todayLocal(now);

const MS_PER_DAY = 86_400_000;

/** The viewer's calendar day `offset` days from `now`, as YYYY-MM-DD (for the quick due-date chips). */
export function addDaysLocal(offset: number, now = new Date()): string {
  return todayLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

export const DueTone = {
  Overdue: 'overdue',
  Today: 'today',
  Normal: 'normal',
} as const;
export type DueTone = (typeof DueTone)[keyof typeof DueTone];

/** "20 Oct", or "20 Oct 2027" when it is not in the current year. */
function shortDate(iso: string, now: Date): string {
  const sameYear = new Date(iso).getUTCFullYear() === now.getFullYear();
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A friendly, relative description of a due date: "Overdue · 20 Oct", "Due today",
 * "Due tomorrow", "Due 28 Oct". Finished tasks are never flagged. The wording always carries the
 * meaning, so colour is only a reinforcement.
 */
export function describeDue(
  iso: string,
  status: TaskStatus,
  now = new Date(),
): { text: string; tone: DueTone } {
  const days = daysBetween(todayLocal(now), isoToDateInput(iso));
  if (status === TaskStatus.Done)
    return { text: `Due ${shortDate(iso, now)}`, tone: DueTone.Normal };
  if (days < 0) return { text: `Overdue · ${shortDate(iso, now)}`, tone: DueTone.Overdue };
  if (days === 0) return { text: 'Due today', tone: DueTone.Today };
  if (days === 1) return { text: 'Due tomorrow', tone: DueTone.Normal };
  return { text: `Due ${shortDate(iso, now)}`, tone: DueTone.Normal };
}
