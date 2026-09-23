import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/lib/env";

/**
 * Two-step verification: RFC 6238 TOTP, written out rather than pulled in.
 *
 * It is thirty lines of HMAC and a base32 alphabet, and the alternative was a
 * dependency that sits in the sign-in path forever. What is *not* written out
 * is the QR image — that is a real encoder with Reed-Solomon in it, and
 * `qrcode` does it properly.
 *
 * Four decisions worth stating, because each of them is a way this is usually
 * got wrong:
 *
 *   — **The shared secret is encrypted at rest.** A database leak that hands
 *     out TOTP seeds is a leak that hands out second factors. AES-256-GCM,
 *     with a key derived from `SESSION_SECRET` (or `TOTP_KEY`, if the studio
 *     would rather keep the two separate). Rotating that secret makes every
 *     enrolled authenticator unreadable, which is why the enrolment row keeps
 *     its own version marker and `open()` returns null rather than throwing.
 *   — **A code can be used once.** The step it came from is written to the
 *     user row, and a step that has already been spent is refused. Without
 *     this, a code read over somebody's shoulder is good for the rest of its
 *     thirty seconds on a second browser.
 *   — **One step of drift either way**, and no more. Thirty seconds of slack
 *     covers a phone with a lazy clock; a wider window is a longer guessing
 *     window for the same six digits.
 *   — **Recovery codes are hashed** the same way a password is, because that
 *     is exactly what they are: a string that signs somebody in.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/* ------------------------------------------------------------------ base32 */

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const raw of text.replace(/=+$/, "").toUpperCase()) {
    if (raw === " " || raw === "-") continue;
    const index = ALPHABET.indexOf(raw);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* -------------------------------------------------------------------- totp */

/** A fresh 160-bit secret, in the base32 an authenticator app expects. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepFor(atMs = Date.now()): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

export function codeFor(secret: string, step: number): string | null {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(counter).digest();

  // RFC 4226 dynamic truncation.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Check a typed code. Returns the step it matched, so the caller can record
 * it and refuse the same code a second time; null when nothing matches.
 */
export function verifyCode(
  secret: string,
  typed: string,
  opts: { atMs?: number; window?: number; usedStep?: number | null } = {},
): number | null {
  const clean = typed.replace(/\D/g, "");
  if (clean.length !== DIGITS) return null;

  const window = opts.window ?? 1;
  const now = stepFor(opts.atMs);

  for (let drift = -window; drift <= window; drift++) {
    const step = now + drift;
    if (opts.usedStep != null && step <= opts.usedStep) continue;
    const expected = codeFor(secret, step);
    if (!expected) return null;
    // Both are six ASCII digits, so the lengths always match.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

/** What goes in the QR code, and what a person types in by hand. */
export function otpauthUrl(secret: string, account: string, issuer = "腾亚创变"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* --------------------------------------------------------------- at rest */

function key(): Buffer {
  /* `TOTP_KEY` if the studio set one, otherwise derived from the session
     secret — one secret to look after rather than two, at the cost that
     rotating it means everybody re-enrols. HKDF rather than the raw value so
     the signing key and the encryption key are not literally the same bytes. */
  const raw = process.env.TOTP_KEY || env.sessionSecret;
  return Buffer.from(hkdfSync("sha256", Buffer.from(raw), Buffer.alloc(0), Buffer.from("totp-secret-v1"), 32));
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function seal(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** null for anything that does not open — a rotated key, a truncated row. */
export function open(sealed: string | null): string | null {
  if (!sealed) return null;
  const [version, ivB64, tagB64, bodyB64] = sealed.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !bodyB64) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- recovery codes */

/**
 * Ten of them, in the shape people expect (`4f2k-9xqa`). 50 bits each, from
 * an alphabet with no 0/1/l/o in it, because these get read off paper.
 */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = randomBytes(10);
    let text = "";
    for (let j = 0; j < 10; j++) text += RECOVERY_ALPHABET[bytes[j] % RECOVERY_ALPHABET.length];
    codes.push(`${text.slice(0, 5)}-${text.slice(5)}`);
  }
  return codes;
}

/** Stored hashed. 50 bits of entropy from a CSPRNG needs no stretching, so
 * this is a plain digest rather than scrypt — and it is compared in constant
 * time like everything else here. */
export function hashRecovery(code: string): string {
  return createHash("sha256").update(normaliseRecovery(code)).digest("base64url");
}

export function normaliseRecovery(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchRecovery(code: string, hashes: string[]): string | null {
  const typed = Buffer.from(hashRecovery(code));
  for (const stored of hashes) {
    const candidate = Buffer.from(stored);
    if (candidate.length === typed.length && timingSafeEqual(candidate, typed)) return stored;
  }
  return null;
}
