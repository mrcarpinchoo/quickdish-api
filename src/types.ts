import type { AuthUser } from "./lib/jwt";

/** Hono environment shared by every router and middleware. */
export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    /** Set by `requireAuth` for authenticated requests. */
    user: AuthUser;
  };
};
