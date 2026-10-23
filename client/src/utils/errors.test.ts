import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/http';
import { describeError } from './errors';

describe('describeError', () => {
  it('shows the message as-is for ordinary errors', () => {
    expect(describeError(new Error('Nope'))).toBe('Nope');
    expect(describeError('weird')).toBe('Something went wrong');
  });

  it('keeps client errors clean: validation messages need no reference', () => {
    const error = new ApiError(
      'title: Title is required',
      400,
      'VALIDATION_ERROR',
      undefined,
      'abcdef12-0000',
    );
    expect(describeError(error)).toBe('title: Title is required');
  });

  it('adds a short reference to server errors, matching the server log request id', () => {
    const error = new ApiError(
      'The server had a problem.',
      502,
      undefined,
      undefined,
      '3f2a9c1e-7b4d-4e0a',
    );
    expect(describeError(error)).toBe('The server had a problem. (ref 3f2a9c1e)');
  });

  it('omits the reference when there is no request id', () => {
    expect(describeError(new ApiError('The server had a problem.', 500))).toBe(
      'The server had a problem.',
    );
  });
});
