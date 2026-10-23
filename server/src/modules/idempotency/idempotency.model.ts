import { Schema, model } from 'mongoose';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long a request may stay "in progress" before it is presumed dead (the process crashed or was
 * killed before answering). A retry after this takes the key over; before it, the retry gets 409.
 * Must be comfortably longer than the slowest legitimate request.
 */
export const IDEMPOTENCY_LEASE_MS = 60_000;

export interface IIdempotencyRecord {
  key: string;
  requestHash: string;
  /** When the request that owns this key started (or was last taken over). */
  lockedAt: Date;
  /** Unset while the original request is still being processed. */
  statusCode?: number;
  responseBody?: unknown;
  createdAt: Date;
}

const idempotencySchema = new Schema<IIdempotencyRecord>({
  // The unique index is what makes "first request wins" atomic across concurrent requests.
  // With authentication, scope this by user: the key must be unique per (userId, key).
  key: { type: String, required: true, unique: true },
  requestHash: { type: String, required: true },
  lockedAt: { type: Date, default: Date.now },
  statusCode: { type: Number },
  responseBody: { type: Schema.Types.Mixed },
  // MongoDB deletes the record itself after the TTL, so no cleanup job is needed.
  createdAt: { type: Date, default: Date.now, expires: IDEMPOTENCY_TTL_SECONDS },
});

export const IdempotencyRecord = model<IIdempotencyRecord>('IdempotencyRecord', idempotencySchema);
