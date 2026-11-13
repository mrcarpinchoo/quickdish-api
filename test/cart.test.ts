import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Product } from "../src/generated/prisma/client";
import app from "../src/index";
import type { CartView } from "../src/services/cart";
import { addCategory, addProduct, addUser, fakePrisma } from "./fake-prisma";
import { jsonRequest, makeEnv } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

type ErrorBody = { error: { code: string; message: string } };

const env = makeEnv();

let token: string;
let tacos: Category;
let pastor: Product;
let horchata: Product;

beforeEach(async () => {
  fakePrisma.reset();
  token = (await addUser({ email: "c@quickdish.test" })).token;
  tacos = addCategory({ name: "Tacos" });
  pastor = addProduct({
    name: "Taco al pastor",
    priceCents: 3500,
    categoryId: tacos.id
  });
  horchata = addProduct({
    name: "Horchata",
    priceCents: 4000,
    categoryId: tacos.id
  });
});

function request(path: string, method = "GET", body?: unknown, auth = token) {
  return app.request(path, jsonRequest(method, body, auth), env);
}

function add(productId: string, quantity = 1, notes?: string) {
  return request("/cart/items", "POST", { productId, quantity, notes });
}

describe("authentication on /cart", () => {
  it("returns 401 without a token", async () => {
    const res = await app.request("/cart", {}, env);

    expect(res.status).toBe(401);
  });
});

describe("GET /cart", () => {
  it("creates an empty cart on first use, once per user", async () => {
    const first = await request("/cart");
    const second = await request("/cart");

    expect(first.status).toBe(200);
    const body = await first.json<CartView>();
    expect(body).toMatchObject({ items: [], totalCents: 0 });
    expect((await second.json<CartView>()).id).toBe(body.id);
    expect(fakePrisma.carts).toHaveLength(1);
  });

  it("returns subtotals and the total with current prices", async () => {
    await add(pastor.id, 3);
    await add(horchata.id, 2);

    const body = await (await request("/cart")).json<CartView>();

    expect(
      body.items.map(i => [i.product.name, i.quantity, i.subtotalCents])
    ).toEqual([
      ["Horchata", 2, 8000],
      ["Taco al pastor", 3, 10500]
    ]);
    expect(body.totalCents).toBe(18500);
  });

  it("flags items whose product was hidden after being added", async () => {
    await add(pastor.id);
    pastor.available = false;

    const body = await (await request("/cart")).json<CartView>();

    expect(body.items[0]?.product.available).toBe(false);
  });

  it("drops items whose product was deleted", async () => {
    await add(pastor.id);
    const admin = await addUser({ email: "a@quickdish.test", role: "ADMIN" });
    await request(`/products/${pastor.id}`, "DELETE", undefined, admin.token);

    const body = await (await request("/cart")).json<CartView>();

    expect(body.items).toEqual([]);
  });
});

describe("POST /cart/items", () => {
  it("adds a product and returns the cart with 201", async () => {
    const res = await add(pastor.id, 2, "sin cebolla");

    expect(res.status).toBe(201);
    const body = await res.json<CartView>();
    expect(body.items).toMatchObject([
      { productId: pastor.id, quantity: 2, notes: "sin cebolla" }
    ]);
    expect(body.totalCents).toBe(7000);
  });

  it("adds to the quantity when the product is already in the cart", async () => {
    await add(pastor.id, 2, "sin cebolla");

    const body = await (await add(pastor.id, 3)).json<CartView>();

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ quantity: 5, notes: "sin cebolla" });
  });

  it("returns 409 for an unavailable product", async () => {
    const hidden = addProduct({ categoryId: tacos.id, available: false });

    const res = await add(hidden.id);

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe(
      "PRODUCT_UNAVAILABLE"
    );
    expect(fakePrisma.cartItems).toHaveLength(0);
  });

  it("returns 409 for a product of an inactive category", async () => {
    const closed = addCategory({ active: false });
    const product = addProduct({ categoryId: closed.id });

    const res = await add(product.id);

    expect(res.status).toBe(409);
  });

  it("returns 404 for an unknown product", async () => {
    const res = await add("missing");

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("returns 409 when the total quantity would pass 20", async () => {
    await add(pastor.id, 15);

    const res = await add(pastor.id, 6);

    expect(res.status).toBe(409);
    expect((await res.json<ErrorBody>()).error.code).toBe("QUANTITY_LIMIT");
    expect(fakePrisma.cartItems[0]?.quantity).toBe(15);
  });

  it.each([0, 21, 1.5, -1])("returns 400 for quantity %s", async quantity => {
    const res = await add(pastor.id, quantity);

    expect(res.status).toBe(400);
  });
});

describe("PATCH /cart/items/:id", () => {
  it("changes the quantity and notes", async () => {
    const itemId = (await (await add(pastor.id, 2)).json<CartView>()).items[0]
      ?.id;

    const res = await request(`/cart/items/${itemId}`, "PATCH", {
      quantity: 4,
      notes: "extra salsa"
    });

    expect(res.status).toBe(200);
    const body = await res.json<CartView>();
    expect(body.items[0]).toMatchObject({ quantity: 4, notes: "extra salsa" });
    expect(body.totalCents).toBe(14000);
  });

  it("returns 400 for a quantity over 20 or an empty body", async () => {
    const itemId = (await (await add(pastor.id)).json<CartView>()).items[0]?.id;

    const tooMany = await request(`/cart/items/${itemId}`, "PATCH", {
      quantity: 21
    });
    const empty = await request(`/cart/items/${itemId}`, "PATCH", {});

    expect(tooMany.status).toBe(400);
    expect(empty.status).toBe(400);
  });

  it("returns 404 for an item of another user's cart", async () => {
    const itemId = (await (await add(pastor.id)).json<CartView>()).items[0]?.id;
    const other = await addUser({ email: "other@quickdish.test" });

    const res = await request(
      `/cart/items/${itemId}`,
      "PATCH",
      { quantity: 5 },
      other.token
    );

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe(
      "CART_ITEM_NOT_FOUND"
    );
    expect(fakePrisma.cartItems[0]?.quantity).toBe(1);
  });
});

describe("DELETE /cart/items/:id", () => {
  it("removes the item and returns the cart", async () => {
    await add(horchata.id);
    const cart = await (await add(pastor.id)).json<CartView>();
    const pastorItem = cart.items.find(i => i.productId === pastor.id);

    const res = await request(`/cart/items/${pastorItem?.id}`, "DELETE");

    expect(res.status).toBe(200);
    expect((await res.json<CartView>()).items.map(i => i.productId)).toEqual([
      horchata.id
    ]);
  });

  it("returns 404 for an item of another user's cart", async () => {
    const itemId = (await (await add(pastor.id)).json<CartView>()).items[0]?.id;
    const other = await addUser({ email: "other@quickdish.test" });

    const res = await request(
      `/cart/items/${itemId}`,
      "DELETE",
      undefined,
      other.token
    );

    expect(res.status).toBe(404);
    expect(fakePrisma.cartItems).toHaveLength(1);
  });
});

describe("DELETE /cart", () => {
  it("empties only the user's cart", async () => {
    await add(pastor.id);
    const other = await addUser({ email: "other@quickdish.test" });
    await request(
      "/cart/items",
      "POST",
      { productId: pastor.id, quantity: 1 },
      other.token
    );

    const res = await request("/cart", "DELETE");

    expect(res.status).toBe(204);
    expect(fakePrisma.cartItems).toHaveLength(1);
    expect((await (await request("/cart")).json<CartView>()).items).toEqual([]);
  });
});
