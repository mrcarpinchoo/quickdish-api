import { z } from "zod";

const name = z.string().trim().min(1).max(100);
const description = z.string().trim().max(500).nullable().optional();

/** `?all=true` lets admins see inactive categories and unavailable products. */
const all = z.enum(["true", "false"]).optional();

export const listCategoriesQuery = z.object({ all });

export const categorySchema = z.object({
  name,
  description,
  active: z.boolean().optional()
});

export const listProductsQuery = z.object({
  all,
  categoryId: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(100).optional()
});

export const productSchema = z.object({
  name,
  description,
  /** Price in cents: 3500 = $35.00. */
  priceCents: z.number().int().positive().max(10_000_000),
  imageUrl: z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .nullable()
    .optional(),
  available: z.boolean().optional(),
  categoryId: z.string().min(1)
});

/** PUT body: send only the fields to change. `null` clears description and imageUrl. */
export const updateCategorySchema = categorySchema
  .partial()
  .refine(data => Object.values(data).some(v => v !== undefined), {
    message: "Send at least one field to update"
  });

export const updateProductSchema = productSchema
  .partial()
  .refine(data => Object.values(data).some(v => v !== undefined), {
    message: "Send at least one field to update"
  });

export const availabilitySchema = z.object({ available: z.boolean() });

export type CategoryInput = z.infer<typeof categorySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuery>;
