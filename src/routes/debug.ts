import * as Sentry from "@sentry/hono/cloudflare";
import { Hono } from "hono";
import { requireAuth, requireRole } from "../middleware/auth";
import type { AppEnv } from "../types";

const debug = new Hono<AppEnv>();

debug.use("*", requireAuth, requireRole("ADMIN"));

/**
 * GET /debug/error (admin) → 500. Throws on purpose to show an error in Sentry
 * during the demo: `handleError` answers 500 and Sentry captures the exception.
 */
debug.get("/error", c => {
  Sentry.logger.info("debug_error_triggered", { userId: c.var.user.id });
  throw new Error("Debug error triggered on purpose to test Sentry");
});

export default debug;
