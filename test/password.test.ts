import { describe, expect, it } from "vitest";
import {
  hashPassword,
  PBKDF2_ITERATIONS,
  verifyPassword
} from "../src/lib/password";

describe("hashPassword", () => {
  it("stores pbkdf2$<iterations>$<salt>$<hash>, never the plain password", async () => {
    const hash = await hashPassword("Password123");

    const parts = hash.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(Number(parts[1])).toBe(PBKDF2_ITERATIONS);
    expect(hash).not.toContain("Password123");
  });

  it("uses a different salt every time", async () => {
    const a = await hashPassword("Password123", 1000);
    const b = await hashPassword("Password123", 1000);

    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    const hash = await hashPassword("Password123", 1000);

    expect(await verifyPassword("Password123", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Password123", 1000);

    expect(await verifyPassword("password123", hash)).toBe(false);
  });

  it("uses the iteration count stored in the hash", async () => {
    const hash = await hashPassword("Password123", 2000);

    expect(hash.split("$")[1]).toBe("2000");
    expect(await verifyPassword("Password123", hash)).toBe(true);
  });

  it.each([
    "",
    "Password123",
    "bcrypt$1000$c2FsdA==$aGFzaA==",
    "pbkdf2$abc$c2FsdA==$aGFzaA==",
    "pbkdf2$0$c2FsdA==$aGFzaA==",
    "pbkdf2$1000$$",
    "pbkdf2$1000$%%%$aGFzaA=="
  ])("rejects the malformed hash %j", async stored => {
    expect(await verifyPassword("Password123", stored)).toBe(false);
  });
});
