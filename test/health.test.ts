import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("GET /health", () => {
  it("returns an ok status", async () => {
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
