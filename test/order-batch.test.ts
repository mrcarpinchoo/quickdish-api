import { describe, expect, it } from "vitest";
import { saveOrder, type OrderPlan } from "../src/lib/order-batch";

type Statement = { sql: string; params: unknown[] };

/** D1 stand-in that records each prepared statement and each batch. */
function recordingD1({ fail = false } = {}) {
  const batches: Statement[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({ sql, params })
    }),
    batch: (statements: Statement[]) => {
      batches.push(statements);
      return fail ?
          Promise.reject(new Error("D1_ERROR: FOREIGN KEY constraint failed"))
        : Promise.resolve([]);
    }
  };
  return { db: db as unknown as D1Database, batches };
}

const plan: OrderPlan = {
  id: "order-1",
  userId: "user-1",
  totalCents: 18500,
  notes: "para llevar",
  createdAt: new Date("2026-11-13T00:00:00.000Z"),
  items: [
    {
      id: "item-1",
      productId: "pastor",
      quantity: 3,
      unitPriceCents: 3500,
      notes: "sin cebolla"
    },
    {
      id: "item-2",
      productId: "horchata",
      quantity: 2,
      unitPriceCents: 4000,
      notes: null
    }
  ],
  cartItemIds: ["cart-item-1", "cart-item-2"]
};

describe("saveOrder", () => {
  it("writes the order, its items and the cart cleanup in one batch", async () => {
    const { db, batches } = recordingD1();

    await saveOrder(db, plan);

    expect(batches).toHaveLength(1);
    const [order, ...rest] = batches[0] ?? [];
    expect(order?.sql).toMatch(/^INSERT INTO "orders"/);
    expect(order?.params).toEqual([
      "order-1",
      "user-1",
      "PENDING",
      18500,
      "para llevar",
      "2026-11-13T00:00:00.000Z"
    ]);
    expect(rest.map(s => s.params)).toEqual([
      ["item-1", "order-1", "pastor", 3, 3500, "sin cebolla"],
      ["item-2", "order-1", "horchata", 2, 4000, null],
      ["cart-item-1"],
      ["cart-item-2"]
    ]);
    expect(rest.slice(0, 2).every(s => s.sql.includes('"order_items"'))).toBe(
      true
    );
    expect(rest.slice(2).every(s => s.sql.startsWith("DELETE"))).toBe(true);
  });

  it("rejects when D1 rolls the batch back", async () => {
    const { db } = recordingD1({ fail: true });

    await expect(saveOrder(db, plan)).rejects.toThrow("FOREIGN KEY");
  });
});
