import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * The editor pieces the Google-Docs-style script page adds to TipTap:
 *
 *   BlockExtras   paragraph/heading attributes Docs has and TipTap does not:
 *                 the shot note (画面说明, `shot`), indentation (`indent`) and
 *                 paragraph line spacing (`lineHeight`)
 *   Highlights    decorations for the page's own marks, all computed, none
 *                 stored in the document: comment quotes (yellow), find
 *                 matches (orange, the current one darker), and 编剧's tracked
 *                 changes (old text struck through in red, the new text as a
 *                 green widget with 接受 / 拒绝)
 *
 * And the one rule shared with `lib/script/rich.ts`: the spoken lines are the
 * paragraphs with words or a shot note, in document order (`spokenUnits`).
 */

export const BlockExtras = Extension.create({
  name: "blockExtras",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          shot: {
            default: null,
            /* A new paragraph made with Enter starts without the shot note. */
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-shot"),
            renderHTML: (a: Record<string, unknown>) => (a.shot ? { "data-shot": String(a.shot) } : {}),
          },
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-indent") || 0),
            renderHTML: (a: Record<string, unknown>) => (Number(a.indent) > 0 ? { "data-indent": String(a.indent), style: `margin-left: ${Number(a.indent) * 36}px` } : {}),
          },
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.lineHeight || null,
            renderHTML: (a: Record<string, unknown>) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
          },
        },
      },
    ];
  },
});

export type Unit = { index: number; from: number; to: number; text: string; shot: string };

/** The spoken lines of the live document, with where each paragraph sits. */
export function spokenUnits(doc: PMNode): Unit[] {
  const out: Unit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") return false;
    if (node.type.name === "paragraph") {
      const text = node.textBetween(0, node.content.size, "\n", "").replace(/\s+$/g, "");
      const shot = typeof node.attrs.shot === "string" ? node.attrs.shot.trim() : "";
      if (text.trim() || shot) out.push({ index: out.length, from: pos, to: pos + node.nodeSize, text, shot });
      return false;
    }
    return true;
  });
  return out;
}

/** Every place `term` occurs, as document positions (case-insensitive). */
export function findMatches(doc: PMNode, term: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const needle = term.toLowerCase();
  if (!needle) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    /* Leaves (a line break) count as one character, so offsets map 1:1. */
    const text = node.textBetween(0, node.content.size, undefined, "￼").toLowerCase();
    let at = text.indexOf(needle);
    while (at >= 0) {
      out.push({ from: pos + 1 + at, to: pos + 1 + at + needle.length });
      at = text.indexOf(needle, at + Math.max(1, needle.length));
    }
    return false;
  });
  return out;
}

export type Tracked = { id: string; kind: "change" | "delete" | "insert"; from: number; to: number; text: string; why: string; /** Bumped each time 编剧 redoes this one change (「再改改」). */ rev?: number; busy?: boolean };

export type MarksState = {
  comments: { id: string; quote: string; unit: number | null }[];
  activeComment: string | null;
  search: string;
  current: number;
  tracked: Tracked[];
  zh: boolean;
};

export const marksKey = new PluginKey<MarksState>("gdMarks");

function build(state: EditorState, v: MarksState): DecorationSet {
  const decos: Decoration[] = [];
  const doc = state.doc;
  /* Comment quotes: the first place each quote occurs — inside its own line
     when the comment names one, else anywhere. */
  if (v.comments.length) {
    const units = spokenUnits(doc);
    for (const c of v.comments) {
      if (!c.quote) continue;
      let hit: { from: number; to: number } | null = null;
      const unit = c.unit !== null ? units[c.unit] : undefined;
      const all = findMatches(doc, c.quote);
      if (unit) hit = all.find((m) => m.from >= unit.from && m.to <= unit.to) ?? null;
      hit = hit ?? all[0] ?? null;
      if (hit) decos.push(Decoration.inline(hit.from, hit.to, { class: `gd-cmt${v.activeComment === c.id ? " on" : ""}`, "data-cid": c.id }));
    }
  }
  if (v.search) {
    findMatches(doc, v.search).forEach((m, i) => decos.push(Decoration.inline(m.from, m.to, { class: i === v.current ? "gd-find on" : "gd-find" })));
  }
  for (const t of v.tracked) {
    if (t.kind === "change" || t.kind === "delete") {
      if (t.to - t.from > 2) decos.push(Decoration.inline(t.from + 1, t.to - 1, { class: "gd-old" }));
    }
    const at = t.kind === "insert" ? t.from : t.to;
    decos.push(
      Decoration.widget(at, () => trackedWidget(t, v.zh), { side: t.kind === "insert" ? -1 : 1, key: `tr-${t.id}-${t.text.length}-${t.rev ?? 0}-${t.busy ? 1 : 0}`, ignoreSelection: true }),
    );
  }
  return DecorationSet.create(doc, decos);
}

function trackedWidget(t: Tracked, zh: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = `gd-new${t.kind === "delete" ? " del" : ""}`;
  box.contentEditable = "false";
  const body = document.createElement("div");
  body.className = "gd-new-text";
  body.textContent = t.kind === "delete" ? (zh ? "删掉这一段" : "Delete this paragraph") : t.text;
  const bar = document.createElement("div");
  bar.className = "gd-new-bar";
  const why = document.createElement("span");
  why.className = "gd-new-why";
  why.textContent = `${t.kind === "insert" ? (zh ? "新增一段" : "New paragraph") + (t.why ? " · " : "") : ""}${t.why}`;
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "gd-new-ok";
  ok.textContent = zh ? "接受" : "Accept";
  ok.onmousedown = (e) => e.preventDefault();
  ok.onclick = () => window.dispatchEvent(new CustomEvent("gd-tracked", { detail: { id: t.id, accept: true } }));
  const no = document.createElement("button");
  no.type = "button";
  no.className = "gd-new-no";
  no.textContent = zh ? "拒绝" : "Reject";
  no.onmousedown = (e) => e.preventDefault();
  no.onclick = () => window.dispatchEvent(new CustomEvent("gd-tracked", { detail: { id: t.id, accept: false } }));
  /* 「再改改」: redo just this change with one more instruction (the owner, 29 Sep). */
  const again = document.createElement("button");
  again.type = "button";
  again.className = "gd-new-no gd-new-again";
  again.textContent = t.busy ? (zh ? "编剧在改…" : "Rewriting…") : zh ? "再改改" : "Redo";
  again.disabled = Boolean(t.busy);
  again.onmousedown = (e) => e.preventDefault();
  const ask = document.createElement("form");
  ask.className = "gd-new-ask";
  ask.style.display = "none";
  const input = document.createElement("input");
  input.placeholder = zh ? "这一段想怎么改？比如：更口语、加个数字、短一半" : "How should this part change?";
  const go = document.createElement("button");
  go.type = "submit";
  go.className = "gd-new-ok";
  go.textContent = zh ? "改这段" : "Redo it";
  ask.append(input, go);
  ask.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return input.focus();
    window.dispatchEvent(new CustomEvent("gd-tracked-again", { detail: { id: t.id, instruction: q } }));
  };
  again.onclick = () => {
    ask.style.display = ask.style.display === "none" ? "flex" : "none";
    if (ask.style.display === "flex") window.setTimeout(() => input.focus(), 20);
  };
  if (t.kind === "delete") bar.append(why, ok, no);
  else bar.append(why, ok, no, again);
  box.append(body, bar, ask);
  return box;
}

export const Highlights = Extension.create<{ zh: boolean }>({
  name: "gdHighlights",
  addOptions() {
    return { zh: true };
  },
  addProseMirrorPlugins() {
    const zh = this.options.zh;
    return [
      new Plugin<MarksState>({
        key: marksKey,
        state: {
          init: () => ({ comments: [], activeComment: null, search: "", current: -1, tracked: [], zh }),
          apply(tr, value) {
            const meta = tr.getMeta(marksKey) as Partial<MarksState> | undefined;
            let next = meta ? { ...value, ...meta } : value;
            /* Tracked changes move with the text around them. */
            if (tr.docChanged && next.tracked.length && !meta?.tracked) {
              next = { ...next, tracked: next.tracked.map((t) => ({ ...t, from: tr.mapping.map(t.from, -1), to: tr.mapping.map(t.to, 1) })) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            const v = marksKey.getState(state);
            return v ? build(state, v) : null;
          },
        },
      }),
    ];
  },
});
