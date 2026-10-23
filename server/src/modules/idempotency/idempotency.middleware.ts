import { createHash } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { ErrorCode, HttpHeader } from 'shared';
import { requestLogger } from '../../middleware/requestLogger.js';
import { AppError } from '../../utils/AppError.js';
import { HttpStatus } from '../../utils/http.js';
import { IDEMPOTENCY_LEASE_MS, IdempotencyRecord } from './idempotency.model.js';

const MONGO_DUPLICATE_KEY = 11000;
const VALID_KEY = /^[\w-]{8,128}$/;

/** JSON with object keys sorted, so `{a,b}` and `{b,a}` hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Exported so tests can build the exact fingerprint a real request would produce. */
export const hashRequest = (method: string, path: string, body: unknown) =>
  createHash('sha256')
    .update(`${method} ${path} ${canonicalJson(body)}`)
    .digest('hex');

const isDuplicateKeyError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

const isSuccess = (status: number) => status >= HttpStatus.Ok && status < 300;

/**
 * Idempotency-Key support for non-idempotent endpoints (POST). Optional: requests without the
 * header behave exactly as before.
 *
 *  - first request with a key  → runs normally; its response is stored for 24 hours
 *  - same key + same request   → the stored response is replayed (`Idempotent-Replayed: true`)
 *  - same key + different body → 422, because the key is being reused for something else
 *  - same key while the first is still running → 409, retry shortly
 *
 * Only successful (2xx) responses are stored. Errors release the key so the client can fix the
 * request and retry with the same key.
 */
export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.header(HttpHeader.IdempotencyKey);
  if (key === undefined) {
    next();
    return;
  }
  if (!VALID_KEY.test(key)) {
    throw new AppError(
      HttpStatus.BadRequest,
      ErrorCode.IdempotencyKeyInvalid,
      `${HttpHeader.IdempotencyKey} must be 8-128 characters: letters, digits, "-" or "_"`,
    );
  }

  const requestHash = hashRequest(req.method, req.baseUrl + req.path, req.body);

  const ownsKey = await claimKey(key, requestHash, res);
  if (!ownsKey) return; // a stored response was replayed

  // We own the key. Capture the response so it can be stored (or the key released) before the
  // client sees it; that way an immediate retry always finds the final state.
  const send = res.json.bind(res);
  res.json = (body: unknown) => {
    const finish = isSuccess(res.statusCode)
      ? IdempotencyRecord.updateOne(
          { key },
          {
            statusCode: res.statusCode,
            responseBody: JSON.parse(JSON.stringify(body)) as unknown,
          },
        )
      : IdempotencyRecord.deleteOne({ key });
    void finish
      .catch((error: unknown) => {
        requestLogger(res).error('Could not finalise idempotency record', { err: error, key });
      })
      .finally(() => send(body));
    return res;
  };

  // The client went away before we answered: release the key so a retry can run.
  res.on('close', () => {
    if (!res.writableFinished) void IdempotencyRecord.deleteOne({ key, statusCode: null });
  });

  next();
};

const conflict = (message: string) =>
  new AppError(HttpStatus.Conflict, ErrorCode.IdempotencyRequestInProgress, message);

/**
 * Decides who runs the request for this key.
 *  - returns true:  this request owns the key and should run (new key, or an abandoned one taken over)
 *  - returns false: a finished response for the same request was found and replayed
 *  - throws:        422 (key reused for a different request) or 409 (another request is running)
 */
async function claimKey(key: string, requestHash: string, res: Response): Promise<boolean> {
  try {
    await IdempotencyRecord.create({ key, requestHash });
    return true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const existing = await IdempotencyRecord.findOne({ key });
  // The record can expire or be released between the failed insert and this lookup.
  if (!existing) throw conflict('Please retry the request');

  if (existing.requestHash !== requestHash) {
    throw new AppError(
      HttpStatus.UnprocessableEntity,
      ErrorCode.IdempotencyKeyReused,
      `${HttpHeader.IdempotencyKey} was already used with a different request`,
    );
  }

  if (existing.statusCode !== undefined) {
    res.setHeader(HttpHeader.IdempotentReplayed, 'true');
    res.status(existing.statusCode).json(existing.responseBody);
    return false;
  }

  // Still marked "in progress". If its lease has expired the owner is presumed dead (crashed or
  // killed before answering), so without this the key would stay blocked until the 24h TTL.
  // The conditional update is atomic: of several concurrent retries exactly one wins the takeover.
  const takenOver = await IdempotencyRecord.findOneAndUpdate(
    {
      key,
      requestHash,
      statusCode: { $exists: false },
      lockedAt: { $lt: new Date(Date.now() - IDEMPOTENCY_LEASE_MS) },
    },
    { lockedAt: new Date() },
  );
  if (takenOver) return true;

  throw conflict('A request with this key is still being processed');
}
