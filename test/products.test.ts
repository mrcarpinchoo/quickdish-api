import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category } from "../src/generated/prisma/client";
import app from "../src/index";
import { addCategory, addProduct, addUser, fakePrisma } from "./fake-prisma";
import { jsonRequest, makeEnv } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

type ErrorBody = {
  error: { code: string; message: string; details?: { path: string }[] };
};
type ProductBody = { id: string; name: string; available: boolean };

const env = makeEnv();

let adminToken: string;
let customerToken: string;
let tacos: Category;

beforeEach(async () => {
  fakePrisma.reset();
  adminToken = (await addUser({ email: "a@quickdish.test", role: "ADMIN" }))
    .token;
  customerToken = (await addUser({ email: "c@quickdish.test" })).token;
  tacos = addCategory({ name: "Tacos" });
});

function request(path: string, method = "GET", body?: unknown, token?: string) {
  return app.request(path, jsonRequest(method, body, token), env);
}

async function names(res: Response) {
  return (await res.json<ProductBody[]>()).map(p => p.name);
}

const validProduct = () => ({
  name: "Taco al pastor",
  description: "Con piña",
  priceCents: 3500,
  imageUrl: "https://placehold.co/600x400",
  categoryId: tacos.id
});

describe("GET /products", () => {
  let bebidas: Category;

  beforeEach(() => {
    bebidas = addCategory({ name: "Bebidas" });
    const hidden = addCategory({ name: "Temporada", active: false });
    addProduct({ name: "Taco al pastor", categoryId: tacos.id });
    addProduct({ name: "Taco de asada", categoryId: tacos.id });
    addProduct({
      name: "Taco de lengua",
      categoryId: tacos.id,
      available: false
    });
    addProduct({ name: "Horchata", categoryId: bebidas.id });
    addProduct({ name: "Ponche", categoryId: hidden.id });
  });

  it("shows only available products of active categories, by name", async () => {
    const res = await request("/products");

    expect(res.status).toBe(200);
    expect(await names(res)).toEqual([
      "Horchata",
      "Taco al pastor",
      "Taco de asada"
    ]);
  });

  it("filters by category", async () => {
    const res = await request(`/products?categoryId=${bebidas.id}`);

    expect(await names(res)).toEqual(["Horchata"]);
  });

  it("searches by name, ignoring case", async () => {
    const res = await request("/products?q=ASADA");

    expect(await names(res)).toEqual(["Taco de asada"]);
  });

  it("combines the category filter and the search", async () => {
    const res = await request(`/products?categoryId=${tacos.id}&q=pastor`);

    expect(await names(res)).toEqual(["Taco al pastor"]);
  });

  it("shows hidden products to an admin with ?all=true", async () => {
    const res = await request(
      "/products?all=true",
      "GET",
      undefined,
      adminToken
    );

    expect(await names(res)).toEqual([
      "Horchata",
      "Ponche",
      "Taco al pastor",
      "Taco de asada",
      "Taco de lengua"
    ]);
  });

  it("ignores ?all=true for customers", async () => {
    const res = await request(
      "/products?all=true",
      "GET",
      undefined,
      customerToken
    );

    expect(await names(res)).toHaveLength(3);
  });
});

describe("GET /products/:id", () => {
  it("returns an available product without its category", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(`/products/${product.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(product);
  });

  it("returns 404 for an unavailable product, except for admins", async () => {
    const product = addProduct({ categoryId: tacos.id, available: false });

    const anonymous = await request(`/products/${product.id}`);
    const admin = await request(
      `/products/${product.id}`,
      "GET",
      undefined,
      adminToken
    );

    expect(anonymous.status).toBe(404);
    expect((await anonymous.json<ErrorBody>()).error.code).toBe(
      "PRODUCT_NOT_FOUND"
    );
    expect(admin.status).toBe(200);
  });

  it("returns 404 for a product of an inactive category", async () => {
    const hidden = addCategory({ active: false });
    const product = addProduct({ categoryId: hidden.id });

    const res = await request(`/products/${product.id}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request("/products/missing");

    expect(res.status).toBe(404);
  });
});

describe("POST /products", () => {
  it("creates a product for an admin", async () => {
    const res = await request("/products", "POST", validProduct(), adminToken);

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ...validProduct(),
      available: true
    });
    expect(fakePrisma.products).toHaveLength(1);
  });

  it("returns 401 without a token and 403 for a customer", async () => {
    const anonymous = await request("/products", "POST", validProduct());
    const customer = await request(
      "/products",
      "POST",
      validProduct(),
      customerToken
    );

    expect(anonymous.status).toBe(401);
    expect(customer.status).toBe(403);
    expect(fakePrisma.products).toHaveLength(0);
  });

  it.each([
    ["a zero price", { priceCents: 0 }, "priceCents"],
    ["a negative price", { priceCents: -100 }, "priceCents"],
    ["a decimal price", { priceCents: 35.5 }, "priceCents"],
    ["a price as text", { priceCents: "3500" }, "priceCents"],
    ["an invalid image URL", { imageUrl: "not a url" }, "imageUrl"],
    ["a non-http image URL", { imageUrl: "javascript:alert(1)" }, "imageUrl"],
    ["an empty name", { name: "" }, "name"],
    ["a missing category", { categoryId: undefined }, "categoryId"]
  ])("returns 400 for %s", async (_label, override, path) => {
    const res = await request(
      "/products",
      "POST",
      { ...validProduct(), ...override },
      adminToken
    );

    expect(res.status).toBe(400);
    const body = await res.json<ErrorBody>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.map(d => d.path)).toContain(path);
  });

  it("returns 404 for an unknown category", async () => {
    const res = await request(
      "/products",
      "POST",
      { ...validProduct(), categoryId: "missing" },
      adminToken
    );

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("accepts a product without description or image", async () => {
    const res = await request(
      "/products",
      "POST",
      { name: "Agua", priceCents: 2000, categoryId: tacos.id },
      adminToken
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      description: null,
      imageUrl: null
    });
  });
});

describe("PUT /products/:id", () => {
  it("replaces the product", async () => {
    const product = addProduct({ categoryId: tacos.id, imageUrl: "https://x" });
    const bowls = addCategory({ name: "Bowls" });

    const res = await request(
      `/products/${product.id}`,
      "PUT",
      { name: "Bowl", priceCents: 12900, categoryId: bowls.id },
      adminToken
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: product.id,
      name: "Bowl",
      description: null,
      priceCents: 12900,
      imageUrl: null,
      available: true,
      categoryId: bowls.id
    });
  });

  it("returns 404 for an unknown product", async () => {
    const res = await request(
      "/products/missing",
      "PUT",
      validProduct(),
      adminToken
    );

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 404 for an unknown category", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}`,
      "PUT",
      { ...validProduct(), categoryId: "missing" },
      adminToken
    );

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("CATEGORY_NOT_FOUND");
  });

  it("returns 403 for a customer", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}`,
      "PUT",
      validProduct(),
      customerToken
    );

    expect(res.status).toBe(403);
  });
});

describe("PATCH /products/:id/availability", () => {
  it("hides a product from the menu", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}/availability`,
      "PATCH",
      { available: false },
      adminToken
    );
    const menu = await request("/products");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ available: false });
    expect(await menu.json()).toEqual([]);
  });

  it("returns 400 without a boolean", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}/availability`,
      "PATCH",
      { available: "no" },
      adminToken
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown product", async () => {
    const res = await request(
      "/products/missing/availability",
      "PATCH",
      { available: true },
      adminToken
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 for a customer", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}/availability`,
      "PATCH",
      { available: false },
      customerToken
    );

    expect(res.status).toBe(403);
    expect(fakePrisma.products[0]?.available).toBe(true);
  });
});

describe("DELETE /products/:id", () => {
  it("deletes a product", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}`,
      "DELETE",
      undefined,
      adminToken
    );

    expect(res.status).toBe(204);
    expect(fakePrisma.products).toHaveLength(0);
  });

  it("returns 409 when the product is in past orders", async () => {
    const product = addProduct({ categoryId: tacos.id });
    fakePrisma.productsWithOrders.add(product.id);

    const res = await request(
      `/products/${product.id}`,
      "DELETE",
      undefined,
      adminToken
    );

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("PRODUCT_HAS_ORDERS");
  });

  it("returns 404 for an unknown product", async () => {
    const res = await request(
      "/products/missing",
      "DELETE",
      undefined,
      adminToken
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 for a customer", async () => {
    const product = addProduct({ categoryId: tacos.id });

    const res = await request(
      `/products/${product.id}`,
      "DELETE",
      undefined,
      customerToken
    );

    expect(res.status).toBe(403);
  });
});
