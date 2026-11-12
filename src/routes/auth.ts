import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import { signToken } from "../lib/jwt";
import { validate } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { loginSchema, registerSchema } from "../schemas/auth";
import { authenticate, registerUser, toPublicUser } from "../services/users";
import type { AppEnv } from "../types";

const auth = new Hono<AppEnv>();

/** POST /auth/register → 201 `{ token, user }`. New accounts are CUSTOMER. */
auth.post("/register", validate("json", registerSchema), async c => {
  const user = await registerUser(createPrisma(c.env.DB), c.req.valid("json"));
  const token = await signToken(user, c.env.JWT_SECRET);
  return c.json({ token, user: toPublicUser(user) }, 201);
});

/** POST /auth/login → `{ token, user }`. Wrong credentials → 401. */
auth.post("/login", validate("json", loginSchema), async c => {
  try {
    const user = await authenticate(
      createPrisma(c.env.DB),
      c.req.valid("json")
    );
    const token = await signToken(user, c.env.JWT_SECRET);
    return c.json({ token, user: toPublicUser(user) });
  } catch (err) {
    if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
      // Never log the password. TODO(#2): also send it to Sentry as a warning.
      console.warn(JSON.stringify({ event: "login_failed" }));
    }
    throw err;
  }
});

/**
 * POST /auth/logout → 204. JWTs are stateless: the client deletes its token.
 */
auth.post("/logout", requireAuth, c => c.body(null, 204));

export default auth;
