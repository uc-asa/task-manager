/** Status codes used by the API, so handlers never contain bare numbers. */
export const HttpStatus = {
  Ok: 200,
  Created: 201,
  NoContent: 204,
  BadRequest: 400,
  NotFound: 404,
  Conflict: 409,
  PayloadTooLarge: 413,
  UnprocessableEntity: 422,
  InternalServerError: 500,
  ServiceUnavailable: 503,
} as const;
