import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import app from "../src/index";
import { ApiError, handleError, handleNotFound } from "../src/lib/errors";
import { validate } from "../src/lib/validation";
import { makeEnv } from "./helpers";

/** Small app wired like src/index.ts, with routes that throw on purpose. */
function makeTestApp() {
  const testApp = new Hono();
  testApp.get("/api-error", () => {
    throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Product is not available");
  });
  testApp.get("/http-exception", () => {
    throw new HTTPException(401, { message: "Missing token" });
  });
  testApp.get("/crash", () => {
    throw new Error("secret internal detail");
  });
  testApp.post(
    "/items",
    validate("json", z.object({ quantity: z.number().int().min(1) })),
    c => c.json(c.req.valid("json"), 201)
  );
  testApp.notFound(handleNotFound);
  testApp.onError(handleError);
  return testApp;
}

describe("error handling", () => {
  const testApp = makeTestApp();

  it("returns 404 in JSON for unknown routes", async () => {
    const res = await app.request("/nope", {}, makeEnv());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route GET /nope not found" }
    });
  });

  it("uses the status and code of an ApiError", async () => {
    const res = await testApp.request("/api-error");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "PRODUCT_UNAVAILABLE",
        message: "Product is not available"
      }
    });
  });

  it("maps an HTTPException to a code by status", async () => {
    const res = await testApp.request("/http-exception");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing token" }
    });
  });

  it("hides the details of unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await testApp.request("/crash");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" }
    });
  });
});

describe("validate", () => {
  const testApp = makeTestApp();

  it("returns 400 with the invalid fields", async () => {
    const res = await testApp.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: 0 })
    });

    expect(res.status).toBe(400);
    const body = await res.json<{
      error: { code: string; details: { path: string }[] };
    }>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0]?.path).toBe("quantity");
  });

  it("passes valid input to the handler", async () => {
    const res = await testApp.request("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: 2 })
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ quantity: 2 });
  });
});
