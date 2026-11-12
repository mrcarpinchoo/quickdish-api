import { Hono } from "hono";
import { createPrisma } from "../lib/db";
import { FOREIGN_KEY_VIOLATION, isPrismaError } from "../lib/prisma-errors";
import { ApiError } from "../lib/errors";
import { validate } from "../lib/validation";
import { requireAuth, requireRole } from "../middleware/auth";
import { updateMeSchema } from "../schemas/auth";
import { getUser, toPublicUser, updateUser } from "../services/users";
import type { AppEnv } from "../types";

const users = new Hono<AppEnv>();

users.use("*", requireAuth);

/** GET /users/me → profile of the current user. */
users.get("/me", async c => {
  const user = await getUser(createPrisma(c.env.DB), c.var.user.id);
  return c.json(toPublicUser(user));
});

/** PATCH /users/me with `{ name?, email? }`. Email in use → 409. */
users.patch("/me", validate("json", updateMeSchema), async c => {
  const user = await updateUser(
    createPrisma(c.env.DB),
    c.var.user.id,
    c.req.valid("json")
  );
  return c.json(toPublicUser(user));
});

/** GET /users → every user, newest first (admin). */
users.get("/", requireRole("ADMIN"), async c => {
  const list = await createPrisma(c.env.DB).user.findMany({
    orderBy: { createdAt: "desc" }
  });
  return c.json(list.map(toPublicUser));
});

/**
 * DELETE /users/:id → 204 (admin).
 * An admin can't delete themselves, and users with orders are kept (409).
 */
users.delete("/:id", requireRole("ADMIN"), async c => {
  const id = c.req.param("id");
  if (id === c.var.user.id) {
    throw new ApiError(409, "CANNOT_DELETE_SELF", "You can't delete yourself");
  }

  const prisma = createPrisma(c.env.DB);
  await getUser(prisma, id);
  try {
    await prisma.user.delete({ where: { id } });
  } catch (err) {
    if (isPrismaError(err, FOREIGN_KEY_VIOLATION)) {
      throw new ApiError(
        409,
        "USER_HAS_ORDERS",
        "User has orders and can't be deleted"
      );
    }
    throw err;
  }
  return c.body(null, 204);
});

export default users;
