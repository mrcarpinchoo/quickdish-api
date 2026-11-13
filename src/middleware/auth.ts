import { createMiddleware } from "hono/factory";
import { ApiError } from "../lib/errors";
import { verifyToken, type Role } from "../lib/jwt";
import type { AppEnv } from "../types";

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Requires a valid `Authorization: Bearer <token>` header and sets `c.var.user`.
 * Missing, invalid or expired token → 401.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = BEARER.exec(c.req.header("Authorization") ?? "")?.[1];
  if (!token) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing bearer token");
  }

  try {
    c.set("user", await verifyToken(token, c.env.JWT_SECRET));
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
  }

  await next();
});

/**
 * Requires one of the given roles. Use it after `requireAuth`.
 * Authenticated user with another role → 403.
 *
 * @example users.get("/", requireAuth, requireRole("ADMIN"), handler)
 */
export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.var.user.role)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "You don't have access to this resource"
      );
    }
    await next();
  });
}

/**
 * For public routes that show more to admins. Sets `c.var.viewer` to the
 * token's user, or null without a valid token. Never answers 401: a stale
 * token just gets the public view.
 */
export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = BEARER.exec(c.req.header("Authorization") ?? "")?.[1];
  let viewer = null;
  if (token) {
    try {
      viewer = await verifyToken(token, c.env.JWT_SECRET);
    } catch {
      // Invalid or expired token: treat the caller as anonymous.
    }
  }
  c.set("viewer", viewer);
  await next();
});
