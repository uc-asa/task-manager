import { describe, expect, it } from 'vitest';
import { TaskStatus } from '../types';
import {
  addDaysLocal,
  dateInputToIso,
  describeDue,
  DueTone,
  formatDueDate,
  isOverdue,
  isoToDateInput,
  todayLocal,
} from './date';

describe('date input conversion', () => {
  it('round-trips a calendar day without shifting it', () => {
    const iso = dateInputToIso('2026-03-07');
    expect(iso).toBe('2026-03-07T00:00:00.000Z');
    expect(isoToDateInput(iso)).toBe('2026-03-07');
  });

  it('treats an empty input as "no due date"', () => {
    expect(dateInputToIso('')).toBeNull();
    expect(isoToDateInput(null)).toBe('');
  });
});

describe('formatDueDate', () => {
  it('formats in UTC so the day is the same in every timezone', () => {
    expect(formatDueDate('2026-03-07T00:00:00.000Z')).toContain('7');
    expect(formatDueDate('2026-12-31T00:00:00.000Z')).toContain('31');
  });
});

describe('todayLocal', () => {
  it('zero-pads month and day', () => {
    expect(todayLocal(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('uses the local calendar day, including just before midnight', () => {
    expect(todayLocal(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('isOverdue', () => {
  const now = new Date(2026, 5, 15, 10, 0); // 15 June 2026, local time

  it('is overdue only when the due day is strictly before today', () => {
    expect(isOverdue('2026-06-14T00:00:00.000Z', TaskStatus.Todo, now)).toBe(true);
    expect(isOverdue('2026-06-15T00:00:00.000Z', TaskStatus.Todo, now)).toBe(false);
    expect(isOverdue('2026-06-16T00:00:00.000Z', TaskStatus.Todo, now)).toBe(false);
  });

  it('never marks completed tasks or tasks without a due date as overdue', () => {
    expect(isOverdue('2020-01-01T00:00:00.000Z', TaskStatus.Done, now)).toBe(false);
    expect(isOverdue(null, TaskStatus.Todo, now)).toBe(false);
  });
});

describe('addDaysLocal', () => {
  const now = new Date(2026, 11, 30, 23, 30); // 30 Dec 2026, late evening

  it('moves by calendar days, across month and year boundaries', () => {
    expect(addDaysLocal(0, now)).toBe('2026-12-30');
    expect(addDaysLocal(1, now)).toBe('2026-12-31');
    expect(addDaysLocal(2, now)).toBe('2027-01-01');
    expect(addDaysLocal(7, now)).toBe('2027-01-06');
  });

  it('is not thrown off by a daylight-saving change', () => {
    // Europe/US clocks change in March and November; calendar arithmetic must still add whole days.
    expect(addDaysLocal(1, new Date(2026, 2, 7, 12))).toBe('2026-03-08');
    expect(addDaysLocal(1, new Date(2026, 10, 1, 12))).toBe('2026-11-02');
  });
});

describe('describeDue', () => {
  const now = new Date(2026, 5, 15, 10, 0); // 15 June 2026
  const due = (day: string, status: TaskStatus = TaskStatus.Todo) =>
    describeDue(`${day}T00:00:00.000Z`, status, now);

  it('uses relative wording for today and tomorrow', () => {
    expect(due('2026-06-15')).toEqual({ text: 'Due today', tone: DueTone.Today });
    expect(due('2026-06-16')).toEqual({ text: 'Due tomorrow', tone: DueTone.Normal });
  });

  it('flags only open, past tasks as overdue, and says so in words', () => {
    expect(due('2026-06-14').tone).toBe(DueTone.Overdue);
    expect(due('2026-06-14').text).toMatch(/^Overdue · /);
    expect(due('2026-06-14', TaskStatus.InProgress).tone).toBe(DueTone.Overdue);
    expect(due('2020-01-01', TaskStatus.Done).tone).toBe(DueTone.Normal);
    expect(due('2020-01-01', TaskStatus.Done).text).toMatch(/^Due /);
  });

  it('adds the year only when it is not the current one', () => {
    expect(due('2026-10-28').text).not.toContain('2026');
    expect(due('2027-01-05').text).toContain('2027');
  });
});
