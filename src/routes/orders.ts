import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { validate } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { createOrderSchema } from "../schemas/cart";
import {
  cancelOrder,
  createOrder,
  getOrder,
  listMyOrders
} from "../services/orders";
import type { AppEnv } from "../types";

const orders = new Hono<AppEnv>();

orders.use("*", requireAuth);

/** POST /orders with `{ notes? }` turns the cart into an order → 201. */
orders.post("/", validate("json", createOrderSchema), async c => {
  const order = await createOrder(
    createPrisma(c.env.DB),
    c.env.DB,
    c.var.user.id,
    c.req.valid("json")
  );
  return c.json(order, 201);
});

// Declared before /:id so "mine" isn't taken as an id.
/** GET /orders/mine → the user's orders, newest first. */
orders.get("/mine", async c =>
  c.json(await listMyOrders(createPrisma(c.env.DB), c.var.user.id))
);

/** GET /orders/:id → an order of the user, or any order for an admin. */
orders.get("/:id", async c =>
  c.json(await getOrder(createPrisma(c.env.DB), c.var.user, c.req.param("id")))
);

/** POST /orders/:id/cancel → the cancelled order. Not PENDING → 409. */
orders.post("/:id/cancel", async c =>
  c.json(
    await cancelOrder(createPrisma(c.env.DB), c.var.user.id, c.req.param("id"))
  )
);

export default orders;
