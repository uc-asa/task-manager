import { useId } from 'react';
import { addDaysLocal } from '../utils/date';
import { CloseIcon } from './icons';

interface DueDatePickerProps {
  /** YYYY-MM-DD, or '' for no due date. */
  value: string;
  onChange: (value: string) => void;
}

const QUICK_PICKS = [
  { label: 'Today', daysAhead: 0 },
  { label: 'Tomorrow', daysAhead: 1 },
  { label: 'Next week', daysAhead: 7 },
] as const;

/** One-click common dates, plus the full date input for anything else. */
export function DueDatePicker({ value, onChange }: DueDatePickerProps) {
  const labelId = useId();
  return (
    <div className="picker" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="picker-label">
        Due
      </span>
      <div className="chips">
        {QUICK_PICKS.map(({ label, daysAhead }) => {
          const date = addDaysLocal(daysAhead);
          const selected = value === date;
          return (
            <button
              key={label}
              type="button"
              className="chip"
              aria-pressed={selected}
              onClick={() => {
                // Pressing the selected chip again clears it.
                onChange(selected ? '' : date);
              }}
            >
              {label}
            </button>
          );
        })}
        <input
          type="date"
          className="date-input"
          aria-label="Due date"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
        {value && (
          <button
            type="button"
            className="chip chip-clear"
            aria-label="Clear due date"
            onClick={() => {
              onChange('');
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}
