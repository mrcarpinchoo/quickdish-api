import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { signToken } from "../src/lib/jwt";
import { addUser, fakePrisma } from "./fake-prisma";
import { jsonRequest, makeEnv } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

type ErrorBody = { error: { code: string; message: string } };

const env = makeEnv();

beforeEach(() => {
  fakePrisma.reset();
});

describe("authentication on /users", () => {
  it("returns 401 without a token", async () => {
    const res = await app.request("/users/me", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Missing bearer token" }
    });
  });

  it("returns 401 with an invalid token", async () => {
    const res = await app.request(
      "/users/me",
      jsonRequest("GET", undefined, "not.a.jwt"),
      env
    );

    expect(res.status).toBe(401);
    expect((await res.json<ErrorBody>()).error.message).toBe(
      "Invalid or expired token"
    );
  });

  it("returns 401 with a token signed with another secret", async () => {
    const token = await signToken({ id: "x", role: "ADMIN" }, "other-secret");

    const res = await app.request(
      "/users",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(401);
  });
});

describe("GET /users/me", () => {
  it("returns the current user without the password hash", async () => {
    const { user, token } = await addUser({ name: "Ana" });

    const res = await app.request(
      "/users/me",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ id: user.id, name: "Ana", role: "CUSTOMER" });
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("returns 404 when the user was deleted", async () => {
    const { user, token } = await addUser();
    fakePrisma.users = fakePrisma.users.filter(u => u.id !== user.id);

    const res = await app.request(
      "/users/me",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(404);
  });
});

describe("PATCH /users/me", () => {
  it("updates the name and email", async () => {
    const { token } = await addUser();

    const res = await app.request(
      "/users/me",
      jsonRequest(
        "PATCH",
        { name: "Nuevo", email: "NEW@quickdish.test" },
        token
      ),
      env
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: "Nuevo",
      email: "new@quickdish.test"
    });
  });

  it("returns 409 when the email belongs to someone else", async () => {
    await addUser({ email: "taken@quickdish.test" });
    const { token } = await addUser({ email: "me@quickdish.test" });

    const res = await app.request(
      "/users/me",
      jsonRequest("PATCH", { email: "taken@quickdish.test" }, token),
      env
    );

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("EMAIL_TAKEN");
  });

  it("returns 400 for an empty body", async () => {
    const { token } = await addUser();

    const res = await app.request(
      "/users/me",
      jsonRequest("PATCH", {}, token),
      env
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /users (admin)", () => {
  it("returns 403 for a customer", async () => {
    const { token } = await addUser();

    const res = await app.request(
      "/users",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(403);
    expect((await res.json<ErrorBody>()).error.code).toBe("FORBIDDEN");
  });

  it("lists every user for an admin, without password hashes", async () => {
    await addUser({ email: "c@quickdish.test" });
    const { token } = await addUser({
      email: "a@quickdish.test",
      role: "ADMIN"
    });

    const res = await app.request(
      "/users",
      jsonRequest("GET", undefined, token),
      env
    );

    expect(res.status).toBe(200);
    const list = await res.json<Record<string, unknown>[]>();
    expect(list).toHaveLength(2);
    for (const user of list) expect(user).not.toHaveProperty("passwordHash");
  });
});

describe("DELETE /users/:id (admin)", () => {
  async function setup() {
    const admin = await addUser({ email: "a@quickdish.test", role: "ADMIN" });
    const customer = await addUser({ email: "c@quickdish.test" });
    return { admin, customer };
  }

  function del(id: string, token: string) {
    return app.request(
      `/users/${id}`,
      jsonRequest("DELETE", undefined, token),
      env
    );
  }

  it("deletes a user", async () => {
    const { admin, customer } = await setup();

    const res = await del(customer.user.id, admin.token);

    expect(res.status).toBe(204);
    expect(fakePrisma.users.map(u => u.id)).not.toContain(customer.user.id);
  });

  it("returns 403 for a customer", async () => {
    const { admin, customer } = await setup();

    const res = await del(admin.user.id, customer.token);

    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown user", async () => {
    const { admin } = await setup();

    const res = await del("missing-id", admin.token);

    expect(res.status).toBe(404);
  });

  it("returns 409 when admins try to delete themselves", async () => {
    const { admin } = await setup();

    const res = await del(admin.user.id, admin.token);

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("CANNOT_DELETE_SELF");
  });

  it("returns 409 when the user has orders", async () => {
    const { admin, customer } = await setup();
    fakePrisma.usersWithOrders.add(customer.user.id);

    const res = await del(customer.user.id, admin.token);

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("USER_HAS_ORDERS");
  });
});
