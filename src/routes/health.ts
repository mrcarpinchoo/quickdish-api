import { Hono } from "hono";
import type { AppEnv } from "../types";

const health = new Hono<AppEnv>();

/**
 * GET /health → `{ status, env, version, db }`.
 * Answers 503 when D1 is unreachable, so uptime checks notice it.
 */
health.get("/", async c => {
  let db: "ok" | "error" = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch (err) {
    console.error("Health check: D1 is unreachable", err);
    db = "error";
  }

  const ok = db === "ok";
  return c.json(
    {
      status: ok ? "ok" : "degraded",
      env: c.env.ENVIRONMENT,
      version: c.env.VERSION,
      db
    },
    ok ? 200 : 503
  );
});

export default health;
