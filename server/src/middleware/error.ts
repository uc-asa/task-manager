import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { ErrorCode } from 'shared';
import { requestLogger } from './requestLogger.js';
import { HttpStatus } from '../utils/http.js';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(HttpStatus.NotFound, ErrorCode.NotFound, 'Route not found'));
};

/** Errors raised by Express/body-parser (http-errors) carry a client-safe status, e.g. 413. */
interface HttpError extends Error {
  status: number;
  type?: string;
}

const isClientHttpError = (err: unknown): err is HttpError =>
  err instanceof Error &&
  'status' in err &&
  typeof err.status === 'number' &&
  err.status >= HttpStatus.BadRequest &&
  err.status < HttpStatus.InternalServerError;

const HTTP_ERROR_CODES: Record<string, { code: string; message: string }> = {
  'entity.too.large': { code: ErrorCode.PayloadTooLarge, message: 'Request body is too large' },
  'charset.unsupported': { code: ErrorCode.UnsupportedCharset, message: 'Unsupported charset' },
  'encoding.unsupported': { code: ErrorCode.UnsupportedEncoding, message: 'Unsupported encoding' },
};

/**
 * Single place where every error becomes a consistent JSON response:
 * { error: { code, message, details? } }
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(HttpStatus.BadRequest).json({
      error: {
        code: ErrorCode.ValidationError,
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // body-parser raises a SyntaxError (with status 400) for malformed JSON
  if (err instanceof SyntaxError && 'body' in err) {
    res
      .status(HttpStatus.BadRequest)
      .json({ error: { code: ErrorCode.InvalidJson, message: 'Malformed JSON body' } });
    return;
  }

  if (isClientHttpError(err)) {
    const known = err.type ? HTTP_ERROR_CODES[err.type] : undefined;
    res.status(err.status).json({
      error: known ?? { code: ErrorCode.BadRequest, message: 'The request could not be processed' },
    });
    return;
  }

  requestLogger(res).error('Unhandled error', { err });
  res
    .status(HttpStatus.InternalServerError)
    .json({ error: { code: ErrorCode.InternalError, message: 'Something went wrong' } });
};
