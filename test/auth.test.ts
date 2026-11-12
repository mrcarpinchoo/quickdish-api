import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { verifyToken } from "../src/lib/jwt";
import { addUser, fakePrisma } from "./fake-prisma";
import { jsonRequest, makeEnv, TEST_JWT_SECRET } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

type AuthBody = {
  token: string;
  user: Record<string, unknown>;
};
type ErrorBody = { error: { code: string; message: string } };

const env = makeEnv();

beforeEach(() => {
  fakePrisma.reset();
});

describe("POST /auth/register", () => {
  const body = {
    name: "Ana López",
    email: "Ana@QuickDish.test",
    password: "Password123"
  };

  it("creates a customer and returns a token and the user", async () => {
    const res = await app.request(
      "/auth/register",
      jsonRequest("POST", body),
      env
    );

    expect(res.status).toBe(201);
    const { token, user } = await res.json<AuthBody>();
    expect(user).toMatchObject({
      name: "Ana López",
      email: "ana@quickdish.test",
      role: "CUSTOMER"
    });
    expect(user).not.toHaveProperty("passwordHash");
    expect(await verifyToken(token, TEST_JWT_SECRET)).toEqual({
      id: user.id,
      role: "CUSTOMER"
    });
  });

  it("never stores the plain password", async () => {
    await app.request("/auth/register", jsonRequest("POST", body), env);

    const stored = fakePrisma.users[0]?.passwordHash ?? "";
    expect(stored).toMatch(/^pbkdf2\$/);
    expect(stored).not.toContain(body.password);
  });

  it("ignores a role sent by the client", async () => {
    const res = await app.request(
      "/auth/register",
      jsonRequest("POST", { ...body, role: "ADMIN" }),
      env
    );

    const { user } = await res.json<AuthBody>();
    expect(user.role).toBe("CUSTOMER");
  });

  it("returns 409 when the email is already registered", async () => {
    await addUser({ email: "ana@quickdish.test" });

    const res = await app.request(
      "/auth/register",
      jsonRequest("POST", body),
      env
    );

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("EMAIL_TAKEN");
  });

  it.each([
    ["a short password", { ...body, password: "short" }],
    ["an invalid email", { ...body, email: "not-an-email" }],
    ["an empty name", { ...body, name: "  " }]
  ])("returns 400 for %s", async (_, invalid) => {
    const res = await app.request(
      "/auth/register",
      jsonRequest("POST", invalid),
      env
    );

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await addUser({ email: "admin@quickdish.test", role: "ADMIN" });
  });

  it("returns a token with the role and the user", async () => {
    const res = await app.request(
      "/auth/login",
      jsonRequest("POST", {
        email: "ADMIN@quickdish.test",
        password: "Password123"
      }),
      env
    );

    expect(res.status).toBe(200);
    const { token, user } = await res.json<AuthBody>();
    expect(user).toMatchObject({
      email: "admin@quickdish.test",
      role: "ADMIN"
    });
    expect(user).not.toHaveProperty("passwordHash");
    expect((await verifyToken(token, TEST_JWT_SECRET)).role).toBe("ADMIN");
  });

  it.each([
    ["a wrong password", "admin@quickdish.test", "WrongPassword"],
    ["an unknown email", "nobody@quickdish.test", "Password123"]
  ])("returns the same generic 401 for %s", async (_, email, password) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const res = await app.request(
      "/auth/login",
      jsonRequest("POST", { email, password }),
      env
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password"
      }
    });
    // The failed login is logged, without the password.
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(password);
  });
});

describe("POST /auth/logout", () => {
  it("returns 204 for an authenticated user", async () => {
    const { token } = await addUser();

    const res = await app.request(
      "/auth/logout",
      jsonRequest("POST", undefined, token),
      env
    );

    expect(res.status).toBe(204);
  });

  it("returns 401 without a token", async () => {
    const res = await app.request("/auth/logout", jsonRequest("POST"), env);

    expect(res.status).toBe(401);
  });
});
