import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { signToken, TOKEN_TTL_SECONDS, verifyToken } from "../src/lib/jwt";

const SECRET = "jwt-test-secret";

function decodePayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json) as Record<string, unknown>;
}

describe("signToken", () => {
  it("carries sub, role and an 8 hour exp", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ id: "user-1", role: "ADMIN" }, SECRET, now);

    expect(decodePayload(token)).toEqual({
      sub: "user-1",
      role: "ADMIN",
      iat: now,
      exp: now + TOKEN_TTL_SECONDS
    });
    expect(TOKEN_TTL_SECONDS).toBe(8 * 60 * 60);
  });
});

describe("verifyToken", () => {
  it("returns the user of a valid token", async () => {
    const token = await signToken({ id: "user-1", role: "CUSTOMER" }, SECRET);

    expect(await verifyToken(token, SECRET)).toEqual({
      id: "user-1",
      role: "CUSTOMER"
    });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signToken({ id: "user-1", role: "CUSTOMER" }, "other");

    await expect(verifyToken(token, SECRET)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const nineHoursAgo = Math.floor(Date.now() / 1000) - 9 * 60 * 60;
    const token = await signToken(
      { id: "user-1", role: "CUSTOMER" },
      SECRET,
      nineHoursAgo
    );

    await expect(verifyToken(token, SECRET)).rejects.toThrow();
  });

  it("rejects a token with an unknown role", async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await sign(
      { sub: "user-1", role: "SUPERUSER", exp },
      SECRET,
      "HS256"
    );

    await expect(verifyToken(token, SECRET)).rejects.toThrow(
      "Invalid token payload"
    );
  });
});
