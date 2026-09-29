/**
 * The script as a rich document (the Google-Docs-style 脚本 page) and the
 * beats every other part of the product reads.
 *
 * The document is TipTap/ProseMirror JSON, kept on `scripts.doc` (and its HTML
 * on `scripts.doc_html`, for Word/PDF export). `script_beats` stays the
 * source the video pipeline, the 剪辑 page, versions and approvals read — so
 * every save writes both, and the rule between them lives here, used by the
 * browser (copilot indexes, comment anchors) and the server (the beats) alike:
 *
 *   — every paragraph with words (or a shot note) is one spoken line: one
 *     beat, in document order, wherever it sits (top level, a list item, a
 *     checklist item, a quote);
 *   — headings are structure: they organise the page and the outline and
 *     are not spoken, so they are not beats;
 *   — a paragraph's shot note (画面说明) rides on the paragraph as the
 *     `shot` attribute and becomes the beat's `visual`; a paragraph with only
 *     a shot note is natural sound (no narration).
 *
 * When something else rewrites the beats (编剧's draft, an import, a restored
 * version), the stored document no longer matches them; the page then builds
 * the document afresh from the beats (`docForBeats`) — the words win.
 */

export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};

export type RichDoc = RichNode & { type: "doc" };

export type BeatLike = { visual: string; voiceover: string; subtitle?: string; naturalSound?: boolean };

export type SpokenUnit = { text: string; shot: string };

function textOf(n: RichNode): string {
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(textOf).join("");
}

/** The spoken lines of a document, in order (see the rule above). */
export function unitsOf(doc: RichNode | null | undefined): SpokenUnit[] {
  const out: SpokenUnit[] = [];
  const walk = (n: RichNode) => {
    if (n.type === "paragraph") {
      const text = textOf(n).replace(/\s+$/g, "");
      const shot = typeof n.attrs?.shot === "string" ? (n.attrs.shot as string).trim() : "";
      if (text.trim() || shot) out.push({ text, shot });
      return;
    }
    if (n.type === "heading") return;
    for (const c of n.content ?? []) walk(c);
  };
  if (doc) walk(doc);
  return out;
}

/** The beats a document stands for. */
export function beatsFromDoc(doc: RichNode | null | undefined): Required<BeatLike>[] {
  return unitsOf(doc).map((u) => ({ voiceover: u.text, visual: u.shot, subtitle: u.text, naturalSound: !u.text.trim() && Boolean(u.shot) }));
}

/** A plain document from beats: one paragraph per beat, the shot note on it. */
export function docFromBeats(beats: BeatLike[]): RichDoc {
  const content: RichNode[] = beats.map((b) => ({
    type: "paragraph",
    attrs: b.visual?.trim() ? { shot: b.visual.trim() } : {},
    ...(b.voiceover ? { content: [{ type: "text", text: b.voiceover }] } : {}),
  }));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const sig = (list: { voiceover: string; visual: string }[]) => list.map((b) => `${b.voiceover.trim()}\u0001${b.visual.trim()}`).join("\u0002");

/** Whether a stored document still says what the beats say. */
export function docMatchesBeats(doc: RichNode | null | undefined, beats: BeatLike[]): boolean {
  if (!doc) return false;
  const fromDoc = beatsFromDoc(doc);
  const real = beats.filter((b) => b.voiceover.trim() || b.visual?.trim());
  return sig(fromDoc) === sig(real.map((b) => ({ voiceover: b.voiceover, visual: b.visual ?? "" })));
}

/** The document the page opens: the stored one if it still matches, else one built from the beats. */
export function docForBeats(doc: RichNode | null | undefined, beats: BeatLike[]): RichDoc {
  if (doc && doc.type === "doc" && docMatchesBeats(doc, beats)) return doc as RichDoc;
  return docFromBeats(beats.filter((b) => b.voiceover.trim() || b.visual?.trim()).length ? beats : []);
}

/** A shallow sanity check on a document the browser sent. */
export function isRichDoc(v: unknown): v is RichDoc {
  return Boolean(v && typeof v === "object" && (v as RichNode).type === "doc" && Array.isArray((v as RichNode).content ?? []));
}

/**
 * The same document with new words for its spoken lines (in `unitsOf`
 * order): a line whose words changed gets them as plain text, keeping its
 * shot note; a line emptied that has no shot note goes. Headings and the
 * lines not touched stay as they were. For edits made outside the page
 * (the chat's 直接编辑).
 */
export function withUnitTexts(doc: RichDoc, texts: string[]): RichDoc {
  let i = 0;
  const walk = (n: RichNode): RichNode | null => {
    if (n.type === "paragraph") {
      const text = textOf(n).replace(/\s+$/g, "");
      const shot = typeof n.attrs?.shot === "string" ? (n.attrs.shot as string).trim() : "";
      if (!text.trim() && !shot) return n;
      const next = texts[i++];
      if (next === undefined || next === text) return n;
      if (!next.trim() && !shot) return null;
      return { ...n, content: next ? [{ type: "text", text: next }] : undefined };
    }
    if (n.type === "heading" || !n.content) return n;
    return { ...n, content: n.content.map(walk).filter((c): c is RichNode => c !== null) };
  };
  const out = walk(doc) as RichDoc;
  return out.content && out.content.length ? out : { type: "doc", content: [{ type: "paragraph" }] };
}
