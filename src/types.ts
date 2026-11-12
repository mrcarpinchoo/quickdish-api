import type { AuthUser } from "./lib/jwt";

/** Hono environment shared by every router and middleware. */
export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    /** Set by `requireAuth` for authenticated requests. */
    user: AuthUser;
    /** Set by `optionalAuth` on public routes: the caller, or null if anonymous. */
    viewer: AuthUser | null;
  };
};
