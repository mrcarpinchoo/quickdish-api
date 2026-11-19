import { sentry } from "@sentry/hono/cloudflare";
import { Hono } from "hono";
import { handleError, handleNotFound } from "./lib/errors";
import { corsMiddleware } from "./middleware/cors";
import auth from "./routes/auth";
import cart from "./routes/cart";
import categories from "./routes/categories";
import debug from "./routes/debug";
import health from "./routes/health";
import orders from "./routes/orders";
import products from "./routes/products";
import users from "./routes/users";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Sentry first, so it traces every request and sees every error, including
// the ones `handleError` answers. Without a SENTRY_DSN (local, tests) it stays off.
app.use(
  sentry(app, (env: CloudflareBindings) => ({
    dsn: env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    release: env.VERSION,
    tracesSampleRate: 1.0
  }))
);

app.use("*", corsMiddleware);

app.route("/health", health);
app.route("/debug", debug);
app.route("/auth", auth);
app.route("/users", users);
app.route("/categories", categories);
app.route("/products", products);
app.route("/cart", cart);
app.route("/orders", orders);

app.notFound(handleNotFound);
app.onError(handleError);

export default app;
