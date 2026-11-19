import * as Sentry from "@sentry/hono/cloudflare";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { signToken } from "../src/lib/jwt";
import { jsonRequest, makeEnv, TEST_JWT_SECRET } from "./helpers";

const env = makeEnv();

function tokenFor(role: "ADMIN" | "CUSTOMER") {
  return signToken({ id: `${role.toLowerCase()}-1`, role }, TEST_JWT_SECRET);
}

describe("GET /debug/error", () => {
  it("returns 401 without a token", async () => {
    const res = await app.request("/debug/error", {}, env);

    expect(res.status).toBe(401);
  });

  it("returns 403 for a customer", async () => {
    const token = await tokenFor("CUSTOMER");

    const res = await app.request(
      "/debug/error",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(403);
  });

  it("throws for an admin: logs the trigger and answers the generic 500", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const info = vi.spyOn(Sentry.logger, "info");
    const token = await tokenFor("ADMIN");

    const res = await app.request(
      "/debug/error",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" }
    });
    expect(info).toHaveBeenCalledWith("debug_error_triggered", {
      userId: "admin-1"
    });
    // handleError logs the unexpected error; Sentry's middleware reports it.
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "Debug error triggered on purpose"
    );
  });
});
