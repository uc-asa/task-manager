/**
 * The error-reporting contract the app depends on. Nothing else imports a vendor SDK: to send
 * errors to Sentry, Datadog, Last9 or Crashlytics-for-web, implement `ErrorReporter` once and
 * change one line in `observability/index.ts`.
 */
export interface ErrorReporter {
  report(error: unknown, context?: Record<string, unknown>): void;
}

/** Default: write to the browser console. Good enough for development. */
export const consoleErrorReporter: ErrorReporter = {
  report(error, context) {
    console.error('[app error]', error, context ?? {});
  },
};

type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/**
 * Reports everything that escapes React and the HTTP client: uncaught exceptions and promise
 * rejections nobody handled. Returns a function that removes the listeners again.
 */
export function installGlobalErrorHandlers(
  reporter: ErrorReporter,
  target: ListenerTarget = window,
): () => void {
  const onError = (event: Event) => {
    const { error, message } = event as { error?: unknown; message?: string };
    reporter.report(error ?? new Error(message), { source: 'window.onerror' });
  };
  const onRejection = (event: Event) => {
    reporter.report((event as PromiseRejectionEvent).reason, { source: 'unhandledrejection' });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
