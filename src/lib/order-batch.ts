/** Everything needed to write a new order, computed before touching the DB. */
export type OrderPlan = {
  id: string;
  userId: string;
  totalCents: number;
  notes: string | null;
  createdAt: Date;
  /**
   * One per cart item, with the cart item as it was read. The batch only
   * goes through if the cart still looks exactly like this.
   */
  items: {
    id: string;
    cartItemId: string;
    productId: string;
    quantity: number;
    unitPriceCents: number;
    notes: string | null;
  }[];
};

/**
 * Inserts the order only if every cart item it was built from still exists
 * with the same quantity, notes and price, and its product is still on the
 * menu. Otherwise it inserts nothing, and the first `order_items` insert
 * fails its foreign key to `orders`, which rolls the whole batch back.
 */
function insertOrderIfCartUnchanged(db: D1Database, plan: OrderPlan) {
  const itemMatches = plan.items
    .map(
      () =>
        '(ci."id" = ? AND ci."quantity" = ? AND ci."notes" IS ? AND p."priceCents" = ?)'
    )
    .join(" OR ");
  return db
    .prepare(
      `INSERT INTO "orders" ("id", "userId", "status", "totalCents", "notes", "createdAt")
       SELECT ?, ?, ?, ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM "cart_items" ci
         JOIN "products" p ON p."id" = ci."productId"
         JOIN "categories" c ON c."id" = p."categoryId"
         WHERE p."available" = 1 AND c."active" = 1 AND (${itemMatches})
       ) = ?`
    )
    .bind(
      plan.id,
      plan.userId,
      "PENDING",
      plan.totalCents,
      plan.notes,
      plan.createdAt.toISOString(),
      ...plan.items.flatMap(item => [
        item.cartItemId,
        item.quantity,
        item.notes,
        item.unitPriceCents
      ]),
      plan.items.length
    );
}

/**
 * Writes the order, its items and the cart cleanup in one D1 batch. D1 runs
 * a batch as a single transaction: if any statement fails, none is applied,
 * so there's never a half-written order or an order whose cart wasn't
 * emptied. Prisma can't do this on D1 (no interactive transactions).
 *
 * The cart was read before the batch, so it may have changed since: another
 * request placed the same order, or changed a quantity. The first statement
 * checks that, so a second order from the same cart or lost units are
 * impossible. Returns false when the cart changed and nothing was written.
 *
 * Kept out of the services so route tests can mock it.
 */
export async function saveOrder(
  db: D1Database,
  plan: OrderPlan
): Promise<boolean> {
  const statements = [
    insertOrderIfCartUnchanged(db, plan),
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
    // Only the items in the order: anything added meanwhile stays in the
    // cart. The batch is one transaction, so they can't change after the
    // check above.
    ...plan.items.map(item =>
      db
        .prepare('DELETE FROM "cart_items" WHERE "id" = ?')
        .bind(item.cartItemId)
    )
  ];
  try {
    await db.batch(statements);
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("FOREIGN KEY")) {
      return false;
    }
    throw err;
  }
}
