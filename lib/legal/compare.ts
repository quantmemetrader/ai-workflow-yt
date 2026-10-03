/**
 * Clause review's comparison, kept apart from the database so it can be
 * checked on its own (`reviewContract` in `./service` is the caller).
 *
 * Clauses are found by their numbered headings: "3. Fee." in the English
 * templates, "第三条　报酬" (or "3、") in the Chinese one. Both become key "3".
 */

export type Departure = "missing" | "added" | "changed" | "reworded";

export type ClauseDiff = {
  clause: string;
  departure: Departure;
  templateText: string | null;
  contractText: string | null;
  explanation: string;
};

const DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 一 → 1, 十一 → 11, 二十 → 20, 二十三 → 23. Up to 99, which is plenty for a contract. */
export function chineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[零〇一二两三四五六七八九十]+$/.test(s)) return null;
  const at = s.indexOf("十");
  if (at === -1) return s.length === 1 ? (DIGIT[s] ?? null) : null;
  const tens = at === 0 ? 1 : (DIGIT[s.slice(0, at)] ?? NaN);
  const ones = at === s.length - 1 ? 0 : (DIGIT[s.slice(at + 1)] ?? NaN);
  const n = tens * 10 + ones;
  return Number.isFinite(n) ? n : null;
}

const HEADING_EN = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const HEADING_ZH = /^\s*(?:第\s*([零〇一二两三四五六七八九十\d]{1,4})\s*条|(\d{1,2})\s*[、．])[\s　]*(.*)$/;

/** Numbered clauses → their text, heading line included after the number. */
export function splitClauses(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (key) out.set(key, buffer.join("\n").trim());
    buffer = [];
  };

  for (const line of body.split("\n")) {
    const en = line.match(HEADING_EN);
    const zh = en ? null : line.match(HEADING_ZH);
    const n = en ? Number(en[1]) : zh ? chineseNumber(zh[1] ?? zh[2]) : null;
    if (n !== null && n > 0) {
      flush();
      key = String(n);
      buffer = [en ? en[2] : (zh?.[3] ?? "")];
    } else if (key) {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/* Letters and digits in any script. `\W` would count every Chinese character
   as punctuation, and any Chinese rewording would read as "reworded". */
const wordsOnly = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
const byClauseNumber = (a: string, b: string) => Number(a) - Number(b);

/** Where `contract` departs from `template` (both already filled), clause by clause. */
export function compareClauses(template: string, contract: string): ClauseDiff[] {
  const a = splitClauses(template);
  const b = splitClauses(contract);
  const out: ClauseDiff[] = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort(byClauseNumber)) {
    const t = a.get(key) ?? null;
    const c = b.get(key) ?? null;
    if (t !== null && c === null) {
      out.push({ clause: key, departure: "missing", templateText: t, contractText: null, explanation: "The template has this clause and the contract does not." });
    } else if (t === null && c !== null) {
      out.push({ clause: key, departure: "added", templateText: null, contractText: c, explanation: "The contract has a clause the template does not." });
    } else if (t !== null && c !== null) {
      const nt = normalise(t);
      const nc = normalise(c);
      if (nt === nc) continue;
      const reworded = wordsOnly(nt) === wordsOnly(nc);
      out.push({
        clause: key,
        departure: reworded ? "reworded" : "changed",
        templateText: t,
        contractText: c,
        explanation: reworded ? "The same words, punctuated or spaced differently." : "The wording differs from the template.",
      });
    }
  }
  return out;
}
