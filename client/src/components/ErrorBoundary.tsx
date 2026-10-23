import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { ErrorReporter } from '../observability';

interface ErrorBoundaryProps {
  reporter: ErrorReporter;
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Last line of defence: without it, an error thrown while rendering unmounts the whole app and
 * leaves a blank page. This reports the error and offers a way forward instead.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.reporter.report(error, {
      source: 'react-error-boundary',
      componentStack: info.componentStack,
    });
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="container">
        <div className="card fatal" role="alert">
          <h1>Something went wrong</h1>
          <p>The page hit an unexpected error. Your tasks are safe; nothing was lost.</p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                this.setState({ failed: false });
              }}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
