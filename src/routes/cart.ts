import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { validate } from "../lib/validation";
import { requireAuth } from "../middleware/auth";
import { addCartItemSchema, updateCartItemSchema } from "../schemas/cart";
import {
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  updateCartItem
} from "../services/cart";
import type { AppEnv } from "../types";

const cart = new Hono<AppEnv>();

cart.use("*", requireAuth);

/** GET /cart → `{ id, items, totalCents }`, created on first use. */
cart.get("/", async c =>
  c.json(await getCart(createPrisma(c.env.DB), c.var.user.id))
);

/**
 * POST /cart/items with `{ productId, quantity, notes? }` → 201 and the cart.
 * A product already in the cart adds to its quantity.
 */
cart.post("/items", validate("json", addCartItemSchema), async c => {
  const view = await addCartItem(
    createPrisma(c.env.DB),
    c.var.user.id,
    c.req.valid("json")
  );
  return c.json(view, 201);
});

/** PATCH /cart/items/:id with `{ quantity?, notes? }` → the cart. */
cart.patch("/items/:id", validate("json", updateCartItemSchema), async c => {
  const view = await updateCartItem(
    createPrisma(c.env.DB),
    c.var.user.id,
    c.req.param("id"),
    c.req.valid("json")
  );
  return c.json(view);
});

/** DELETE /cart/items/:id → the cart. */
cart.delete("/items/:id", async c => {
  const view = await removeCartItem(
    createPrisma(c.env.DB),
    c.var.user.id,
    c.req.param("id")
  );
  return c.json(view);
});

/** DELETE /cart empties the cart → 204. */
cart.delete("/", async c => {
  await clearCart(createPrisma(c.env.DB), c.var.user.id);
  return c.body(null, 204);
});

export default cart;
