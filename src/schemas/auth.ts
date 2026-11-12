import { z } from "zod";

const email = z
  .email()
  .max(254)
  .transform(value => value.trim().toLowerCase());

const name = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  name,
  email,
  password: z.string().min(8).max(128)
});

export const loginSchema = z.object({
  email,
  // No length rules here: a wrong password must answer 401, not 400.
  password: z.string().min(1).max(128)
});

export const updateMeSchema = z
  .object({ name: name.optional(), email: email.optional() })
  .refine(data => data.name !== undefined || data.email !== undefined, {
    message: "Send at least one of name or email"
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
