import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Product, User } from "../src/generated/prisma/client";
import app from "../src/index";
import type { OrderPlan } from "../src/lib/order-batch";
import type { OrderView } from "../src/services/orders";
import {
  addCategory,
  addOrder,
  addProduct,
  addUser,
  fakePrisma
} from "./fake-prisma";
import { jsonRequest, makeEnv } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

// The real batch is tested in order-batch.test.ts; here it writes to the fake.
vi.mock("../src/lib/order-batch", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return {
    saveOrder: (...args: [D1Database, OrderPlan]) =>
      fakePrisma.saveOrder(args[1])
  };
});

type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

const env = makeEnv();

let customer: { user: User; token: string };
let admin: { user: User; token: string };
let tacos: Category;
let pastor: Product;
let horchata: Product;

beforeEach(async () => {
  fakePrisma.reset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  customer = await addUser({ email: "c@quickdish.test" });
  admin = await addUser({ email: "a@quickdish.test", role: "ADMIN" });
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

function request(
  path: string,
  method = "GET",
  body?: unknown,
  token = customer.token
) {
  return app.request(path, jsonRequest(method, body, token), env);
}

async function fillCart(items: [Product, number][], token = customer.token) {
  for (const [product, quantity] of items) {
    await request(
      "/cart/items",
      "POST",
      { productId: product.id, quantity },
      token
    );
  }
}

function placeOrder(body: unknown = {}, token = customer.token) {
  return request("/orders", "POST", body, token);
}

describe("POST /orders", () => {
  it("creates a PENDING order with the right total and empties the cart", async () => {
    await fillCart([
      [pastor, 3],
      [horchata, 2]
    ]);

    const res = await placeOrder({ notes: "para llevar" });

    expect(res.status).toBe(201);
    const order = await res.json<OrderView>();
    expect(order).toMatchObject({
      userId: customer.user.id,
      status: "PENDING",
      totalCents: 3 * 3500 + 2 * 4000,
      notes: "para llevar"
    });
    expect(order.items).toHaveLength(2);
    expect(fakePrisma.cartItems).toHaveLength(0);
  });

  it("copies the unit price, so later price changes don't alter the order", async () => {
    await fillCart([[pastor, 2]]);
    const order = await (await placeOrder()).json<OrderView>();

    pastor.priceCents = 9900;
    const res = await request(`/orders/${order.id}`);

    const after = await res.json<OrderView>();
    expect(after.totalCents).toBe(7000);
    expect(after.items[0]).toMatchObject({
      unitPriceCents: 3500,
      subtotalCents: 7000
    });
  });

  it("returns 400 when the cart is empty", async () => {
    const res = await placeOrder();

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe("CART_EMPTY");
    expect(fakePrisma.orders).toHaveLength(0);
  });

  it("returns 409 listing the products that became unavailable", async () => {
    await fillCart([
      [pastor, 1],
      [horchata, 1]
    ]);
    horchata.available = false;

    const res = await placeOrder();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: "PRODUCT_UNAVAILABLE",
        message: "Some products are not available; remove them from the cart",
        details: [{ productId: horchata.id, name: "Horchata" }]
      }
    });
    expect(fakePrisma.orders).toHaveLength(0);
    expect(fakePrisma.cartItems).toHaveLength(2);
  });

  it("leaves no order and keeps the cart when the batch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await fillCart([[pastor, 1]]);
    fakePrisma.failNextSave = true;

    const res = await placeOrder();

    expect(res.status).toBe(500);
    expect(fakePrisma.orders).toHaveLength(0);
    expect(fakePrisma.orderItems).toHaveLength(0);
    expect(fakePrisma.cartItems).toHaveLength(1);
  });

  it("logs order_created with the id and total", async () => {
    await fillCart([[pastor, 1]]);

    const order = await (await placeOrder()).json<OrderView>();

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "order_created",
        orderId: order.id,
        totalCents: 3500
      })
    );
  });

  it("works without a body", async () => {
    await fillCart([[pastor, 1]]);

    const res = await app.request(
      "/orders",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${customer.token}` }
      },
      env
    );

    expect(res.status).toBe(201);
  });

  it("returns 401 without a token", async () => {
    const res = await app.request("/orders", { method: "POST" }, env);

    expect(res.status).toBe(401);
  });
});

describe("GET /orders/mine", () => {
  it("lists only the user's orders, newest first", async () => {
    const items = [{ productId: pastor.id, quantity: 1, unitPriceCents: 3500 }];
    const old = addOrder({
      userId: customer.user.id,
      createdAt: new Date("2026-11-01"),
      items
    });
    const recent = addOrder({
      userId: customer.user.id,
      createdAt: new Date("2026-11-10"),
      items
    });
    addOrder({ userId: admin.user.id, items });

    const res = await request("/orders/mine");

    expect(res.status).toBe(200);
    expect((await res.json<OrderView[]>()).map(o => o.id)).toEqual([
      recent.id,
      old.id
    ]);
  });

  it("is not taken as an order id", async () => {
    const res = await request("/orders/mine");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /orders/:id", () => {
  function customerOrder() {
    return addOrder({
      userId: customer.user.id,
      items: [{ productId: pastor.id, quantity: 2, unitPriceCents: 3500 }]
    });
  }

  it("returns the owner's order with its items", async () => {
    const order = customerOrder();

    const res = await request(`/orders/${order.id}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: order.id,
      totalCents: 7000,
      items: [{ name: "Taco al pastor", quantity: 2, subtotalCents: 7000 }]
    });
  });

  it("returns any order to an admin", async () => {
    const order = customerOrder();

    const res = await request(
      `/orders/${order.id}`,
      "GET",
      undefined,
      admin.token
    );

    expect(res.status).toBe(200);
  });

  it("returns 404 for another customer's order", async () => {
    const order = customerOrder();
    const other = await addUser({ email: "other@quickdish.test" });

    const res = await request(
      `/orders/${order.id}`,
      "GET",
      undefined,
      other.token
    );

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("ORDER_NOT_FOUND");
  });

  it("returns 404 for an unknown order", async () => {
    const res = await request("/orders/missing");

    expect(res.status).toBe(404);
  });
});

describe("POST /orders/:id/cancel", () => {
  function orderWith(status: OrderView["status"], userId = customer.user.id) {
    return addOrder({
      userId,
      status,
      items: [{ productId: pastor.id, quantity: 1, unitPriceCents: 3500 }]
    });
  }

  it("cancels a pending order of the owner", async () => {
    const order = orderWith("PENDING");

    const res = await request(`/orders/${order.id}/cancel`, "POST");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "CANCELLED" });
    expect(fakePrisma.orders[0]?.status).toBe("CANCELLED");
  });

  it.each(["IN_PREPARATION", "READY", "DELIVERED", "CANCELLED"] as const)(
    "returns 409 for a %s order",
    async status => {
      const order = orderWith(status);

      const res = await request(`/orders/${order.id}/cancel`, "POST");

      expect(res.status).toBe(409);
      expect((await res.json<ErrorBody>()).error.code).toBe(
        "ORDER_NOT_CANCELLABLE"
      );
      expect(fakePrisma.orders[0]?.status).toBe(status);
    }
  );

  it("returns 409 when the order leaves PENDING before the update", async () => {
    const order = orderWith("PENDING");
    const updateMany = fakePrisma.order.updateMany;
    fakePrisma.order.updateMany = args => {
      order.status = "IN_PREPARATION";
      return updateMany(args);
    };

    try {
      const res = await request(`/orders/${order.id}/cancel`, "POST");

      expect(res.status).toBe(409);
      expect(order.status).toBe("IN_PREPARATION");
    } finally {
      fakePrisma.order.updateMany = updateMany;
    }
  });

  it("returns 404 for another user's order, even for an admin", async () => {
    const order = orderWith("PENDING");

    const res = await request(
      `/orders/${order.id}/cancel`,
      "POST",
      undefined,
      admin.token
    );

    expect(res.status).toBe(404);
    expect(fakePrisma.orders[0]?.status).toBe("PENDING");
  });
});
