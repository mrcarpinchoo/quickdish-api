import type { Order, OrderItem, Product } from "../generated/prisma/client";
import type { AuthUser } from "../lib/jwt";
import type { Prisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import { saveOrder, type OrderPlan } from "../lib/order-batch";
import type { CreateOrderInput } from "../schemas/cart";
import { isOrderable, ITEMS_WITH_PRODUCT } from "./cart";

type OrderWithItems = Order & {
  items: (OrderItem & { product: Product })[];
};

const ITEMS = { items: { include: { product: true } } } as const;

/** Order as returned by the API. Item prices are the ones paid. */
export type OrderView = ReturnType<typeof toOrderView>;

export function toOrderView(order: OrderWithItems) {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    totalCents: order.totalCents,
    notes: order.notes,
    createdAt: order.createdAt,
    items: order.items.map(item => ({
      id: item.id,
      productId: item.productId,
      name: item.product.name,
      imageUrl: item.product.imageUrl,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      subtotalCents: item.quantity * item.unitPriceCents,
      notes: item.notes
    }))
  };
}

function orderNotFound(): ApiError {
  return new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
}

/**
 * Turns the user's cart into a PENDING order. Empty cart → 400; any product
 * hidden from the menu → 409 with the products in `details`. Each item keeps
 * the price it has now, so later price changes don't alter the order.
 */
export async function createOrder(
  prisma: Prisma,
  db: D1Database,
  userId: string,
  input: CreateOrderInput
): Promise<OrderView> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: ITEMS_WITH_PRODUCT
  });
  if (!cart || cart.items.length === 0) {
    throw new ApiError(400, "CART_EMPTY", "The cart is empty");
  }

  const unavailable = cart.items.filter(item => !isOrderable(item.product));
  if (unavailable.length > 0) {
    throw new ApiError(
      409,
      "PRODUCT_UNAVAILABLE",
      "Some products are not available; remove them from the cart",
      unavailable.map(item => ({
        productId: item.productId,
        name: item.product.name
      }))
    );
  }

  const items = cart.items.map(item => ({
    id: crypto.randomUUID(),
    productId: item.productId,
    quantity: item.quantity,
    unitPriceCents: item.product.priceCents,
    notes: item.notes
  }));
  const plan: OrderPlan = {
    id: crypto.randomUUID(),
    userId,
    totalCents: items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceCents,
      0
    ),
    notes: input.notes ?? null,
    createdAt: new Date(),
    items,
    cartItemIds: cart.items.map(item => item.id)
  };
  await saveOrder(db, plan);

  // TODO(#2): send `order_created` to Sentry with an `order.create` span.
  console.log(
    JSON.stringify({
      event: "order_created",
      orderId: plan.id,
      totalCents: plan.totalCents
    })
  );
  return getOrder(prisma, { id: userId, role: "CUSTOMER" }, plan.id);
}

/** The user's orders, newest first. */
export async function listMyOrders(
  prisma: Prisma,
  userId: string
): Promise<OrderView[]> {
  const orders = await prisma.order.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: ITEMS
  });
  return orders.map(toOrderView);
}

/** Loads an order for its owner or an admin. Anyone else gets 404. */
export async function getOrder(
  prisma: Prisma,
  viewer: AuthUser,
  id: string
): Promise<OrderView> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: ITEMS
  });
  if (!order || (order.userId !== viewer.id && viewer.role !== "ADMIN")) {
    throw orderNotFound();
  }
  return toOrderView(order);
}

/**
 * Cancels one of the user's orders. Only the owner can, and only while it
 * is PENDING: otherwise 409. The status check is part of the update, so an
 * admin moving the order at the same time can't be overwritten.
 */
export async function cancelOrder(
  prisma: Prisma,
  userId: string,
  id: string
): Promise<OrderView> {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.userId !== userId) throw orderNotFound();

  const notCancellable = () =>
    new ApiError(
      409,
      "ORDER_NOT_CANCELLABLE",
      "Only pending orders can be cancelled"
    );
  if (order.status !== "PENDING") throw notCancellable();

  const { count } = await prisma.order.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "CANCELLED" }
  });
  if (count === 0) throw notCancellable();

  return getOrder(prisma, { id: userId, role: "CUSTOMER" }, id);
}
