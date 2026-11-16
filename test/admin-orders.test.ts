import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Product, User } from "../src/generated/prisma/client";
import app from "../src/index";
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

type ErrorBody = { error: { code: string; message: string } };
type Status =
  "PENDING" | "IN_PREPARATION" | "READY" | "DELIVERED" | "CANCELLED";
type AdminOrder = {
  id: string;
  status: Status;
  customer: { id: string; name: string; email: string };
};

const env = makeEnv();

let admin: { user: User; token: string };
let customer: { user: User; token: string };
let tacos: Category;
let pastor: Product;

beforeEach(async () => {
  fakePrisma.reset();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  admin = await addUser({ email: "a@quickdish.test", role: "ADMIN" });
  customer = await addUser({ email: "c@quickdish.test", name: "Ana" });
  tacos = addCategory({ name: "Tacos" });
  pastor = addProduct({ name: "Taco al pastor", categoryId: tacos.id });
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  token = admin.token
) {
  return app.request(path, jsonRequest(method, body, token), env);
}

function orderIn(status: Status, userId = customer.user.id) {
  return addOrder({
    userId,
    status,
    items: [{ productId: pastor.id, quantity: 1, unitPriceCents: 3500 }]
  });
}

describe("GET /orders (admin)", () => {
  it("lists every customer's orders with who ordered them", async () => {
    orderIn("PENDING");
    orderIn("READY");

    const res = await request("/orders");

    expect(res.status).toBe(200);
    const list = await res.json<AdminOrder[]>();
    expect(list).toHaveLength(2);
    expect(list[0]?.customer).toEqual({
      id: customer.user.id,
      name: "Ana",
      email: "c@quickdish.test"
    });
  });

  it("filters by ?status=", async () => {
    orderIn("PENDING");
    const ready = orderIn("READY");

    const res = await request("/orders?status=READY");

    const list = await res.json<AdminOrder[]>();
    expect(list.map(o => o.id)).toEqual([ready.id]);
  });

  it("returns 400 for an unknown status", async () => {
    const res = await request("/orders?status=SHIPPED");

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 for a customer and 401 without a token", async () => {
    const customerRes = await request(
      "/orders",
      "GET",
      undefined,
      customer.token
    );
    const anonymous = await app.request("/orders", {}, env);

    expect(customerRes.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });
});

describe("PATCH /orders/:id/status", () => {
  it.each([
    ["PENDING", "IN_PREPARATION"],
    ["IN_PREPARATION", "READY"],
    ["READY", "DELIVERED"]
  ] as const)("moves an order from %s to %s", async (from, to) => {
    const order = orderIn(from);

    const res = await request(`/orders/${order.id}/status`, "PATCH", {
      status: to
    });

    expect(res.status).toBe(200);
    expect(await res.json<AdminOrder>()).toMatchObject({ status: to });
    expect(fakePrisma.orders[0]?.status).toBe(to);
  });

  it.each([
    ["PENDING", "READY"],
    ["PENDING", "DELIVERED"],
    ["PENDING", "PENDING"],
    ["PENDING", "CANCELLED"],
    ["IN_PREPARATION", "PENDING"],
    ["READY", "CANCELLED"],
    ["DELIVERED", "PENDING"],
    ["CANCELLED", "IN_PREPARATION"]
  ] as const)("rejects %s to %s with 400", async (from, to) => {
    const order = orderIn(from);

    const res = await request(`/orders/${order.id}/status`, "PATCH", {
      status: to
    });

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe(
      "INVALID_STATUS_TRANSITION"
    );
    expect(fakePrisma.orders[0]?.status).toBe(from);
  });

  it("returns 400 for a status that doesn't exist", async () => {
    const order = orderIn("PENDING");

    const res = await request(`/orders/${order.id}/status`, "PATCH", {
      status: "SHIPPED"
    });

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 for a customer, even on their own order", async () => {
    const order = orderIn("PENDING");

    const res = await request(
      `/orders/${order.id}/status`,
      "PATCH",
      { status: "IN_PREPARATION" },
      customer.token
    );

    expect(res.status).toBe(403);
    expect(fakePrisma.orders[0]?.status).toBe("PENDING");
  });

  it("returns 404 for an unknown order", async () => {
    const res = await request("/orders/missing/status", "PATCH", {
      status: "IN_PREPARATION"
    });

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("ORDER_NOT_FOUND");
  });

  it("returns 409 when another admin moved the order first", async () => {
    const order = orderIn("PENDING");
    const updateMany = fakePrisma.order.updateMany;
    fakePrisma.order.updateMany = args => {
      order.status = "CANCELLED";
      return updateMany(args);
    };

    try {
      const res = await request(`/orders/${order.id}/status`, "PATCH", {
        status: "IN_PREPARATION"
      });

      expect(res.status).toBe(409);
      expect((await res.json<ErrorBody>()).error.code).toBe(
        "ORDER_STATUS_CHANGED"
      );
      expect(order.status).toBe("CANCELLED");
    } finally {
      fakePrisma.order.updateMany = updateMany;
    }
  });

  it("logs the previous and new status", async () => {
    const order = orderIn("PENDING");

    await request(`/orders/${order.id}/status`, "PATCH", {
      status: "IN_PREPARATION"
    });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "order_status_changed",
        orderId: order.id,
        from: "PENDING",
        to: "IN_PREPARATION"
      })
    );
  });
});
