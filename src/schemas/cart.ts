import { z } from "zod";

/** Units of one product in the cart. */
export const MAX_QUANTITY = 20;

const quantity = z.number().int().min(1).max(MAX_QUANTITY);
const itemNotes = z.string().trim().max(200).nullable().optional();

export const addCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity,
  notes: itemNotes
});

export const updateCartItemSchema = z
  .object({ quantity: quantity.optional(), notes: itemNotes })
  .refine(data => data.quantity !== undefined || data.notes !== undefined, {
    message: "Send quantity or notes"
  });

export const createOrderSchema = z.object({
  notes: z.string().trim().max(500).nullable().optional()
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
