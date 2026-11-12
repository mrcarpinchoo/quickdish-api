/** Unique constraint failed (e.g. a repeated email). */
export const UNIQUE_VIOLATION = "P2002";
/** Foreign key constraint failed (e.g. deleting a row other rows depend on). */
export const FOREIGN_KEY_VIOLATION = "P2003";

/** True when `err` is a Prisma known request error with the given code. */
export function isPrismaError(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === code
  );
}
