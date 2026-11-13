import { Hono } from "hono";
import { handleError, handleNotFound } from "./lib/errors";
import { corsMiddleware } from "./middleware/cors";
import auth from "./routes/auth";
import categories from "./routes/categories";
import health from "./routes/health";
import products from "./routes/products";
import users from "./routes/users";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", corsMiddleware);

app.route("/health", health);
app.route("/auth", auth);
app.route("/users", users);
app.route("/categories", categories);
app.route("/products", products);

app.notFound(handleNotFound);
app.onError(handleError);

export default app;
