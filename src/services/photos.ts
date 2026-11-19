import type { Product } from "../generated/prisma/client";
import type { Prisma } from "../lib/db";
import { ApiError } from "../lib/errors";
import {
  detectPhotoType,
  MAX_PHOTO_BYTES,
  photoKey,
  photoPath
} from "../lib/photos";
import { getProduct } from "./catalog";

/**
 * Stores a product's photo in R2 and points `imageUrl` at it. Missing product
 * → 404 (checked before storing, so no orphan object is left behind). Wrong
 * size or type → 413 / 415 with nothing stored.
 */
export async function setProductPhoto(
  prisma: Prisma,
  bucket: R2Bucket,
  id: string,
  bytes: Uint8Array
): Promise<Product> {
  if (bytes.length === 0) {
    throw new ApiError(
      400,
      "PHOTO_REQUIRED",
      "Send the photo as the request body"
    );
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new ApiError(
      413,
      "PHOTO_TOO_LARGE",
      "Photos must be 1 MB or smaller"
    );
  }
  const type = detectPhotoType(bytes);
  if (!type) {
    throw new ApiError(
      415,
      "UNSUPPORTED_PHOTO_TYPE",
      "Send a JPG, PNG or WebP image"
    );
  }

  await getProduct(prisma, id);
  await bucket.put(photoKey(id), bytes, {
    httpMetadata: { contentType: type }
  });
  return prisma.product.update({
    where: { id },
    data: { imageUrl: photoPath(id, Date.now()) }
  });
}

/**
 * Reads a product's photo. Hidden products are 404 for customers, as in
 * `getProduct`. A product without a stored photo → 404.
 */
export async function getProductPhoto(
  prisma: Prisma,
  bucket: R2Bucket,
  id: string,
  includeHidden: boolean
): Promise<R2ObjectBody> {
  await getProduct(prisma, id, includeHidden);
  const object = await bucket.get(photoKey(id));
  if (!object) {
    throw new ApiError(404, "PHOTO_NOT_FOUND", "This dish has no photo");
  }
  return object;
}

/** Removes a product's photo and clears `imageUrl`. Missing product → 404. */
export async function removeProductPhoto(
  prisma: Prisma,
  bucket: R2Bucket,
  id: string
): Promise<Product> {
  await getProduct(prisma, id);
  await bucket.delete(photoKey(id));
  return prisma.product.update({ where: { id }, data: { imageUrl: null } });
}
