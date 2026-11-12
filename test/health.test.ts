import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { fakeD1, makeEnv } from "./helpers";

describe("GET /health", () => {
  it("returns an ok status with env, version and db", async () => {
    const res = await app.request("/health", {}, makeEnv());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      env: "test",
      version: "test-version",
      db: "ok"
    });
  });

  it("returns 503 when D1 is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await app.request(
      "/health",
      {},
      makeEnv({ DB: fakeD1({ fail: true }) })
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", db: "error" });
  });
});
