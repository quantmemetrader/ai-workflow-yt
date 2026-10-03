/**
 * Clause review's comparison, kept apart from the database so it can be
 * checked on its own (`reviewContract` in `./service` is the caller).
 *
 * Clauses are found by their numbered headings: "3. Fee." in the English
 * templates, "第三条　报酬" (or "3、") in the Chinese one. Both become key "3".
 *
 * QA, 4 Oct: text outside the numbered clauses was never compared, so a
 * reversed sentence in the preamble ("授权人不同意…") went unreported. The
 * text before the first clause (title, party block, recitals) is now the
 * section `preamble`, and the signing block after the last clause is the
 * section `closing`; both are compared like any clause.
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

/** The section before the first numbered clause: title, parties, recitals. */
export const PREAMBLE = "preamble";
/** The section after the last numbered clause: the signing block. */
export const CLOSING = "closing";

/* Where the signing block starts: a line that opens with somebody's signature
   ("授权人签署：", "被授权方签字：", "Signed:", "Signature:") or with
   "IN WITNESS". Only looked for after the last numbered heading, so a clause
   that mentions signing never ends early. */
const CLOSING_START = /^\s*(?:[^\s：:，。]{0,10}(?:签署|签字|签名|盖章)\s*[：:]|(?:signed|signature)\b.*[:_]|in witness\b)/i;

/** Numbered clauses → their text, heading line included after the number;
 * plus `preamble` and `closing` when there is text outside the clauses. */
export function splitClauses(body: string): Map<string, string> {
  const lines = body.split("\n");
  const heading = (line: string): number | null => {
    const en = line.match(HEADING_EN);
    if (en) return Number(en[1]);
    const zh = line.match(HEADING_ZH);
    const n = zh ? chineseNumber(zh[1] ?? zh[2]) : null;
    return n !== null && n > 0 ? n : null;
  };
  const headingText = (line: string) => line.match(HEADING_EN)?.[2] ?? line.match(HEADING_ZH)?.[3] ?? "";

  let lastHeading = -1;
  lines.forEach((line, i) => {
    if (heading(line) !== null) lastHeading = i;
  });
  let closingAt = lines.length;
  if (lastHeading >= 0) {
    for (let i = lastHeading + 1; i < lines.length; i += 1) {
      if (CLOSING_START.test(lines[i])) {
        closingAt = i;
        break;
      }
    }
  }

  const out = new Map<string, string>();
  let key: string | null = PREAMBLE;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (key && (text || (key !== PREAMBLE && key !== CLOSING))) out.set(key, text);
    buffer = [];
  };

  lines.forEach((line, i) => {
    if (i === closingAt) {
      flush();
      key = CLOSING;
      buffer = [line];
      return;
    }
    const n = i < closingAt ? heading(line) : null;
    if (n !== null) {
      flush();
      key = String(n);
      buffer = [headingText(line)];
    } else {
      buffer.push(line);
    }
  });
  flush();
  return out;
}

/** Preamble first, the numbered clauses in order, the signing block last. */
export function clauseOrder(a: string, b: string): number {
  const rank = (k: string) => (k === PREAMBLE ? -1 : k === CLOSING ? Number.MAX_SAFE_INTEGER : Number(k));
  return rank(a) - rank(b);
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/* Letters and digits in any script. `\W` would count every Chinese character
   as punctuation, and any Chinese rewording would read as "reworded". */
const wordsOnly = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/** Where `contract` departs from `template` (both already filled), clause by clause. */
export function compareClauses(template: string, contract: string): ClauseDiff[] {
  const a = splitClauses(template);
  const b = splitClauses(contract);
  const out: ClauseDiff[] = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort(clauseOrder)) {
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
