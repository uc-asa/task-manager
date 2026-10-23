import { config } from '../config/env';
import { createHttpClient } from './http';
import { errorReporter } from '../observability';
import { errorReportingInterceptor, requestIdInterceptor, timingInterceptor } from './interceptors';

/**
 * The one HTTP client the app uses. Add cross-cutting behaviour here, not in feature modules:
 *
 *   http.interceptors.request.use(authInterceptor(() => session.token));
 *   http.interceptors.error.use(unauthorizedInterceptor(() => redirectToLogin()));
 */
export const http = createHttpClient({
  baseUrl: config.api.baseUrl,
  timeoutMs: config.api.timeoutMs,
});

http.interceptors.request.use(requestIdInterceptor);
http.interceptors.error.use(errorReportingInterceptor(errorReporter));
if (config.api.logRequests) http.interceptors.response.use(timingInterceptor);
