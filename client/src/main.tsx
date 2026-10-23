import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { config } from './config/env';
import { errorReporter, installGlobalErrorHandlers } from './observability';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: config.query.staleTimeMs,
      retry: config.query.retries,
      refetchOnWindowFocus: false,
    },
  },
});

installGlobalErrorHandlers(errorReporter);

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary reporter={errorReporter}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
