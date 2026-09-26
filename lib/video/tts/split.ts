import type { SpeakSentence } from "./types";

/**
 * Narration text into the sentences it is spoken in.
 *
 * Pure, so it is the same rule in the worker, in a test and in the editor's
 * character count.
 *
 * Why sentences and not the whole text in one call: Kokoro (and most small
 * TTS models) were trained on sentence-length inputs and rush anything much
 * longer, and one sentence per call is also what gives every sentence its own
 * timing for the captions. The pause between them is ours, not the model's,
 * so it is the same every time:
 *
 *   - a blank line is a paragraph (a script beat): 700 ms after it;
 *   - a sentence inside a paragraph: 380 ms;
 *   - a sentence that ends on a question or an exclamation keeps a little
 *     more, because that is where a reader lets the line land.
 *
 * A sentence past `maxLen` characters is cut at the comma nearest its middle,
 * and a fragment under four characters ("对。") joins the one before it so it
 * is not read as a sentence of its own.
 */
export const PAUSE = { sentence: 380, paragraph: 700, emphasis: 480 } as const;

export function splitNarration(text: string, opts: { maxLen?: number } = {}): SpeakSentence[] {
  const maxLen = opts.maxLen ?? 90;
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: SpeakSentence[] = [];
  paragraphs.forEach((para, paragraph) => {
    const sentences: string[] = [];
    for (const line of para.split(/\n+/)) {
      let buf = "";
      for (const piece of line.split(/(?<=[。！？!?；;…])/)) {
        const s = piece.trim();
        if (!s) continue;
        if (buf && s.replace(/[\s\p{P}]/gu, "").length < 4) {
          buf += s;
          continue;
        }
        if (buf) sentences.push(buf);
        buf = s;
      }
      if (buf) sentences.push(buf);
    }
    const halved = sentences.flatMap((s) => halve(s, maxLen));
    halved.forEach((s, i) => {
      const last = i === halved.length - 1;
      out.push({
        text: s,
        paragraph,
        pauseMs: last ? PAUSE.paragraph : /[？！?!]$/.test(s) ? PAUSE.emphasis : PAUSE.sentence,
      });
    });
  });
  return out;
}

function halve(s: string, maxLen: number): string[] {
  if (s.length <= maxLen) return [s];
  const cuts = [...s.matchAll(/[，、,：:]/g)].map((m) => (m.index ?? 0) + 1);
  if (!cuts.length) return [s];
  const mid = s.length / 2;
  const at = cuts.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best), cuts[0]);
  if (at <= 4 || at >= s.length - 4) return [s];
  return [...halve(s.slice(0, at), maxLen), ...halve(s.slice(at), maxLen)];
}

/**
 * The narration a script's beats add up to: every beat's 旁白 (voiceover)
 * that has words and is not marked natural sound, one paragraph per beat.
 * `beatOrds[n]` is the beat the n-th paragraph came from, so a cut timed to
 * the narration can still tell which beat's pictures belong where.
 */
export function narrationFromBeats(
  beats: { ord: number; voiceover: string; naturalSound?: boolean | null }[],
): { text: string; beatOrds: number[] } {
  const used = beats
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .filter((b) => !b.naturalSound && b.voiceover.trim())
    .map((b) => ({ ord: b.ord, text: cleanVoiceover(b.voiceover) }))
    .filter((b) => b.text);
  return { text: used.map((b) => b.text).join("\n\n"), beatOrds: used.map((b) => b.ord) };
}

/**
 * What a writer puts in a VO cell that must not be read aloud: stage
 * directions in brackets ("（停顿）", "[music up]"), a speaker tag at the
 * start ("旁白：", "VO:"), and markdown emphasis.
 */
export function cleanVoiceover(s: string): string {
  return s
    .replace(/[（(【\[][^）)】\]]{0,24}[）)】\]]/g, "")
    .replace(/^\s*(?:旁白|画外音|配音|VO|V\.O\.|Narrator)\s*[:：]\s*/i, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Characters a read will say, for the counter under the box. */
export function spokenLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}
