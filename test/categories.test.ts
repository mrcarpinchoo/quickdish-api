import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { addCategory, addProduct, addUser, fakePrisma } from "./fake-prisma";
import { jsonRequest, makeEnv } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

type ErrorBody = { error: { code: string; message: string } };
type CategoryBody = { id: string; name: string; active: boolean };

const env = makeEnv();

let adminToken: string;
let customerToken: string;

beforeEach(async () => {
  fakePrisma.reset();
  adminToken = (await addUser({ email: "a@quickdish.test", role: "ADMIN" }))
    .token;
  customerToken = (await addUser({ email: "c@quickdish.test" })).token;
});

function request(path: string, method = "GET", body?: unknown, token?: string) {
  return app.request(path, jsonRequest(method, body, token), env);
}

describe("GET /categories", () => {
  beforeEach(() => {
    addCategory({ name: "Tacos" });
    addCategory({ name: "Bebidas" });
    addCategory({ name: "Temporada", active: false });
  });

  it("lists only active categories, by name, without a token", async () => {
    const res = await request("/categories");

    expect(res.status).toBe(200);
    const list = await res.json<CategoryBody[]>();
    expect(list.map(c => c.name)).toEqual(["Bebidas", "Tacos"]);
  });

  it("includes inactive categories for an admin with ?all=true", async () => {
    const res = await request(
      "/categories?all=true",
      "GET",
      undefined,
      adminToken
    );

    expect((await res.json<CategoryBody[]>()).map(c => c.name)).toEqual([
      "Bebidas",
      "Tacos",
      "Temporada"
    ]);
  });

  it("ignores ?all=true for customers", async () => {
    const res = await request(
      "/categories?all=true",
      "GET",
      undefined,
      customerToken
    );

    expect(await res.json<CategoryBody[]>()).toHaveLength(2);
  });

  it("treats an invalid token as anonymous", async () => {
    const res = await request(
      "/categories?all=true",
      "GET",
      undefined,
      "not.a.jwt"
    );

    expect(res.status).toBe(200);
    expect(await res.json<CategoryBody[]>()).toHaveLength(2);
  });

  it("returns 400 for an invalid ?all value", async () => {
    const res = await request("/categories?all=yes");

    expect(res.status).toBe(400);
  });
});

describe("GET /categories/:id", () => {
  it("returns an active category", async () => {
    const category = addCategory({ name: "Tacos" });

    const res = await request(`/categories/${category.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(category);
  });

  it("returns 404 for an inactive category, except for admins", async () => {
    const category = addCategory({ active: false });

    const anonymous = await request(`/categories/${category.id}`);
    const admin = await request(
      `/categories/${category.id}`,
      "GET",
      undefined,
      adminToken
    );

    expect(anonymous.status).toBe(404);
    expect((await anonymous.json<ErrorBody>()).error.code).toBe(
      "CATEGORY_NOT_FOUND"
    );
    expect(admin.status).toBe(200);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request("/categories/missing");

    expect(res.status).toBe(404);
  });
});

describe("POST /categories", () => {
  it("creates a category for an admin", async () => {
    const res = await request(
      "/categories",
      "POST",
      { name: "  Postres ", description: "Algo dulce" },
      adminToken
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      name: "Postres",
      description: "Algo dulce",
      active: true
    });
    expect(fakePrisma.categories).toHaveLength(1);
  });

  it("returns 401 without a token and 403 for a customer", async () => {
    const anonymous = await request("/categories", "POST", { name: "X" });
    const customer = await request(
      "/categories",
      "POST",
      { name: "X" },
      customerToken
    );

    expect(anonymous.status).toBe(401);
    expect(customer.status).toBe(403);
    expect(fakePrisma.categories).toHaveLength(0);
  });

  it("returns 400 for an empty name", async () => {
    const res = await request("/categories", "POST", { name: " " }, adminToken);

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 for a repeated name", async () => {
    addCategory({ name: "Tacos" });

    const res = await request(
      "/categories",
      "POST",
      { name: "Tacos" },
      adminToken
    );

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe(
      "CATEGORY_NAME_TAKEN"
    );
  });
});

describe("PUT /categories/:id", () => {
  it("updates the fields sent and keeps the rest", async () => {
    const category = addCategory({ name: "Tacos", description: "Viejo" });

    const res = await request(
      `/categories/${category.id}`,
      "PUT",
      { name: "Tacos y más", active: false },
      adminToken
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: category.id,
      name: "Tacos y más",
      description: "Viejo",
      active: false
    });
  });

  it("keeps an inactive category hidden when only the name changes", async () => {
    const category = addCategory({ name: "Temporada", active: false });

    await request(
      `/categories/${category.id}`,
      "PUT",
      { name: "Temporada navideña" },
      adminToken
    );

    expect(fakePrisma.categories[0]).toMatchObject({
      name: "Temporada navideña",
      active: false
    });
  });

  it("clears the description with null", async () => {
    const category = addCategory({ description: "Viejo" });

    const res = await request(
      `/categories/${category.id}`,
      "PUT",
      { description: null },
      adminToken
    );

    expect(await res.json()).toMatchObject({ description: null });
  });

  it("returns 400 for an empty body", async () => {
    const category = addCategory();

    const res = await request(
      `/categories/${category.id}`,
      "PUT",
      {},
      adminToken
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown category", async () => {
    const res = await request(
      "/categories/missing",
      "PUT",
      { name: "X" },
      adminToken
    );

    expect(res.status).toBe(404);
  });

  it("returns 409 when the name belongs to another category", async () => {
    addCategory({ name: "Tacos" });
    const other = addCategory({ name: "Bowls" });

    const res = await request(
      `/categories/${other.id}`,
      "PUT",
      { name: "Tacos" },
      adminToken
    );

    expect(res.status).toBe(409);
  });

  it("returns 403 for a customer", async () => {
    const category = addCategory();

    const res = await request(
      `/categories/${category.id}`,
      "PUT",
      { name: "X" },
      customerToken
    );

    expect(res.status).toBe(403);
  });
});

describe("DELETE /categories/:id", () => {
  it("deletes an empty category", async () => {
    const category = addCategory();

    const res = await request(
      `/categories/${category.id}`,
      "DELETE",
      undefined,
      adminToken
    );

    expect(res.status).toBe(204);
    expect(fakePrisma.categories).toHaveLength(0);
  });

  it("returns 409 when the category has products", async () => {
    const category = addCategory();
    addProduct({ categoryId: category.id });

    const res = await request(
      `/categories/${category.id}`,
      "DELETE",
      undefined,
      adminToken
    );

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe(
      "CATEGORY_HAS_PRODUCTS"
    );
    expect(fakePrisma.categories).toHaveLength(1);
  });

  it("returns 404 for an unknown category", async () => {
    const res = await request(
      "/categories/missing",
      "DELETE",
      undefined,
      adminToken
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 for a customer", async () => {
    const category = addCategory();

    const res = await request(
      `/categories/${category.id}`,
      "DELETE",
      undefined,
      customerToken
    );

    expect(res.status).toBe(403);
  });
});
