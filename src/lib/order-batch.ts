/** Everything needed to write a new order, computed before touching the DB. */
export type OrderPlan = {
  id: string;
  userId: string;
  totalCents: number;
  notes: string | null;
  createdAt: Date;
  items: {
    id: string;
    productId: string;
    quantity: number;
    unitPriceCents: number;
    notes: string | null;
  }[];
  /** Cart items turned into this order: they are removed from the cart. */
  cartItemIds: string[];
};

/**
 * Writes the order, its items and the cart cleanup in one D1 batch. D1 runs
 * a batch as a single transaction: if any statement fails, none is applied,
 * so there's never a half-written order or an order whose cart wasn't
 * emptied. Prisma can't do this on D1 (no interactive transactions).
 *
 * Kept out of the services so route tests can mock it.
 */
export async function saveOrder(db: D1Database, plan: OrderPlan) {
  const statements = [
    db
      .prepare(
        'INSERT INTO "orders" ("id", "userId", "status", "totalCents", "notes", "createdAt") VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        plan.id,
        plan.userId,
        "PENDING",
        plan.totalCents,
        plan.notes,
        plan.createdAt.toISOString()
      ),
    ...plan.items.map(item =>
      db
        .prepare(
          'INSERT INTO "order_items" ("id", "orderId", "productId", "quantity", "unitPriceCents", "notes") VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(
          item.id,
          plan.id,
          item.productId,
          item.quantity,
          item.unitPriceCents,
          item.notes
        )
    ),
    // Only the items in the order: anything added meanwhile stays in the cart.
    ...plan.cartItemIds.map(id =>
      db.prepare('DELETE FROM "cart_items" WHERE "id" = ?').bind(id)
    )
  ];
  await db.batch(statements);
}
