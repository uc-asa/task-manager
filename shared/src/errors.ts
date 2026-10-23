/** Machine-readable error codes returned in `{ error: { code } }`. Clients may switch on these. */
export const ErrorCode = {
  ValidationError: 'VALIDATION_ERROR',
  InvalidJson: 'INVALID_JSON',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  UnsupportedCharset: 'UNSUPPORTED_CHARSET',
  UnsupportedEncoding: 'UNSUPPORTED_ENCODING',
  BadRequest: 'BAD_REQUEST',
  NotFound: 'NOT_FOUND',
  TaskNotFound: 'TASK_NOT_FOUND',
  RateLimited: 'RATE_LIMITED',
  IdempotencyKeyInvalid: 'IDEMPOTENCY_KEY_INVALID',
  IdempotencyKeyReused: 'IDEMPOTENCY_KEY_REUSED',
  IdempotencyRequestInProgress: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  InternalError: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: { path: string; message: string }[];
  };
}
