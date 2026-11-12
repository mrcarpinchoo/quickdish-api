import type { Category, Product } from "../generated/prisma/client";
import type { Prisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import {
  FOREIGN_KEY_VIOLATION,
  isPrismaError,
  UNIQUE_VIOLATION
} from "../lib/prisma-errors";
import type {
  CategoryInput,
  ListProductsQuery,
  ProductInput
} from "../schemas/catalog";

// ---------- Categories ----------

function categoryNotFound(): ApiError {
  return new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found");
}

function categoryNameTaken(): ApiError {
  return new ApiError(
    409,
    "CATEGORY_NAME_TAKEN",
    "A category with that name already exists"
  );
}

function categoryHasProducts(): ApiError {
  return new ApiError(
    409,
    "CATEGORY_HAS_PRODUCTS",
    "Category has products; deactivate it or move them first"
  );
}

/** Active categories by name; with `includeHidden`, inactive ones too. */
export function listCategories(
  prisma: Prisma,
  includeHidden: boolean
): Promise<Category[]> {
  return prisma.category.findMany({
    where: includeHidden ? {} : { active: true },
    orderBy: { name: "asc" }
  });
}

/** Loads a category. Missing, or inactive without `includeHidden` → 404. */
export async function getCategory(
  prisma: Prisma,
  id: string,
  includeHidden = true
): Promise<Category> {
  const category = await prisma.category.findUnique({ where: { id } });
  if (!category || (!includeHidden && !category.active)) {
    throw categoryNotFound();
  }
  return category;
}

/** Fills the optional fields so a PUT replaces the whole category. */
function categoryData(input: CategoryInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    active: input.active ?? true
  };
}

/** Creates a category. Repeated name → 409. */
export async function createCategory(
  prisma: Prisma,
  input: CategoryInput
): Promise<Category> {
  try {
    return await prisma.category.create({ data: categoryData(input) });
  } catch (err) {
    if (isPrismaError(err, UNIQUE_VIOLATION)) throw categoryNameTaken();
    throw err;
  }
}

/** Replaces a category. Missing → 404, repeated name → 409. */
export async function updateCategory(
  prisma: Prisma,
  id: string,
  input: CategoryInput
): Promise<Category> {
  await getCategory(prisma, id);
  try {
    return await prisma.category.update({
      where: { id },
      data: categoryData(input)
    });
  } catch (err) {
    if (isPrismaError(err, UNIQUE_VIOLATION)) throw categoryNameTaken();
    throw err;
  }
}

/**
 * Deletes an empty category. Missing → 404; with products → 409, so the
 * admin moves or deletes them first, or deactivates the category instead.
 */
export async function deleteCategory(prisma: Prisma, id: string) {
  await getCategory(prisma, id);
  if ((await prisma.product.count({ where: { categoryId: id } })) > 0) {
    throw categoryHasProducts();
  }
  try {
    await prisma.category.delete({ where: { id } });
  } catch (err) {
    // A product was added between the count and the delete.
    if (isPrismaError(err, FOREIGN_KEY_VIOLATION)) throw categoryHasProducts();
    throw err;
  }
}

// ---------- Products ----------

function productNotFound(): ApiError {
  return new ApiError(404, "PRODUCT_NOT_FOUND", "Product not found");
}

/**
 * Products by name, filtered by category and by a text search on the name.
 * Without `includeHidden`, only available products of active categories:
 * that is the customer menu.
 */
export function listProducts(
  prisma: Prisma,
  { categoryId, q }: Pick<ListProductsQuery, "categoryId" | "q">,
  includeHidden: boolean
): Promise<Product[]> {
  return prisma.product.findMany({
    where: {
      ...(categoryId && { categoryId }),
      ...(q && { name: { contains: q } }),
      ...(!includeHidden && { available: true, category: { active: true } })
    },
    orderBy: { name: "asc" }
  });
}

/**
 * Loads a product. Missing → 404. Without `includeHidden`, unavailable
 * products and products of inactive categories are 404 too.
 */
export async function getProduct(
  prisma: Prisma,
  id: string,
  includeHidden = true
): Promise<Product> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: true }
  });
  if (
    !product ||
    (!includeHidden && (!product.available || !product.category.active))
  ) {
    throw productNotFound();
  }
  const { category, ...rest } = product;
  void category;
  return rest;
}

/** Fills the optional fields so a PUT replaces the whole product. */
async function productData(prisma: Prisma, input: ProductInput) {
  // Unknown category → 404 instead of a foreign key error.
  await getCategory(prisma, input.categoryId);
  return {
    name: input.name,
    description: input.description ?? null,
    priceCents: input.priceCents,
    imageUrl: input.imageUrl ?? null,
    available: input.available ?? true,
    categoryId: input.categoryId
  };
}

/** Creates a product. Unknown category → 404. */
export async function createProduct(
  prisma: Prisma,
  input: ProductInput
): Promise<Product> {
  return prisma.product.create({ data: await productData(prisma, input) });
}

/** Replaces a product. Missing product or category → 404. */
export async function updateProduct(
  prisma: Prisma,
  id: string,
  input: ProductInput
): Promise<Product> {
  await getProduct(prisma, id);
  return prisma.product.update({
    where: { id },
    data: await productData(prisma, input)
  });
}

/** Shows or hides a product in the menu. Missing → 404. */
export async function setProductAvailability(
  prisma: Prisma,
  id: string,
  available: boolean
): Promise<Product> {
  await getProduct(prisma, id);
  return prisma.product.update({ where: { id }, data: { available } });
}

/**
 * Deletes a product and removes it from carts. Missing → 404. Products in
 * past orders are kept for the order history (409): mark them unavailable.
 */
export async function deleteProduct(prisma: Prisma, id: string) {
  await getProduct(prisma, id);
  try {
    await prisma.product.delete({ where: { id } });
  } catch (err) {
    if (isPrismaError(err, FOREIGN_KEY_VIOLATION)) {
      throw new ApiError(
        409,
        "PRODUCT_HAS_ORDERS",
        "Product appears in orders; mark it unavailable instead"
      );
    }
    throw err;
  }
}
