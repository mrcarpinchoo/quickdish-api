import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { saveOrder, type OrderPlan } from "../src/lib/order-batch";

type Statement = { sql: string; params: SQLInputValue[] };

/**
 * Just enough of D1 over a real SQLite database with the app's migrations:
 * foreign keys on, as in D1, and a batch is one transaction.
 */
function sqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(readFileSync("migrations/0001_init.sql", "utf8"));
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: SQLInputValue[]): Statement => ({ sql, params })
    }),
    batch: (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        for (const { sql, params } of statements) {
          sqlite.prepare(sql).run(...params);
        }
        sqlite.exec("COMMIT");
        return Promise.resolve([]);
      } catch (err) {
        sqlite.exec("ROLLBACK");
        const message = err instanceof Error ? err.message : String(err);
        return Promise.reject(new Error(`D1_ERROR: ${message}`));
      }
    }
  };
  const rows = (sql: string, ...params: SQLInputValue[]) =>
    sqlite.prepare(sql).all(...params);
  const run = (sql: string, ...params: SQLInputValue[]) =>
    sqlite.prepare(sql).run(...params);
  return { db: db as unknown as D1Database, rows, run };
}

let d1: ReturnType<typeof sqliteD1>;

beforeEach(() => {
  d1 = sqliteD1();
  d1.run(
    `INSERT INTO "users" ("id", "name", "email", "passwordHash", "role")
     VALUES ('user-1', 'Ana', 'ana@quickdish.test', 'x', 'CUSTOMER')`
  );
  d1.run(`INSERT INTO "categories" ("id", "name") VALUES ('tacos', 'Tacos')`);
  d1.run(
    `INSERT INTO "products" ("id", "name", "priceCents", "categoryId") VALUES
     ('pastor', 'Taco al pastor', 3500, 'tacos'),
     ('horchata', 'Horchata', 4000, 'tacos')`
  );
  d1.run(`INSERT INTO "carts" ("id", "userId") VALUES ('cart-1', 'user-1')`);
  d1.run(
    `INSERT INTO "cart_items" ("id", "cartId", "productId", "quantity", "notes") VALUES
     ('cart-item-1', 'cart-1', 'pastor', 3, 'sin cebolla'),
     ('cart-item-2', 'cart-1', 'horchata', 2, NULL)`
  );
});

/** The plan createOrder would build from the cart above, with fresh ids. */
function planFromCart(suffix = "1"): OrderPlan {
  return {
    id: `order-${suffix}`,
    userId: "user-1",
    totalCents: 18500,
    notes: "para llevar",
    createdAt: new Date("2026-11-13T00:00:00.000Z"),
    items: [
      {
        id: `order-${suffix}-item-1`,
        cartItemId: "cart-item-1",
        productId: "pastor",
        quantity: 3,
        unitPriceCents: 3500,
        notes: "sin cebolla"
      },
      {
        id: `order-${suffix}-item-2`,
        cartItemId: "cart-item-2",
        productId: "horchata",
        quantity: 2,
        unitPriceCents: 4000,
        notes: null
      }
    ]
  };
}

const orders = () => d1.rows('SELECT * FROM "orders"');
const orderItems = () => d1.rows('SELECT * FROM "order_items"');
const cartItems = () =>
  d1.rows('SELECT "id", "quantity" FROM "cart_items" ORDER BY "id"');

describe("saveOrder", () => {
  it("writes the order and its items and removes the ordered cart items", async () => {
    d1.run(
      `INSERT INTO "products" ("id", "name", "priceCents", "categoryId")
       VALUES ('agua', 'Agua', 2000, 'tacos')`
    );
    d1.run(
      `INSERT INTO "cart_items" ("id", "cartId", "productId", "quantity")
       VALUES ('added-meanwhile', 'cart-1', 'agua', 1)`
    );

    expect(await saveOrder(d1.db, planFromCart())).toBe(true);

    expect(orders()).toEqual([
      {
        id: "order-1",
        userId: "user-1",
        status: "PENDING",
        totalCents: 18500,
        notes: "para llevar",
        createdAt: "2026-11-13T00:00:00.000Z"
      }
    ]);
    expect(orderItems()).toEqual([
      {
        id: "order-1-item-1",
        orderId: "order-1",
        productId: "pastor",
        quantity: 3,
        unitPriceCents: 3500,
        notes: "sin cebolla"
      },
      {
        id: "order-1-item-2",
        orderId: "order-1",
        productId: "horchata",
        quantity: 2,
        unitPriceCents: 4000,
        notes: null
      }
    ]);
    expect(cartItems()).toEqual([{ id: "added-meanwhile", quantity: 1 }]);
  });

  it("writes nothing for a second order from the same cart read (double submit)", async () => {
    expect(await saveOrder(d1.db, planFromCart("1"))).toBe(true);

    expect(await saveOrder(d1.db, planFromCart("2"))).toBe(false);

    expect(orders()).toHaveLength(1);
    expect(orderItems()).toHaveLength(2);
  });

  it("keeps units added to a cart item after it was read", async () => {
    d1.run(`UPDATE "cart_items" SET "quantity" = 5 WHERE "id" = 'cart-item-1'`);

    expect(await saveOrder(d1.db, planFromCart())).toBe(false);

    expect(orders()).toHaveLength(0);
    expect(cartItems()).toEqual([
      { id: "cart-item-1", quantity: 5 },
      { id: "cart-item-2", quantity: 2 }
    ]);
  });

  it.each([
    [
      "a cart item's notes changed",
      `UPDATE "cart_items" SET "notes" = 'con todo' WHERE "id" = 'cart-item-1'`
    ],
    [
      "a cart item was removed",
      `DELETE FROM "cart_items" WHERE "id" = 'cart-item-2'`
    ],
    [
      "a price changed",
      `UPDATE "products" SET "priceCents" = 3900 WHERE "id" = 'pastor'`
    ],
    [
      "a product became unavailable",
      `UPDATE "products" SET "available" = 0 WHERE "id" = 'horchata'`
    ],
    [
      "the category was deactivated",
      `UPDATE "categories" SET "active" = 0 WHERE "id" = 'tacos'`
    ]
  ])("writes nothing when %s", async (_, change) => {
    d1.run(change);

    expect(await saveOrder(d1.db, planFromCart())).toBe(false);

    expect(orders()).toHaveLength(0);
    expect(orderItems()).toHaveLength(0);
  });

  it("rethrows errors that aren't a changed cart", async () => {
    const db = {
      prepare: () => ({ bind: () => ({}) }),
      batch: () => Promise.reject(new Error("D1_ERROR: network lost"))
    } as unknown as D1Database;

    await expect(saveOrder(db, planFromCart())).rejects.toThrow("network lost");
  });
});
