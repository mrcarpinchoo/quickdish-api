import { z } from "zod";
import { isPhotoPath } from "../lib/photos";

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

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
  /** An http(s) link, or the photo path this API returns after an upload. */
  imageUrl: z
    .string()
    .max(2048)
    .refine(value => isHttpUrl(value) || isPhotoPath(value), {
      message: "imageUrl must be an http(s) URL or a product photo path"
    })
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
