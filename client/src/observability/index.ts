import { consoleErrorReporter } from './errorReporter';

export type { ErrorReporter } from './errorReporter';
export { installGlobalErrorHandlers } from './errorReporter';

/** The app-wide reporter. The one place that chooses where errors are sent. */
export const errorReporter = consoleErrorReporter;
