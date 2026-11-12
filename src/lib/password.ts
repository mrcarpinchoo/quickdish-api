/**
 * Password hashing with PBKDF2-SHA256 through Web Crypto (`crypto.subtle`),
 * which works in Workers without native addons.
 *
 * Stored format: `pbkdf2$<iterations>$<salt base64>$<hash base64>`.
 * The iteration count travels with each hash, so it can be tuned later
 * without breaking existing passwords.
 */

/**
 * Kept low on purpose: the Workers free plan allows ~10 ms of CPU per request
 * and workerd rejects more than 100,000 iterations. Measure login CPU time in
 * Dev before raising it.
 */
export const PBKDF2_ITERATIONS = 10_000;

const SALT_BYTES = 16;
const HASH_BITS = 256;
const PREFIX = "pbkdf2";

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS
  );
  return new Uint8Array(bits);
}

/** Compares two byte arrays in constant time to avoid timing leaks. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Hashes a password with a random salt. Never store the plain password. */
export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return [PREFIX, iterations, toBase64(salt), toBase64(hash)].join("$");
}

/** Checks a password against a stored hash. Malformed hashes never match. */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [prefix, iterationsText, saltText, hashText] = stored.split("$");
  const iterations = Number(iterationsText);
  if (
    prefix !== PREFIX ||
    !Number.isInteger(iterations) ||
    iterations <= 0 ||
    !saltText ||
    !hashText
  ) {
    return false;
  }

  try {
    const expected = fromBase64(hashText);
    const actual = await derive(password, fromBase64(saltText), iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
