import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  STATUS_LABELS,
  TASK_STATUSES,
  TaskLimits,
  TaskPriority,
  TaskStatus,
  type Task,
  type TaskInput,
} from '../types';
import { dateInputToIso, isoToDateInput } from '../utils/date';
import { DueDatePicker } from './DueDatePicker';
import { ChevronIcon, PlusIcon } from './icons';
import { PriorityPicker } from './PriorityPicker';

interface TaskFormProps {
  /** When provided the form edits this task; otherwise it creates a new one. */
  task?: Task;
  submitting: boolean;
  error: string | null;
  /** May return a promise; the form resets only if it resolves. */
  onSubmit: (input: TaskInput) => Promise<unknown> | void;
  onCancel?: () => void;
}

export function TaskForm({ task, submitting, error, onSubmit, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? TaskStatus.Todo);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? TaskPriority.Medium);
  const [dueDate, setDueDate] = useState(isoToDateInput(task?.dueDate ?? null));
  const [titleError, setTitleError] = useState<string | null>(null);

  const isEditing = task !== undefined;
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const descriptionId = useId();

  // Priority and due date are always one click away. Only the description (the field people
  // use least) sits behind a disclosure, and it stays open once it has content.
  const [descriptionRequested, setDescriptionRequested] = useState(false);
  const descriptionOpen = isEditing || descriptionRequested || description !== '';

  useEffect(() => {
    if (descriptionRequested) descriptionRef.current?.focus();
  }, [descriptionRequested]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setTitleError('Please enter a title.');
      return;
    }
    setTitleError(null);
    // Only clear the form once the save succeeded, so a failed request never loses the input.
    void Promise.resolve(
      onSubmit({
        title: title.trim(),
        description: description.trim(),
        status,
        priority,
        dueDate: dateInputToIso(dueDate),
      }),
    ).then(
      () => {
        if (!isEditing) {
          setTitle('');
          setDescription('');
          setStatus(TaskStatus.Todo);
          setPriority(TaskPriority.Medium);
          setDueDate('');
          setDescriptionRequested(false);
          titleRef.current?.focus(); // ready for the next task
        }
      },
      () => undefined, // the error is surfaced through the `error` prop
    );
  };

  return (
    <form
      className={`card form ${isEditing ? 'form-editing' : ''}`}
      onSubmit={handleSubmit}
      noValidate
    >
      <h2 className={isEditing ? undefined : 'sr-only'}>{isEditing ? 'Edit task' : 'New task'}</h2>

      {/* DOM order is the natural keyboard order; the grid places "Add task" beside the title. */}
      <div className="composer">
        <div className="composer-title">
          <label className="field">
            <span className={isEditing ? undefined : 'sr-only'}>Title</span>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              maxLength={TaskLimits.TitleMax}
              placeholder={isEditing ? undefined : 'What needs doing?'}
              aria-invalid={titleError !== null}
              aria-describedby={titleError ? 'title-error' : undefined}
              autoFocus={isEditing}
            />
          </label>
          {titleError && (
            <span id="title-error" className="field-error" role="alert">
              {titleError}
            </span>
          )}
          {title.length >= TaskLimits.TitleMax - 20 && (
            <span className="counter" aria-live="polite">
              {title.length}/{TaskLimits.TitleMax}
            </span>
          )}
        </div>

        <div className="composer-options">
          <PriorityPicker value={priority} onChange={setPriority} />
          <DueDatePicker value={dueDate} onChange={setDueDate} />

          {isEditing && (
            <label className="picker">
              <span className="picker-label">Status</span>
              <select
                className="picker-select"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as TaskStatus);
                }}
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!descriptionOpen && (
            <button
              type="button"
              className="link-btn"
              aria-expanded={false}
              aria-controls={descriptionId}
              onClick={() => {
                setDescriptionRequested(true);
              }}
            >
              Add description <ChevronIcon open={false} />
            </button>
          )}
        </div>

        {descriptionOpen && (
          <label className="field composer-description">
            <span>Description</span>
            <textarea
              id={descriptionId}
              ref={descriptionRef}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              maxLength={TaskLimits.DescriptionMax}
              rows={3}
              placeholder="Optional details"
            />
          </label>
        )}

        {!isEditing && (
          <button type="submit" className="btn btn-primary composer-submit" disabled={submitting}>
            <PlusIcon />
            {submitting ? 'Saving…' : 'Add task'}
          </button>
        )}
      </div>

      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}

      {isEditing && (
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      )}
    </form>
  );
}
