import { sign, verify } from "hono/jwt";

export type Role = "CUSTOMER" | "ADMIN";

/** User identity carried by the token and set on `c.var.user`. */
export type AuthUser = {
  id: string;
  role: Role;
};

/** Token lifetime: 8 hours. */
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

const ALG = "HS256";

/** Signs a JWT with `sub`, `role`, `iat` and `exp`. */
export function signToken(
  user: AuthUser,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): Promise<string> {
  return sign(
    { sub: user.id, role: user.role, iat: now, exp: now + TOKEN_TTL_SECONDS },
    secret,
    ALG
  );
}

/**
 * Verifies the signature and expiry of a token and returns its user.
 * Throws when the token is invalid, expired or has an unexpected payload.
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<AuthUser> {
  const payload = await verify(token, secret, ALG);
  const { sub, role } = payload;
  if (typeof sub !== "string" || (role !== "CUSTOMER" && role !== "ADMIN")) {
    throw new Error("Invalid token payload");
  }
  return { id: sub, role };
}
