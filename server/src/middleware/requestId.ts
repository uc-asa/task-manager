import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HttpHeader } from 'shared';

// Only trust a client-supplied id if it is short and boring, so it can't be used to inject
// control characters or huge values into logs.
const SAFE_REQUEST_ID = /^[\w-]{1,64}$/;

/** Reuses the caller's request id (or makes one), echoes it back, and exposes it to handlers. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header(HttpHeader.RequestId);
  const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = id;
  res.setHeader(HttpHeader.RequestId, id);
  next();
};
