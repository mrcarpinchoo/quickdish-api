import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { validate } from "../lib/validation";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth";
import {
  categorySchema,
  listCategoriesQuery,
  updateCategorySchema
} from "../schemas/catalog";
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory
} from "../services/catalog";
import type { AppEnv } from "../types";

const categories = new Hono<AppEnv>();

const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

/**
 * GET /categories → active categories (public).
 * An admin sends `?all=true` to include inactive ones.
 */
categories.get(
  "/",
  optionalAuth,
  validate("query", listCategoriesQuery),
  async c => {
    const all =
      c.var.viewer?.role === "ADMIN" && c.req.valid("query").all === "true";
    return c.json(await listCategories(createPrisma(c.env.DB), all));
  }
);

/** GET /categories/:id (public). Inactive → 404 except for admins. */
categories.get("/:id", optionalAuth, async c => {
  const category = await getCategory(
    createPrisma(c.env.DB),
    c.req.param("id"),
    c.var.viewer?.role === "ADMIN"
  );
  return c.json(category);
});

/** POST /categories with `{ name, description?, active? }` → 201 (admin). */
categories.post(
  "/",
  ...adminOnly,
  validate("json", categorySchema),
  async c => {
    const category = await createCategory(
      createPrisma(c.env.DB),
      c.req.valid("json")
    );
    return c.json(category, 201);
  }
);

/** PUT /categories/:id updates the fields sent; the rest stay as they are (admin). */
categories.put(
  "/:id",
  ...adminOnly,
  validate("json", updateCategorySchema),
  async c => {
    const category = await updateCategory(
      createPrisma(c.env.DB),
      c.req.param("id"),
      c.req.valid("json")
    );
    return c.json(category);
  }
);

/** DELETE /categories/:id → 204 (admin). With products → 409. */
categories.delete("/:id", ...adminOnly, async c => {
  await deleteCategory(createPrisma(c.env.DB), c.req.param("id"));
  return c.body(null, 204);
});

export default categories;
