// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api/tasks';
import { deferred, makePage, makeStats, makeTask } from './test/factories';
import './test/setup';
import { TaskSort, TaskStatus, type Task, type TaskPage } from './types';
import { addDaysLocal } from './utils/date';

vi.mock('./api/tasks');

const fetchTasks = vi.mocked(api.fetchTasks);
const createTask = vi.mocked(api.createTask);
const updateTask = vi.mocked(api.updateTask);
const deleteTask = vi.mocked(api.deleteTask);
const fetchTaskStats = vi.mocked(api.fetchTaskStats);

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    ),
  };
}

const lastFilters = () => fetchTasks.mock.lastCall?.[0];
const statusSelect = (title: string) => screen.getByLabelText(`Status of ${title}`);
// Tabs carry a count ("Done 1"), so match on the start of the accessible name.
const statusTab = (name: string) =>
  within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', {
    name: new RegExp(`^${name}`),
  });

beforeEach(() => {
  vi.resetAllMocks();
  fetchTaskStats.mockResolvedValue(makeStats());
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});

describe('loading the list', () => {
  it('shows tasks and the total', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask({ title: 'Buy milk' }), makeTask()]));
    renderApp();

    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
  });

  it('shows the headline counts, and only mentions overdue when something is', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask()]));
    fetchTaskStats.mockResolvedValue(makeStats({ open: 3, overdue: 0 }));
    const { unmount } = renderApp();

    const summary = await screen.findByRole('list', { name: 'Summary' });
    expect(summary).toHaveTextContent('3 open');
    expect(summary).toHaveTextContent('1 done');
    expect(summary).not.toHaveTextContent('overdue');
    unmount();

    fetchTaskStats.mockResolvedValue(makeStats({ overdue: 2 }));
    renderApp();
    expect(await screen.findByText('2 overdue')).toBeInTheDocument();
  });

  it('shows a count on each status tab', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask()]));
    fetchTaskStats.mockResolvedValue(
      makeStats({ total: 9, byStatus: { todo: 5, in_progress: 3, done: 1 } }),
    );
    renderApp();

    await waitFor(() => {
      expect(statusTab('All')).toHaveTextContent('9');
    });
    expect(statusTab('To do')).toHaveTextContent('5');
    expect(statusTab('In progress')).toHaveTextContent('3');
    expect(statusTab('Done')).toHaveTextContent('1');
  });

  it('describes due dates in plain words', async () => {
    const at = (offset: number) => `${addDaysLocal(offset)}T00:00:00.000Z`;
    fetchTasks.mockResolvedValue(
      makePage([
        makeTask({ title: 'A', dueDate: at(-2) }),
        makeTask({ title: 'B', dueDate: at(0) }),
        makeTask({ title: 'C', dueDate: at(1) }),
        makeTask({ title: 'D', dueDate: at(-2), status: TaskStatus.Done }),
      ]),
    );
    renderApp();

    expect(await screen.findByText(/^Overdue · /)).toBeInTheDocument();
    expect(screen.getByText('Due today')).toBeInTheDocument();
    expect(screen.getByText('Due tomorrow')).toBeInTheDocument();
    // A finished task is never called overdue, even if its date has passed.
    expect(screen.getAllByText(/^Overdue/)).toHaveLength(1);
  });

  it('shows an empty state, and a different one when filters are active', async () => {
    fetchTasks.mockResolvedValue(makePage([]));
    const { user } = renderApp();
    expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument();

    await user.click(statusTab('Done'));
    expect(await screen.findByText('No tasks match your filters.')).toBeInTheDocument();
    expect(statusTab('Done')).toHaveAttribute('aria-pressed', 'true');

    // One click gets the user out of a dead end.
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText(/No tasks yet/)).toBeInTheDocument();
    expect(statusTab('All')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows an error with a working retry', async () => {
    fetchTasks.mockRejectedValueOnce(new Error('Cannot reach the server'));
    fetchTasks.mockResolvedValue(makePage([makeTask({ title: 'Recovered' })]));
    const { user } = renderApp();

    expect(await screen.findByText('Cannot reach the server')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Recovered')).toBeInTheDocument();
  });
});

describe('optimistic status change', () => {
  it('updates immediately, before the server answers, and keeps the result on success', async () => {
    const task = makeTask({ title: 'Ship it' });
    const request = deferred<Task>();
    fetchTasks.mockResolvedValueOnce(makePage([task]));
    fetchTasks.mockResolvedValue(makePage([{ ...task, status: TaskStatus.Done }]));
    updateTask.mockReturnValue(request.promise);
    const { user } = renderApp();

    await screen.findByText('Ship it');
    await user.selectOptions(statusSelect('Ship it'), TaskStatus.Done);

    // The request is still pending, yet the UI already shows the new status.
    expect(statusSelect('Ship it')).toHaveValue(TaskStatus.Done);
    expect(updateTask).toHaveBeenCalledWith(task.id, { status: TaskStatus.Done });

    request.resolve({ ...task, status: TaskStatus.Done });
    await waitFor(() => {
      expect(statusSelect('Ship it')).toHaveValue(TaskStatus.Done);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rolls back and explains when the request fails', async () => {
    const task = makeTask({ title: 'Ship it' });
    const request = deferred<Task>();
    const resync = deferred<TaskPage>();
    fetchTasks.mockResolvedValueOnce(makePage([task]));
    // Hold the post-failure re-sync back, so only the rollback can restore the old value.
    fetchTasks.mockReturnValue(resync.promise);
    updateTask.mockReturnValue(request.promise);
    const { user } = renderApp();

    await screen.findByText('Ship it');
    await user.selectOptions(statusSelect('Ship it'), TaskStatus.Done);
    expect(statusSelect('Ship it')).toHaveValue(TaskStatus.Done);

    request.reject(new Error('Server exploded'));

    // Rolled back from the snapshot while the server re-sync is still outstanding...
    await waitFor(() => {
      expect(statusSelect('Ship it')).toHaveValue(TaskStatus.Todo);
    });
    // ...and the user is told why once the mutation settles.
    resync.resolve(makePage([task]));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded');
    expect(statusSelect('Ship it')).toHaveValue(TaskStatus.Todo);
  });
});

describe('quick complete checkbox', () => {
  it('completes a task instantly and can reopen it', async () => {
    const task = makeTask({ title: 'Tick me' });
    const request = deferred<Task>();
    fetchTasks.mockResolvedValue(makePage([task]));
    updateTask.mockReturnValue(request.promise);
    const { user } = renderApp();

    const checkbox = await screen.findByRole('checkbox', { name: 'Mark Tick me as done' });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    expect(updateTask).toHaveBeenCalledWith(task.id, { status: TaskStatus.Done });
    expect(screen.getByRole('checkbox', { name: 'Mark Tick me as to do' })).toBeChecked();
    expect(statusSelect('Tick me')).toHaveValue(TaskStatus.Done);
  });
});

describe('deleting', () => {
  const openDeleteDialog = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    await user.click(await screen.findByRole('button', { name: `Delete ${title}` }));
    return screen.getByRole('dialog', { name: 'Delete this task?' });
  };

  it('asks in a modal first, naming the task, and focuses the safe choice', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask({ title: 'Doomed' })]));
    const { user } = renderApp();

    const dialog = await openDeleteDialog(user, 'Doomed');
    expect(dialog).toHaveTextContent('"Doomed" will be permanently removed');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('removes the task immediately on confirm, and restores it if the request fails', async () => {
    const task = makeTask({ title: 'Doomed' });
    const request = deferred<undefined>();
    const resync = deferred<TaskPage>();
    const page = makePage([task, makeTask({ title: 'Survivor' })]);
    fetchTasks.mockResolvedValueOnce(page);
    // Hold the post-failure re-sync back, so only the rollback can bring the task back.
    fetchTasks.mockReturnValue(resync.promise);
    deleteTask.mockReturnValue(request.promise);
    const { user } = renderApp();

    const dialog = await openDeleteDialog(user, 'Doomed');
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));

    expect(deleteTask).toHaveBeenCalledWith(task.id);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Doomed')).not.toBeInTheDocument();
    expect(screen.getByText('Survivor')).toBeInTheDocument();

    request.reject(new Error('Could not delete'));
    expect(await screen.findByText('Doomed')).toBeInTheDocument();

    resync.resolve(page);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete');
  });

  it('does nothing on Cancel', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask({ title: 'Keep me' })]));
    const { user } = renderApp();

    const dialog = await openDeleteDialog(user, 'Keep me');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();
    expect(screen.getByText('Keep me')).toBeInTheDocument();
  });

  it('closes on Escape and on a backdrop click without deleting', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask({ title: 'Keep me' })]));
    const { user } = renderApp();

    // Escape: the browser fires `cancel` on the dialog.
    let dialog = await openDeleteDialog(user, 'Keep me');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Backdrop: a click whose target is the <dialog> itself rather than its content.
    dialog = await openDeleteDialog(user, 'Keep me');
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(deleteTask).not.toHaveBeenCalled();
  });
});

describe('task form options', () => {
  beforeEach(() => {
    fetchTasks.mockResolvedValue(makePage([]));
  });

  const priorityGroup = () => screen.getByRole('group', { name: 'Priority' });
  const dueGroup = () => screen.getByRole('group', { name: 'Due' });

  it('shows priority and due-date shortcuts up front; only the description is behind a button', async () => {
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    expect(within(priorityGroup()).getByRole('radio', { name: 'Medium' })).toBeChecked();
    for (const name of ['Today', 'Tomorrow', 'Next week']) {
      expect(within(dueGroup()).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add description/ }));
    expect(screen.getByLabelText('Description')).toHaveFocus();
    expect(screen.queryByRole('button', { name: /Add description/ })).not.toBeInTheDocument();
  });

  it('sends the chosen priority and quick due date', async () => {
    createTask.mockResolvedValue(makeTask());
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    await user.type(screen.getByLabelText('Title'), 'Send invoice');
    await user.click(within(priorityGroup()).getByRole('radio', { name: 'High' }));
    await user.click(within(dueGroup()).getByRole('button', { name: 'Tomorrow' }));
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Send invoice',
          priority: 'high',
          dueDate: `${addDaysLocal(1)}T00:00:00.000Z`,
        }),
        expect.any(String),
      );
    });
  });

  it('toggles a quick date off when pressed again, and can clear any date', async () => {
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);
    const today = within(dueGroup()).getByRole('button', { name: 'Today' });

    await user.click(today);
    expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Due date')).toHaveValue(addDaysLocal(0));

    await user.click(today);
    expect(today).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Due date')).toHaveValue('');

    await user.click(within(dueGroup()).getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: 'Clear due date' }));
    expect(screen.getByLabelText('Due date')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear due date' })).not.toBeInTheDocument();
  });

  it('follows a natural keyboard order, ending on the Add task button', async () => {
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    await user.click(screen.getByLabelText('Title'));
    const order: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      await user.tab();
      const focused = document.activeElement as HTMLElement;
      order.push(
        focused instanceof HTMLInputElement && focused.type === 'radio'
          ? `radio:${focused.value}`
          : (focused.getAttribute('aria-label') ?? focused.textContent.trim()),
      );
    }

    // The checked radio is the group's single tab stop; then the date shortcuts and field, the
    // description disclosure, and finally submit. (Not jumping straight to "Add task".)
    expect(order).toEqual([
      'radio:medium',
      'Today',
      'Tomorrow',
      'Next week',
      'Due date',
      'Add description',
      'Add task',
    ]);
  });

  it('clears the form after a successful add and keeps focus on the title for the next one', async () => {
    createTask.mockResolvedValue(makeTask());
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    await user.type(screen.getByLabelText('Title'), 'Quick one');
    await user.click(screen.getByRole('button', { name: /Add description/ }));
    await user.type(screen.getByLabelText('Description'), 'with notes');
    await user.click(within(priorityGroup()).getByRole('radio', { name: 'Low' }));
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('');
    });
    expect(screen.getByLabelText('Title')).toHaveFocus();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument(); // folded away again
    expect(within(priorityGroup()).getByRole('radio', { name: 'Medium' })).toBeChecked();
  });

  it('refreshes the counts after a task is added', async () => {
    createTask.mockResolvedValue(makeTask());
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);
    const before = fetchTaskStats.mock.calls.length;

    await user.type(screen.getByLabelText('Title'), 'One more');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    await waitFor(() => {
      expect(fetchTaskStats.mock.calls.length).toBeGreaterThan(before);
    });
  });
});

describe('task form', () => {
  beforeEach(() => {
    fetchTasks.mockResolvedValue(makePage([]));
  });

  it('blocks a blank title without calling the API', async () => {
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    await user.type(screen.getByLabelText('Title'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    expect(screen.getByText('Please enter a title.')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('keeps what the user typed when saving fails, and clears it on success', async () => {
    createTask.mockRejectedValueOnce(new Error('title: Title is too long'));
    createTask.mockResolvedValueOnce(makeTask({ title: 'Write report' }));
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    await user.type(screen.getByLabelText('Title'), 'Write report');
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    expect(await screen.findByText('title: Title is too long')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Write report');

    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('');
    });
    expect(createTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Write report', dueDate: null }),
      expect.any(String),
    );
  });

  it('retries a failed create with the same idempotency key, and uses a new key for new data', async () => {
    createTask.mockRejectedValueOnce(new Error('Request timed out'));
    createTask.mockRejectedValueOnce(new Error('Request timed out'));
    createTask.mockResolvedValue(makeTask());
    const { user } = renderApp();
    await screen.findByText(/No tasks yet/);

    const title = screen.getByLabelText('Title');
    await user.type(title, 'Pay rent');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await screen.findByText('Request timed out');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledTimes(2);
    });

    // Same data → same key: the server can recognise the retry.
    const [first, second] = createTask.mock.calls;
    expect(first?.[1]).toBe(second?.[1]);

    // Edited data is a different action → different key (else the server would answer 422).
    await user.type(title, ' today');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledTimes(3);
    });
    expect(createTask.mock.calls[2]?.[1]).not.toBe(first?.[1]);
  });

  it('edits an existing task', async () => {
    const task = makeTask({ title: 'Old title' });
    fetchTasks.mockResolvedValue(makePage([task]));
    updateTask.mockResolvedValue({ ...task, title: 'New title' });
    const { user } = renderApp();

    await user.click(await screen.findByRole('button', { name: 'Edit Old title' }));
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('Old title');

    await user.clear(title);
    await user.type(title, 'New title');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith(
        task.id,
        expect.objectContaining({ title: 'New title' }),
      );
    });
    expect(await screen.findByRole('heading', { name: 'New task' })).toBeInTheDocument();
  });
});

describe('filters, sorting and pagination', () => {
  it('sends the chosen sort and goes back to page 1', async () => {
    fetchTasks.mockImplementation(({ page }) =>
      Promise.resolve(makePage([makeTask()], { page, totalPages: 3, total: 24 })),
    );
    const { user } = renderApp();

    await screen.findByText('Page 1 of 3');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 3');

    await user.selectOptions(screen.getByLabelText('Sort tasks'), TaskSort.DueDateDesc);

    await waitFor(() => {
      expect(lastFilters()).toMatchObject({ sort: TaskSort.DueDateDesc, page: 1 });
    });
  });

  it('can sort by priority, high first', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask()]));
    const { user } = renderApp();
    await screen.findByRole('heading', { level: 3 });

    await user.selectOptions(screen.getByLabelText('Sort tasks'), TaskSort.PriorityDesc);

    await waitFor(() => {
      expect(lastFilters()).toMatchObject({ sort: '-priority', page: 1 });
    });
    expect(screen.getByRole('option', { name: 'Priority (high first)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Priority (low first)' })).toBeInTheDocument();
  });

  it('debounces the search box and searches from page 1', async () => {
    fetchTasks.mockResolvedValue(makePage([makeTask()]));
    const { user } = renderApp();
    await screen.findByRole('heading', { level: 3 });
    const callsBefore = fetchTasks.mock.calls.length;

    await user.type(screen.getByLabelText('Search tasks'), 'milk');

    // Typing four characters must not fire four requests.
    expect(fetchTasks.mock.calls.length).toBe(callsBefore);
    await waitFor(() => {
      expect(lastFilters()).toMatchObject({ q: 'milk', page: 1 });
    });
    expect(fetchTasks.mock.calls.length).toBe(callsBefore + 1);
  });

  it('steps back to the last real page when the current one no longer exists', async () => {
    fetchTasks.mockImplementation(({ page }) =>
      Promise.resolve(
        page === 1
          ? makePage([makeTask({ title: 'Only one left' })], { total: 1, totalPages: 1 })
          : makePage([], { page, total: 1, totalPages: 1 }),
      ),
    );
    // Pretend the user was on page 2 of 2 and another tab deleted the second page's tasks.
    fetchTasks.mockResolvedValueOnce(makePage([makeTask()], { total: 9, totalPages: 2 }));
    const { user } = renderApp();
    await screen.findByText('Page 1 of 2');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const list = await screen.findByText('Only one left');
    expect(within(list.closest('ul') as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
    await waitFor(() => {
      expect(lastFilters()).toMatchObject({ page: 1 });
    });
  });
});
