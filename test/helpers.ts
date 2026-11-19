export const TEST_JWT_SECRET = "test-secret-for-unit-tests-only";

/** Fake D1 binding: `SELECT 1` succeeds, or rejects when `fail` is true. */
export function fakeD1({ fail = false } = {}): D1Database {
  return {
    prepare: () => ({
      first: () =>
        fail ?
          Promise.reject(new Error("D1 unavailable"))
        : Promise.resolve({ 1: 1 })
    })
  } as unknown as D1Database;
}

/** In-memory R2 bucket with the methods the API uses: put, get and delete. */
export function fakeR2() {
  const objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string }
  >();
  const bucket = {
    objects,
    put(key: string, value: ArrayBuffer | Uint8Array, options?: R2PutOptions) {
      const bytes = new Uint8Array(
        value instanceof ArrayBuffer ? value : value.buffer.slice(0)
      );
      const contentType = (
        options?.httpMetadata as { contentType?: string } | undefined
      )?.contentType;
      objects.set(key, { bytes, contentType });
      return Promise.resolve(null);
    },
    get(key: string) {
      const stored = objects.get(key);
      if (!stored) return Promise.resolve(null);
      return Promise.resolve({
        body: new Response(stored.bytes).body,
        httpMetadata: { contentType: stored.contentType },
        httpEtag: `"etag-${key}"`
      });
    },
    delete(key: string) {
      objects.delete(key);
      return Promise.resolve();
    }
  };
  return bucket as unknown as R2Bucket & { objects: typeof objects };
}

/** Bindings passed as the third argument of `app.request()`. */
export function makeEnv(
  overrides: Partial<CloudflareBindings> = {}
): CloudflareBindings {
  return {
    ENVIRONMENT: "test",
    VERSION: "test-version",
    CORS_ORIGINS: "http://localhost:5173, https://quickdish.example.com",
    JWT_SECRET: TEST_JWT_SECRET,
    DB: fakeD1(),
    PHOTOS: fakeR2(),
    ...overrides
  } as CloudflareBindings;
}

/** Builds `app.request()` options for a JSON request, with an optional token. */
export function jsonRequest(
  method: string,
  body?: unknown,
  token?: string
): RequestInit {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}
