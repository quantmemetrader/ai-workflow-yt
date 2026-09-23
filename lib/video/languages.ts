/**
 * Which caption track leads.
 *
 * A bilingual cut has two tracks with the same timings, and "the first one"
 * out of a list ordered by time was whichever the database happened to hand
 * back, which changed from one poll to the next and swapped the preview's
 * language every few seconds. One rule, used by the preview, the caption
 * editor and the export picker alike: the language the cut was made in when
 * it is known, otherwise Chinese (the channel's own), otherwise the first
 * alphabetically.
 */
export function primaryLanguage(captions: { language: string }[], preferred?: string | null): string | null {
  const langs = [...new Set(captions.map((c) => c.language))];
  if (!langs.length) return null;
  if (preferred && langs.includes(preferred)) return preferred;
  return langs.find((l) => /^zh/i.test(l)) ?? langs.sort()[0];
}

/** The same list, the leading language first. */
export function languagesInOrder(captions: { language: string }[], preferred?: string | null): string[] {
  const first = primaryLanguage(captions, preferred);
  const rest = [...new Set(captions.map((c) => c.language))].filter((l) => l !== first).sort();
  return first ? [first, ...rest] : rest;
}
