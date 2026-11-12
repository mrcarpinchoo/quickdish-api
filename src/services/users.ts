import type { User } from "../generated/prisma/client";
import type { Prisma } from "../lib/db";
import { isPrismaError, UNIQUE_VIOLATION } from "../lib/prisma-errors";
import { ApiError } from "../lib/errors";
import { hashPassword, verifyPassword } from "../lib/password";
import type { LoginInput, RegisterInput, UpdateMeInput } from "../schemas/auth";

/** User as returned by the API: never includes the password hash. */
export type PublicUser = Pick<
  User,
  "id" | "name" | "email" | "role" | "createdAt"
>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function emailTaken(): ApiError {
  return new ApiError(409, "EMAIL_TAKEN", "Email is already registered");
}

/** Creates a customer account. Repeated email → 409. */
export async function registerUser(
  prisma: Prisma,
  input: RegisterInput
): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email }
  });
  if (existing) throw emailTaken();

  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash }
    });
  } catch (err) {
    // Two registrations with the same email at the same time.
    if (isPrismaError(err, UNIQUE_VIOLATION)) throw emailTaken();
    throw err;
  }
}

/**
 * Checks email and password. Any mismatch → 401 with the same generic
 * message, so the response doesn't reveal which emails exist.
 */
export async function authenticate(
  prisma: Prisma,
  input: LoginInput
): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  return user;
}

/** Loads a user by id. Missing → 404. */
export async function getUser(prisma: Prisma, id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
  return user;
}

/** Updates the name and/or email of a user. Email in use → 409. */
export async function updateUser(
  prisma: Prisma,
  id: string,
  input: UpdateMeInput
): Promise<User> {
  await getUser(prisma, id);
  try {
    return await prisma.user.update({ where: { id }, data: input });
  } catch (err) {
    if (isPrismaError(err, UNIQUE_VIOLATION)) throw emailTaken();
    throw err;
  }
}
