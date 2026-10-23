// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ErrorReporter } from '../observability';
import '../test/setup';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('render exploded');
  return <p>All good</p>;
}

describe('ErrorBoundary', () => {
  const report = vi.fn();
  const reporter: ErrorReporter = { report };

  beforeEach(() => {
    shouldThrow = true;
    report.mockClear();
    // React logs caught render errors to the console; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing is wrong', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary reporter={reporter}>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(report).not.toHaveBeenCalled();
  });

  it('shows a recoverable message instead of a blank page, and reports the error', () => {
    render(
      <ErrorBoundary reporter={reporter}>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render exploded' }),
      expect.objectContaining({
        source: 'react-error-boundary',
        componentStack: expect.stringContaining('Bomb') as string,
      }),
    );
  });

  it('recovers when the user chooses "Try again" and the problem is gone', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary reporter={reporter}>
        <Bomb />
      </ErrorBoundary>,
    );

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('All good')).toBeInTheDocument();
  });
});
