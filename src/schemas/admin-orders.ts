import { z } from "zod";

/** Every order status. The API and the UI read the same list (#25). */
export const ORDER_STATUSES = [
  "PENDING",
  "IN_PREPARATION",
  "READY",
  "DELIVERED",
  "CANCELLED"
] as const;

/** `?status=` filters the admin list. Omitted → all orders. */
export const listOrdersQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional()
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES)
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
