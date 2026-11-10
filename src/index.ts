import { Hono } from "hono";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/health", c => c.json({ status: "ok" }));

export default app;
