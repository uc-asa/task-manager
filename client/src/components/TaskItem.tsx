import { PRIORITY_LABELS, STATUS_LABELS, TASK_STATUSES, TaskStatus, type Task } from '../types';
import { describeDue } from '../utils/date';
import { CalendarIcon } from './icons';

interface TaskItemProps {
  task: Task;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskItem({ task, onStatusChange, onEdit, onDelete }: TaskItemProps) {
  const done = task.status === TaskStatus.Done;
  const due = task.dueDate ? describeDue(task.dueDate, task.status) : null;

  return (
    <li className={`card task priority-${task.priority} ${done ? 'task-done' : ''}`}>
      {/* The label is a larger click/tap target around the small visible circle. */}
      <label className="check-hit">
        <input
          type="checkbox"
          className="check"
          checked={done}
          aria-label={done ? `Mark ${task.title} as to do` : `Mark ${task.title} as done`}
          onChange={() => {
            onStatusChange(task.id, done ? TaskStatus.Todo : TaskStatus.Done);
          }}
        />
      </label>

      <div className="task-main">
        <h3 className="task-title">{task.title}</h3>
        {task.description && <p className="task-desc">{task.description}</p>}
        <div className="task-meta">
          <span className={`badge badge-${task.priority}`}>
            <span className="dot" aria-hidden="true" />
            {PRIORITY_LABELS[task.priority]}
          </span>
          {due && (
            <span className={`due due-${due.tone}`}>
              <CalendarIcon />
              {due.text}
            </span>
          )}
        </div>
      </div>

      <div className="task-controls">
        {/* A native <select> styled as a pill: keyboard, touch and screen readers all just work. */}
        <select
          className={`status-select status-${task.status}`}
          aria-label={`Status of ${task.title}`}
          value={task.status}
          onChange={(e) => {
            onStatusChange(task.id, e.target.value as TaskStatus);
          }}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            onEdit(task);
          }}
          aria-label={`Edit ${task.title}`}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-danger"
          onClick={() => {
            onDelete(task);
          }}
          aria-label={`Delete ${task.title}`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
