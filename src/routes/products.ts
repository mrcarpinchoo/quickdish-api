import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { validate } from "../lib/validation";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth";
import {
  availabilitySchema,
  listProductsQuery,
  productSchema,
  updateProductSchema
} from "../schemas/catalog";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  setProductAvailability,
  updateProduct
} from "../services/catalog";
import type { AppEnv } from "../types";

const products = new Hono<AppEnv>();

const adminOnly = [requireAuth, requireRole("ADMIN")] as const;

/**
 * GET /products?categoryId=&q= → the menu (public): available products of
 * active categories. An admin sends `?all=true` to include hidden ones.
 */
products.get(
  "/",
  optionalAuth,
  validate("query", listProductsQuery),
  async c => {
    const { all, ...filters } = c.req.valid("query");
    const includeHidden = c.var.viewer?.role === "ADMIN" && all === "true";
    return c.json(
      await listProducts(createPrisma(c.env.DB), filters, includeHidden)
    );
  }
);

/** GET /products/:id (public). Hidden from the menu → 404 except for admins. */
products.get("/:id", optionalAuth, async c => {
  const product = await getProduct(
    createPrisma(c.env.DB),
    c.req.param("id"),
    c.var.viewer?.role === "ADMIN"
  );
  return c.json(product);
});

/** POST /products → 201 (admin). Unknown category → 404. */
products.post("/", ...adminOnly, validate("json", productSchema), async c => {
  const product = await createProduct(
    createPrisma(c.env.DB),
    c.req.valid("json")
  );
  return c.json(product, 201);
});

/** PUT /products/:id updates the fields sent; the rest stay as they are (admin). */
products.put(
  "/:id",
  ...adminOnly,
  validate("json", updateProductSchema),
  async c => {
    const product = await updateProduct(
      createPrisma(c.env.DB),
      c.req.param("id"),
      c.req.valid("json")
    );
    return c.json(product);
  }
);

/** PATCH /products/:id/availability with `{ available }` (admin). */
products.patch(
  "/:id/availability",
  ...adminOnly,
  validate("json", availabilitySchema),
  async c => {
    const product = await setProductAvailability(
      createPrisma(c.env.DB),
      c.req.param("id"),
      c.req.valid("json").available
    );
    return c.json(product);
  }
);

/** DELETE /products/:id → 204 (admin). In past orders → 409. */
products.delete("/:id", ...adminOnly, async c => {
  await deleteProduct(createPrisma(c.env.DB), c.req.param("id"));
  return c.body(null, 204);
});

export default products;
