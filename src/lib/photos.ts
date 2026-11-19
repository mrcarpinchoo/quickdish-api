/** Largest photo the API accepts, in bytes. The admin app shrinks photos to ~800 px JPEG first. */
export const MAX_PHOTO_BYTES = 1024 * 1024;

export type PhotoType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Recognises JPEG, PNG and WebP by their first bytes, so a renamed file or a
 * forged Content-Type can't store something else in the bucket.
 */
export function detectPhotoType(bytes: Uint8Array): PhotoType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((byte, i) => bytes[i] === byte)) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** R2 object key for a product's photo. One photo per product, so it's overwritten. */
export function photoKey(productId: string): string {
  return `products/${productId}`;
}

/**
 * Path the API returns as `imageUrl` for an uploaded photo. The version
 * changes on every upload, so browsers and caches never show an old picture.
 */
export function photoPath(productId: string, version: number): string {
  return `/products/${encodeURIComponent(productId)}/image?v=${version}`;
}

const PHOTO_PATH = /^\/products\/[^/?]+\/image(\?v=\d+)?$/;

/** True for a path this API serves itself (what `photoPath` returns). */
export function isPhotoPath(value: string): boolean {
  return PHOTO_PATH.test(value);
}
