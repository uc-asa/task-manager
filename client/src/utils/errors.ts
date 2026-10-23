import { ApiError } from '../api/http';

const REFERENCE_LENGTH = 8;

/**
 * A message fit for the screen. For server-side failures it adds a short reference (the request
 * id), which the user can quote to support and which matches the id in the server logs.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Something went wrong';
  if (error instanceof ApiError && error.status >= 500 && error.requestId) {
    return `${error.message} (ref ${error.requestId.slice(0, REFERENCE_LENGTH)})`;
  }
  return error.message;
}
