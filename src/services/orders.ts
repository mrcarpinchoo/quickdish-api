import type {
  Order,
  OrderItem,
  OrderStatus,
  Product
} from "../generated/prisma/client";
import type { AuthUser } from "../lib/jwt";
import type { Prisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import { saveOrder, type OrderPlan } from "../lib/order-batch";
import type { CreateOrderInput } from "../schemas/cart";
import type { UpdateOrderStatusInput } from "../schemas/admin-orders";
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
 * the price it has now, so later price changes don't alter the order. If
 * the cart changes before the order is saved (a second submit, a quantity
 * change), nothing is written → 409 `CART_CHANGED`.
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
    cartItemId: item.id,
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
    items
  };
  if (!(await saveOrder(db, plan))) {
    throw new ApiError(
      409,
      "CART_CHANGED",
      "The cart changed while placing the order; review it and try again"
    );
  }

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

// ---------- Admin ----------

const ADMIN_INCLUDE = {
  items: { include: { product: true } },
  user: { select: { id: true, name: true, email: true } }
} as const;

type AdminOrderWithRelations = OrderWithItems & {
  user: { id: string; name: string; email: string };
};

/** Order for the admin panel: the customer is included so staff know who it is for. */
export function toAdminOrderView(order: AdminOrderWithRelations) {
  return {
    ...toOrderView(order),
    customer: {
      id: order.user.id,
      name: order.user.name,
      email: order.user.email
    }
  };
}

/** Every order, newest first; `status` narrows the list. */
export async function listAllOrders(prisma: Prisma, status?: OrderStatus) {
  const orders = await prisma.order.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    include: ADMIN_INCLUDE
  });
  return orders.map(toAdminOrderView);
}

/**
 * The one forward step each status can take. CANCELLED and DELIVERED are
 * final: no entry means no transition.
 */
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  PENDING: "IN_PREPARATION",
  IN_PREPARATION: "READY",
  READY: "DELIVERED"
};

async function loadAdminOrder(prisma: Prisma, id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: ADMIN_INCLUDE
  });
  if (!order) throw orderNotFound();
  return toAdminOrderView(order);
}

/**
 * Moves an order one step forward. Any other move → 400. The status is
 * checked again inside the update, so two admins can't both move the same
 * order: the second one gets 409 and reloads.
 */
export async function updateOrderStatus(
  prisma: Prisma,
  id: string,
  input: UpdateOrderStatusInput
) {
  const current = await prisma.order.findUnique({ where: { id } });
  if (!current) throw orderNotFound();

  if (NEXT_STATUS[current.status] !== input.status) {
    throw new ApiError(
      400,
      "INVALID_STATUS_TRANSITION",
      `An order cannot go from ${current.status} to ${input.status}`
    );
  }

  const { count } = await prisma.order.updateMany({
    where: { id, status: current.status },
    data: { status: input.status }
  });
  if (count === 0) {
    throw new ApiError(
      409,
      "ORDER_STATUS_CHANGED",
      "The order changed while you were updating it; reload and try again"
    );
  }

  // TODO(#2): send `order_status_changed` to Sentry.
  console.log(
    JSON.stringify({
      event: "order_status_changed",
      orderId: id,
      from: current.status,
      to: input.status
    })
  );
  return loadAdminOrder(prisma, id);
}
