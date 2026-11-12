import type { User } from "../src/generated/prisma/client";
import { signToken } from "../src/lib/jwt";
import { hashPassword } from "../src/lib/password";
import {
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION
} from "../src/lib/prisma-errors";
import { TEST_JWT_SECRET } from "./helpers";

type Where = { id?: string; email?: string };

function prismaError(code: string) {
  return Object.assign(new Error(`Prisma error ${code}`), { code });
}

/**
 * In-memory stand-in for the parts of Prisma Client the routes use.
 * Tests mock `createPrisma` to return `fakePrisma`.
 */
class FakePrisma {
  users: User[] = [];
  /** Ids of users that have orders: deleting them fails like the real FK. */
  usersWithOrders = new Set<string>();

  reset() {
    this.users = [];
    this.usersWithOrders.clear();
  }

  private find({ id, email }: Where) {
    return this.users.find(
      u =>
        (id === undefined || u.id === id) &&
        (email === undefined || u.email === email)
    );
  }

  user = {
    findUnique: ({ where }: { where: Where }) =>
      Promise.resolve(this.find(where) ?? null),

    findMany: () =>
      Promise.resolve(
        [...this.users].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        )
      ),

    create: ({
      data
    }: {
      data: Pick<User, "name" | "email" | "passwordHash"> & Partial<User>;
    }) => {
      if (this.find({ email: data.email })) {
        return Promise.reject(prismaError(UNIQUE_VIOLATION));
      }
      const user: User = {
        id: crypto.randomUUID(),
        role: "CUSTOMER",
        createdAt: new Date(),
        ...data
      };
      this.users.push(user);
      return Promise.resolve(user);
    },

    update: ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<User>;
    }) => {
      const user = this.find(where);
      if (!user) return Promise.reject(prismaError("P2025"));
      const other = data.email ? this.find({ email: data.email }) : undefined;
      if (other && other.id !== user.id) {
        return Promise.reject(prismaError(UNIQUE_VIOLATION));
      }
      Object.assign(user, data);
      return Promise.resolve(user);
    },

    delete: ({ where }: { where: { id: string } }) => {
      if (this.usersWithOrders.has(where.id)) {
        return Promise.reject(prismaError(FOREIGN_KEY_VIOLATION));
      }
      const user = this.find(where);
      if (!user) return Promise.reject(prismaError("P2025"));
      this.users = this.users.filter(u => u.id !== where.id);
      return Promise.resolve(user);
    }
  };
}

export const fakePrisma = new FakePrisma();

/**
 * Adds a user to the fake database and returns it with a valid token.
 * Uses few PBKDF2 iterations to keep the tests fast.
 */
export async function addUser({
  name = "Test User",
  email = "user@quickdish.test",
  password = "Password123",
  role = "CUSTOMER"
}: Partial<Pick<User, "name" | "email" | "role">> & {
  password?: string;
} = {}) {
  const user: User = {
    id: crypto.randomUUID(),
    name,
    email,
    role,
    passwordHash: await hashPassword(password, 1000),
    createdAt: new Date()
  };
  fakePrisma.users.push(user);
  const token = await signToken(user, TEST_JWT_SECRET);
  return { user, token };
}
