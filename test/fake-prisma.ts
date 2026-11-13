import type { Category, Product, User } from "../src/generated/prisma/client";
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
    this.categories = [];
    this.products = [];
    this.productsWithOrders.clear();
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
      Object.assign(user, defined(data));
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

  categories: Category[] = [];
  products: Product[] = [];
  /** Ids of products in past orders: deleting them fails like the real FK. */
  productsWithOrders = new Set<string>();

  private findCategory(id: string) {
    return this.categories.find(c => c.id === id);
  }

  private nameTaken(name: string, exceptId?: string) {
    return this.categories.some(c => c.name === name && c.id !== exceptId);
  }

  category = {
    findMany: ({ where }: { where: { active?: boolean } }) =>
      Promise.resolve(
        this.categories
          .filter(c => where.active === undefined || c.active === where.active)
          .sort(byName)
      ),

    findUnique: ({ where }: { where: { id: string } }) =>
      Promise.resolve(this.findCategory(where.id) ?? null),

    create: ({ data }: { data: Omit<Category, "id"> }) => {
      if (this.nameTaken(data.name)) {
        return Promise.reject(prismaError(UNIQUE_VIOLATION));
      }
      const category: Category = { id: crypto.randomUUID(), ...data };
      this.categories.push(category);
      return Promise.resolve(category);
    },

    update: ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<Category>;
    }) => {
      const category = this.findCategory(where.id);
      if (!category) return Promise.reject(prismaError("P2025"));
      if (data.name && this.nameTaken(data.name, category.id)) {
        return Promise.reject(prismaError(UNIQUE_VIOLATION));
      }
      Object.assign(category, defined(data));
      return Promise.resolve(category);
    },

    delete: ({ where }: { where: { id: string } }) => {
      if (this.products.some(p => p.categoryId === where.id)) {
        return Promise.reject(prismaError(FOREIGN_KEY_VIOLATION));
      }
      const category = this.findCategory(where.id);
      if (!category) return Promise.reject(prismaError("P2025"));
      this.categories = this.categories.filter(c => c.id !== where.id);
      return Promise.resolve(category);
    }
  };

  private findProduct(id: string) {
    return this.products.find(p => p.id === id);
  }

  product = {
    count: ({ where }: { where: { categoryId: string } }) =>
      Promise.resolve(
        this.products.filter(p => p.categoryId === where.categoryId).length
      ),

    findMany: ({ where }: { where: ProductWhere }) =>
      Promise.resolve(
        this.products
          .filter(
            p =>
              (where.categoryId === undefined ||
                p.categoryId === where.categoryId) &&
              (where.available === undefined ||
                p.available === where.available) &&
              // SQLite LIKE is case-insensitive for ASCII.
              (where.name === undefined ||
                p.name
                  .toLowerCase()
                  .includes(where.name.contains.toLowerCase())) &&
              (where.category === undefined ||
                this.findCategory(p.categoryId)?.active ===
                  where.category.active)
          )
          .sort(byName)
      ),

    findUnique: ({ where }: { where: { id: string } }) => {
      const product = this.findProduct(where.id);
      if (!product) return Promise.resolve(null);
      const category = this.findCategory(product.categoryId);
      if (!category) throw new Error("Product without category");
      return Promise.resolve({ ...product, category });
    },

    create: ({ data }: { data: Omit<Product, "id"> }) => {
      if (!this.findCategory(data.categoryId)) {
        return Promise.reject(prismaError(FOREIGN_KEY_VIOLATION));
      }
      const product: Product = { id: crypto.randomUUID(), ...data };
      this.products.push(product);
      return Promise.resolve(product);
    },

    update: ({
      where,
      data
    }: {
      where: { id: string };
      data: Partial<Product>;
    }) => {
      const product = this.findProduct(where.id);
      if (!product) return Promise.reject(prismaError("P2025"));
      Object.assign(product, defined(data));
      return Promise.resolve(product);
    },

    delete: ({ where }: { where: { id: string } }) => {
      if (this.productsWithOrders.has(where.id)) {
        return Promise.reject(prismaError(FOREIGN_KEY_VIOLATION));
      }
      const product = this.findProduct(where.id);
      if (!product) return Promise.reject(prismaError("P2025"));
      this.products = this.products.filter(p => p.id !== where.id);
      return Promise.resolve(product);
    }
  };
}

type ProductWhere = {
  categoryId?: string;
  available?: boolean;
  name?: { contains: string };
  category?: { active: boolean };
};

/** Prisma ignores `undefined` fields in `data`; `null` clears them. */
function defined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
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

/** Adds a category to the fake database. */
export function addCategory(data: Partial<Category> = {}): Category {
  const category: Category = {
    id: crypto.randomUUID(),
    name: `Category ${fakePrisma.categories.length + 1}`,
    description: null,
    active: true,
    ...data
  };
  fakePrisma.categories.push(category);
  return category;
}

/** Adds a product to the fake database. */
export function addProduct(
  data: Partial<Product> & Pick<Product, "categoryId">
): Product {
  const product: Product = {
    id: crypto.randomUUID(),
    name: `Product ${fakePrisma.products.length + 1}`,
    description: null,
    priceCents: 3500,
    imageUrl: null,
    available: true,
    ...data
  };
  fakePrisma.products.push(product);
  return product;
}
