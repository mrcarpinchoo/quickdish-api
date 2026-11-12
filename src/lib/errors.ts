import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Shape of every error response: `{ error: { code, message, details? } }`. */
export type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

const CODE_BY_STATUS: Partial<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS"
};

export function errorBody(
  code: string,
  message: string,
  details?: unknown
): ErrorBody {
  return {
    error:
      details === undefined ? { code, message } : { code, message, details }
  };
}

/**
 * Error with an HTTP status and a stable, machine-readable code.
 * Throw it from routes and services; `handleError` turns it into JSON.
 *
 * @example throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Product is not available");
 */
export class ApiError extends HTTPException {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(status, { message });
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

/** `app.onError` handler: every thrown error becomes an `ErrorBody`. */
export function handleError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status);
  }

  if (err instanceof HTTPException) {
    const code = CODE_BY_STATUS[err.status] ?? `HTTP_${err.status}`;
    return c.json(errorBody(code, err.message || code), err.status);
  }

  // Unexpected error: log it, but don't leak internals to the client.
  console.error(err);
  return c.json(errorBody("INTERNAL_ERROR", "Internal server error"), 500);
}

/** `app.notFound` handler. */
export function handleNotFound(c: Context) {
  return c.json(
    errorBody("NOT_FOUND", `Route ${c.req.method} ${c.req.path} not found`),
    404
  );
}
