import { describe, expect, it } from "vitest";
import app from "../src/index";
import { parseOrigins } from "../src/middleware/cors";
import { makeEnv } from "./helpers";

function preflight(origin: string) {
  return app.request(
    "/health",
    {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization"
      }
    },
    makeEnv()
  );
}

describe("CORS", () => {
  it("allows the local frontend", async () => {
    const res = await preflight("http://localhost:5173");

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "Authorization"
    );
  });

  it("allows every origin listed in CORS_ORIGINS", async () => {
    const res = await preflight("https://quickdish.example.com");

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://quickdish.example.com"
    );
  });

  it("does not allow other origins", async () => {
    const res = await preflight("https://evil.example.com");

    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("parseOrigins", () => {
  it("splits, trims and drops empty values", () => {
    expect(parseOrigins(" http://a.test , ,http://b.test")).toEqual([
      "http://a.test",
      "http://b.test"
    ]);
    expect(parseOrigins("")).toEqual([]);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});
