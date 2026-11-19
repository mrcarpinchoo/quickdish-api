import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import { MAX_PHOTO_BYTES, photoKey } from "../lib/photos";
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
import {
  getProductPhoto,
  removeProductPhoto,
  setProductPhoto
} from "../services/photos";
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

/**
 * GET /products/:id/image → the photo itself (public). Hidden products → 404.
 * The URL changes on each upload (`?v=`), so the browser may cache it for a year.
 */
products.get("/:id/image", optionalAuth, async c => {
  const object = await getProductPhoto(
    createPrisma(c.env.DB),
    c.env.PHOTOS,
    c.req.param("id"),
    c.var.viewer?.role === "ADMIN"
  );
  return c.body(object.body, 200, {
    "Content-Type":
      object.httpMetadata?.contentType ?? "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: object.httpEtag
  });
});

/**
 * PUT /products/:id/image: the photo as the raw request body, with its image
 * Content-Type (admin). Replaces the earlier photo. Returns the product.
 */
products.put("/:id/image", ...adminOnly, async c => {
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > MAX_PHOTO_BYTES) {
    throw new ApiError(
      413,
      "PHOTO_TOO_LARGE",
      "Photos must be 1 MB or smaller"
    );
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const product = await setProductPhoto(
    createPrisma(c.env.DB),
    c.env.PHOTOS,
    c.req.param("id"),
    bytes
  );
  return c.json(product);
});

/** DELETE /products/:id/image removes the photo and clears `imageUrl` (admin). */
products.delete("/:id/image", ...adminOnly, async c => {
  const product = await removeProductPhoto(
    createPrisma(c.env.DB),
    c.env.PHOTOS,
    c.req.param("id")
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
  const id = c.req.param("id");
  await deleteProduct(createPrisma(c.env.DB), id);
  await c.env.PHOTOS.delete(photoKey(id));
  return c.body(null, 204);
});

export default products;
