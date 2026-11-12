import { Hono } from "hono";
import { handleError, handleNotFound } from "./lib/errors";
import { corsMiddleware } from "./middleware/cors";
import health from "./routes/health";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", corsMiddleware);

app.route("/health", health);

app.notFound(handleNotFound);
app.onError(handleError);

export default app;
