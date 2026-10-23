import { useId } from 'react';
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from '../types';

interface PriorityPickerProps {
  value: TaskPriority;
  onChange: (value: TaskPriority) => void;
}

/** Native radio buttons styled as a segmented control: arrow keys, labels and groups for free. */
export function PriorityPicker({ value, onChange }: PriorityPickerProps) {
  const name = useId();
  const labelId = useId();

  return (
    <div className="picker" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="picker-label">
        Priority
      </span>
      <div className="segmented">
        {TASK_PRIORITIES.map((priority) => (
          <label key={priority} className={`segment segment-${priority}`}>
            <input
              type="radio"
              name={name}
              value={priority}
              checked={value === priority}
              onChange={() => {
                onChange(priority);
              }}
            />
            <span>{PRIORITY_LABELS[priority]}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
