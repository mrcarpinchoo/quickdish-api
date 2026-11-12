import { cors } from "hono/cors";

/** Parses the comma-separated `CORS_ORIGINS` var into a list of origins. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

/**
 * CORS for the frontend. Allowed origins come from the `CORS_ORIGINS` var of
 * each environment (see wrangler.jsonc), so adding a Pages URL needs no code.
 */
export const corsMiddleware = cors({
  origin: (origin, c) => {
    const env = c.env as Partial<CloudflareBindings> | undefined;
    return parseOrigins(env?.CORS_ORIGINS).includes(origin) ? origin : null;
  },
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  maxAge: 600
});
