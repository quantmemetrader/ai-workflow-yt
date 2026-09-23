import { randomBytes } from "node:crypto";

/**
 * Time-sortable, prefixed ids: `usr_01k5m2v9x8qh4t7b3n0p6d1w2r`.
 *
 * ULID layout — 48-bit millisecond timestamp + 80 bits of randomness, encoded
 * in Crockford base32. Sortable by creation time, so a b-tree index on the
 * primary key is also a chronological index, and the prefix makes every id in
 * a log line self-describing.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let out = "";
  for (let i = 9; i >= 0; i--) {
    out = ALPHABET[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

export function ulid(now = Date.now()): string {
  return (encodeTime(now) + encodeRandom()).toLowerCase();
}

export type IdPrefix =
  | "usr" | "ses" | "team" | "inv" | "ntf" | "aud" | "tnt"
  | "fld" | "fil" | "ver" | "chk" | "tup"
  | "ch" | "msg" | "rct"
  | "cnv" | "am" | "cit" | "tc" | "use" | "bdg" | "kn"
  | "job"
  | "top" | "rep" | "cmt"
  | "chn" | "pm" | "cd"
  | "brf" | "scr" | "sv" | "sug"
  | "prj" | "beat" | "shot" | "rnd" | "gfx" | "cv"
  | "pch" | "post" | "tgt" | "trx" | "apr"
  | "doc" | "acct" | "bank" | "exp"
  | "bl" | "cf" | "req"
  | "tpl" | "con" | "rev" | "dep" | "comp"
  | "emp" | "lv" | "lvt" | "rq" | "app" | "cand" | "int";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid()}`;
}
