import { describe, expect, it, vi } from 'vitest';
import { installGlobalErrorHandlers } from './errorReporter';

describe('installGlobalErrorHandlers', () => {
  const setup = () => {
    const target = new EventTarget();
    const reporter = { report: vi.fn() };
    const uninstall = installGlobalErrorHandlers(reporter, target);
    return { target, reporter, uninstall };
  };

  it('reports uncaught exceptions', () => {
    const { target, reporter } = setup();
    const error = new Error('uncaught');

    target.dispatchEvent(Object.assign(new Event('error'), { error, message: 'uncaught' }));

    expect(reporter.report).toHaveBeenCalledWith(error, { source: 'window.onerror' });
  });

  it('falls back to the message when the event has no error object (cross-origin scripts)', () => {
    const { target, reporter } = setup();

    target.dispatchEvent(Object.assign(new Event('error'), { message: 'Script error.' }));

    expect(reporter.report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Script error.' }),
      { source: 'window.onerror' },
    );
  });

  it('reports unhandled promise rejections', () => {
    const { target, reporter } = setup();
    const reason = new Error('nobody caught me');

    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));

    expect(reporter.report).toHaveBeenCalledWith(reason, { source: 'unhandledrejection' });
  });

  it('stops reporting once uninstalled', () => {
    const { target, reporter, uninstall } = setup();
    uninstall();

    target.dispatchEvent(Object.assign(new Event('error'), { message: 'late' }));
    expect(reporter.report).not.toHaveBeenCalled();
  });
});
