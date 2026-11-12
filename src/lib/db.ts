import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "../generated/prisma/client";

/**
 * Creates a Prisma Client bound to the request's D1 database.
 * Create one per request: Workers can't share it across requests.
 *
 * @example const prisma = createPrisma(c.env.DB);
 */
export function createPrisma(db: D1Database) {
  return new PrismaClient({ adapter: new PrismaD1(db) });
}

export type Prisma = ReturnType<typeof createPrisma>;
