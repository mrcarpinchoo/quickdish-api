import type { CartItem, Category, Product } from "../generated/prisma/client";
import type { Prisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import {
  MAX_QUANTITY,
  type AddCartItemInput,
  type UpdateCartItemInput
} from "../schemas/cart";

export type ProductWithCategory = Product & { category: Category };
export type CartItemWithProduct = CartItem & { product: ProductWithCategory };

/** Include that loads each cart item with its product and category. */
export const ITEMS_WITH_PRODUCT = {
  items: { include: { product: { include: { category: true } } } }
} as const;

/** A product can be ordered while it's available and its category is active. */
export function isOrderable(product: ProductWithCategory): boolean {
  return product.available && product.category.active;
}

/** Cart as returned by the API, with prices computed from current products. */
export type CartView = {
  id: string;
  items: {
    id: string;
    productId: string;
    quantity: number;
    notes: string | null;
    subtotalCents: number;
    product: {
      id: string;
      name: string;
      priceCents: number;
      imageUrl: string | null;
      /** False when it was hidden after being added: the order would fail. */
      available: boolean;
    };
  }[];
  totalCents: number;
};

export function toCartView(cart: {
  id: string;
  items: CartItemWithProduct[];
}): CartView {
  const items = [...cart.items]
    .sort((a, b) => a.product.name.localeCompare(b.product.name))
    .map(item => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes,
      subtotalCents: item.quantity * item.product.priceCents,
      product: {
        id: item.product.id,
        name: item.product.name,
        priceCents: item.product.priceCents,
        imageUrl: item.product.imageUrl,
        available: isOrderable(item.product)
      }
    }));
  return {
    id: cart.id,
    items,
    totalCents: items.reduce((sum, item) => sum + item.subtotalCents, 0)
  };
}

/** The user's cart with its items. Created on first use: one per user. */
export async function getCart(prisma: Prisma, userId: string) {
  return toCartView(
    await prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: ITEMS_WITH_PRODUCT
    })
  );
}

function quantityLimit(): ApiError {
  return new ApiError(
    409,
    "QUANTITY_LIMIT",
    `An item can have at most ${MAX_QUANTITY} units`
  );
}

/**
 * Adds a product to the cart. If it's already there, adds to its quantity
 * (and replaces the notes when sent). Missing product → 404, hidden from
 * the menu → 409, more than the limit → 409.
 */
export async function addCartItem(
  prisma: Prisma,
  userId: string,
  input: AddCartItemInput
): Promise<CartView> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: { category: true }
  });
  if (!product) {
    throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product not found");
  }
  if (!isOrderable(product)) {
    throw new ApiError(
      409,
      "PRODUCT_UNAVAILABLE",
      "Product is not available right now"
    );
  }

  const cart = await prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {}
  });
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId: product.id } }
  });

  if (existing) {
    const quantity = existing.quantity + input.quantity;
    if (quantity > MAX_QUANTITY) throw quantityLimit();
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity, notes: input.notes }
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: product.id,
        quantity: input.quantity,
        notes: input.notes ?? null
      }
    });
  }
  return getCart(prisma, userId);
}

/** Loads an item of the user's cart. Someone else's item → 404 too. */
async function findOwnItem(prisma: Prisma, userId: string, itemId: string) {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { userId } }
  });
  if (!item) {
    throw new ApiError(404, "CART_ITEM_NOT_FOUND", "Cart item not found");
  }
  return item;
}

/** Changes the quantity and/or notes of an item of the user's cart. */
export async function updateCartItem(
  prisma: Prisma,
  userId: string,
  itemId: string,
  input: UpdateCartItemInput
): Promise<CartView> {
  await findOwnItem(prisma, userId, itemId);
  await prisma.cartItem.update({ where: { id: itemId }, data: input });
  return getCart(prisma, userId);
}

/** Removes an item from the user's cart. */
export async function removeCartItem(
  prisma: Prisma,
  userId: string,
  itemId: string
): Promise<CartView> {
  await findOwnItem(prisma, userId, itemId);
  await prisma.cartItem.delete({ where: { id: itemId } });
  return getCart(prisma, userId);
}

/** Empties the user's cart. */
export async function clearCart(prisma: Prisma, userId: string) {
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
}
