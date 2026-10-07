/**
 * 视频号 files, made playable.
 *
 * WeChat Channels serves every video with its first 128 KB scrambled: XORed
 * with a keystream that WeChat's own player makes in WASM from the
 * `decode_key` the detail API hands out beside the file address (TikHub's
 * `fetch_video_detail` returns both, from the same answer — a key from one
 * request does not open the file of another). The rest of the file is plain
 * MP4. The keystream is ISAAC64 seeded with the key, read out as big-endian
 * 64-bit words, which is what WeChat's WASM computes; doing it here means no
 * browser, no WASM and no third-party decrypt service.
 *
 * BigInt arithmetic, masked to 64 bits after every step. 128 KB is 16 384
 * words — a few milliseconds, once a download.
 */

export const WECHAT_SCRAMBLED_BYTES = 131072;

/* BigInt("…") rather than 1n literals: the project compiles to a target older than ES2020. */
const MASK = (BigInt("1") << BigInt("64")) - BigInt("1");
const SIZE = 256;

class Isaac64 {
  private mm = new Array<bigint>(SIZE).fill(BigInt("0"));
  private rsl = new Array<bigint>(SIZE).fill(BigInt("0"));
  private aa = BigInt("0");
  private bb = BigInt("0");
  private cc = BigInt("0");
  private count = 0;

  constructor(seed: bigint) {
    this.rsl[0] = seed & MASK;
    this.init();
  }

  private generate() {
    const mm = this.mm;
    let a = this.aa;
    this.cc = (this.cc + BigInt("1")) & MASK;
    let b = (this.bb + this.cc) & MASK;
    const step = (i: number, mix: bigint, j: number) => {
      const x = mm[i];
      a = (mix + mm[j]) & MASK;
      const y = (mm[Number((x >> BigInt("3")) & BigInt("255"))] + a + b) & MASK;
      mm[i] = y;
      b = (mm[Number((y >> BigInt("11")) & BigInt("255"))] + x) & MASK;
      this.rsl[i] = b;
    };
    const half = SIZE / 2;
    for (let pass = 0; pass < 2; pass++) {
      const from = pass === 0 ? 0 : half;
      const other = pass === 0 ? half : 0;
      for (let k = 0; k < half; k += 4) {
        const i = from + k;
        const j = other + k;
        step(i, ~(a ^ ((a << BigInt("21")) & MASK)) & MASK, j);
        step(i + 1, a ^ (a >> BigInt("5")), j + 1);
        step(i + 2, a ^ ((a << BigInt("12")) & MASK), j + 2);
        step(i + 3, a ^ (a >> BigInt("33")), j + 3);
      }
    }
    this.aa = a;
    this.bb = b;
    this.count = SIZE;
  }

  private init() {
    const v = new Array<bigint>(8).fill(BigInt("0x9e3779b97f4a7c13"));
    const mix = () => {
      v[0] = (v[0] - v[4]) & MASK; v[5] ^= v[7] >> BigInt("9"); v[7] = (v[7] + v[0]) & MASK;
      v[1] = (v[1] - v[5]) & MASK; v[6] ^= (v[0] << BigInt("9")) & MASK; v[0] = (v[0] + v[1]) & MASK;
      v[2] = (v[2] - v[6]) & MASK; v[7] ^= v[1] >> BigInt("23"); v[1] = (v[1] + v[2]) & MASK;
      v[3] = (v[3] - v[7]) & MASK; v[0] ^= (v[2] << BigInt("15")) & MASK; v[2] = (v[2] + v[3]) & MASK;
      v[4] = (v[4] - v[0]) & MASK; v[1] ^= v[3] >> BigInt("14"); v[3] = (v[3] + v[4]) & MASK;
      v[5] = (v[5] - v[1]) & MASK; v[2] ^= (v[4] << BigInt("20")) & MASK; v[4] = (v[4] + v[5]) & MASK;
      v[6] = (v[6] - v[2]) & MASK; v[3] ^= v[5] >> BigInt("17"); v[5] = (v[5] + v[6]) & MASK;
      v[7] = (v[7] - v[3]) & MASK; v[4] ^= (v[6] << BigInt("14")) & MASK; v[6] = (v[6] + v[7]) & MASK;
    };
    for (let i = 0; i < 4; i++) mix();
    for (const source of [this.rsl, this.mm]) {
      for (let i = 0; i < SIZE; i += 8) {
        for (let k = 0; k < 8; k++) v[k] = (v[k] + source[i + k]) & MASK;
        mix();
        for (let k = 0; k < 8; k++) this.mm[i + k] = v[k];
      }
    }
    this.generate();
  }

  /** The reference `rand()`: the results are read from the end backwards. */
  next(): bigint {
    if (this.count === 0) this.generate();
    this.count -= 1;
    return this.rsl[this.count];
  }
}

/** The 128 KB a 视频号 file's head is XORed with, for one `decode_key`. */
export function wechatKeystream(decodeKey: string): Buffer {
  const rng = new Isaac64(BigInt(decodeKey));
  const out = Buffer.alloc(WECHAT_SCRAMBLED_BYTES);
  for (let off = 0; off < WECHAT_SCRAMBLED_BYTES; off += 8) out.writeBigUInt64BE(rng.next(), off);
  return out;
}

/** Unscramble a file's head in place. True when the result reads as an MP4. */
export function unscrambleWechatHead(head: Buffer, decodeKey: string): boolean {
  const key = wechatKeystream(decodeKey);
  const n = Math.min(head.length, key.length);
  for (let i = 0; i < n; i++) head[i] ^= key[i];
  return head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp";
}
