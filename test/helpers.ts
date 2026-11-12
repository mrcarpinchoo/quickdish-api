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

/** Bindings passed as the third argument of `app.request()`. */
export function makeEnv(
  overrides: Partial<CloudflareBindings> = {}
): CloudflareBindings {
  return {
    ENVIRONMENT: "test",
    VERSION: "test-version",
    CORS_ORIGINS: "http://localhost:5173, https://quickdish.example.com",
    DB: fakeD1(),
    ...overrides
  } as CloudflareBindings;
}
