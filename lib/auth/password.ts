import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/** promisify() drops the options overload, so it is written out here. */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });
}

/** scrypt with the parameters OWASP recommends (N=2^16, r=8, p=1, 64-byte
 * output). No native dependency, so the same code runs locally, on Vercel and
 * on the render box. The cost parameters are stored with the hash, so they can
 * be raised later without invalidating existing passwords. */
const N = 1 << 16;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: 256 * 1024 * 1024,
  });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt") return false;
  // A truncated or hand-edited row must answer "no", not throw: Buffer.from()
  // on an undefined field would turn a bad hash into a 500 at the sign-in form.
  if (!saltB64 || !keyB64 || !Number.isFinite(Number(n))) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  const key = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * A hash of 32 random bytes that were then thrown away, so no password matches
 * it. Sign-in verifies against this when the email is unknown, which is what
 * makes an unknown address cost the same scrypt work as a known one. Without
 * it, "no such user" returns after one database round trip and "wrong
 * password" returns ~100ms later, and the form becomes a way to find out who
 * works here. It is not a secret: it opens nothing.
 */
export const NO_SUCH_USER_HASH =
  "scrypt$65536$8$1$i4zE07_oFdXno9oNvCEXCA$IkWsZYdpUZf90ag_4r-B5NXNFDV5N6ogME7Zg3_nCurbAxZcsEKSizUXXdojccyrgshdJtvgVBjd5AEZ72Y2KA";

/** A password that is never guessed but can be typed out over the phone when
 * an admin sets someone up. */
export function generatePassword(): string {
  const words = randomBytes(9).toString("base64url").replace(/[-_]/g, "");
  return words.slice(0, 12);
}
