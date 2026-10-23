/** Custom HTTP headers used by the API and its clients. */
export const HttpHeader = {
  /** Correlates one request across client, server logs and error reports. Optional, echoed back. */
  RequestId: 'X-Request-Id',
  /**
   * Makes a non-idempotent request (POST) safe to retry: the same key + same body returns the
   * original response instead of repeating the work. Optional on the server.
   */
  IdempotencyKey: 'Idempotency-Key',
  /** Set to `true` on a response that was replayed from a previous request with the same key. */
  IdempotentReplayed: 'Idempotent-Replayed',
} as const;
export type HttpHeader = (typeof HttpHeader)[keyof typeof HttpHeader];
