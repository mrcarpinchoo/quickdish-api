import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Product } from "../src/generated/prisma/client";
import app from "../src/index";
import { MAX_PHOTO_BYTES } from "../src/lib/photos";
import { addCategory, addProduct, addUser, fakePrisma } from "./fake-prisma";
import { fakeR2, jsonRequest, makeEnv } from "./helpers";

vi.mock("../src/lib/db", async () => {
  const { fakePrisma } = await import("./fake-prisma");
  return { createPrisma: () => fakePrisma };
});

type ErrorBody = { error: { code: string; message: string } };

/** A minimal JPEG: the magic bytes followed by padding. */
const JPEG = new Uint8Array(68);
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);
const PNG = new Uint8Array(40);
PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let env: ReturnType<typeof makeEnv>;
let photos: ReturnType<typeof fakeR2>;
let adminToken: string;
let customerToken: string;
let tacos: Category;
let product: Product;

beforeEach(async () => {
  fakePrisma.reset();
  env = makeEnv();
  photos = env.PHOTOS as unknown as ReturnType<typeof fakeR2>;
  adminToken = (await addUser({ email: "a@quickdish.test", role: "ADMIN" }))
    .token;
  customerToken = (await addUser({ email: "c@quickdish.test" })).token;
  tacos = addCategory({ name: "Tacos" });
  product = addProduct({ name: "Taco al pastor", categoryId: tacos.id });
});

function upload(
  id: string,
  bytes: Uint8Array,
  token: string | null = adminToken,
  contentType = "image/jpeg"
) {
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.request(
    `/products/${id}/image`,
    { method: "PUT", headers, body: bytes },
    env
  );
}

describe("PUT /products/:id/image", () => {
  it("stores a JPEG in the bucket and points imageUrl at it", async () => {
    const res = await upload(product.id, JPEG);

    expect(res.status).toBe(200);
    const body = await res.json<Product>();
    expect(body.imageUrl).toMatch(
      new RegExp(`^/products/${product.id}/image\\?v=\\d+$`)
    );
    expect(photos.objects.get(`products/${product.id}`)?.contentType).toBe(
      "image/jpeg"
    );
  });

  it("accepts PNG and checks the real type, not the Content-Type header", async () => {
    expect(
      (await upload(product.id, PNG, adminToken, "image/png")).status
    ).toBe(200);
    const res = await upload(product.id, PNG, adminToken, "image/jpeg");
    expect(res.status).toBe(200);
    expect(photos.objects.get(`products/${product.id}`)?.contentType).toBe(
      "image/png"
    );
  });

  it("rejects a file that is not a JPG, PNG or WebP image", async () => {
    const res = await upload(
      product.id,
      new TextEncoder().encode("<html>not a photo</html>"),
      adminToken,
      "image/jpeg"
    );

    expect(res.status).toBe(415);
    expect((await res.json<ErrorBody>()).error.code).toBe(
      "UNSUPPORTED_PHOTO_TYPE"
    );
    expect(photos.objects.size).toBe(0);
  });

  it("rejects a photo larger than 1 MB without storing it", async () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(JPEG.subarray(0, 4));

    const res = await upload(product.id, big);

    expect(res.status).toBe(413);
    expect(photos.objects.size).toBe(0);
  });

  it("rejects an empty body", async () => {
    const res = await upload(product.id, new Uint8Array(0));

    expect(res.status).toBe(400);
    expect((await res.json<ErrorBody>()).error.code).toBe("PHOTO_REQUIRED");
  });

  it("is admin only", async () => {
    expect((await upload(product.id, JPEG, customerToken)).status).toBe(403);
    expect((await upload(product.id, JPEG, null)).status).toBe(401);
    expect(photos.objects.size).toBe(0);
  });

  it("returns 404 for an unknown product and stores nothing", async () => {
    const res = await upload("00000000-0000-0000-0000-000000000000", JPEG);

    expect(res.status).toBe(404);
    expect(photos.objects.size).toBe(0);
  });
});

describe("GET /products/:id/image", () => {
  it("serves the stored photo to anyone, with caching headers", async () => {
    await upload(product.id, JPEG);

    const res = await app.request(`/products/${product.id}/image`, {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toContain("max-age=");
    expect(res.headers.get("ETag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
  });

  it("returns 404 when the dish has no photo", async () => {
    const res = await app.request(`/products/${product.id}/image`, {}, env);

    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error.code).toBe("PHOTO_NOT_FOUND");
  });

  it("hides the photo of an unavailable dish from customers", async () => {
    await upload(product.id, JPEG);
    fakePrisma.products[0].available = false;

    const anonymous = await app.request(
      `/products/${product.id}/image`,
      {},
      env
    );
    const admin = await app.request(
      `/products/${product.id}/image`,
      jsonRequest("GET", undefined, adminToken),
      env
    );

    expect(anonymous.status).toBe(404);
    expect(admin.status).toBe(200);
  });
});

describe("DELETE /products/:id/image", () => {
  it("removes the photo and clears imageUrl", async () => {
    await upload(product.id, JPEG);

    const res = await app.request(
      `/products/${product.id}/image`,
      jsonRequest("DELETE", undefined, adminToken),
      env
    );

    expect(res.status).toBe(200);
    expect((await res.json<Product>()).imageUrl).toBeNull();
    expect(photos.objects.size).toBe(0);
  });
});

describe("product imageUrl", () => {
  it("accepts a photo path returned by the API when editing a dish", async () => {
    const res = await app.request(
      `/products/${product.id}`,
      jsonRequest(
        "PUT",
        { imageUrl: `/products/${product.id}/image?v=123` },
        adminToken
      ),
      env
    );

    expect(res.status).toBe(200);
  });

  it("still accepts an http(s) link", async () => {
    const res = await app.request(
      `/products/${product.id}`,
      jsonRequest(
        "PUT",
        { imageUrl: "https://placehold.co/600x400" },
        adminToken
      ),
      env
    );

    expect(res.status).toBe(200);
  });

  it.each(["javascript:alert(1)", "ftp://example.com/a.jpg", "not a url"])(
    "rejects %s",
    async imageUrl => {
      const res = await app.request(
        `/products/${product.id}`,
        jsonRequest("PUT", { imageUrl }, adminToken),
        env
      );

      expect(res.status).toBe(400);
    }
  );
});

describe("DELETE /products/:id", () => {
  it("also removes the dish's photo from the bucket", async () => {
    await upload(product.id, JPEG);

    const res = await app.request(
      `/products/${product.id}`,
      jsonRequest("DELETE", undefined, adminToken),
      env
    );

    expect(res.status).toBe(204);
    expect(photos.objects.size).toBe(0);
  });
});
