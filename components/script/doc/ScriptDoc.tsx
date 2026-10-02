"use client";

import { AttachButton, AttachChips, useAttachments } from "@/components/chat/Attach";
import { feedbackAction } from "@/app/(app)/train/learn-actions";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { ModelChip, useChatModel } from "@/components/chat/ModelChip";
import { AUTO_MODEL } from "@/lib/ai/chat-models";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { ShareDialog } from "@/components/share/ShareDialog";
import { notify } from "@/lib/client/notify";
import { uploadFiles } from "@/lib/client/upload";
import { renameProjectAction, setProjectAccessAction, setProjectLinkAction, setScriptLengthAction, startFromTopicAction } from "@/app/(app)/projects/actions";
import { AccessPicker } from "@/components/files/AccessPicker";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { ScriptPicker } from "@/components/projects/ScriptPicker";
import {
  addReferenceAction,
  approveDocAction,
  copilotAction,
  copilotRedoAction,
  docCommentAction,
  docImageAction,
  importDocAction,
  saveVersionAction,
  removeReferenceAction,
  renameScriptAction,
  requestChangesAction,
  resolveCommentAction,
  replyCommentAction,
  deleteCommentAction,
  restoreDocVersionAction,
  saveRichAction,
  settleDocSendBackAction,
  shareScriptAction,
  startBlankAction,
  unlockDocAction,
  versionBeatsAction,
  withdrawReviewAction,
  draftWithInstructionAction,
} from "@/app/(app)/projects/[id]/script/actions";
import { BlockExtras, Highlights, findMatches, marksKey, spokenUnits, type MarksState, type Tracked } from "./editor";
import { MenuBar, Modal, type Menu } from "./chrome";
import { BLOCKS, SPACINGS, Toolbar, changeIndent, setBlock, setLineHeight, type Mode } from "./toolbar";
import { GI } from "./icons";
import { measureText } from "@/lib/script/count";
import { richToHtml } from "@/lib/script/rich-html";
import type { RichDoc } from "@/lib/script/rich";
import type { DocComment, ScriptDocProps } from "./types";

/**
 * The script as a Google Doc (the project's 脚本 page).
 *
 * The owner (29 Sep, with a screenshot of docs.google.com): "let's try to
 * have really like google doc". Ryan before that: "more like google doc —
 * got an export button, user can always upload", and the client: "they just
 * need a google doc with an ai copilot so they can share and get approval
 * internally". So this is Docs' own layout, in Chinese:
 *
 *   header    the doc icon, the title (type to rename), 已保存, the menus
 *             文件 编辑 查看 插入 格式 工具 帮助; on the right the comments
 *             button, the soft-blue 分享 pill, the AI sparkle, you
 *   toolbar   find, undo/redo, print, zoom, 正文/标题, font, size, B I U,
 *             colour, highlight, link, comment, image, align, spacing,
 *             checklist, lists, indent, clear — and 编辑 / 建议 / 查看
 *   status    one slim line for the approval flow (share for review, the
 *             reviewer's 批准 / 提修改意见, approved → 去剪辑, a send-back)
 *   body      the outline of headings on the left, the white page in the
 *             middle with the comments in its right margin, and a floating
 *             AI bar at the bottom ("描述你想怎么改这份稿子…"); the AI panel,
 *             version history and all comments open on the right
 *
 * The document is rich text (TipTap); every save also writes the beats the
 * rest of the product reads (`saveRichAction`, `lib/script/rich.ts`).
 */

const CHIPS: { zh: string; en: string; icon?: string }[] = [
  { zh: "更口语", en: "More conversational" },
  { zh: "扩写到 3 分钟（约 800 字）", en: "Expand to 3 minutes" },
  { zh: "扩写到 5 分钟（约 1350 字）", en: "Expand to 5 minutes" },
  { zh: "缩短 30 秒", en: "Cut 30 seconds" },
  { zh: "强化开头钩子", en: "Stronger opening hook" },
  { zh: "删掉绝对化说法", en: "Remove absolute claims" },
  { zh: "加生活化比喻", en: "Add an everyday metaphor" },
  { zh: "改成小红书版本", en: "Rewrite for Xiaohongshu" },
];

/* 换个风格 (Ryan, 1 Oct: "they might want to create scripts based on different samples and styles"). */
const STYLES: { zh: string; label: string; en: string }[] = [
  { label: "照范例风格重写", zh: "照参考范例的风格重写全文：学它的结构、语气、节奏和开头方式，内容还是这个选题（范例用这次附的文件，没附就用右边的参考资料）", en: "Rewrite in the style of the sample" },
  { label: "故事型", zh: "改成故事型：用一个具体的人或事件串起来，有起因、转折、结果", en: "As a story" },
  { label: "新闻快讯", zh: "改成新闻快讯风格：开头一句话说清发生了什么，然后讲影响，干脆利落", en: "As a news flash" },
  { label: "干货清单", zh: "改成干货清单：开头抛问题，然后分 3 个要点讲清楚，最后一句总结", en: "As a 3-point list" },
  { label: "对比测评", zh: "改成对比测评：把两个对象放在一起比，给出明确结论", en: "As a comparison" },
  { label: "情绪共鸣", zh: "改成情绪共鸣型：从普通人的感受切入，语气更有温度", en: "More emotional" },
  { label: "反常识开头", zh: "开头改成一个反常识的观点，再一步步解释为什么", en: "Counter-intuitive opening" },
];

/* 字数 and 时长 come from lib/script/count, the same counter the versions use (QA, 2 Oct). */
function clock(sec: number, zh: boolean) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return zh ? (m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`) : `${m}:${String(s % 60).padStart(2, "0")}`;
}
/*
 * Times on the page. The server and the browser must write the same text or
 * React throws #418 (QA, 2 Oct: 「已批准 · 9月28日 02:15」 came out in UTC on
 * the server and in local time in the browser). So the first render writes
 * the Hong Kong clock by hand, no locale or timezone involved, and "3 分钟前"
 * only appears once the page is running (`useNow`).
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function hkStamp(iso: string, zh: boolean) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return zh ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hm}`;
}
function ago(iso: string, zh: boolean, now: number | null) {
  if (now === null) return hkStamp(iso, zh);
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return zh ? "刚刚" : "just now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`;
  return hkStamp(iso, zh);
}
/** The time now, once the page runs in the browser (null on the server and the first render). */
function useNow() {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const h = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(h);
  }, []);
  return now;
}
/* Notes written by the app itself before they were in Chinese. */
function noteText(note: string, zh: boolean) {
  if (zh && note === "before restoring an earlier version") return "恢复旧版本前的稿子";
  return note;
}

type Panel = null | "ai" | "versions" | "comments";
const EMPTY_DOC_STATE = { headings: [] as { level: number; text: string; pos: number }[], units: 0, count: 0, seconds: 0, cjk: 0, words: 0, paragraphs: 0, hasSelection: false };
type Proposal = { summary: string; source: "ai" | "sendback"; total: number };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

export function ScriptDoc(props: ScriptDocProps) {
  const { projectId, zh, me, script } = props;
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const now = useNow();

  /* ---------------- view state ---------------- */
  const [mode, setModeRaw] = React.useState<Mode>(me.canEdit ? "edit" : "view");
  /* The outline starts closed (the owner, 29 Sep); ☰ opens it. */
  const [outline, setOutline] = React.useState(false);
  const [ruler, setRuler] = React.useState(true);
  const [shots, setShots] = React.useState(false);
  /* The side panel is always open, on the AI assistant unless 批注 or 版本
     is picked (the owner, 29 Sep: "have the AI assistant always on"). */
  const [panelPick, setPanelPick] = React.useState<Exclude<Panel, null>>("ai");
  /* What was asked of 编剧 on this page, newest last, with what came back. */
  const [aiLog, setAiLog] = React.useState<{ q: string; a: string | null }[]>([]);
  const [accessOpen, setAccessOpen] = React.useState(false);
  /* 所有脚本: every script, in its project's folder, to switch to (Ryan, 29 Sep). */
  const [picking, setPicking] = React.useState(false);
  const [versionNote, setVersionNote] = React.useState("");
  const panel: Exclude<Panel, null> = panelPick;
  const setPanel = (p: Panel) => setPanelPick(p ?? "ai");
  const [zoom, setZoomRaw] = React.useState(1);
  /* The page scales down to fit the space there is (like Docs on a small
     window): 816px page, plus the comment margin when there is room for it.
     On a laptop the paper ran off the right edge (29 Sep). */
  const [fit, setFit] = React.useState(1);
  const [marginOn, setMarginOn] = React.useState(true);
  const [canvasW, setCanvasW] = React.useState(0);
  const setZoom = setZoomRaw;
  const z = zoom * fit;
  /* Zoomed wider than the window: the page row scrolls sideways. */
  const wide = canvasW > 0 && (816 + (marginOn ? 300 : 0)) * z > canvasW - 8;
  /* Unlocked for this approved version only: a newer approval locks it again. */
  const [unlockedFor, setUnlockedFor] = React.useState<number | null>(null);
  const unlocked = script?.lockedVersion != null && unlockedFor === script.lockedVersion;
  const setUnlocked = (on: boolean) => setUnlockedFor(on ? (script?.lockedVersion ?? null) : null);
  const locked = script?.lockedVersion != null && !unlocked;
  const [lockPrompt, setLockPrompt] = React.useState(false);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);
  const [thinking, setThinking] = React.useState(false);
  const [viewing, setViewing] = React.useState<{ versionNo: number; beats: { visual: string; voiceover: string; naturalSound: boolean }[]; doc: RichDoc | null } | null>(null);
  const [dialog, setDialog] = React.useState<null | "count" | "keys" | "rename" | "link" | "shot">(null);
  const [find, setFind] = React.useState<{ term: string; replace: string; current: number; withReplace: boolean } | null>(null);
  const [saveState, setSaveState] = React.useState<"saved" | "dirty" | "saving" | "error">("saved");
  /* The title as typed while renaming; the stored one otherwise. */
  const [titleDraft, setTitleDraft] = React.useState<string | null>(null);
  const title = titleDraft ?? script?.title ?? props.projectTitle;
  const setTitle = (v: string) => setTitleDraft(v);

  const editable = me.canEdit && mode === "edit" && !locked && !proposal && !viewing && !props.writing && !thinking;

  /* ---------------- the editor ---------------- */
  /* editSeq counts edits; savedSeq is the last edit the server has. */
  const editSeq = React.useRef(0);
  const savedSeq = React.useRef(0);
  const inflight = React.useRef<Promise<void> | null>(null);
  const lastDoc = React.useRef(JSON.stringify(props.doc));
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    content: props.doc,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }, codeBlock: false, code: false }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ inline: false }),
      TaskList,
      /* The checkbox's screen-reader label in the page's language (QA, 2 Oct: it read "Task item checkbox for …"). */
      TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node, checked) => (zh ? `${checked ? "已完成" : "待办"}：${node.textContent || "空白事项"}` : `${checked ? "Done" : "To do"}: ${node.textContent || "empty item"}`) } }),
      Placeholder.configure({ placeholder: () => (zh ? "从这里开始写…" : "Start writing…"), showOnlyCurrent: true }),
      BlockExtras,
      Highlights.configure({ zh }),
    ],
    editorProps: { attributes: { class: "gd-prose notranslate", spellcheck: "false", translate: "no" } },
    onUpdate: ({ transaction }) => {
      if (!transaction.docChanged || transaction.getMeta("gd-remote")) return;
      editSeq.current += 1;
      setSaveState("dirty");
    },
  });

  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  /*
   * Saving. One save at a time; a save asked for while one is in flight waits
   * for it and then saves whatever is newer, so no edit is ever left without
   * a save coming (QA, 2 Oct: with a slow server the timer fired mid-save,
   * the save bailed out, and the page sat on 有改动未保存 for good; the last
   * lines were gone on reload). Resolves true once the server has every edit
   * made before the call.
   */
  const errorShown = React.useRef(false);
  const saveRef = React.useRef<() => Promise<boolean>>(async () => false);
  const save = React.useCallback(async (): Promise<boolean> => {
    if (!editor) return false;
    while (inflight.current) await inflight.current;
    if (editSeq.current === savedSeq.current) return true;
    const mySeq = editSeq.current;
    /* Plain objects only: ProseMirror's attrs have no prototype, which a server action cannot take. */
    const json = JSON.parse(JSON.stringify(editor.getJSON())) as Record<string, unknown>;
    const html = editor.getHTML();
    let ok = false;
    const run = (async () => {
      try {
        setSaveState("saving");
        const r = await saveRichAction(projectId, json, html).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
        if ("error" in r && r.error) {
          setSaveState("error");
          if (!errorShown.current) notify(r.error);
          errorShown.current = true;
          return;
        }
        errorShown.current = false;
        ok = true;
        savedSeq.current = mySeq;
        lastDoc.current = JSON.stringify(json);
        setSaveState(editSeq.current === mySeq ? "saved" : "dirty");
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    await run;
    /* Typed while that save was on its way: save again shortly. */
    if (ok && editSeq.current !== savedSeq.current) window.setTimeout(() => void saveRef.current(), 900);
    return ok && editSeq.current === savedSeq.current;
  }, [editor, projectId]);
  saveRef.current = save;

  React.useEffect(() => {
    if (saveState !== "dirty") return;
    const h = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(h);
  }, [saveState, save]);
  /* A failed save tries again by itself (the button under 已保存 still works too). */
  React.useEffect(() => {
    if (saveState !== "error") return;
    const h = window.setTimeout(() => void save(), 8000);
    return () => window.clearTimeout(h);
  }, [saveState, save]);
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState !== "saved" || editSeq.current !== savedSeq.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /* New text from the server (编剧's draft, an import, a restore, another
     person's save) replaces the page — unless there is typing not saved yet. */
  const propDoc = JSON.stringify(props.doc);
  React.useEffect(() => {
    if (!editor || propDoc === lastDoc.current) return;
    if (saveState !== "saved" || editSeq.current !== savedSeq.current) return;
    lastDoc.current = propDoc;
    editor.chain().setMeta("gd-remote", true).setContent(props.doc, { emitUpdate: false }).run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, propDoc]);

  /* While 编剧 writes, the page keeps asking for the draft. */
  React.useEffect(() => {
    if (!props.writing) return;
    const h = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(h);
  }, [props.writing, router]);

  const docState = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { headings: [] as { level: number; text: string; pos: number }[], units: 0, count: 0, seconds: 0, cjk: 0, words: 0, paragraphs: 0, hasSelection: false };
      const headings: { level: number; text: string; pos: number }[] = [];
      e.state.doc.descendants((n, pos) => {
        if (n.type.name === "heading") {
          headings.push({ level: Number(n.attrs.level), text: n.textContent, pos });
          return false;
        }
        return true;
      });
      const units = spokenUnits(e.state.doc);
      const m = units.reduce((acc, u) => {
        const x = measureText(u.text);
        return { count: acc.count + x.count, seconds: acc.seconds + x.seconds, cjk: acc.cjk + x.cjk, words: acc.words + x.words };
      }, { count: 0, seconds: 0, cjk: 0, words: 0 });
      return { headings, units: units.length, paragraphs: units.length, hasSelection: !e.state.selection.empty, ...m };
    },
  }) ?? EMPTY_DOC_STATE;

  /* ---------------- marks: comments, find, tracked changes ---------------- */
  /* Threads: a comment and the replies under it (parentId). Only a thread's
     first comment is anchored in the text; replies show inside its card. */
  const openComments = props.comments.filter((c) => !c.resolvedAt && !c.parentId);
  const threads = props.comments.filter((c) => !c.parentId);
  const repliesOf = React.useMemo(() => {
    const m = new Map<string, DocComment[]>();
    for (const c of props.comments) if (c.parentId) m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]);
    return m;
  }, [props.comments]);
  const repliesKey = props.comments.filter((c) => c.parentId).map((c) => c.id).join("|");
  const [activeComment, setActiveComment] = React.useState<string | null>(null);
  const setMarks = React.useCallback(
    (m: Partial<MarksState>) => {
      if (!editor) return;
      editor.view.dispatch(editor.state.tr.setMeta(marksKey, m).setMeta("addToHistory", false));
    },
    [editor],
  );
  const commentsKey = openComments.map((c) => `${c.id}:${c.quote ?? ""}:${c.beatOrd ?? ""}`).join("|");
  React.useEffect(() => {
    setMarks({ comments: openComments.map((c) => ({ id: c.id, quote: c.quote ?? "", unit: c.beatOrd })), activeComment });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMarks, commentsKey, activeComment]);
  const findTerm = find?.term ?? "";
  const findCurrent = find?.current ?? -1;
  React.useEffect(() => {
    setMarks({ search: findTerm, current: findCurrent });
  }, [setMarks, findTerm, findCurrent]);

  /* ---------------- the canvas & the margin ---------------- */
  const canvas = React.useRef<HTMLDivElement | null>(null);
  /*
   * The wheel scrolls the script wherever the pointer is — over the outline,
   * the toolbar, the grey margins, the rail — not only over the paper (the
   * owner, 29 Sep: "let me scroll this screen completely, if the mouse is not
   * around the paper"). Anything that scrolls on its own (the AI panel, a
   * menu, a dialog) keeps its wheel.
   */
  React.useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const c = (canvas.current?.closest("[data-project-frame]") as HTMLElement | null) ?? canvas.current;
      if (!c || e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const target = e.target as Element | null;
      if (!target || c.contains(target) || target.closest("[role=dialog], [role=menu], [role=listbox], textarea, select")) return;
      for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1) {
          const down = e.deltaY > 0;
          const room = down ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
          if (room) return;
        }
      }
      c.scrollTop += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);
  const sheet = React.useRef<HTMLDivElement | null>(null);
  const [cardTops, setCardTops] = React.useState<Record<string, number>>({});
  const [selTop, setSelTop] = React.useState<number | null>(null);
  const layoutCards = React.useCallback(() => {
    const root = sheet.current;
    if (!root || !editor) return;
    const base = root.getBoundingClientRect().top;
    const tops: Record<string, number> = {};
    const list = openComments
      .map((c) => {
        const el = root.querySelector(`.gd-cmt[data-cid="${c.id}"]`) as HTMLElement | null;
        return { id: c.id, y: el ? (el.getBoundingClientRect().top - base) / z : null };
      })
      .filter((x): x is { id: string; y: number } => x.y !== null)
      .sort((a, b) => a.y - b.y);
    let floor = 0;
    for (const x of list) {
      const y = Math.max(x.y - 6, floor);
      tops[x.id] = y;
      /* The card as drawn (replies and an open reply box make it taller), or a guess before it is. */
      const card = root.parentElement?.querySelector(`.gd-margin [data-card="${x.id}"]`) as HTMLElement | null;
      floor = y + (card ? card.offsetHeight + 10 : activeComment === x.id ? 150 : 104);
    }
    setCardTops(tops);
    const sel = editor.state.selection;
    if (!sel.empty) {
      try {
        const c = editor.view.coordsAtPos(sel.from);
        setSelTop((c.top - base) / z);
      } catch {
        setSelTop(null);
      }
    } else setSelTop(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, commentsKey, repliesKey, z, activeComment]);
  React.useEffect(() => {
    if (!editor) return;
    const run = () => window.requestAnimationFrame(layoutCards);
    run();
    editor.on("transaction", run);
    window.addEventListener("resize", run);
    return () => {
      editor.off("transaction", run);
      window.removeEventListener("resize", run);
    };
  }, [editor, layoutCards]);

  /* ---------------- comments ---------------- */
  const [draft, setDraft] = React.useState<{ unit: number | null; quote: string | null; top: number } | null>(null);
  const [draftText, setDraftText] = React.useState("");
  function startComment() {
    if (!editor) return;
    const sel = editor.state.selection;
    const quote = sel.empty ? null : editor.state.doc.textBetween(sel.from, sel.to, " ").slice(0, 300).trim() || null;
    const unit = spokenUnits(editor.state.doc).find((u) => sel.from >= u.from && sel.from <= u.to)?.index ?? null;
    setDraft({ unit, quote, top: selTop ?? 40 });
    setDraftText("");
    /* No room for the right margin (below ~1700px wide): the comment box opens
       in the side panel's 批注 tab instead of in a margin nobody can see
       (QA, 2 Oct: comments could not be added at 1280 or 1440). */
    if (!marginOn) setPanel("comments");
  }
  function sendComment() {
    if (!draft || !draftText.trim()) return;
    start(async () => {
      const r = await docCommentAction(projectId, draft.unit, draft.quote, draftText);
      if ("error" in r && r.error) return notify(r.error);
      setDraft(null);
      setDraftText("");
      router.refresh();
    });
  }
  function jumpTo(c: DocComment) {
    setActiveComment(c.id);
    const el = sheet.current?.querySelector(`.gd-cmt[data-cid="${c.id}"]`) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* ---------------- the copilot: tracked changes in the page ---------------- */
  const [ask, setAsk] = React.useState("");
  const [askFocus, setAskFocus] = React.useState(false);
  const askBox = React.useRef<HTMLInputElement | null>(null);
  const [pickModel, setPickModel] = useChatModel(`script:${projectId}`);

  const trackedNow = (): Tracked[] => (editor ? (marksKey.getState(editor.state)?.tracked ?? []) : []);
  const endProposalIfDone = React.useCallback(
    (left: Tracked[], source: "ai" | "sendback") => {
      if (left.length) return;
      if (source === "sendback") void settleDocSendBackAction(projectId, "applied").then(() => router.refresh());
      setProposal(null);
    },
    [projectId, router],
  );

  function openProposal(items: Tracked[], summary: string, source: "ai" | "sendback") {
    if (source === "ai") setAiLog((l) => (l.length ? [...l.slice(0, -1), { ...l[l.length - 1], a: summary || t(`改了 ${items.length} 处，已在文档里标出`, `${items.length} edits, marked in the document`) }] : l));
    if (!items.length) return notify(t("编剧觉得不用改", "The writer found nothing to change"), "ok");
    setMarks({ tracked: items });
    setProposal({ summary, source, total: items.length });
  }

  const refAtt = useAttachments(zh, 5);
  function runCopilot(text?: string) {
    const q = (text ?? ask).trim();
    if (q && editor && !locked) setAiLog((l) => [...l.slice(-5), { q, a: null }]);
    if (!editor) return;
    if (!q) return notify(t("写下要怎么改，或点一个快捷指令", "Say what to change, or press a quick instruction"));
    if (locked) {
      setLockPrompt(true);
      return notify(t("脚本已批准。先点「继续编辑」，再让编剧改", "Approved. Press Continue editing first"));
    }
    const units = spokenUnits(editor.state.doc);
    if (!units.length) {
      /* Nothing to rewrite yet: the instruction becomes the first draft. */
      setThinking(true);
      start(async () => {
        const r = await draftWithInstructionAction(projectId, q, refAtt.ids);
        setThinking(false);
        if ("error" in r && r.error) return notify(r.error);
        refAtt.clear();
        setAsk("");
        notify(t("编剧开始按你的要求写初稿了，写好会出现在文档里", "The writer is drafting from your instruction"), "ok");
        router.refresh();
      });
      return;
    }
    setThinking(true);
    start(async () => {
      await save();
      const r = await copilotAction(projectId, units.map((u) => u.text), q, pickModel === AUTO_MODEL ? undefined : pickModel, refAtt.ids);
      setThinking(false);
      if ("error" in r && r.error) return notify(r.error);
      refAtt.clear();
      if (!("ok" in r) || !r.ok) return;
      const now = spokenUnits(editor.state.doc);
      const items: Tracked[] = [];
      for (const c of r.changes) {
        const u = now[c.i];
        if (!u) continue;
        items.push({ id: `c${c.i}`, kind: c.text.trim() ? "change" : "delete", from: u.from, to: u.to, text: c.text, why: c.why });
      }
      r.inserts.forEach((x, n) => {
        const at = x.after < 0 ? (now[0]?.from ?? 0) : now[x.after]?.to;
        if (at === undefined) return;
        items.push({ id: `i${n}`, kind: "insert", from: at, to: at, text: x.text, why: x.why });
      });
      openProposal(items, r.summary, "ai");
      setAsk("");
    });
  }

  function loadSentBack() {
    const sb = props.sentBack;
    if (!editor || !sb?.suggestions?.length) return;
    if (locked) return setLockPrompt(true);
    const units = spokenUnits(editor.state.doc);
    const byUnit = new Map<number, { text: string; why: string }>();
    for (const s of sb.suggestions) {
      const u = units[s.ord];
      if (!u) continue;
      const cur = byUnit.get(s.ord)?.text ?? u.text;
      if (!cur.includes(s.before)) continue;
      byUnit.set(s.ord, { text: cur.replace(s.before, s.after), why: s.why });
    }
    const items: Tracked[] = [...byUnit.entries()].map(([i, c]) => ({ id: `s${i}`, kind: "change", from: units[i].from, to: units[i].to, text: c.text, why: c.why }));
    if (!items.length) return notify(t("这些改法对不上现在的文字了（可能已经改过）", "Those edits no longer match the text"));
    openProposal(items, sb.note, "sendback");
  }

  /* Apply one tracked change (or several, last first so positions hold). */
  const applyTracked = React.useCallback(
    (ids: string[]) => {
      if (!editor) return [] as Tracked[];
      const all = marksKey.getState(editor.state)?.tracked ?? [];
      const pick = all.filter((x) => ids.includes(x.id)).sort((a, b) => b.from - a.from || (a.kind === "insert" ? -1 : 1));
      const { state } = editor;
      const tr = state.tr;
      const schema = state.schema;
      for (const x of pick) {
        if (x.kind === "insert") {
          tr.insert(tr.mapping.map(x.from), schema.nodes.paragraph.create(null, x.text ? schema.text(x.text) : null));
        } else if (x.kind === "change") {
          const from = x.from + 1;
          const to = x.to - 1;
          if (to > from) tr.replaceWith(from, to, schema.text(x.text));
          else tr.insert(from, schema.text(x.text));
        } else {
          const $p = tr.doc.resolve(x.from + 1);
          const parent = $p.node($p.depth - 1);
          if ((parent.type.name === "listItem" || parent.type.name === "taskItem") && parent.childCount === 1) tr.delete($p.before($p.depth - 1), $p.after($p.depth - 1));
          else if (tr.doc.childCount === 1 && $p.depth === 1) tr.replaceWith(x.from, x.to, schema.nodes.paragraph.create());
          else tr.delete(x.from, x.to);
        }
      }
      const left = all.filter((x) => !ids.includes(x.id)).map((x) => ({ ...x, from: tr.mapping.map(x.from, -1), to: tr.mapping.map(x.to, 1) }));
      tr.setMeta(marksKey, { tracked: left });
      editor.view.dispatch(tr);
      editSeq.current += 1;
      setSaveState("dirty");
      return left;
    },
    [editor],
  );
  const rejectTracked = React.useCallback(
    (ids: string[]) => {
      if (!editor) return [] as Tracked[];
      const left = (marksKey.getState(editor.state)?.tracked ?? []).filter((x) => !ids.includes(x.id));
      editor.view.dispatch(editor.state.tr.setMeta(marksKey, { tracked: left }).setMeta("addToHistory", false));
      return left;
    },
    [editor],
  );
  React.useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; accept: boolean }>).detail;
      if (!proposal) return;
      if (!d.accept) {
        const tr = trackedNow().find((x) => x.id === d.id);
        if (tr) void feedbackAction("script", "reject", tr.kind === "delete" ? "删一段的改法" : tr.text.slice(0, 200), tr.why);
      }
      const left = d.accept ? applyTracked([d.id]) : rejectTracked([d.id]);
      endProposalIfDone(left, proposal.source);
    };
    window.addEventListener("gd-tracked", on);
    return () => window.removeEventListener("gd-tracked", on);
  }, [proposal, applyTracked, rejectTracked, endProposalIfDone]);
  /* 「再改改」 on one suggested change: 编剧 redoes just that paragraph to the new instruction. */
  React.useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; instruction: string }>).detail;
      if (!editor || !d?.id) return;
      const setTracked = (fn: (list: Tracked[]) => Tracked[]) =>
        editor.view.dispatch(editor.state.tr.setMeta(marksKey, { tracked: fn(marksKey.getState(editor.state)?.tracked ?? []) }).setMeta("addToHistory", false));
      const tr = (marksKey.getState(editor.state)?.tracked ?? []).find((x) => x.id === d.id);
      if (!tr || tr.busy) return;
      setTracked((list) => list.map((x) => (x.id === d.id ? { ...x, busy: true } : x)));
      void feedbackAction("script", "redo", d.instruction, tr.text.slice(0, 200));
      const size = editor.state.doc.content.size;
      const before = tr.kind === "change" ? editor.state.doc.textBetween(tr.from, Math.min(tr.to, size), "\n").trim() : "";
      const around = editor.state.doc.textBetween(Math.max(0, tr.from - 600), Math.min(size, tr.to + 600), "\n");
      void copilotRedoAction(projectId, { before, suggestion: tr.text, instruction: d.instruction, around }, pickModel === AUTO_MODEL ? undefined : pickModel)
        .then((r) => {
          if (!r || "error" in r) {
            notify((r && "error" in r && r.error) || t("没改成，再试一次", "Could not redo it; try again"));
            setTracked((list) => list.map((x) => (x.id === d.id ? { ...x, busy: false } : x)));
            return;
          }
          setTracked((list) => list.map((x) => (x.id === d.id ? { ...x, text: r.text, busy: false, rev: (x.rev ?? 0) + 1, why: t(`按「${d.instruction.slice(0, 16)}」又改了一版`, "Redone to your note") } : x)));
        })
        .catch(() => setTracked((list) => list.map((x) => (x.id === d.id ? { ...x, busy: false } : x))));
    };
    window.addEventListener("gd-tracked-again", on);
    return () => window.removeEventListener("gd-tracked-again", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, projectId, pickModel]);

  /* ---------------- references & images ---------------- */
  const refInput = React.useRef<HTMLInputElement | null>(null);
  const imgInput = React.useRef<HTMLInputElement | null>(null);
  const importInput = React.useRef<HTMLInputElement | null>(null);
  const importMode = React.useRef<"replace" | "append">("replace");
  /* 导入 also puts the file in 参考资料 only when this is ticked (QA, 2 Oct). */
  const [importAsRef, setImportAsRef] = React.useState(false);
  const [uploading, setUploading] = React.useState<{ name: string; pct: number }[]>([]);
  const access = props.accessMode === "everyone" ? ({ mode: "everyone" } as const) : ({ mode: "private" } as const);
  /* A file just added is read in the background: ask again for a while so
     「无文字」 turns into the file's text without a reload (QA, 2 Oct). */
  const [refPollUntil, setRefPollUntil] = React.useState(0);
  const refsUnread = props.references.some((f) => !f.hasText);
  React.useEffect(() => {
    if (!refsUnread || !refPollUntil) return;
    const h = window.setInterval(() => {
      if (Date.now() > refPollUntil) {
        window.clearInterval(h);
        setRefPollUntil(0);
        return;
      }
      router.refresh();
    }, 4000);
    return () => window.clearInterval(h);
  }, [refsUnread, refPollUntil, router]);
  async function uploadRefs(list: FileList) {
    await uploadFiles(list, {
      access,
      onProgress: (u) => setUploading(u.filter((x) => x.pct < 100 && !x.error)),
      onDone: async (fileId) => {
        const r = await addReferenceAction(projectId, fileId);
        if ("error" in r && r.error) notify(r.error);
      },
    });
    setUploading([]);
    setRefPollUntil(Date.now() + 90_000);
    router.refresh();
  }
  async function insertImages(list: FileList) {
    await uploadFiles(list, {
      access,
      onDone: async (fileId) => {
        const r = await docImageAction(projectId, fileId);
        if ("error" in r && r.error) return notify(r.error);
        if ("src" in r && r.src) editor?.chain().focus().setImage({ src: r.src }).run();
      },
    });
  }
  async function importFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (importMode.current === "replace" && !window.confirm(t("用这个文件的内容替换现在的稿子？（旧的内容可以在「版本记录」里找回）", "Replace the script with this file's text? (The old text stays in Version history.)"))) return;
    /* What is typed but not saved yet goes first: the import builds on the saved document and the page reloads after. */
    await save();
    notify(t(`正在导入 ${file.name}…`, `Importing ${file.name}…`), "info");
    let result: { ok?: true; paragraphs?: number; error?: string } | null = null;
    await uploadFiles([file] as unknown as FileList, {
      access,
      onDone: async (fileId) => {
        result = (await importDocAction(projectId, fileId, importMode.current, importAsRef)) as typeof result;
      },
    });
    const r = result as { ok?: true; paragraphs?: number; error?: string } | null;
    if (importInput.current) importInput.current.value = "";
    if (!r) return notify(t("上传没成功", "The upload did not finish"));
    if (r.error) return notify(r.error);
    notify(importAsRef ? t(`已导入 ${r.paragraphs} 段，原文件也放进了参考资料`, `Imported ${r.paragraphs} paragraphs; the file is also in References`) : t(`已导入 ${r.paragraphs} 段`, `Imported ${r.paragraphs} paragraphs`), "ok");
    window.location.reload();
  }

  /* ---------------- approval & sharing ---------------- */
  const [sharing, setSharing] = React.useState(false);
  /* Arrived from 「发给同事审阅」 in a chat: open the share box, set to ask for approval. */
  React.useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("share") === "review" && me.canEdit) setSharing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* 「分享」 in the script library lands here with ?share=1. */
  React.useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("share") !== "1") return;
    url.searchParams.delete("share");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    /* Not cancelled on cleanup: the param is gone once read, so a second run
       (React's dev double effect) would otherwise never open it. */
    window.setTimeout(() => setSharing(true), 0);
  }, []);
  /* ?tab=… from a link (an approval notice, the old script page's tabs):
     open the matching side panel rather than ignore it (QA, 2 Oct). */
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("tab");
    if (!tab) return;
    if (tab === "versions" || tab === "approval") setPanelPick("versions");
    else if (tab === "comments") setPanelPick("comments");
    url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const open = props.approvals.filter((a) => a.state === "requested");
  const mine = open.find((a) => a.approverId === me.id) ?? null;
  const decider = mine ?? (me.isAdmin ? open.find((a) => a.requestedBy !== me.id) ?? null : null);
  const approved = script?.lockedVersion != null ? props.approvals.find((a) => a.state === "approved" && a.versionNo === script.lockedVersion) ?? null : null;
  const sentBack = props.sentBack && props.sentBack.state === "open" ? props.sentBack : null;

  function approve() {
    start(async () => {
      await save();
      const r = await approveDocAction(projectId);
      if ("error" in r && r.error) return notify(r.error);
      notify(t("已批准，交给剪辑", "Approved — on to the edit"), "ok");
      router.refresh();
    });
  }
  function sendNote() {
    if (!note.trim()) return notify(t("写下要改什么", "Say what to change"));
    start(async () => {
      const r = await requestChangesAction(projectId, note);
      if ("error" in r && r.error) return notify(r.error);
      setNote("");
      setNoteOpen(false);
      notify(t("修改意见已发给写脚本的人", "Sent back with your note"), "ok");
      router.refresh();
    });
  }
  function unlockNow() {
    start(async () => {
      const r = await unlockDocAction(projectId);
      if ("error" in r && r.error) return notify(r.error);
      setUnlocked(true);
      setLockPrompt(false);
      router.refresh();
    });
  }
  function renameTo(name: string) {
    const clean = name.trim();
    if (!clean || clean === (script?.title ?? props.projectTitle)) {
      setTitleDraft(null);
      return;
    }
    start(async () => {
      const r = await renameScriptAction(projectId, clean);
      if ("error" in r && r.error) return notify(r.error);
      await renameProjectAction(projectId, clean);
      router.refresh();
      setTitleDraft(null);
    });
  }

  /* ---------------- mode ---------------- */
  function setMode(m: Mode) {
    if (m === "suggest") {
      setModeRaw("edit");
      setPanel("ai");
      window.setTimeout(() => askBox.current?.focus(), 60);
      notify(t("建议模式：在下面写要怎么改，编剧的改法会以修订显示，接受了才生效", "Suggesting: say what to change below; the writer's edits show as tracked changes"), "info");
      return;
    }
    setModeRaw(m);
  }

  /* ---------------- find & replace ---------------- */
  const matches = React.useMemo(() => (editor && find?.term ? findMatches(editor.state.doc, find.term) : []), [editor, find?.term, docState.count]); // eslint-disable-line react-hooks/exhaustive-deps
  function gotoMatch(i: number) {
    if (!editor || !matches.length) return;
    const n = ((i % matches.length) + matches.length) % matches.length;
    setFind((f) => (f ? { ...f, current: n } : f));
    const m = matches[n];
    editor.commands.setTextSelection({ from: m.from, to: m.to });
    try {
      const dom = editor.view.domAtPos(m.from).node as HTMLElement;
      (dom.nodeType === 1 ? dom : dom.parentElement)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      /* position gone */
    }
  }
  function replaceOne() {
    if (!editor || !find || !matches.length || !editor.isEditable) return;
    const m = matches[Math.max(0, find.current)];
    editor.chain().focus().insertContentAt({ from: m.from, to: m.to }, find.replace).run();
  }
  function replaceAll() {
    if (!editor || !find || !matches.length || !editor.isEditable) return;
    const tr = editor.state.tr;
    [...matches].reverse().forEach((m) => (find.replace ? tr.replaceWith(m.from, m.to, editor.state.schema.text(find.replace)) : tr.delete(m.from, m.to)));
    editor.view.dispatch(tr);
    notify(t(`已替换 ${matches.length} 处`, `Replaced ${matches.length}`), "ok");
  }

  /* ---------------- keys ---------------- */
  /*
   * Listened for on the window's capture phase, ahead of the site-wide
   * shortcuts: in the editor ⌘K is 插入链接, not 跳转到 (QA, 2 Oct: the
   * palette opened instead). Only the keys handled here are stopped.
   */
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (k === "k" && !e.shiftKey && !e.altKey && editor?.isFocused) {
        take();
        if (editor.isEditable) setDialog("link");
      } else if (e.altKey && (k === "m" || e.code === "KeyM")) {
        take();
        startComment();
      } else if ((k === "/" || e.code === "Slash") && !e.altKey) {
        take();
        setDialog("keys");
      } else if (e.shiftKey && !e.altKey && (k === "c" || e.code === "KeyC")) {
        take();
        setDialog("count");
      } else if (e.shiftKey && !e.altKey && (k === "x" || e.code === "KeyX") && editor?.isFocused && editor.isEditable) {
        take();
        editor.chain().focus().toggleStrike().run();
      } else if ((k === "h" || (k === "f" && editor?.isFocused)) && !e.altKey && !e.shiftKey) {
        take();
        setFind((f) => f ?? { term: "", replace: "", current: 0, withReplace: k === "h" });
      } else if (k === "s" && !e.altKey && !e.shiftKey) {
        take();
        void save();
      } else if (k === "\\" && editor?.isEditable) {
        take();
        editor.chain().focus().unsetAllMarks().clearNodes().run();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  function print() {
    window.print();
  }
  function fullscreen() {
    const el = document.querySelector("[data-gd-root]") as HTMLElement | null;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }

  const exportHref = (f: string) => `/api/projects/${projectId}/script-export?format=${f}${shots ? "&notes=1" : ""}`;

  /* ---------------- the menus ---------------- */
  const canEdit = me.canEdit && Boolean(script);
  const menus: Menu[] = [
    {
      key: "file",
      label: t("文件", "File"),
      items: [
        {
          label: t("导入", "Import"),
          icon: "upload",
          disabled: !canEdit,
          submenu: [
            { label: t("用文件替换现在的稿子…", "Replace with a file…"), onClick: () => { importMode.current = "replace"; importInput.current?.click(); } },
            { label: t("把文件内容接在后面…", "Add a file's text at the end…"), onClick: () => { importMode.current = "append"; importInput.current?.click(); } },
          ],
        },
        {
          label: t("下载", "Download"),
          icon: "download",
          submenu: [
            { label: t("Word 文档 (.docx)", "Microsoft Word (.docx)"), href: exportHref("docx"), download: true },
            { label: "PDF (.pdf)", href: exportHref("pdf"), download: true },
            { label: t("纯文本 (.txt)", "Plain text (.txt)"), href: exportHref("txt"), download: true },
            { label: "Markdown (.md)", href: exportHref("md"), download: true },
          ],
        },
        { divider: true },
        { label: t("分享", "Share"), icon: "lock", onClick: () => setSharing(true) },
        { label: t("重命名", "Rename"), icon: "pencil", disabled: !canEdit, onClick: () => setDialog("rename") },
        { label: t("版本记录", "Version history"), icon: "history", onClick: () => setPanel("versions") },
        { divider: true },
        { label: t("打印", "Print"), icon: "print", shortcut: `${MOD}P`, onClick: print },
      ],
    },
    {
      key: "edit",
      label: t("编辑", "Edit"),
      items: [
        { label: t("撤销", "Undo"), icon: "undo", shortcut: `${MOD}Z`, disabled: !editable, onClick: () => editor?.chain().focus().undo().run() },
        { label: t("重做", "Redo"), icon: "redo", shortcut: `${MOD}Y`, disabled: !editable, onClick: () => editor?.chain().focus().redo().run() },
        { divider: true },
        { label: t("全选", "Select all"), shortcut: `${MOD}A`, onClick: () => editor?.chain().focus().selectAll().run() },
        { label: t("查找和替换", "Find and replace"), icon: "search", shortcut: `${MOD}H`, onClick: () => setFind({ term: "", replace: "", current: 0, withReplace: true }) },
      ],
    },
    {
      key: "view",
      label: t("查看", "View"),
      items: [
        { label: t("显示大纲", "Show outline"), checked: outline, onClick: () => setOutline((v) => !v) },
        { label: t("显示画面说明", "Show shot notes"), checked: shots, onClick: () => setShots((v) => !v) },
        { label: t("显示标尺", "Show ruler"), checked: ruler, onClick: () => setRuler((v) => !v) },
        { divider: true },
        { label: t("全屏", "Full screen"), icon: "focus", onClick: fullscreen },
        {
          label: t("模式", "Mode"),
          submenu: [
            { label: t("编辑", "Editing"), checked: mode === "edit", disabled: !me.canEdit, onClick: () => setMode("edit") },
            { label: t("查看", "Viewing"), checked: mode === "view", onClick: () => setMode("view") },
          ],
        },
      ],
    },
    {
      key: "insert",
      label: t("插入", "Insert"),
      items: [
        { label: t("图片", "Image"), icon: "image", disabled: !editable, onClick: () => imgInput.current?.click() },
        { label: t("链接", "Link"), icon: "link", shortcut: `${MOD}K`, disabled: !editable, onClick: () => setDialog("link") },
        { label: t("分隔线", "Horizontal line"), icon: "hr", disabled: !editable, onClick: () => editor?.chain().focus().setHorizontalRule().run() },
        { label: t("清单", "Checklist"), icon: "checklist", disabled: !editable, onClick: () => editor?.chain().focus().toggleTaskList().run() },
        { divider: true },
        { label: t("批注", "Comment"), icon: "comment", shortcut: isMac ? "⌘⌥M" : "Ctrl+Alt+M", onClick: startComment },
        { label: t("画面说明…", "Shot note…"), icon: "film", disabled: !editable, onClick: () => setDialog("shot") },
      ],
    },
    {
      key: "format",
      label: t("格式", "Format"),
      items: [
        {
          label: t("文本", "Text"),
          disabled: !editable,
          submenu: [
            { label: t("粗体", "Bold"), shortcut: `${MOD}B`, onClick: () => editor?.chain().focus().toggleBold().run() },
            { label: t("斜体", "Italic"), shortcut: `${MOD}I`, onClick: () => editor?.chain().focus().toggleItalic().run() },
            { label: t("下划线", "Underline"), shortcut: `${MOD}U`, onClick: () => editor?.chain().focus().toggleUnderline().run() },
            { label: t("删除线", "Strikethrough"), shortcut: isMac ? "⌘⇧X" : "Ctrl+Shift+X", onClick: () => editor?.chain().focus().toggleStrike().run() },
          ],
        },
        {
          label: t("段落样式", "Paragraph styles"),
          disabled: !editable,
          submenu: BLOCKS.map((b) => ({ label: zh ? b.zh : b.en, shortcut: b.key === "p" ? (isMac ? "⌘⌥0" : "Ctrl+Alt+0") : isMac ? `⌘⌥${b.key.slice(1)}` : `Ctrl+Alt+${b.key.slice(1)}`, onClick: () => editor && setBlock(editor, b.key) })),
        },
        {
          label: t("对齐和缩进", "Align & indent"),
          disabled: !editable,
          submenu: [
            { label: t("左对齐", "Left"), icon: "alignLeft", onClick: () => editor?.chain().focus().setTextAlign("left").run() },
            { label: t("居中", "Centre"), icon: "alignCenter", onClick: () => editor?.chain().focus().setTextAlign("center").run() },
            { label: t("右对齐", "Right"), icon: "alignRight", onClick: () => editor?.chain().focus().setTextAlign("right").run() },
            { label: t("两端对齐", "Justified"), icon: "alignJustify", onClick: () => editor?.chain().focus().setTextAlign("justify").run() },
            { divider: true },
            { label: t("增加缩进", "Increase indent"), icon: "indent", onClick: () => editor && changeIndent(editor, 1) },
            { label: t("减少缩进", "Decrease indent"), icon: "outdent", onClick: () => editor && changeIndent(editor, -1) },
          ],
        },
        {
          label: t("行距", "Line spacing"),
          disabled: !editable,
          submenu: SPACINGS.map((s) => ({ label: s === "1" ? t("单倍", "Single") : s === "2" ? t("双倍", "Double") : s, onClick: () => editor && setLineHeight(editor, s) })),
        },
        {
          label: t("列表", "Lists"),
          disabled: !editable,
          submenu: [
            { label: t("项目符号列表", "Bulleted list"), icon: "bullets", onClick: () => editor?.chain().focus().toggleBulletList().run() },
            { label: t("编号列表", "Numbered list"), icon: "numbers", onClick: () => editor?.chain().focus().toggleOrderedList().run() },
            { label: t("清单", "Checklist"), icon: "checklist", onClick: () => editor?.chain().focus().toggleTaskList().run() },
          ],
        },
        { divider: true },
        { label: t("清除格式", "Clear formatting"), icon: "clear", shortcut: `${MOD}\\`, disabled: !editable, onClick: () => editor?.chain().focus().unsetAllMarks().clearNodes().run() },
      ],
    },
    {
      key: "tools",
      label: t("工具", "Tools"),
      items: [
        { label: t("字数统计", "Word count"), icon: "count", shortcut: isMac ? "⌘⇧C" : "Ctrl+Shift+C", onClick: () => setDialog("count") },
        { label: t("AI 改写", "AI rewrite"), icon: "sparkle", disabled: !me.canEdit, onClick: () => { setPanel("ai"); window.setTimeout(() => askBox.current?.focus(), 60); } },
        { label: t("训练编剧", "Train the writer"), icon: "pencil", href: "/train/script" },
      ],
    },
    {
      key: "help",
      label: t("帮助", "Help"),
      items: [{ label: t("键盘快捷键", "Keyboard shortcuts"), icon: "keyboard", shortcut: `${MOD}/`, onClick: () => setDialog("keys") }],
    },
  ];

  /* ---------------- status line (the approval flow) ---------------- */
  function statusLine(): React.ReactNode {
    if (props.writing) return <Status tone="run" text={t("编剧正在写初稿，写好会自动出现在文档里。", "The writer is drafting; it appears in the document when done.")} />;
    if (props.draftFailed && !docState?.words)
      return (
        <Status tone="wait" text={<><b>{t("初稿没写成：", "The draft did not land: ")}</b>{props.draftFailed.note}</>}>
          {me.canEdit ? (
            <button type="button" className="gd-status-btn primary" disabled={pending} onClick={() => start(async () => { const r = await startFromTopicAction({ kind: "project", id: projectId }, { write: true, rewrite: false }); if ("error" in r && r.error) return notify(r.error); notify(t("编剧重新开始写初稿了", "Drafting again"), "ok"); router.refresh(); })}>
              {t("重试", "Retry")}
            </button>
          ) : null}
        </Status>
      );
    if (!script) return null;
    if (script.lockedVersion != null && !unlocked) {
      const who = approved?.deciderName ?? "";
      return (
        <Status tone="ok" text={<>{t(`已批准 · 第 ${script.lockedVersion} 版`, `Approved · v${script.lockedVersion}`)}{who ? ` · ${who}` : ""}{approved?.decidedAt ? ` · ${ago(approved.decidedAt, zh, now)}` : ""}<span className="gd-status-dim">{t("　剪辑师会照这一版剪。改动会生成新版本。", " The edit follows this version.")}</span></>}>
          {me.canEdit ? <button type="button" className="gd-status-btn" onClick={() => setLockPrompt(true)}>{t("继续编辑", "Continue editing")}</button> : null}
          <Link href={`/projects/${projectId}/edit`} prefetch={false} className="gd-status-btn primary">{t("下一步：去剪辑 →", "Next: the edit →")}</Link>
        </Status>
      );
    }
    if (decider) {
      return (
        <Status tone="you" text={<><b>{decider.requesterName ?? t("同事", "A colleague")}</b>{t(` 请你审阅这份脚本（第 ${decider.versionNo ?? "?"} 版）。可以直接改、加批注，看完选一个：`, ` asks you to review this (v${decider.versionNo ?? "?"}). Edit or comment, then:`)}</>}>
          <button type="button" className="gd-status-btn primary" disabled={pending} onClick={approve}>{t("批准", "Approve")}</button>
          <button type="button" className="gd-status-btn" disabled={pending} onClick={() => setNoteOpen((v) => !v)}>{t("提修改意见", "Ask for changes")}</button>
        </Status>
      );
    }
    if (open.length) {
      const names = open.map((a) => a.approverName ?? "?").join("、");
      return (
        <Status tone="wait" text={t(`已分享给 ${names} 审阅（第 ${open[0].versionNo ?? "?"} 版），等他们批准。`, `With ${names} for review (v${open[0].versionNo ?? "?"}).`)}>
          <button type="button" className="gd-status-btn" onClick={() => setSharing(true)}>{t("再发给别人", "Send to someone else")}</button>
          {me.canEdit ? <button type="button" className="gd-status-btn" disabled={pending} onClick={() => start(async () => { await withdrawReviewAction(projectId); router.refresh(); })}>{t("撤回审阅", "Withdraw")}</button> : null}
          {me.canEdit ? <button type="button" className="gd-status-btn" disabled={pending} onClick={approve}>{t("我自己审阅通过", "I approve it myself")}</button> : null}
        </Status>
      );
    }
    if (sentBack) {
      return (
        <Status tone="you" text={<>{t("退回修改：", "Sent back: ")}<b>「{sentBack.note}」</b>{sentBack.byName ? <span className="gd-status-dim"> — {sentBack.byName}</span> : null}{sentBack.suggestions?.length ? t(`　编剧给出了 ${sentBack.suggestions.length} 处改法。`, ` ${sentBack.suggestions.length} suggested edits.`) : ""}</>}>
          {sentBack.suggestions?.length && me.canEdit ? <button type="button" className="gd-status-btn primary" onClick={loadSentBack}>{t("在文档里看改法", "See the edits")}</button> : null}
          <button type="button" className="gd-status-btn" onClick={() => setSharing(true)}>{t("改好了，重新发审", "Done — send for review")}</button>
          {me.isAdmin ? <button type="button" className="gd-status-btn" disabled={pending} onClick={approve}>{t("直接批准", "Approve now")}</button> : null}
        </Status>
      );
    }
    return (
      <Status tone="draft" text={<><b>{t("写好了？选一个往下走：", "Done? Pick the way forward:")}</b><span className="gd-status-dim">{t(`　草稿 · 第 ${(script.version ?? 0) + 1} 版`, `  Draft · v${(script.version ?? 0) + 1}`)}</span></>}>
        {me.canEdit ? <button type="button" className="gd-status-btn primary" onClick={() => setSharing(true)}>{t("发给同事审阅", "Send for review")}</button> : null}
        {me.canEdit ? <button type="button" className="gd-status-btn" disabled={pending} onClick={approve}>{t("我自己审阅通过", "I approve it myself")}</button> : null}
        <Link href={`/projects/${projectId}/edit`} prefetch={false} className="gd-status-btn">{t("先去剪辑 →", "Skip to the edit →")}</Link>
      </Status>
    );
  }

  const saveLabel =
    saveState === "saving" ? t("正在保存…", "Saving…") : saveState === "dirty" ? t("有改动未保存", "Unsaved changes") : saveState === "error" ? t("没保存上 · 点这里重试", "Not saved · retry") : t("已保存", "All changes saved");
  const target = script?.targetSeconds ?? null;
  const trackedLeft = proposal ? trackedNow().length : 0;
  const noScript = !props.writing && !script;

  React.useEffect(() => {
    const el = canvas.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    /* Fit shrinks the page to the window at 100%; a zoom above that is
       honoured and the page scrolls sideways (QA, 2 Oct: 150% grew the page
       only ~12% because fit undid the zoom). */
    const measure = () => {
      const w = el.clientWidth - 40;
      const room = w >= (816 + 300) * zoom;
      setMarginOn(room);
      setCanvasW(el.clientWidth);
      setFit(Math.max(0.45, Math.min(1, w / (room ? 816 + 300 : 816))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom, outline]);

  /* 视频时长: the length the script is written to (the owner, 29 Sep: "where do I even choose how long I want the video"). */
  function setLength(secs: number) {
    start(async () => {
      const r = await setScriptLengthAction(projectId, secs);
      if (r && "error" in r && r.error) return notify(r.error);
      notify(t(`目标时长改成 ${secs / 60} 分钟`, `Target set to ${secs / 60} min`), "ok");
      router.refresh();
    });
  }
  function fitToLength(secs: number) {
    const want = Math.round(secs * 4.5);
    const now = docState.count;
    runCopilot(
      zh
        ? `把整份稿子调整到约 ${secs < 60 ? `${secs} 秒` : `${secs / 60} 分钟`}：现在约 ${now} 字，目标 ${want} 字（上下不超过 10%）。${now < want ? "在原段落上直接扩写（改写原段落本身），每段多说细节、数字和例子；需要时可以加新段落，但不要重复已有段落的意思。" : "在原段落上直接精简，删掉重复和空话，保留关键事实和数字。"}保留原来的结构和顺序。`
        : `Adjust the whole script to about ${secs} seconds: now ~${now} characters, target ${want} (within 10%). Rewrite the existing paragraphs in place; never add a paragraph that repeats one.`,
    );
  }

  /* The new-comment box: in the page's right margin when it shows, else at the top of the 批注 tab. */
  const composer = draft ? (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <PersonAvatar id={me.id} url={me.avatarUrl} name={me.name} size={28} />
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>{me.name}</span>
      </div>
      {draft.quote ? <div className="gd-quote">「{draft.quote}」</div> : null}
      <textarea autoFocus value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendComment(); if (e.key === "Escape") setDraft(null); }} placeholder={t("添加批注，或 @ 提及某人", "Comment or add others with @")} className="gd-comment-box" />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" className="gd-status-btn" onClick={() => setDraft(null)}>{t("取消", "Cancel")}</button>
        <button type="button" className="gd-status-btn blue" disabled={pending || !draftText.trim()} onClick={sendComment}>{t("批注", "Comment")}</button>
      </div>
    </>
  ) : null;

  /* ---------------- render ---------------- */
  return (
    <div data-gd-root="" className={`gd-root${shots ? " gd-shots" : ""}`}>
      <style>{GD_CSS}</style>
      <input ref={importInput} type="file" hidden accept=".docx,.doc,.pdf,.txt,.md,.rtf,.odt,.pptx,.ppt,.pages,.wps,.html,.htm" onChange={(e) => void importFile(e.target.files)} />
      <input ref={imgInput} type="file" hidden accept="image/*" multiple onChange={(e) => { if (e.target.files?.length) void insertImages(e.target.files); e.target.value = ""; }} />
      <input ref={refInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.xlsx,.pptx,image/*" onChange={(e) => { if (e.target.files?.length) void uploadRefs(e.target.files); e.target.value = ""; }} />

      {/* The menu bar, slim like Docs' (QA, 2 Oct: it was built but never drawn, so 重命名, 字数统计, 快捷键, 删除线, 分隔线, 全屏, 标尺 and 画面说明 had no way in). */}
      <div className="gd-head">
        <MenuBar menus={menus} />
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="gd-saved" data-state={saveState} onClick={() => saveState === "error" && void save()} title={saveLabel}>
          <GI name="cloud" size={17} />
          <span>{saveLabel}</span>
        </button>
      </div>

      <Toolbar
        editor={editor}
        zh={zh}
        mode={mode}
        setMode={setMode}
        canEdit={me.canEdit}
        zoom={zoom}
        setZoom={setZoom}
        onFind={() => setFind((f) => (f ? null : { term: "", replace: "", current: 0, withReplace: true }))}
        onPrint={print}
        onLink={() => setDialog("link")}
        onComment={startComment}
        onImage={() => imgInput.current?.click()}
      />

      <div className="gd-actions">
        <button type="button" className="gd-big" onClick={() => setPicking(true)}><GI name="outline" size={16} />{t("所有脚本", "All scripts")}</button>
        {me.canEdit ? (
          <BigDrop icon="upload" label={t("导入文档", "Import")}>
            {(close) => (
              <>
                <button type="button" className="gd-menu-item" onClick={() => { close(); importMode.current = "replace"; importInput.current?.click(); }}>{t("用文件替换现在的稿子", "Replace with a file")}</button>
                <button type="button" className="gd-menu-item" onClick={() => { close(); importMode.current = "append"; importInput.current?.click(); }}>{t("把文件内容接在后面", "Add a file's text at the end")}</button>
                <label className="gd-menu-item" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderTop: "1px solid #eceef1", color: "#5f6368", fontSize: 13 }}>
                  <input type="checkbox" checked={importAsRef} onChange={(e) => setImportAsRef(e.target.checked)} style={{ margin: 0 }} />
                  {t("同时把原文件放进参考资料", "Also keep the file in References")}
                </label>
              </>
            )}
          </BigDrop>
        ) : null}
        <BigDrop icon="download" label={t("导出 / 下载", "Export")}>
          {(close) => (
            <>
              {([["docx", t("Word 文档 (.docx)", "Word (.docx)")], ["pdf", "PDF (.pdf)"], ["txt", t("纯文本 (.txt)", "Plain text (.txt)")], ["md", "Markdown (.md)"]] as const).map(([f, label]) => (
                <a key={f} href={exportHref(f)} download className="gd-menu-item" onClick={close}>{label}</a>
              ))}
            </>
          )}
        </BigDrop>
        <button type="button" className="gd-big" onClick={print}><GI name="print" size={16} />{t("打印", "Print")}</button>
        <button type="button" className="gd-big" onClick={() => setPanel("versions")}><GI name="history" size={16} />{t("版本记录", "Versions")}</button>
        <button type="button" className="gd-big" onClick={() => setSharing(true)}><GI name="lock" size={16} />{t("分享链接", "Share link")}</button>
        {props.canManageAccess ? (
          <button type="button" className="gd-big" onClick={() => setAccessOpen(true)}>
            <GI name="people" size={16} />
            {props.access?.mode === "private" ? t("谁能看：仅自己", "Access: only me") : props.access?.mode === "everyone" ? t("谁能看：全工作室", "Access: everyone") : props.access?.mode === "groups" ? t("谁能看：部分分组", "Access: groups") : t(`谁能看：${props.access?.userIds?.length ?? 0} 人`, "Access: people")}
          </button>
        ) : null}
        {script ? (
          <span className="gd-big gd-length" title={t("视频时长", "Video length")}>
            <GI name="clock" size={16} />
            <span>{t("时长", "Length")}</span>
            <span key={`len-${docState.seconds}`}>{clock(docState.seconds, zh)}</span>
            <span style={{ color: "#8a8a8a", fontWeight: 500 }}>/ {t("目标", "target")}</span>
            <select
              value={String(script.targetSeconds ?? 180)}
              disabled={!me.canEdit || pending}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  const v = window.prompt(t("目标时长（分钟，可以写小数，如 2.5）", "Target length in minutes (e.g. 2.5)"), String(Math.round(((script.targetSeconds ?? 180) / 60) * 10) / 10));
                  const n = Math.round(Number(v) * 60);
                  if (v !== null && n >= 10 && n <= 3600) setLength(n);
                  return;
                }
                setLength(Number(e.target.value));
              }}
              aria-label={t("目标时长", "Target length")}
            >
              {[30, 60, 90, 180, 300, 480, 600].concat(script.targetSeconds && ![30, 60, 90, 180, 300, 480, 600].includes(script.targetSeconds) ? [script.targetSeconds] : []).map((n) => (
                <option key={n} value={n}>{n < 60 ? t(`${n} 秒`, `${n}s`) : t(`${Math.round((n / 60) * 10) / 10} 分钟`, `${Math.round((n / 60) * 10) / 10} min`)}</option>
              ))}
              <option value="custom">{t("自定义…", "Custom…")}</option>
            </select>
            {me.canEdit && Math.abs(docState.seconds - (script.targetSeconds ?? 180)) > (script.targetSeconds ?? 180) * 0.15 ? (
              <button type="button" className="gd-length-fit" disabled={thinking || Boolean(proposal)} onClick={() => fitToLength(script.targetSeconds ?? 180)}>
                <span key={docState.seconds < (script.targetSeconds ?? 180) ? "more" : "less"}>{docState.seconds < (script.targetSeconds ?? 180) ? t("让编剧扩写到目标", "Expand to target") : t("让编剧精简到目标", "Trim to target")}</span>
              </button>
            ) : null}
          </span>
        ) : null}
        <label className="gd-big" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={shots} onChange={() => setShots((v) => !v)} style={{ width: 15, height: 15 }} />
          {t("画面说明", "Shot notes")}
        </label>
      </div>

      {statusLine()}
      {noteOpen ? (
        <div className="gd-strip">
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t("要改什么？例如：开头太慢，第二段数字要写出处。编剧会据此给出逐段改法。", "What should change? The writer turns it into concrete edits.")} className="gd-note" />
          <button type="button" className="gd-status-btn primary" disabled={pending} onClick={sendNote}>{t("发送意见", "Send")}</button>
          <button type="button" className="gd-status-btn" onClick={() => setNoteOpen(false)}>{t("取消", "Cancel")}</button>
        </div>
      ) : null}
      {lockPrompt && locked ? (
        <div className="gd-strip warn">
          <span style={{ flexGrow: 1 }}>{t(`这份脚本已经批准（第 ${script!.lockedVersion} 版）。继续编辑会生成第 ${(script!.version ?? 0) + 1} 版，需要重新批准。`, `Approved as v${script!.lockedVersion}. Editing makes v${(script!.version ?? 0) + 1}, which needs approving again.`)}</span>
          <button type="button" className="gd-status-btn primary" disabled={pending} onClick={unlockNow}>{t("继续编辑", "Continue editing")}</button>
          <button type="button" className="gd-status-btn" onClick={() => setLockPrompt(false)}>{t("不改了", "Never mind")}</button>
        </div>
      ) : null}
      {proposal ? (
        <div className="gd-strip ai">
          <GI name="sparkle" size={16} />
          <span style={{ flexGrow: 1, minWidth: 160 }}>
            <b>{proposal.source === "sendback" ? t("按退回意见的改法", "Edits for the note") : t("编剧的修改建议", "The writer's edits")}</b>
            {t(` · 还剩 ${trackedLeft} 处`, ` · ${trackedLeft} left`)}
            <span className="gd-status-dim">{t(" · 点文中的修改可以逐处接受或拒绝，处理完就能直接改字", " · click a change to take or drop it; then type freely")}</span>
            {proposal.summary ? <span className="gd-status-dim"> — {proposal.summary}</span> : null}
          </span>
          <button
            type="button"
            className="gd-status-btn primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                /* The draft as it was, kept as a version first, so the AI's edits can be undone from 版本. */
                await save();
                if (!locked) await saveVersionAction(projectId, t("AI 改写前", "Before the AI edits")).catch(() => null);
                const ids = trackedNow().map((x) => x.id);
                applyTracked(ids);
                endProposalIfDone([], proposal.source);
                notify(t("已接受全部修改（改之前的稿子存成了一个版本）", "All changes accepted (the draft before them is kept as a version)"), "ok");
                router.refresh();
              })
            }
          >
            {t("接受全部", "Accept all")}
          </button>
          {/* Catherine, 29 Sep: "can I edit the text myself? I can only accept or reject" — accept, then the page is yours to type in. */}
          <button
            type="button"
            className="gd-status-btn"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await save();
                if (!locked) await saveVersionAction(projectId, t("AI 改写前", "Before the AI edits")).catch(() => null);
                applyTracked(trackedNow().map((x) => x.id));
                endProposalIfDone([], proposal.source);
                setModeRaw("edit");
                notify(t("已接受，现在可以直接改文字", "Accepted; type straight into the page"), "ok");
                window.setTimeout(() => editor?.commands.focus("end"), 80);
              })
            }
          >
            {t("接受后自己改", "Accept, then edit")}
          </button>
          <button type="button" className="gd-status-btn" onClick={() => { rejectTracked(trackedNow().map((x) => x.id)); setProposal(null); window.setTimeout(() => editor?.commands.focus("end"), 80); }}>{t("全部拒绝", "Reject all")}</button>
        </div>
      ) : null}
      {viewing ? (
        <div className="gd-strip">
          <GI name="history" size={16} />
          <span style={{ flexGrow: 1 }}>{t(`正在看第 ${viewing.versionNo} 版（只读）`, `Viewing v${viewing.versionNo} (read-only)`)}</span>
          {me.canEdit ? (
            <button
              type="button"
              className="gd-status-btn primary"
              disabled={pending}
              onClick={() => {
                if (!window.confirm(t(`用第 ${viewing.versionNo} 版替换现在的稿子？现在的稿子会先存成一个版本。`, `Replace the draft with v${viewing.versionNo}? The current draft is kept as a version first.`))) return;
                start(async () => {
                  /* Typing not saved yet goes in first: it becomes the 「恢复旧版本前的稿子」 version. */
                  await save();
                  const r = await restoreDocVersionAction(projectId, viewing.versionNo);
                  if ("error" in r && r.error) return notify(r.error);
                  /* Load the restored text now and mark the page clean, so no autosave can write over it. */
                  savedSeq.current = editSeq.current;
                  if ("doc" in r && r.doc && editor) {
                    lastDoc.current = JSON.stringify(r.doc);
                    editor.chain().setMeta("gd-remote", true).setContent(r.doc as never, { emitUpdate: false }).run();
                  } else {
                    lastDoc.current = "";
                  }
                  setSaveState("saved");
                  setViewing(null);
                  setUnlocked(false);
                  notify(t("已恢复", "Restored"), "ok");
                  router.refresh();
                });
              }}
            >
              {t("恢复此版本", "Restore this version")}
            </button>
          ) : null}
          <button type="button" className="gd-status-btn" onClick={() => setViewing(null)}>{t("返回当前稿", "Back to the draft")}</button>
        </div>
      ) : null}
      {find ? (
        <div className="gd-find-bar">
          <GI name="search" size={16} style={{ color: "#5f6368" }} />
          <input autoFocus className="gd-find-input" placeholder={t("在文档中查找", "Find in document")} value={find.term} onChange={(e) => setFind({ ...find, term: e.target.value, current: 0 })} onKeyDown={(e) => { if (e.key === "Enter") gotoMatch(find.current + (e.shiftKey ? -1 : 1)); if (e.key === "Escape") setFind(null); }} />
          <span style={{ fontSize: 12.5, color: "#5f6368", minWidth: 54 }}>{find.term ? (matches.length ? `${Math.min(find.current + 1, matches.length)} / ${matches.length}` : t("无结果", "No results")) : ""}</span>
          <button type="button" className="gd-icon" onClick={() => gotoMatch(find.current - 1)} aria-label={t("上一个", "Previous")} title={t("上一个", "Previous")}><GI name="up" size={17} /></button>
          <button type="button" className="gd-icon" onClick={() => gotoMatch(find.current + 1)} aria-label={t("下一个", "Next")} title={t("下一个", "Next")}><GI name="chevron" size={17} /></button>
          {find.withReplace ? (
            <>
              <input className="gd-find-input" placeholder={t("替换为", "Replace with")} value={find.replace} onChange={(e) => setFind({ ...find, replace: e.target.value })} />
              <button type="button" className="gd-status-btn" disabled={!editable || !matches.length} onClick={replaceOne}>{t("替换", "Replace")}</button>
              <button type="button" className="gd-status-btn" disabled={!editable || !matches.length} onClick={replaceAll}>{t("全部替换", "Replace all")}</button>
            </>
          ) : (
            <button type="button" className="gd-link" onClick={() => setFind({ ...find, withReplace: true })}>{t("替换…", "Replace…")}</button>
          )}
          <button type="button" className="gd-icon" onClick={() => setFind(null)} aria-label={t("关闭查找", "Close find")} title={t("关闭查找", "Close find")}><GI name="x" size={17} /></button>
        </div>
      ) : null}

      {/* ---- body ---- */}
      <div className="gd-body">
        {outline ? (
          <aside className="gd-outline">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <button type="button" className="gd-icon" onClick={() => setOutline(false)} aria-label={t("收起大纲", "Hide outline")} title={t("收起大纲", "Hide outline")}>
                <GI name="left" size={20} />
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 500, color: "#1f1f1f", flexGrow: 1 }}>{t("文档大纲", "Document outline")}</span>
            </div>
            <div className="gd-tab-pill">
              <GI name="outline" size={17} />
              <span style={{ flexGrow: 1 }}>{t("脚本", "Script")}</span>
              <span key={`ol-${docState.seconds}`} style={{ fontSize: 12, color: "#5f6368" }}>{clock(docState.seconds, zh)}</span>
            </div>
            {docState.headings.length ? (
              <nav style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 10 }}>
                {docState.headings.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    className="gd-outline-item"
                    style={{ paddingLeft: 12 + (h.level - 1) * 14, fontWeight: h.level === 1 ? 500 : 400 }}
                    onClick={() => {
                      if (!editor) return;
                      editor.commands.setTextSelection(h.pos + 1);
                      try {
                        const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null;
                        dom?.scrollIntoView({ behavior: "smooth", block: "start" });
                      } catch {
                        /* gone */
                      }
                    }}
                  >
                    {h.text || t("（空标题）", "(empty heading)")}
                  </button>
                ))}
              </nav>
            ) : (
              <p style={{ fontSize: 13, fontStyle: "italic", color: "#444746", lineHeight: 1.5, margin: "12px 4px 0" }}>{t("你在文档中添加的标题会显示在这里。", "Headings that you add to the document will appear here.")}</p>
            )}
          </aside>
        ) : (
          <button type="button" className="gd-outline-open" onClick={() => setOutline(true)} title={t("显示大纲", "Show outline")} aria-label={t("显示大纲", "Show outline")}>
            <GI name="outline" size={20} />
          </button>
        )}

        <div className="gd-canvas" ref={canvas}>
          {ruler ? (
            <div className="gd-ruler-wrap">
              <div className="gd-ruler" style={{ width: 816 * z }}>
                {Array.from({ length: 17 }, (_, i) => (
                  <span key={i} style={{ left: `${((i * 37.8 + 96) / 816) * 100}%` }}>{i === 0 ? "" : i}</span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="gd-sheet-scroll" style={wide ? { overflowX: "auto" } : undefined}>
          <div className="gd-sheet-row" style={{ zoom: z }}>
            <div className="gd-sheet" ref={sheet} onMouseDown={() => { if (locked && me.canEdit && mode === "edit") setLockPrompt(true); }}>
              {noScript ? (
                <div className="gd-empty">
                  <div style={{ fontSize: 22, fontWeight: 500, color: "#1f1f1f" }}>{t("这份脚本还没开始", "No script yet")}</div>
                  <div style={{ fontSize: 14, color: "#5f6368" }}>{t("让编剧按选题写一版初稿，或者自己动手写。", "Have the writer draft it from the topic, or write it yourself.")}</div>
                  {me.canEdit ? (
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
                      <button type="button" className="gd-status-btn primary big" disabled={pending} onClick={() => start(async () => { const r = await startFromTopicAction({ kind: "project", id: projectId }, { write: true, rewrite: false }); if ("error" in r && r.error) return notify(r.error); if ("note" in r && r.note) notify(r.note); router.refresh(); })}>
                        {t("让编剧写初稿", "Have the writer draft it")}
                      </button>
                      <button type="button" className="gd-status-btn big" disabled={pending} onClick={() => start(async () => { const r = await startBlankAction(projectId); if ("error" in r && r.error) return notify(r.error); router.refresh(); })}>
                        {t("自己写", "Write it myself")}
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#5f6368" }}>{t("你没有脚本模块的权限，等同事写好。", "You need the Script module to write it.")}</div>
                  )}
                </div>
              ) : viewing?.doc ? (
                /* The version as it was written, headings and bold included (QA, 2 Oct). Built and escaped by richToHtml from the JSON. */
                <div className="gd-prose gd-readonly notranslate" translate="no" dangerouslySetInnerHTML={{ __html: richToHtml(viewing.doc, { natural: t("（现场声，无口播）", "(natural sound)") }) }} />
              ) : viewing ? (
                <div className="gd-prose gd-readonly notranslate" translate="no">
                  {viewing.beats.map((b, i) => (
                    <p key={i} data-shot={b.visual || undefined} style={{ color: b.voiceover ? undefined : "#80868b" }}>{b.voiceover || t("（现场声，无口播）", "(natural sound)")}</p>
                  ))}
                </div>
              ) : (
                <EditorContent editor={editor} />
              )}
            </div>
            {/* the right margin: comments */}
            <div className="gd-margin" style={marginOn ? undefined : { display: "none" }}>
              {!noScript && !viewing
                ? openComments.map((c) =>
                    cardTops[c.id] !== undefined ? (
                      <div key={c.id} className="gd-card" data-card={c.id} data-on={activeComment === c.id ? "1" : undefined} style={{ top: cardTops[c.id] }} onClick={() => setActiveComment(c.id)}>
                        <CommentThread c={c} replies={repliesOf.get(c.id) ?? []} projectId={projectId} me={me} zh={zh} now={now} onResize={() => window.requestAnimationFrame(layoutCards)} onResolve={() => start(async () => { await resolveCommentAction(projectId, c.id); router.refresh(); })} />
                      </div>
                    ) : null,
                  )
                : null}
              {draft && marginOn ? (
                <div className="gd-card on" style={{ top: draft.top, zIndex: 3 }}>
                  {composer}
                </div>
              ) : selTop !== null && !noScript && !viewing ? (
                <button type="button" className="gd-add-comment" style={{ top: selTop }} onMouseDown={(e) => e.preventDefault()} onClick={startComment} title={t("添加批注", "Add comment")}>
                  <GI name="comment" size={18} />
                </button>
              ) : null}
            </div>
          </div>
          </div>

          {/* the floating AI bar: always at hand at the bottom of the page (the owner, 29 Sep: the side panel alone is not intuitive) */}
          {/* Not in 查看 mode: that is for reading (QA, 2 Oct). */}
          {me.canEdit && script && !noScript && mode !== "view" && !viewing ? (
            <div className="gd-ai-dock">
              {refAtt.attached.length ? <div style={{ display: "flex", justifyContent: "center" }}><AttachChips zh={zh} attached={refAtt.attached} onRemove={refAtt.remove} /></div> : null}
              {askFocus && !thinking ? (
                <div className="gd-ai-chips" onMouseDown={(e) => e.preventDefault()}>
                  {CHIPS.map((c) => (
                    <button key={c.zh} type="button" className="gd-chip" onClick={() => runCopilot(zh ? c.zh : c.en)}>
                      {zh ? c.zh : c.en}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="gd-ai-bar" data-busy={thinking ? "1" : undefined}>
                <span className="gd-ai-mark"><GI name="sparkle" size={18} /></span>
                <input
                  ref={askBox}
                  className="gd-ai-input"
                  value={ask}
                  disabled={thinking || Boolean(proposal)}
                  onChange={(e) => setAsk(e.target.value)}
                  onFocus={() => setAskFocus(true)}
                  onBlur={() => window.setTimeout(() => setAskFocus(false), 120)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) runCopilot(); }}
                  onPaste={refAtt.onPaste}
                  placeholder={thinking ? t("编剧正在改…", "The writer is on it…") : proposal ? t("先处理上面的修改建议", "Deal with the suggested edits first") : t("描述你想怎么改这份稿子…（可以附范例文件）", "Describe how to change this script… (attach a sample)")}
                />
                <AttachButton zh={zh} onFiles={refAtt.add} size={30} title={t("附参考文件：范例、资料、截图，只用于这次修改", "Attach a sample or notes for this edit")} />
                <ModelChip value={pickModel} onChange={setPickModel} zh={zh} placement="up" align="right" />
                <button type="button" className="gd-ai-send" disabled={thinking || !ask.trim() || Boolean(proposal)} onClick={() => runCopilot()} aria-label={t("发送", "Send")}>
                  {thinking ? <span className="gd-spin" /> : <GI name="send" size={18} />}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {panel ? (
          <aside className="gd-side">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <div className="gd-side-tabs" role="tablist">
                {(["ai", "comments", "versions"] as const).map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={panel === k} className="gd-side-tab" data-on={panel === k ? "1" : undefined} onClick={() => setPanel(k)}>
                    {k === "ai" ? t("AI 助手", "AI") : k === "comments" ? t(`批注${openComments.length ? ` ${openComments.length}` : ""}`, "Comments") : t("版本", "Versions")}
                  </button>
                ))}
              </div>
            </div>
            {panel === "ai" ? (
              <div className="gd-ai-panel">
                <div className="gd-ai-who">
                  <AgentIcon agent="script" size={36} radius={10} />
                  <div style={{ minWidth: 0, flexGrow: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{t("编剧", "The writer")}</div>
                    <div style={{ fontSize: 12.5, color: thinking ? "#1a73e8" : "#5f6368" }}>{thinking ? t("正在改稿…", "Rewriting…") : t("告诉我怎么改，改法会标在文档里", "Say how to change it")}</div>
                  </div>
                </div>

                {aiLog.length ? (
                  <div className="gd-ai-log">
                    {aiLog.map((m, i) => (
                      <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className="gd-ai-q">{m.q.length > 80 ? `${m.q.slice(0, 80)}…` : m.q}</div>
                        <div className="gd-ai-a">{m.a ?? (thinking && i === aiLog.length - 1 ? t("正在改…", "Working…") : t("没有改动", "No changes"))}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {me.canEdit && !viewing && mode !== "view" ? (
                  <>
                    <div className="gd-ai-label">{t("一键改", "One-press edits")}</div>
                    <div className="gd-ai-grid">
                      {CHIPS.map((c) => (
                        <button key={c.zh} type="button" className="gd-ai-action" disabled={thinking || Boolean(proposal)} onClick={() => runCopilot(zh ? c.zh : c.en)}>
                          {zh ? c.zh.replace(/（.*）/, "") : c.en}
                        </button>
                      ))}
                    </div>
                    <div className="gd-ai-label">{t("换个风格", "Change the style")}</div>
                    <div className="gd-ai-grid">
                      {STYLES.map((c) => (
                        <button key={c.label} type="button" className="gd-ai-action" disabled={thinking || Boolean(proposal)} onClick={() => runCopilot(zh ? c.zh : c.en)} title={zh ? c.zh : c.en}>
                          {zh ? c.label : c.en}
                        </button>
                      ))}
                    </div>
                    <div className="gd-ai-compose">
                      <AttachChips zh={zh} attached={refAtt.attached} onRemove={refAtt.remove} />
                      <textarea
                        onPaste={refAtt.onPaste}
                        ref={askBox as unknown as React.RefObject<HTMLTextAreaElement>}
                        value={ask}
                        rows={3}
                        disabled={thinking || Boolean(proposal)}
                        onChange={(e) => setAsk(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); runCopilot(); } }}
                        placeholder={thinking ? t("编剧正在改…", "The writer is on it…") : proposal ? t("先处理文档里的修改建议", "Deal with the suggested edits first") : t("想怎么改？例如：开头更抓人，第二段加一个真实数据", "How should it change?")}
                      />
                      <div className="gd-ai-row">
                        <AttachButton zh={zh} onFiles={refAtt.add} size={28} title={t("附参考文件：范例、资料、截图，只用于这次修改", "Attach a sample or notes for this edit")} />
                        <ModelChip value={pickModel} onChange={setPickModel} zh={zh} placement="up" align="left" />
                        <span style={{ flexGrow: 1 }} />
                        <button type="button" className="gd-ai-go" disabled={thinking || !ask.trim() || Boolean(proposal)} onClick={() => runCopilot()}>
                          {thinking ? <span className="gd-spin" /> : <GI name="send" size={16} />}
                          {t("让编剧改", "Rewrite")}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                <div className="gd-ai-refs" onDragOver={(e) => { if (me.canEdit) e.preventDefault(); }} onDrop={(e) => { if (!me.canEdit || !e.dataTransfer.files.length) return; e.preventDefault(); void uploadRefs(e.dataTransfer.files); }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <GI name="paperclip" size={16} />
                    <span style={{ fontSize: 14, fontWeight: 600, flexGrow: 1 }}>{t("参考资料", "References")}</span>
                    {me.canEdit ? <button type="button" className="gd-ai-up" onClick={() => refInput.current?.click()}><GI name="upload" size={14} />{t("上传", "Upload")}</button> : null}
                  </div>
                  {props.references.map((f) => (
                    <div key={f.id} className="gd-ref">
                      <GI name="doc" size={14} />
                      <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" title={f.name}>{f.name}</a>
                      {!f.hasText ? <span style={{ fontSize: 11, color: refPollUntil ? "#5f6368" : "#b06000", whiteSpace: "nowrap" }}>{refPollUntil ? t("读取中…", "Reading…") : t("无文字", "no text")}</span> : null}
                      {me.canEdit ? <button type="button" className="gd-icon" aria-label={t("移除", "Remove")} onClick={() => start(async () => { await removeReferenceAction(projectId, f.id); router.refresh(); })}><GI name="x" size={14} /></button> : null}
                    </div>
                  ))}
                  {uploading.map((u) => (
                    <div key={u.name} className="gd-ref" style={{ color: "#5f6368" }}>
                      <GI name="upload" size={14} />
                      <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                      <span style={{ fontSize: 11 }}>{u.pct}%</span>
                    </div>
                  ))}
                  {!props.references.length && !uploading.length ? <div className="gd-ai-drop">{t("把范例、采访稿、数据拖到这里，编剧改稿时会读", "Drop examples, notes or data here")}</div> : null}
                </div>
                <Link href="/train/script" prefetch={false} className="gd-link" style={{ fontSize: 13 }}>{t("训练编剧：写长期说明、上传范例 →", "Train the writer →")}</Link>
              </div>
            ) : null}
            {panel === "versions" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="gd-version-now">
                  <button type="button" className="gd-version" data-on={!viewing ? "1" : undefined} onClick={() => setViewing(null)} style={{ border: 0, padding: 0, background: "transparent" }}>
                    <b style={{ fontSize: 13.5 }}>{t("当前稿（正在写）", "Current draft")}</b>
                    <span key={`vc-${docState.count}`} style={{ fontSize: 12, color: "#5f6368" }}>{t(`${docState.count} 字 · 约 ${clock(docState.seconds, zh)} · 自动保存`, `${docState.count} words · ~${clock(docState.seconds, zh)} · autosaved`)}</span>
                  </button>
                  <div style={{ fontSize: 12, color: "#5f6368", lineHeight: 1.5 }}>
                    {t("改动会自动存进当前稿。想留一个能随时找回的版本，点下面的按钮；发给同事审阅、批准时也会自动存一版。", "Edits save into the draft. Save a version to keep a copy you can go back to; sending for review or approving saves one too.")}
                  </div>
                  {me.canEdit && !locked ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={versionNote} onChange={(e) => setVersionNote(e.target.value)} placeholder={t("备注（可不填）", "Note (optional)")} style={{ flexGrow: 1, minWidth: 0, height: 34, border: "1px solid #d3d3d0", borderRadius: 8, padding: "0 10px", font: "inherit", fontSize: 13 }} />
                      <button
                        type="button"
                        className="gd-ai-go"
                        disabled={pending || docState.count === 0}
                        onClick={() =>
                          start(async () => {
                            await save();
                            const r = await saveVersionAction(projectId, versionNote.trim() || null);
                            if ("error" in r && r.error) return notify(r.error);
                            setVersionNote("");
                            notify(t(`已存为第 ${"versionNo" in r ? r.versionNo : ""} 版`, `Saved as v${"versionNo" in r ? r.versionNo : ""}`), "ok");
                            router.refresh();
                          })
                        }
                      >
                        {t("保存为新版本", "Save a version")}
                      </button>
                    </div>
                  ) : null}
                </div>
                {props.versions.map((v) => {
                  const isLocked = script?.lockedVersion === v.versionNo;
                  const inReview = open.some((a) => a.versionNo === v.versionNo);
                  return (
                    <button
                      key={v.versionNo}
                      type="button"
                      className="gd-version"
                      data-on={viewing?.versionNo === v.versionNo ? "1" : undefined}
                      onClick={() =>
                        start(async () => {
                          const r = await versionBeatsAction(projectId, v.versionNo);
                          if ("error" in r && r.error) return notify(r.error);
                          if ("beats" in r) setViewing({ versionNo: v.versionNo, beats: r.beats, doc: r.doc ?? null });
                        })
                      }
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <b style={{ fontSize: 13.5 }}>{t(`第 ${v.versionNo} 版`, `v${v.versionNo}`)}</b>
                        {isLocked ? <span className="gd-badge ok">{t("已批准", "Approved")}</span> : null}
                        {inReview ? <span className="gd-badge wait">{t("审阅中", "In review")}</span> : null}
                        {v.model ? <span className="gd-badge ai">AI</span> : null}
                      </span>
                      <span style={{ fontSize: 12, color: "#5f6368" }}>{v.authorName ?? "—"} · {ago(v.createdAt, zh, now)} · {t(`${v.wordCount} 字`, `${v.wordCount} words`)}</span>
                      {v.note ? <span style={{ fontSize: 12.5, color: "#1f1f1f", lineHeight: 1.45, overflowWrap: "anywhere" }}>{noteText(v.note, zh)}</span> : null}
                    </button>
                  );
                })}
                {!props.versions.length ? <div style={{ fontSize: 13, color: "#80868b" }}>{t("还没有存过版本。分享审阅时会自动存一版。", "No versions yet. Sharing for review saves one.")}</div> : null}
              </div>
            ) : null}
            {panel === "comments" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {draft && !marginOn ? <div className="gd-card static on">{composer}</div> : null}
                {threads.length ? (
                  threads.map((c) => (
                    <div key={c.id} className="gd-card static" data-on={activeComment === c.id ? "1" : undefined} style={{ opacity: c.resolvedAt ? 0.6 : 1 }} onClick={() => jumpTo(c)}>
                      <CommentThread c={c} replies={repliesOf.get(c.id) ?? []} projectId={projectId} me={me} zh={zh} now={now} resolved={Boolean(c.resolvedAt)} onResolve={() => start(async () => { await resolveCommentAction(projectId, c.id, Boolean(c.resolvedAt)); router.refresh(); })} />
                    </div>
                  ))
                ) : (
                  draft && !marginOn ? null : <div style={{ fontSize: 13, color: "#80868b" }}>{t("还没有批注。选中文字，点工具栏的批注按钮。", "No comments yet. Select text and press the comment button.")}</div>
                )}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

      {/* ---- dialogs ---- */}
      {dialog === "count" ? (
        <Modal title={t("字数统计", "Word count")} onClose={() => setDialog(null)} width={380} closeLabel={t("关闭", "Close")}>
          <table className="gd-count">
            <tbody>
              <tr><td>{t("字数（汉字 + 英文单词）", "Words")}</td><td>{docState.count}</td></tr>
              <tr><td>{t("汉字", "Chinese characters")}</td><td>{docState.cjk}</td></tr>
              <tr><td>{t("英文单词", "English words")}</td><td>{docState.words}</td></tr>
              <tr><td>{t("口播段落", "Spoken paragraphs")}</td><td>{docState.paragraphs}</td></tr>
              <tr><td>{t("预计口播时长", "Estimated spoken length")}</td><td>{clock(docState.seconds, zh)}</td></tr>
              {target ? <tr><td>{t("目标时长", "Target length")}</td><td>{clock(target, zh)}</td></tr> : null}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: "#5f6368", marginTop: 10 }}>{t("标题不计入口播；按每秒约 4.5 个汉字估算。", "Headings are not spoken; about 4.5 Chinese characters a second.")}</div>
        </Modal>
      ) : null}
      {dialog === "keys" ? (
        <Modal title={t("键盘快捷键", "Keyboard shortcuts")} onClose={() => setDialog(null)} width={480} closeLabel={t("关闭", "Close")}>
          <table className="gd-count">
            <tbody>
              {(
                [
                  [t("粗体 / 斜体 / 下划线", "Bold / italic / underline"), `${MOD}B / ${MOD}I / ${MOD}U`],
                  [t("插入链接", "Insert link"), `${MOD}K`],
                  [t("标题 1–3", "Headings 1–3"), isMac ? "⌘⌥1 – ⌘⌥3" : "Ctrl+Alt+1 – 3"],
                  [t("正文", "Normal text"), isMac ? "⌘⌥0" : "Ctrl+Alt+0"],
                  [t("编号列表 / 项目符号 / 清单", "Numbered / bulleted / checklist"), isMac ? "⌘⇧7 / ⌘⇧8 / ⌘⇧9" : "Ctrl+Shift+7 / 8 / 9"],
                  [t("添加批注", "Add comment"), isMac ? "⌘⌥M" : "Ctrl+Alt+M"],
                  [t("查找 / 查找和替换", "Find / find and replace"), `${MOD}F / ${MOD}H`],
                  [t("撤销 / 重做", "Undo / redo"), `${MOD}Z / ${MOD}Y`],
                  [t("清除格式", "Clear formatting"), `${MOD}\\`],
                  [t("删除线", "Strikethrough"), isMac ? "⌘⇧X" : "Ctrl+Shift+X"],
                  [t("字数统计", "Word count"), isMac ? "⌘⇧C" : "Ctrl+Shift+C"],
                  [t("键盘快捷键", "Keyboard shortcuts"), `${MOD}/`],
                  [t("保存", "Save"), `${MOD}S`],
                  [t("打印", "Print"), `${MOD}P`],
                ] as [string, string][]
              ).map(([a, b]) => (
                <tr key={a}><td>{a}</td><td style={{ fontFamily: "ui-monospace,monospace", fontSize: 12.5 }}>{b}</td></tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
      {dialog === "rename" ? (
        <PromptModal title={t("重命名", "Rename")} label={t("标题", "Title")} initial={title} zh={zh} onClose={() => setDialog(null)} onOk={(v) => { setTitle(v); renameTo(v); }} />
      ) : null}
      {dialog === "link" && editor ? (
        <PromptModal title={t("插入链接", "Insert link")} label={t("链接地址", "Link")} initial={(editor.getAttributes("link").href as string | undefined) ?? "https://"} zh={zh} onClose={() => setDialog(null)} extra={editor.isActive("link") ? { label: t("移除链接", "Remove link"), run: () => editor.chain().focus().extendMarkRange("link").unsetLink().run() } : undefined} onOk={(v) => { const href = v.trim(); if (!href || href === "https://") return; if (editor.state.selection.empty) editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run(); else editor.chain().focus().extendMarkRange("link").setLink({ href }).run(); }} />
      ) : null}
      {dialog === "shot" && editor ? (
        <PromptModal
          title={t("画面说明", "Shot note")}
          label={t("这一段拍什么（镜头、画面、字幕卡…）", "What this paragraph shows (framing, b-roll, on-screen text…)")}
          initial={(editor.getAttributes("paragraph").shot as string | undefined) ?? ""}
          zh={zh}
          onClose={() => setDialog(null)}
          onOk={(v) => { editor.chain().focus().updateAttributes("paragraph", { shot: v.trim() || null }).run(); setShots(true); }}
        />
      ) : null}

      {picking ? <ScriptPicker zh={zh} currentId={script?.id} onClose={() => setPicking(false)} /> : null}
      {accessOpen && props.access ? (
        <AccessPicker
          title={t("谁可以看到并参与这个项目？", "Who can see and work on this project?")}
          zh={zh}
          initial={props.access.mode === "groups" ? { mode: "groups", groups: props.access.groups ?? [] } : props.access.mode === "people" ? { mode: "people", userIds: props.access.userIds ?? [] } : { mode: props.access.mode }}
          confirm={t("保存", "Save")}
          note={t("稿子、剪辑和对话都跟着这个设置。AI 员工始终可以参与。", "The script, edit and chat follow this.")}
          onClose={() => setAccessOpen(false)}
          onConfirm={(choice) =>
            start(async () => {
              const r = await setProjectAccessAction(projectId, choice as Parameters<typeof setProjectAccessAction>[1]);
              if (r?.error) notify(r.error);
              else notify(t("已保存", "Saved"), "ok");
              setAccessOpen(false);
              router.refresh();
            })
          }
        />
      ) : null}
      {sharing ? (
        <ShareDialog
          onManageAccess={props.canManageAccess ? () => { setSharing(false); setAccessOpen(true); } : undefined}
          zh={zh}
          title={t(`分享脚本《${props.projectTitle}》`, `Share “${props.projectTitle}”`)}
          url={`/projects/${projectId}/script`}
          accessNote={props.accessNote}
          linkAccess={props.linkAccess ?? null}
          onLinkAccess={
            props.canManageAccess
              ? async (v) => {
                  const r = await setProjectLinkAction(projectId, v);
                  if (r?.error) return notify(r.error);
                  notify(v === "edit" ? t("有链接的人现在可以编辑", "Anyone with the link can now edit") : v === "view" ? t("有链接的人现在可以查看", "Anyone with the link can now view") : t("只有能看到项目的人能打开", "Only people who can see the project can open it"), "ok");
                  router.refresh();
                }
              : undefined
          }
          people={props.people}
          meId={me.id}
          allowReview={!locked}
          defaultAsk={locked ? "view" : "review"}
          onClose={() => setSharing(false)}
          onSend={async (userIds, askFor, message) => {
            await save();
            const r = await shareScriptAction(projectId, { userIds, ask: askFor, message });
            if ("error" in r) return { error: r.error };
            const n = r.sent;
            notify(askFor === "review" ? t(`已发给 ${n} 人审阅`, `Sent to ${n} for review`) : t(`已分享给 ${n} 人`, `Shared with ${n}`), "ok");
            router.refresh();
            return { ok: true };
          }}
        />
      ) : null}
    </div>
  );
}

function Status({ tone, text, children }: { tone: "run" | "ok" | "you" | "wait" | "draft"; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="gd-status" data-tone={tone}>
      <span className="gd-status-dot" />
      <span style={{ flexGrow: 1, minWidth: 200 }}>{text}</span>
      {children ? <span style={{ display: "flex", gap: 8, flexWrap: "wrap", minWidth: 0 }}>{children}</span> : null}
    </div>
  );
}

/**
 * A comment with its replies and a 回复 box (QA round 2: comments could not be
 * answered, so a question in the margin got its answer in WeChat). Replies sit
 * indented under the first comment; Ctrl/Cmd+Enter sends, Esc closes the box.
 * The author, or an owner or admin, may delete; deleting the first comment
 * takes the replies with it.
 */
function CommentThread({
  c,
  replies,
  projectId,
  me,
  zh,
  now,
  resolved = false,
  onResolve,
  onResize,
}: {
  c: DocComment;
  replies: DocComment[];
  projectId: string;
  me: { id: string; name: string; avatarUrl: string | null; isAdmin: boolean };
  zh: boolean;
  now: number | null;
  resolved?: boolean;
  onResolve: () => void;
  onResize?: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    onResize?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, replies.length]);
  const canDelete = (x: DocComment) => x.authorId === me.id || me.isAdmin;
  function send() {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      const r = await replyCommentAction(projectId, c.id, body);
      if ("error" in r && r.error) return notify(r.error);
      setText("");
      setOpen(false);
      router.refresh();
    });
  }
  function remove(x: DocComment) {
    const first = x.id === c.id;
    if (!window.confirm(first && replies.length ? t(`删除这条批注和下面的 ${replies.length} 条回复？`, `Delete this comment and its ${replies.length} replies?`) : t("删除这条批注？", "Delete this comment?"))) return;
    start(async () => {
      const r = await deleteCommentAction(projectId, x.id);
      if ("error" in r && r.error) return notify(r.error);
      router.refresh();
    });
  }
  const linkBtn: React.CSSProperties = { border: 0, background: "transparent", padding: 0, font: "inherit", fontSize: 12.5, color: "#0b57d0", cursor: "pointer" };
  return (
    <div onClick={(e) => (open ? e.stopPropagation() : undefined)}>
      <CommentBody c={c} zh={zh} now={now} resolved={resolved} onResolve={onResolve} />
      {replies.length ? (
        <div className="gd-replies">
          {replies.map((r) => (
            <div key={r.id} className="gd-reply">
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <PersonAvatar id={r.authorId} url={r.authorAvatar} name={r.authorName} size={22} />
                <div style={{ minWidth: 0, flexGrow: 1, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#1f1f1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.authorName}</span>
                  <span style={{ fontSize: 11.5, color: "#5f6368", whiteSpace: "nowrap" }}>{ago(r.createdAt, zh, now)}</span>
                </div>
                {canDelete(r) ? (
                  <button type="button" style={{ ...linkBtn, color: "#5f6368", fontSize: 12 }} disabled={pending} onClick={(e) => { e.stopPropagation(); remove(r); }}>
                    {t("删除", "Delete")}
                  </button>
                ) : null}
              </div>
              <div style={{ fontSize: 13.5, color: "#1f1f1f", lineHeight: 1.5, marginTop: 4, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.body}</div>
            </div>
          ))}
        </div>
      ) : null}
      {open ? (
        <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="gd-comment-box"
            placeholder={t("回复…", "Reply…")}
            aria-label={t("回复这条批注", "Reply to this comment")}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button type="button" className="gd-status-btn" onClick={() => setOpen(false)}>{t("取消", "Cancel")}</button>
            <button type="button" className="gd-status-btn blue" disabled={pending || !text.trim()} onClick={send}>{pending ? t("正在发送…", "Sending…") : t("回复", "Reply")}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          <button type="button" style={linkBtn} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
            {replies.length ? t(`回复（${replies.length}）`, `Reply (${replies.length})`) : t("回复", "Reply")}
          </button>
          {canDelete(c) ? (
            <button type="button" style={{ ...linkBtn, color: "#5f6368" }} disabled={pending} onClick={(e) => { e.stopPropagation(); remove(c); }}>
              {t("删除", "Delete")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CommentBody({ c, zh, now, resolved = false, onResolve }: { c: DocComment; zh: boolean; now: number | null; resolved?: boolean; onResolve: () => void }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PersonAvatar id={c.authorId} url={c.authorAvatar} name={c.authorName} size={28} />
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "#1f1f1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.authorName}</div>
          <div style={{ fontSize: 11.5, color: "#5f6368" }}>{ago(c.createdAt, zh, now)}</div>
        </div>
        <button type="button" className="gd-icon" title={resolved ? (zh ? "重新打开" : "Reopen") : zh ? "标记为已解决并隐藏" : "Mark as resolved"} onClick={(e) => { e.stopPropagation(); onResolve(); }}>
          <GI name={resolved ? "undo" : "check"} size={18} style={{ color: resolved ? "#5f6368" : "#1a73e8" }} />
        </button>
      </div>
      {c.quote ? <div className="gd-quote">「{c.quote}」</div> : null}
      <div style={{ fontSize: 13.5, color: "#1f1f1f", lineHeight: 1.5, marginTop: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.body}</div>
    </>
  );
}

function PromptModal({ title, label, initial, zh, onClose, onOk, extra }: { title: string; label: string; initial: string; zh: boolean; onClose: () => void; onOk: (v: string) => void; extra?: { label: string; run: () => void } }) {
  const [v, setV] = React.useState(initial);
  return (
    <Modal title={title} onClose={onClose} closeLabel={zh ? "关闭" : "Close"}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#444746" }}>
        {label}
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onOk(v); onClose(); } }} className="gd-field" />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        {extra ? <button type="button" className="gd-status-btn" style={{ marginRight: "auto" }} onClick={() => { extra.run(); onClose(); }}>{extra.label}</button> : null}
        <button type="button" className="gd-status-btn" onClick={onClose}>{zh ? "取消" : "Cancel"}</button>
        <button type="button" className="gd-status-btn blue" onClick={() => { onOk(v); onClose(); }}>{zh ? "确定" : "OK"}</button>
      </div>
    </Modal>
  );
}

export const GD_CSS = `
/* The whole page scrolls as one — header, tabs, toolbar and paper together (the owner, 30 Sep: "let the whole page scroll so the script gets more room"). */
[data-project-frame]:has([data-gd-root]) { overflow-y: auto !important; }
[data-project-frame]:has([data-gd-root]) > [data-project-body] { flex-shrink: 0; min-height: auto !important; }
[data-script-page] { min-height: auto !important; }
.gd-root { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; background: #f9fbfd; color: #1f1f1f; font-family: "Google Sans", Roboto, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.gd-root:fullscreen { background: #f9fbfd; overflow-y: auto; }
.gd-head { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 4px 16px 0 22px; flex-shrink: 0; position: relative; z-index: 30; }
.gd-title { font: inherit; font-size: 18px; color: #1f1f1f; border: 1px solid transparent; border-radius: 4px; padding: 1px 6px; margin-left: -6px; background: transparent; min-width: 6ch; max-width: 52ch; text-overflow: ellipsis; }
.gd-title:hover:not(:disabled) { border-color: #c7c7c7; }
.gd-title:focus { outline: none; border-color: #1a73e8; box-shadow: inset 0 0 0 1px #1a73e8; }
.gd-saved { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: #444746; font: inherit; font-size: 12.5px; padding: 3px 6px; border-radius: 4px; cursor: default; white-space: nowrap; }
.gd-saved[data-state="error"] { color: #b3261e; cursor: pointer; }
.gd-saved[data-state="saving"] span, .gd-saved[data-state="dirty"] span { color: #5f6368; }
.gd-menubar { display: flex; align-items: center; margin-left: -8px; }
.gd-menubtn { border: 0; background: transparent; font: inherit; font-size: 13.5px; color: #1f1f1f; padding: 3px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.gd-menubtn:hover, .gd-menubtn[data-on] { background: #e3e3e3; }
.gd-menu { position: absolute; top: calc(100% + 2px); left: 0; z-index: 60; min-width: 250px; padding: 6px 0; background: #fff; border-radius: 8px; box-shadow: 0 2px 6px 2px rgba(60,64,67,.15), 0 1px 2px rgba(60,64,67,.3); }
.gd-sub { top: -6px; left: 100%; }
.gd-menu-row { position: relative; }
.gd-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 4px 16px 4px 10px; border: 0; background: transparent; font: inherit; font-size: 14px; color: #1f1f1f; text-align: left; cursor: pointer; text-decoration: none; box-sizing: border-box; }
.gd-menu-item:hover:not(:disabled) { background: #f1f3f4; }
.gd-menu-item:disabled, .gd-menu-item[data-off] { color: #a8a8a8; cursor: default; pointer-events: none; }
.gd-menu-check { width: 22px; display: inline-flex; justify-content: center; color: #444746; flex-shrink: 0; }
.gd-menu-label { flex-grow: 1; white-space: nowrap; }
.gd-menu-key { color: #5f6368; font-size: 12.5px; margin-left: 24px; white-space: nowrap; }
.gd-menu-div { height: 1px; background: #e3e3e3; margin: 6px 0; }
.gd-head-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.gd-icon { display: inline-flex; align-items: center; justify-content: center; position: relative; width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: #444746; cursor: pointer; }
.gd-icon.big { width: 40px; height: 40px; }
.gd-icon:hover, .gd-icon[data-on] { background: #e8eaed; }
.gd-spark { color: #1a73e8; }
.gd-dot { position: absolute; top: 3px; right: 2px; min-width: 16px; height: 16px; border-radius: 999px; background: #1a73e8; color: #fff; font-size: 10px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; }
.gd-share { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 22px 0 18px; border: 0; border-radius: 999px; background: #c2e7ff; color: #001d35; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.gd-share:hover { background: #b3dcf6; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.gd-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 1px; margin: 4px 16px 6px; padding: 5px 8px; min-height: 40px; box-sizing: border-box; background: #edf2fa; border-radius: 24px; flex-shrink: 0; position: relative; z-index: 20; }
.gd-tb { display: inline-flex; align-items: center; justify-content: center; gap: 2px; min-width: 27px; height: 28px; padding: 0 4px; border: 0; border-radius: 4px; background: transparent; color: #444746; font: inherit; font-size: 14px; cursor: pointer; flex-shrink: 0; }
.gd-tb[data-wide] { padding: 0 6px; }
.gd-tb:hover:not(:disabled) { background: #dfe3eb; }
.gd-tb[data-on] { background: #d3e3fd; color: #041e49; }
.gd-tb:disabled { color: #b0b3b8; cursor: default; }
.gd-tb-text { font-size: 14px; color: inherit; white-space: nowrap; }
.gd-glyph { font-size: 16px; font-family: Arial, sans-serif; width: 16px; text-align: center; }
.gd-sep { width: 1px; height: 20px; background: #c7c7c7; margin: 0 3px; flex-shrink: 0; }
.gd-tb-wide { display: inline-flex; }
/* Tighter on a laptop so the toolbar stays on one line (QA, 2 Oct: at 1280 清除格式 sat alone on a second row). Print and the mode's word are in the menus too. */
@media (max-width: 1400px) { .gd-tb-wide { display: none; } }
.gd-size { width: 34px; height: 24px; border: 1px solid #747775; border-radius: 4px; text-align: center; font: inherit; font-size: 14px; background: transparent; color: #1f1f1f; flex-shrink: 0; }
.gd-size:disabled { border-color: #c7c7c7; color: #9aa0a6; }
.gd-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; margin: 0 16px 8px; padding: 6px 10px 6px 14px; border-radius: 12px; font-size: 14px; color: #1f1f1f; flex-shrink: 0; min-height: 48px; box-sizing: border-box; border: 1px solid #e3e3e3; }
.gd-status[data-tone="draft"] { background: #fff8e8; border-color: #f4ddb0; }
.gd-status[data-tone="you"] { background: #fef7e0; }
.gd-status[data-tone="wait"] { background: #f1f3f4; }
.gd-status[data-tone="ok"] { background: #e6f4ea; }
.gd-status[data-tone="run"] { background: #e8f0fe; }
.gd-status-dot { width: 8px; height: 8px; border-radius: 99px; flex-shrink: 0; background: #9aa0a6; }
.gd-status[data-tone="you"] .gd-status-dot { background: #f29900; }
.gd-status[data-tone="ok"] .gd-status-dot { background: #1e8e3e; }
.gd-status[data-tone="run"] .gd-status-dot { background: #1a73e8; animation: auraPulse 1.4s ease-in-out infinite; }
.gd-status-dim { color: #5f6368; }
.gd-status-btn { display: inline-flex; align-items: center; justify-content: center; height: 34px; padding: 0 14px; border: 1px solid #c4c7c5; border-radius: 10px; background: #fff; color: #1f1f1f; font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }
.gd-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0 16px 8px; flex-shrink: 0; }
/* Same weight and size as the toolbar's words (QA, 2 Oct: this row read heavier and larger than the rest). */
.gd-big { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid #d3d3d0; border-radius: 10px; background: #fff; color: #1f1f1f; font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; white-space: nowrap; text-decoration: none; }
.gd-big:hover { background: #f3f3f1; }
.gd-length { gap: 6px; cursor: default; }
.gd-length select { height: 26px; border: 1px solid #d3d3d0; border-radius: 8px; background: #fff; font: inherit; font-size: 13.5px; font-weight: 600; padding: 0 6px; cursor: pointer; }
.gd-length-fit { height: 26px; padding: 0 10px; border: 0; border-radius: 8px; background: #171717; color: #fff; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.gd-length-fit:disabled { opacity: .5; cursor: default; }
.gd-ai-panel { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }
.gd-ai-who { display: flex; align-items: center; gap: 10px; }
.gd-ai-log { display: flex; flex-direction: column; gap: 12px; max-height: 240px; overflow-y: auto; padding: 2px; }
.gd-ai-q { align-self: flex-end; max-width: 88%; background: #171717; color: #fff; border-radius: 14px 14px 4px 14px; padding: 8px 12px; font-size: 13px; line-height: 1.5; }
.gd-ai-a { align-self: flex-start; max-width: 92%; background: #f1f3f4; color: #1f1f1f; border-radius: 14px 14px 14px 4px; padding: 8px 12px; font-size: 13px; line-height: 1.5; }
.gd-ai-label { font-size: 12.5px; font-weight: 600; color: #5f6368; margin-bottom: -6px; }
.gd-ai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.gd-ai-action { min-height: 38px; padding: 6px 10px; border: 1px solid #e3e3e3; border-radius: 10px; background: #fff; font: inherit; font-size: 13px; font-weight: 500; color: #1f1f1f; text-align: left; cursor: pointer; line-height: 1.35; }
.gd-ai-action:hover:not(:disabled) { border-color: #c4c7c5; background: #f8f9fa; }
.gd-ai-action:disabled { opacity: .5; cursor: default; }
.gd-ai-compose { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid #d3d3d0; border-radius: 14px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.gd-ai-compose:focus-within { border-color: #8ab4f8; box-shadow: 0 0 0 3px rgba(26,115,232,.12); }
.gd-ai-compose textarea { border: 0; outline: none; resize: none; font: inherit; font-size: 14px; line-height: 1.5; background: transparent; }
.gd-ai-go { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 0; border-radius: 10px; background: #171717; color: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.gd-ai-go:disabled { opacity: .4; cursor: default; }
/* The side panel's row under the box: wraps in a narrow panel (1024 wide, QA round 2), the button staying at the right. */
.gd-ai-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gd-ai-row .gd-ai-go { margin-left: auto; }
.gd-ai-refs { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid #e3e3e3; border-radius: 12px; background: #fbfbfa; }
.gd-ai-up { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px; border: 1px solid #d3d3d0; border-radius: 8px; background: #fff; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.gd-ai-drop { border: 1.5px dashed #d3d3d0; border-radius: 10px; padding: 14px 10px; text-align: center; font-size: 12.5px; color: #80868b; }
.gd-version-now { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid #d3e3fd; border-radius: 12px; background: #f5f8ff; margin-bottom: 8px; }
.gd-side-tabs { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: #f1f3f4; width: 100%; }
.gd-side-tab { flex: 1; height: 32px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 13.5px; color: #5f6368; cursor: pointer; }
.gd-side-tab[data-on] { background: #fff; color: #1f1f1f; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.gd-status-btn:hover:not(:disabled) { background: #f1f3f4; }
.gd-status-btn.primary { background: #171717; border-color: #171717; color: #fff; }
.gd-status-btn.primary:hover:not(:disabled) { background: #333; }
.gd-status-btn.blue { background: #0b57d0; border-color: #0b57d0; color: #fff; }
.gd-status-btn.blue:hover:not(:disabled) { background: #0842a0; }
.gd-status-btn.big { height: 40px; padding: 0 22px; font-size: 14px; }
.gd-status-btn:disabled { opacity: .5; cursor: default; }
.gd-strip { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 16px 6px; padding: 8px 10px 8px 12px; border-radius: 8px; background: #f1f3f4; font-size: 13px; flex-shrink: 0; }
.gd-strip.warn { background: #fef7e0; color: #5c3c00; }
.gd-strip.ai { background: #e8f0fe; color: #0b3a84; }
.gd-note { flex-grow: 1; min-width: 240px; border: 1px solid #c7c7c7; border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13.5px; resize: vertical; background: #fff; }
.gd-find-bar { display: flex; align-items: center; gap: 8px; margin: 0 16px 6px; padding: 6px 8px 6px 12px; border-radius: 8px; background: #fff; box-shadow: 0 1px 3px rgba(60,64,67,.25); flex-shrink: 0; }
.gd-find-input { height: 30px; min-width: 160px; border: 1px solid #c7c7c7; border-radius: 6px; padding: 0 10px; font: inherit; font-size: 13.5px; }
.gd-find-input:focus, .gd-field:focus, .gd-comment-box:focus { outline: none; border-color: #0b57d0; box-shadow: 0 0 0 1px #0b57d0; }
.gd-link { border: 0; background: none; padding: 0; color: #0b57d0; font: inherit; font-size: 13px; cursor: pointer; text-decoration: none; }
.gd-link:hover { text-decoration: underline; }
.gd-body { flex-grow: 1; display: flex; align-items: flex-start; position: relative; }
.gd-outline { width: 250px; flex-shrink: 0; padding: 14px 12px 24px 18px; overflow-y: auto; box-sizing: border-box; position: sticky; top: 0; max-height: calc(100vh - 40px); }
.gd-outline-open { position: absolute; left: 16px; top: 14px; z-index: 5; width: 40px; height: 40px; border: 0; border-radius: 999px; background: #fff; color: #444746; box-shadow: 0 1px 3px rgba(60,64,67,.3); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.gd-tab-pill { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 14px; border-radius: 999px; background: #d3e3fd; color: #041e49; font-size: 14px; font-weight: 500; }
.gd-outline-item { border: 0; background: none; text-align: left; font: inherit; font-size: 13.5px; color: #1f1f1f; padding: 6px 10px; border-radius: 999px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gd-outline-item:hover { background: #e8eaed; }
.gd-canvas { flex-grow: 1; min-width: 0; overflow-x: clip; position: relative; align-self: stretch; }
.gd-ruler-wrap { position: sticky; top: 0; z-index: 4; display: flex; justify-content: safe center; overflow: hidden; background: #f9fbfd; }
.gd-ruler { position: relative; height: 22px; border-bottom: 1px solid #dadce0; background: linear-gradient(to right, #eef0f3 0, #eef0f3 11.76%, #fff 11.76%, #fff 88.24%, #eef0f3 88.24%) , #fff; background-clip: padding-box; box-sizing: border-box; }
.gd-ruler::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: repeating-linear-gradient(to right, #80868b 0, #80868b 1px, transparent 1px, transparent 9.45px); opacity: .55; }
.gd-ruler span { position: absolute; top: 2px; transform: translateX(-50%); font-size: 10px; color: #5f6368; }
.gd-sheet-row { display: flex; justify-content: center; gap: 16px; padding: 18px 0 150px; margin: 0 auto; width: fit-content; }
.gd-sheet { width: 816px; min-height: 1056px; background: #fff; box-shadow: 0 0 0 .75pt #d1d1d1, 0 0 3pt .75pt #ccc; box-sizing: border-box; padding: 96px 96px 120px; position: relative; }
.gd-margin { width: 284px; position: relative; flex-shrink: 0; }
.gd-card { position: absolute; left: 0; width: 272px; box-sizing: border-box; background: #fff; border-radius: 8px; padding: 12px 12px 12px; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); cursor: pointer; transition: top .15s ease, box-shadow .15s ease; }
.gd-card:not([data-on]):not(.on) { box-shadow: 0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.15); background: #f8fafd; }
.gd-card[data-on], .gd-card.on { left: -12px; background: #fff; }
.gd-card.static { position: static; width: auto; left: auto; }
.gd-replies { margin-top: 10px; padding-left: 12px; border-left: 2px solid #e3e3e3; display: flex; flex-direction: column; gap: 10px; }
.gd-reply { min-width: 0; }
.gd-quote { margin-top: 8px; padding-left: 8px; border-left: 3px solid #fbbc04; font-size: 12.5px; color: #444746; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.gd-comment-box { width: 100%; box-sizing: border-box; border: 1px solid #c7c7c7; border-radius: 6px; padding: 8px 10px; font: inherit; font-size: 13.5px; resize: vertical; margin-top: 8px; }
.gd-add-comment { position: absolute; left: 0; width: 40px; height: 40px; border: 0; border-radius: 999px; background: #fff; color: #444746; box-shadow: 0 1px 3px rgba(60,64,67,.3); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.gd-add-comment:hover { background: #f1f3f4; }
.gd-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; padding: 160px 0; }
.gd-side { width: 340px; flex-shrink: 0; border-left: 1px solid #e3e3e3; background: #fff; padding: 16px 18px 24px; overflow-y: auto; box-sizing: border-box; position: sticky; top: 0; max-height: calc(100vh - 40px); }
.gd-side-block { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid #e3e3e3; border-radius: 12px; }
.gd-ref { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 0; }
.gd-ref a { flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1f1f1f; text-decoration: none; }
.gd-ref a:hover { text-decoration: underline; }
.gd-version { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: transparent; font: inherit; text-align: left; cursor: pointer; }
.gd-version:hover { background: #f1f3f4; }
.gd-version[data-on] { background: #d3e3fd; }
.gd-badge { font-size: 11px; font-weight: 500; border-radius: 4px; padding: 0 6px; line-height: 18px; }
.gd-badge.ok { color: #137333; background: #e6f4ea; }
.gd-badge.wait { color: #b06000; background: #fef7e0; }
.gd-badge.ai { color: #0b57d0; background: #e8f0fe; }
.gd-chip { height: 30px; padding: 0 12px; border: 1px solid #c7c7c7; border-radius: 8px; background: #fff; color: #1f1f1f; font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
.gd-chip:hover:not(:disabled) { background: #f1f3f4; }
.gd-chip:disabled { opacity: .5; cursor: default; }
.gd-ai-dock { position: sticky; bottom: 22px; z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; margin-top: -120px; padding: 0 16px; }
.gd-ai-dock > * { pointer-events: auto; }
.gd-ai-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 720px; }
.gd-ai-chips .gd-chip { border-radius: 999px; box-shadow: 0 1px 3px rgba(60,64,67,.2); }
.gd-ai-bar { display: flex; align-items: center; gap: 8px; width: min(720px, 90%); height: 56px; padding: 0 8px 0 14px; box-sizing: border-box; background: #fff; border-radius: 999px; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); }
.gd-ai-bar[data-busy] { box-shadow: 0 0 0 2px #a8c7fa, 0 4px 8px 3px rgba(60,64,67,.15); }
.gd-ai-mark { color: #1a73e8; display: inline-flex; }
.gd-ai-input { flex-grow: 1; min-width: 0; height: 40px; border: 0; outline: none; font: inherit; font-size: 15px; color: #1f1f1f; background: transparent; }
.gd-ai-input::placeholder { color: #5f6368; }
.gd-ai-send { width: 40px; height: 40px; border-radius: 999px; border: 0; background: #171717; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.gd-ai-send:disabled { background: #e3e3e3; color: #9aa0a6; cursor: default; }
.gd-spin { width: 16px; height: 16px; border-radius: 99px; border: 2px solid #9aa0a6; border-top-color: transparent; animation: gdSpin .8s linear infinite; }
@keyframes gdSpin { to { transform: rotate(360deg); } }
.gd-veil { position: fixed; inset: 0; z-index: 90; background: rgba(32,33,36,.45); display: flex; align-items: center; justify-content: center; }
.gd-modal { background: #fff; border-radius: 12px; padding: 22px 24px; box-shadow: 0 8px 28px rgba(0,0,0,.28); max-width: calc(100vw - 32px); box-sizing: border-box; }
.gd-field { height: 38px; border: 1px solid #747775; border-radius: 6px; padding: 0 12px; font: inherit; font-size: 14px; }
.gd-count { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.gd-count td { padding: 8px 0; border-bottom: 1px solid #e3e3e3; }
.gd-count td:last-child { text-align: right; color: #1f1f1f; font-weight: 500; }

/* the page's type, like Docs */
.gd-prose { outline: none; font-family: Arial, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 11pt; line-height: 1.5; color: #000; min-height: 780px; word-break: break-word; }
.gd-prose p { margin: 0 0 8pt; }
.gd-prose h1 { font-size: 20pt; font-weight: 400; margin: 20pt 0 6pt; line-height: 1.25; }
.gd-prose h2 { font-size: 16pt; font-weight: 400; margin: 18pt 0 6pt; line-height: 1.3; }
.gd-prose h3 { font-size: 14pt; font-weight: 400; color: #434343; margin: 16pt 0 4pt; line-height: 1.3; }
.gd-prose > :first-child { margin-top: 0; }
.gd-prose ul, .gd-prose ol { padding-left: 28px; margin: 0 0 8pt; }
.gd-prose ul { list-style: disc; }
.gd-prose ul ul { list-style: circle; }
.gd-prose ul ul ul { list-style: square; }
.gd-prose ol { list-style: decimal; }
.gd-prose ol ol { list-style: lower-alpha; }
.gd-prose li { display: list-item; }
.gd-prose strong, .gd-prose b { font-weight: 700; }
.gd-prose li > p { margin: 0 0 2pt; }
.gd-prose ul[data-type="taskList"] { list-style: none; padding-left: 4px; }
.gd-prose ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 8px; }
.gd-prose ul[data-type="taskList"] li > label { margin-top: 3px; flex-shrink: 0; }
.gd-prose ul[data-type="taskList"] li > div { flex-grow: 1; }
.gd-prose ul[data-type="taskList"] li[data-checked="true"] > div { text-decoration: line-through; color: #80868b; }
.gd-prose a { color: #1155cc; text-decoration: underline; }
.gd-prose img { max-width: 100%; height: auto; display: block; margin: 6pt 0; }
.gd-prose img.ProseMirror-selectednode { outline: 2px solid #1a73e8; }
.gd-prose hr { border: 0; border-top: 1px solid #c7c7c7; margin: 12pt 0; }
.gd-prose blockquote { border-left: 3px solid #dadce0; margin: 0 0 8pt; padding-left: 12px; color: #444746; }
.gd-prose p.is-editor-empty:first-child::before, .gd-prose .is-empty.has-focus::before { content: attr(data-placeholder); color: #9aa0a6; float: left; height: 0; pointer-events: none; }
.gd-prose .gd-cmt { background: rgba(251,188,4,.28); border-bottom: 2px solid #fbbc04; }
.gd-prose .gd-cmt.on { background: rgba(251,188,4,.55); }
.gd-prose .gd-find { background: #fde293; }
.gd-prose .gd-find.on { background: #f9ab00; }
.gd-prose .gd-old { color: #b3261e; text-decoration: line-through; text-decoration-color: #b3261e; background: #fce8e6; }
.gd-new { margin: 4pt 0 10pt; padding: 8px 10px; border-left: 3px solid #1e8e3e; background: #e6f4ea; border-radius: 0 6px 6px 0; font-family: inherit; }
.gd-new.del { border-left-color: #b3261e; background: #fce8e6; }
.gd-new-text { color: #0d652d; line-height: 1.5; white-space: pre-wrap; }
.gd-new.del .gd-new-text { color: #b3261e; font-size: 10pt; }
.gd-new-bar { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-family: "Google Sans", -apple-system, "PingFang SC", sans-serif; }
.gd-new-why { flex-grow: 1; font-size: 11.5px; color: #0b57d0; }
.gd-new-ok, .gd-new-no { height: 26px; padding: 0 12px; border-radius: 999px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; }
.gd-new-ok { border: 0; background: #1e8e3e; color: #fff; }
.gd-new-no { border: 1px solid #747775; background: #fff; color: #1f1f1f; }
.gd-new-again { border-color: #0b57d0; color: #0b57d0; }
.gd-new-again:disabled { opacity: .6; cursor: default; }
.gd-new-ask { display: flex; gap: 6px; margin-top: 8px; font-family: "Google Sans", -apple-system, "PingFang SC", sans-serif; }
.gd-new-ask input { flex-grow: 1; min-width: 0; height: 30px; border: 1px solid #c7c7c7; border-radius: 999px; padding: 0 12px; font: inherit; font-size: 13px; background: #fff; outline: none; }
.gd-new-ask input:focus { border-color: #0b57d0; box-shadow: 0 0 0 1px #0b57d0; }
.gd-shots .gd-prose p[data-shot]::after, .gd-shots .gd-readonly p[data-shot]::after { content: "画面：" attr(data-shot); display: block; margin-top: 4px; padding: 3px 8px; border-radius: 6px; background: #f1f3f4; color: #5f6368; font-size: 9.5pt; line-height: 1.45; }
.gd-readonly p { margin: 0 0 8pt; }

@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body * { visibility: hidden !important; }
  body *:not(.gd-sheet):not(.gd-sheet *) { position: static !important; overflow: visible !important; height: auto !important; min-height: 0 !important; max-height: none !important; zoom: 1 !important; transform: none !important; }
  .gd-sheet, .gd-sheet * { visibility: visible !important; }
  .gd-sheet { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; min-height: 0 !important; box-shadow: none !important; padding: 0 !important; margin: 0 !important; }
  .gd-new-bar, .gd-ai-dock, .gd-margin { display: none !important; }
  .gd-prose { min-height: 0 !important; }
  .gd-prose .gd-cmt, .gd-prose .gd-find { background: none !important; border: 0 !important; }
  @page { margin: 2.2cm; }
}
@media (max-width: 1500px) { .gd-side { width: 300px; } .gd-outline { width: 210px; } }
@media (max-width: 1200px) { .gd-side { width: 270px; padding: 14px 12px; } }
`;

/** A big button that opens a small menu under it (导入 / 导出). */
function BigDrop({ icon, label, children }: { icon: "upload" | "download"; label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className="gd-big" aria-expanded={open} data-on={open ? "1" : undefined} onClick={() => setOpen((v) => !v)}>
        <GI name={icon} size={16} />
        {label}
        <GI name="chevron" size={15} style={{ color: "#5f6368" }} />
      </button>
      {open ? (
        <div className="gd-menu" style={{ minWidth: 240, left: 0, top: "calc(100% + 6px)" }}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
