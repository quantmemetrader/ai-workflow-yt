"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { PersonAvatar } from "@/components/ui/PersonAvatar";
import { Empty, GoButton, NextStep, bigButton, smallButton } from "@/components/projects/kit";
import { ShareDialog } from "@/components/share/ShareDialog";
import { notify } from "@/lib/client/notify";
import { uploadFiles } from "@/lib/client/upload";
import { startFromTopicAction } from "@/app/(app)/projects/actions";
import {
  addReferenceAction,
  approveDocAction,
  copilotAction,
  docCommentAction,
  removeReferenceAction,
  requestChangesAction,
  resolveCommentAction,
  restoreDocVersionAction,
  saveDocAction,
  settleDocSendBackAction,
  shareScriptAction,
  startBlankAction,
  unlockDocAction,
  versionBeatsAction,
  withdrawReviewAction,
} from "@/app/(app)/projects/[id]/script/actions";
import type { DocBeat, DocComment, ScriptDocProps } from "./types";

/**
 * The script as a Google Doc with an AI copilot (the project's 脚本 page).
 *
 * The client's words (28 Sep): "script can not be edited — the entire script
 * page needs to be closer to google drive: easier to share with anyone for
 * review, edit"; "they just need a google doc with ai copilot so they can
 * share and get approve internally"; "the approval steps also confuse me".
 *
 *   — the document: one white page, each paragraph a beat's spoken line,
 *     typed straight into; Enter makes a new paragraph, Backspace at the
 *     start joins it to the one above; saved as you type. The shot notes
 *     (画面说明) are there behind a toggle for whoever films it.
 *   — on the right: AI 助手 (quick chips or your own instruction; 编剧's
 *     changes come back as tracked changes to accept or not; 参考资料 it
 *     reads), 批注 (select words, comment, resolve), 版本 (every version,
 *     open one, put it back).
 *   — at the top, one band that says what to do now (share it for review,
 *     approve it, it is approved — go to 剪辑) with the one press it needs.
 */

type Para = DocBeat & { k: string };
type Change = { text: string; why: string };
type Insert = { id: string; afterK: string | null; text: string; why: string };
type Proposal = { changes: Record<string, Change>; inserts: Insert[]; summary: string; source: "ai" | "sendback" };
type Tab = "ai" | "comments" | "versions";

const CHIPS: { zh: string; en: string }[] = [
  { zh: "更口语、降低术语", en: "More conversational, less jargon" },
  { zh: "缩短 30 秒", en: "Cut 30 seconds" },
  { zh: "强化前 3 秒钩子", en: "Stronger first 3 seconds" },
  { zh: "删掉绝对化说法", en: "Remove absolute claims" },
  { zh: "加一个生活化比喻", en: "Add an everyday metaphor" },
  { zh: "改成小红书版本", en: "Rewrite for Xiaohongshu" },
];

const CJK = /[㐀-鿿豈-﫿]/g;
function measureText(s: string) {
  const cjk = (s.match(CJK) ?? []).length;
  const words = (s.replace(CJK, " ").match(/[A-Za-z0-9']+/g) ?? []).length;
  return { count: cjk + words, seconds: cjk / 4.5 + words / 2.6 };
}
function clock(sec: number, zh: boolean) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return zh ? (m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`) : `${m}:${String(s % 60).padStart(2, "0")}`;
}
function ago(iso: string, zh: boolean) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return zh ? "刚刚" : "just now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`;
  return d.toLocaleDateString(zh ? "zh-CN" : "en", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(zh ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" });
}
const sigOf = (list: DocBeat[]) => JSON.stringify(list.map((b) => [b.voiceover, b.visual, b.naturalSound]));

export function ScriptDoc(props: ScriptDocProps) {
  const { projectId, zh, me, script } = props;
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();

  /* ---------------- the document ---------------- */
  const seq = React.useRef(0);
  const toParas = React.useCallback((list: DocBeat[]): Para[] => list.map((b) => ({ ...b, k: `p${++seq.current}` })), []);
  const [paras, setParas] = React.useState<Para[]>(() => toParas(props.beats));
  const parasRef = React.useRef(paras);
  parasRef.current = paras;
  const [saveState, setSaveState] = React.useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const lastSig = React.useRef(sigOf(props.beats));
  const editSeq = React.useRef(0);
  const saving = React.useRef(false);
  const boxes = React.useRef(new Map<string, HTMLTextAreaElement>());
  const [unlocked, setUnlocked] = React.useState(false);
  const locked = script?.lockedVersion != null && !unlocked;
  const [lockPrompt, setLockPrompt] = React.useState(false);
  const [showVisual, setShowVisual] = React.useState(false);
  const [proposal, setProposal] = React.useState<Proposal | null>(null);
  const [viewing, setViewing] = React.useState<{ versionNo: number; beats: { visual: string; voiceover: string; naturalSound: boolean }[] } | null>(null);
  const editable = me.canEdit && !locked && !proposal && !viewing && !props.writing;

  /* New text from the server (a restore, 编剧's draft landing, another
     person's save picked up on refresh) replaces the page — unless this
     person has typing the server has not got yet. */
  const propsSig = sigOf(props.beats);
  React.useEffect(() => {
    if (propsSig === lastSig.current) return;
    if (saveState === "dirty" || saveState === "saving") return;
    lastSig.current = propsSig;
    setParas(toParas(props.beats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsSig]);
  React.useEffect(() => {
    if (script?.lockedVersion == null) return;
    setUnlocked(false);
  }, [script?.lockedVersion]);

  const edit = React.useCallback((fn: (list: Para[]) => Para[]) => {
    editSeq.current += 1;
    setParas(fn);
    setSaveState("dirty");
  }, []);

  const save = React.useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    const mySeq = editSeq.current;
    const snapshot = parasRef.current;
    setSaveState("saving");
    const beats = snapshot.map(({ visual, voiceover, subtitle, naturalSound }) => ({ visual, voiceover, subtitle, naturalSound }));
    const r = await saveDocAction(projectId, beats).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    saving.current = false;
    if ("error" in r && r.error) {
      setSaveState("error");
      notify(r.error);
      return;
    }
    lastSig.current = sigOf(beats);
    setSavedAt(new Date().toISOString());
    setSaveState(editSeq.current === mySeq ? "saved" : "dirty");
  }, [projectId]);

  React.useEffect(() => {
    if (saveState !== "dirty") return;
    const h = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(h);
  }, [paras, saveState, save]);
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /* While 编剧 writes, the page keeps asking for the draft. */
  React.useEffect(() => {
    if (!props.writing) return;
    const h = window.setInterval(() => router.refresh(), 4000);
    return () => window.clearInterval(h);
  }, [props.writing, router]);

  const focusAt = (k: string, pos: number | "end") =>
    window.requestAnimationFrame(() => {
      const el = boxes.current.get(k);
      if (!el) return;
      el.focus();
      const p = pos === "end" ? el.value.length : pos;
      el.setSelectionRange(p, p);
    });

  const setVoice = (k: string, value: string) =>
    edit((list) =>
      list.map((p) =>
        p.k !== k ? p : { ...p, voiceover: value, subtitle: !p.subtitle || p.subtitle === p.voiceover ? value : p.subtitle, naturalSound: value.trim() ? false : p.naturalSound },
      ),
    );
  const setVisual = (k: string, value: string) => edit((list) => list.map((p) => (p.k !== k ? p : { ...p, visual: value })));

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>, i: number) {
    const el = e.currentTarget;
    const p = paras[i];
    if (!editable) {
      if (locked && me.canEdit && (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter" || e.key === "Delete")) setLockPrompt(true);
      return;
    }
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (composing) return;
    const s = el.selectionStart;
    const en = el.selectionEnd;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const head = p.voiceover.slice(0, s);
      const tail = p.voiceover.slice(en);
      const next: Para = { k: `p${++seq.current}`, visual: "", voiceover: tail, subtitle: tail, naturalSound: false };
      edit((list) => {
        const out = [...list];
        out.splice(i, 1, { ...p, voiceover: head, subtitle: !p.subtitle || p.subtitle === p.voiceover ? head : p.subtitle }, next);
        return out;
      });
      focusAt(next.k, 0);
    } else if (e.key === "Backspace" && s === 0 && en === 0 && i > 0) {
      e.preventDefault();
      const prev = paras[i - 1];
      const joined = prev.voiceover + p.voiceover;
      edit((list) => {
        const out = [...list];
        out.splice(i - 1, 2, {
          ...prev,
          voiceover: joined,
          subtitle: joined,
          visual: [prev.visual, p.visual].filter((x) => x.trim()).join("；"),
          naturalSound: joined.trim() ? false : prev.naturalSound,
        });
        return out;
      });
      focusAt(prev.k, prev.voiceover.length);
    } else if (e.key === "ArrowUp" && s === 0 && en === 0 && i > 0) {
      e.preventDefault();
      focusAt(paras[i - 1].k, "end");
    } else if (e.key === "ArrowDown" && s === el.value.length && i < paras.length - 1) {
      e.preventDefault();
      focusAt(paras[i + 1].k, 0);
    }
  }

  const totals = React.useMemo(() => {
    const m = paras.reduce((acc, p) => {
      const x = measureText(p.voiceover);
      return { count: acc.count + x.count, seconds: acc.seconds + x.seconds };
    }, { count: 0, seconds: 0 });
    return m;
  }, [paras]);

  /* ---------------- comments ---------------- */
  const [tab, setTab] = React.useState<Tab>("ai");
  const [sel, setSel] = React.useState<{ i: number; quote: string; x: number; y: number } | null>(null);
  const [draft, setDraft] = React.useState<{ i: number | null; quote: string | null } | null>(null);
  const [draftText, setDraftText] = React.useState("");
  const [activeComment, setActiveComment] = React.useState<string | null>(null);
  const [showResolved, setShowResolved] = React.useState(false);
  const draftBox = React.useRef<HTMLTextAreaElement | null>(null);
  const openComments = props.comments.filter((c) => !c.resolvedAt);

  function pickSelection(e: React.SyntheticEvent<HTMLTextAreaElement>, i: number, point?: { x: number; y: number }) {
    const el = e.currentTarget;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    if (b - a < 1) {
      setSel(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setSel({ i, quote: el.value.slice(a, b).slice(0, 300), x: point?.x ?? r.right - 60, y: point?.y ?? r.top });
  }
  React.useEffect(() => {
    if (!sel) return;
    const clear = () => setSel(null);
    window.addEventListener("scroll", clear, true);
    return () => window.removeEventListener("scroll", clear, true);
  }, [sel]);

  function startComment(i: number | null, quote: string | null) {
    setDraft({ i, quote });
    setDraftText("");
    setSel(null);
    setTab("comments");
    window.setTimeout(() => draftBox.current?.focus(), 60);
  }
  function sendComment() {
    if (!draft || !draftText.trim()) return;
    start(async () => {
      const r = await docCommentAction(projectId, draft.i, draft.quote, draftText);
      if ("error" in r && r.error) return notify(r.error);
      setDraft(null);
      setDraftText("");
      router.refresh();
    });
  }
  function jumpTo(c: DocComment) {
    setActiveComment(c.id);
    const i = c.beatOrd ?? -1;
    const p = paras[i] ?? (c.quote ? paras.find((x) => x.voiceover.includes(c.quote!)) : undefined);
    const el = p ? boxes.current.get(p.k) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const marksFor = (i: number, text: string) => {
    const out: { a: number; b: number; id: string }[] = [];
    for (const c of openComments) {
      if (!c.quote) continue;
      if (c.beatOrd !== null && c.beatOrd !== i) continue;
      const at = text.indexOf(c.quote);
      if (at >= 0) out.push({ a: at, b: at + c.quote.length, id: c.id });
    }
    return out.sort((x, y) => x.a - y.a);
  };

  /* ---------------- the copilot ---------------- */
  const [instruction, setInstruction] = React.useState("");
  const [thinking, setThinking] = React.useState(false);

  function runCopilot(text?: string) {
    const ask = (text ?? instruction).trim();
    if (!ask) return notify(t("写下要怎么改，或点一个快捷指令", "Say what to change, or press a quick instruction"));
    if (locked) {
      setLockPrompt(true);
      return notify(t("脚本已批准。先点「继续编辑」，再让编剧改", "Approved. Press Continue editing first"));
    }
    setThinking(true);
    start(async () => {
      if (saveState === "dirty") await save();
      const r = await copilotAction(projectId, paras.map((p) => p.voiceover), ask);
      setThinking(false);
      if ("error" in r && r.error) return notify(r.error);
      if (!("ok" in r) || !r.ok) return;
      const changes: Record<string, Change> = {};
      for (const c of r.changes) {
        const p = paras[c.i];
        if (p) changes[p.k] = { text: c.text, why: c.why };
      }
      const inserts: Insert[] = r.inserts.map((x, n) => ({ id: `ins${n}-${Date.now()}`, afterK: x.after < 0 ? null : (paras[x.after]?.k ?? null), text: x.text, why: x.why }));
      setProposal({ changes, inserts, summary: r.summary, source: "ai" });
      setInstruction("");
    });
  }

  function loadSentBack() {
    const sb = props.sentBack;
    if (!sb?.suggestions?.length) return;
    if (locked) return setLockPrompt(true);
    const changes: Record<string, Change> = {};
    for (const s of sb.suggestions) {
      const p = paras[s.ord];
      if (!p || !p.voiceover.includes(s.before)) continue;
      changes[p.k] = { text: (changes[p.k]?.text ?? p.voiceover).replace(s.before, s.after), why: s.why };
    }
    if (!Object.keys(changes).length) return notify(t("这些改法对不上现在的文字了（可能已经改过）", "Those edits no longer match the text"));
    setProposal({ changes, inserts: [], summary: sb.note, source: "sendback" });
  }

  function applyChange(k: string) {
    if (!proposal) return;
    const c = proposal.changes[k];
    edit((list) => (c.text ? list.map((p) => (p.k === k ? { ...p, voiceover: c.text, subtitle: c.text, naturalSound: false } : p)) : list.filter((p) => p.k !== k)));
    dropFromProposal({ change: k });
  }
  function applyInsert(id: string) {
    if (!proposal) return;
    const x = proposal.inserts.find((n) => n.id === id);
    if (!x) return;
    edit((list) => {
      const at = x.afterK === null ? 0 : list.findIndex((p) => p.k === x.afterK) + 1;
      const out = [...list];
      out.splice(Math.max(0, at), 0, { k: `p${++seq.current}`, visual: "", voiceover: x.text, subtitle: x.text, naturalSound: false });
      return out;
    });
    dropFromProposal({ insert: id });
  }
  function dropFromProposal(what: { change?: string; insert?: string }) {
    setProposal((pr) => {
      if (!pr) return pr;
      const changes = { ...pr.changes };
      if (what.change) delete changes[what.change];
      const inserts = pr.inserts.filter((n) => n.id !== what.insert);
      if (!Object.keys(changes).length && !inserts.length) {
        if (pr.source === "sendback") void settleDocSendBackAction(projectId, "applied").then(() => router.refresh());
        return null;
      }
      return { ...pr, changes, inserts };
    });
  }
  function acceptAll() {
    if (!proposal) return;
    const pr = proposal;
    edit((list) => {
      let out = list.flatMap((p) => {
        const c = pr.changes[p.k];
        if (!c) return [p];
        return c.text ? [{ ...p, voiceover: c.text, subtitle: c.text, naturalSound: false }] : [];
      });
      for (const x of pr.inserts) {
        const at = x.afterK === null ? 0 : out.findIndex((p) => p.k === x.afterK) + 1;
        const copy = [...out];
        copy.splice(at > 0 || x.afterK === null ? at : copy.length, 0, { k: `p${++seq.current}`, visual: "", voiceover: x.text, subtitle: x.text, naturalSound: false });
        out = copy;
      }
      return out;
    });
    if (pr.source === "sendback") void settleDocSendBackAction(projectId, "applied").then(() => router.refresh());
    setProposal(null);
    notify(t("已接受全部修改", "All changes accepted"), "ok");
  }

  /* ---------------- references ---------------- */
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = React.useState<{ name: string; pct: number }[]>([]);
  async function uploadRefs(list: FileList) {
    const access = props.accessMode === "everyone" ? ({ mode: "everyone" } as const) : ({ mode: "private" } as const);
    await uploadFiles(list, {
      access,
      onProgress: (u) => setUploading(u.filter((x) => x.pct < 100 && !x.error)),
      onDone: async (fileId) => {
        const r = await addReferenceAction(projectId, fileId);
        if ("error" in r && r.error) notify(r.error);
      },
    });
    setUploading([]);
    router.refresh();
  }

  /* ---------------- approval & sharing ---------------- */
  const [sharing, setSharing] = React.useState(false);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");
  const open = props.approvals.filter((a) => a.state === "requested");
  const mine = open.find((a) => a.approverId === me.id) ?? null;
  /* An owner or admin may decide a request put to somebody else — but not
     one they sent themselves: to the person who asked, it is waiting. */
  const decider = mine ?? (me.isAdmin ? open.find((a) => a.requestedBy !== me.id) ?? null : null);
  const approved = script?.lockedVersion != null ? props.approvals.find((a) => a.state === "approved" && a.versionNo === script.lockedVersion) ?? null : null;
  const sentBack = props.sentBack && props.sentBack.state === "open" ? props.sentBack : null;

  function approve() {
    start(async () => {
      if (saveState === "dirty") await save();
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

  function band() {
    if (props.writing) return <NextStep zh={zh} state="running" text={t("编剧正在写初稿，写好会自动出现在下面。", "The writer is drafting; it appears below when done.")} />;
    if (!script || !paras.length) return null;
    if (script.lockedVersion != null && !unlocked) {
      const who = approved?.deciderName ?? "";
      return (
        <NextStep zh={zh} state="done" text={<>{t(`已批准 · 第 ${script.lockedVersion} 版`, `Approved · v${script.lockedVersion}`)}{who ? ` · ${who}` : ""}{approved?.decidedAt ? ` · ${ago(approved.decidedAt, zh)}` : ""}<span style={{ color: "#6b6b6b" }}>{t("　剪辑师会照这一版剪。", " — the edit follows this version.")}</span></>}>
          <GoButton href={`/projects/${projectId}/edit`}>{t("去剪辑 →", "On to the edit →")}</GoButton>
        </NextStep>
      );
    }
    if (decider) {
      return (
        <NextStep
          zh={zh}
          state="you"
          text={
            <>
              <b>{decider.requesterName ?? t("同事", "A colleague")}</b>
              {t(` 请你审阅这份脚本（第 ${decider.versionNo ?? "?"} 版）。可以直接改、加批注，看完选一个：`, ` asks you to review this script (v${decider.versionNo ?? "?"}). Edit or comment, then choose:`)}
            </>
          }
        >
          <button type="button" style={bigButton("primary", pending)} disabled={pending} onClick={approve}>
            <Icon name="check" size={15} />
            {t("批准", "Approve")}
          </button>
          <button type="button" style={bigButton("secondary", pending)} disabled={pending} onClick={() => setNoteOpen((v) => !v)}>
            <Icon name="undo" size={14} />
            {t("提修改意见", "Ask for changes")}
          </button>
        </NextStep>
      );
    }
    if (open.length) {
      const names = open.map((a) => a.approverName ?? "?").join("、");
      return (
        <NextStep zh={zh} state="waiting" text={t(`已发给 ${names} 审阅（第 ${open[0].versionNo ?? "?"} 版），等他们批准。批准后会通知你。`, `With ${names} for review (v${open[0].versionNo ?? "?"}). You will be told when they approve.`)}>
          <button type="button" style={bigButton("secondary")} onClick={() => setSharing(true)}>
            <Icon name="share" size={14} />
            {t("再发给别人", "Send to someone else")}
          </button>
          {me.canEdit ? (
            <button type="button" style={bigButton("secondary", pending)} disabled={pending} onClick={() => start(async () => { await withdrawReviewAction(projectId); router.refresh(); })}>
              {t("撤回审阅", "Withdraw")}
            </button>
          ) : null}
          {me.isAdmin ? (
            <button type="button" style={bigButton("secondary", pending)} disabled={pending} onClick={approve} title={t("管理员可以直接批准", "Admins can approve directly")}>
              <Icon name="check" size={14} />
              {t("直接批准", "Approve now")}
            </button>
          ) : null}
        </NextStep>
      );
    }
    if (sentBack) {
      return (
        <NextStep zh={zh} state="you" text={<>{t("退回修改：", "Sent back: ")}<b>「{sentBack.note}」</b>{sentBack.byName ? <span style={{ color: "#6b6b6b" }}> — {sentBack.byName}</span> : null}{sentBack.suggestions?.length ? t(`　编剧给出了 ${sentBack.suggestions.length} 处具体改法。`, ` The writer suggests ${sentBack.suggestions.length} edits.`) : ""}</>}>
          {sentBack.suggestions?.length && me.canEdit ? (
            <button type="button" style={bigButton("primary")} onClick={loadSentBack}>
              <Icon name="spark" size={14} />
              {t("在文档里看改法", "See the edits")}
            </button>
          ) : null}
          <button type="button" style={bigButton(sentBack.suggestions?.length ? "secondary" : "primary")} onClick={() => setSharing(true)}>
            <Icon name="share" size={14} />
            {t("改好了，重新发审", "Done — send for review")}
          </button>
          {me.isAdmin ? (
            <button type="button" style={bigButton("secondary", pending)} disabled={pending} onClick={approve} title={t("管理员可以直接批准", "Admins can approve directly")}>
              <Icon name="check" size={14} />
              {t("直接批准", "Approve now")}
            </button>
          ) : null}
        </NextStep>
      );
    }
    return (
      <NextStep zh={zh} state="you" text={t("直接在下面改。写好后点「分享」，发给同事审阅并批准。", "Edit below. When it reads right, share it for review.")}>
        <button type="button" style={bigButton("primary")} onClick={() => setSharing(true)}>
          <Icon name="share" size={14} />
          {t("分享 · 请人审阅", "Share for review")}
        </button>
        {me.isAdmin ? (
          <button type="button" style={bigButton("secondary", pending)} disabled={pending} onClick={approve} title={t("管理员可以直接批准", "Admins can approve directly")}>
            <Icon name="check" size={14} />
            {t("直接批准", "Approve now")}
          </button>
        ) : null}
      </NextStep>
    );
  }

  /* ---------------- empty ---------------- */
  if (!props.writing && (!script || !paras.length)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NextStep zh={zh} state="you" text={t("脚本还没开始。让编剧按选题写一版初稿，或者自己动手写。", "No script yet. Have the writer draft one from the topic, or write it yourself.")} />
        <Empty icon="doc" text={t("这里会是一份可以直接编辑、分享、批注的脚本文档。", "This becomes a document you can edit, share and comment on.")}>
          {me.canEdit ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                type="button"
                style={bigButton("primary", pending)}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await startFromTopicAction({ kind: "project", id: projectId }, { write: true, rewrite: false });
                    if ("error" in r && r.error) return notify(r.error);
                    if ("note" in r && r.note) notify(r.note);
                    router.refresh();
                  })
                }
              >
                <Icon name="spark" size={15} />
                {t("让编剧写初稿", "Have the writer draft it")}
              </button>
              <button
                type="button"
                style={bigButton("secondary", pending)}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await startBlankAction(projectId);
                    if ("error" in r && r.error) return notify(r.error);
                    router.refresh();
                  })
                }
              >
                <Icon name="pen" size={14} />
                {t("自己写", "Write it myself")}
              </button>
            </div>
          ) : (
            <div>{t("你没有脚本模块的权限，等同事写好。", "You need the Script module to write it.")}</div>
          )}
        </Empty>
      </div>
    );
  }

  const status = locked
    ? { label: t(`已批准 · 第 ${script!.lockedVersion} 版`, `Approved · v${script!.lockedVersion}`), ink: "#1e7a4f", bg: "#e7f6ee" }
    : open.length
      ? { label: t(`审阅中 · 第 ${open[0].versionNo ?? "?"} 版`, `In review · v${open[0].versionNo ?? "?"}`), ink: "#95590a", bg: "#fff4df" }
      : { label: t(`草稿 · 第 ${(script?.version ?? 0) + 1} 版`, `Draft · v${(script?.version ?? 0) + 1}`), ink: "#5f5f5f", bg: "#f0f0ee" };
  const target = script?.targetSeconds ?? null;
  const proposalCount = proposal ? Object.keys(proposal.changes).length + proposal.inserts.length : 0;

  /* ---------------- render ---------------- */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>
      {band()}
      {noteOpen ? (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 14, background: "#fff", border: "1px solid #e7e6e2", borderRadius: 14 }}>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t("要改什么？例如：开头太慢，第二段数字要写出处，每句不超过 20 个字。编剧会据此给出逐段改法。", "What should change? The writer turns it into concrete edits.")} style={{ flexGrow: 1, border: "1px solid #dcdbd6", borderRadius: 10, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", resize: "vertical" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" style={bigButton("primary", pending)} disabled={pending} onClick={sendNote}>{t("发送意见", "Send")}</button>
            <button type="button" style={bigButton("secondary")} onClick={() => setNoteOpen(false)}>{t("取消", "Cancel")}</button>
          </div>
        </div>
      ) : null}

      <div className="sd-grid">
        {/* ---- the page ---- */}
        <section style={{ background: "#fff", border: "1px solid #e7e6e2", borderRadius: 14, boxShadow: "0 1px 2px rgba(0,0,0,.03)", minWidth: 0 }}>
          <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 18px", borderBottom: "1px solid #efeee9" }}>
            <Icon name="doc" size={16} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#171717", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }} title={script?.title ?? props.projectTitle}>{script?.title ?? props.projectTitle}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: status.ink, background: status.bg, borderRadius: 999, padding: "0 9px", lineHeight: "22px", whiteSpace: "nowrap" }}>{status.label}</span>
            <span style={{ flexGrow: 1 }} />
            <span style={{ fontSize: 12, color: "#8a8a8a", whiteSpace: "nowrap" }}>
              {t(`${totals.count} 字 · 约 ${clock(totals.seconds, zh)}`, `${totals.count} words · ~${clock(totals.seconds, zh)}`)}
              {target ? <span style={{ color: Math.abs(totals.seconds - target) / target <= 0.1 ? "#1e7a4f" : "#b45309" }}>{t(` / 目标 ${clock(target, zh)}`, ` / target ${clock(target, zh)}`)}</span> : null}
            </span>
            <span style={{ fontSize: 12, color: saveState === "error" ? "#c42b2b" : "#8a8a8a", whiteSpace: "nowrap" }}>
              {saveState === "saving" ? t("保存中…", "Saving…") : saveState === "dirty" ? t("未保存", "Unsaved") : saveState === "error" ? t("没保存上", "Not saved") : savedAt ? t("已保存", "Saved") : ""}
            </span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#525252", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={showVisual} onChange={(e) => setShowVisual(e.target.checked)} />
              {t("显示画面说明", "Show shot notes")}
            </label>
            <button type="button" style={smallButton()} onClick={() => setSharing(true)}>
              <Icon name="share" size={12} />
              {t("分享", "Share")}
            </button>
          </header>

          {lockPrompt && locked ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "12px 18px 0", padding: "10px 12px", background: "#fff8ea", border: "1px solid #f3dfb3", borderRadius: 10, fontSize: 13, color: "#6b4a0f" }}>
              <span style={{ flexGrow: 1 }}>{t(`这份脚本已经批准（第 ${script!.lockedVersion} 版）。改动会生成第 ${(script!.version ?? 0) + 1} 版，需要重新批准。`, `Approved as v${script!.lockedVersion}. Changes make v${(script!.version ?? 0) + 1}, which needs approving again.`)}</span>
              <button type="button" style={smallButton(true)} disabled={pending} onClick={unlockNow}>{t("继续编辑", "Continue editing")}</button>
              <button type="button" style={smallButton()} onClick={() => setLockPrompt(false)}>{t("不改了", "Never mind")}</button>
            </div>
          ) : null}

          {proposal ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "12px 18px 0", padding: "10px 12px", background: "#f2f7ff", border: "1px solid #d6e4fb", borderRadius: 10, fontSize: 13, color: "#1f3f73" }}>
              <Icon name="spark" size={14} />
              <span style={{ flexGrow: 1, minWidth: 180 }}>
                <b>{proposal.source === "sendback" ? t("按退回意见的改法", "Edits for the note") : t("编剧的修改建议", "The writer's edits")}</b>
                {t(` · ${proposalCount} 处`, ` · ${proposalCount}`)}
                {proposal.summary ? <span style={{ color: "#4a5f82" }}> — {proposal.summary}</span> : null}
              </span>
              <button type="button" style={smallButton(true)} onClick={acceptAll}>{t("接受全部", "Accept all")}</button>
              <button type="button" style={smallButton()} onClick={() => setProposal(null)}>{t("放弃", "Discard")}</button>
            </div>
          ) : null}

          {viewing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "12px 18px 0", padding: "10px 12px", background: "#f5f5f3", border: "1px solid #e6e6e3", borderRadius: 10, fontSize: 13 }}>
              <span style={{ flexGrow: 1 }}>{t(`正在看第 ${viewing.versionNo} 版（只读）`, `Viewing v${viewing.versionNo} (read-only)`)}</span>
              {me.canEdit ? (
                <button
                  type="button"
                  style={smallButton(true)}
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t(`用第 ${viewing.versionNo} 版替换现在的稿子？现在的稿子会先存成一个版本。`, `Replace the draft with v${viewing.versionNo}? The current draft is kept as a version first.`))) return;
                    start(async () => {
                      const r = await restoreDocVersionAction(projectId, viewing.versionNo);
                      if ("error" in r && r.error) return notify(r.error);
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
              <button type="button" style={smallButton()} onClick={() => setViewing(null)}>{t("返回当前稿", "Back to the draft")}</button>
            </div>
          ) : null}

          <div className="sd-page">
            {viewing
              ? viewing.beats.map((b, i) => (
                  <div key={i} className="sd-para">
                    <div className="sd-text" style={{ color: b.voiceover ? "#262626" : "#a3a3a3" }}>{b.voiceover || t("（现场声，无口播）", "(natural sound)")}</div>
                    {showVisual && b.visual ? <div className="sd-visual-ro">{t("画面：", "Shot: ")}{b.visual}</div> : null}
                  </div>
                ))
              : proposal
                ? renderProposal()
                : paras.map((p, i) => (
                    <div key={p.k} className="sd-para">
                      <div className="sd-wrap">
                        <Backdrop text={p.voiceover} marks={marksFor(i, p.voiceover)} active={activeComment} />
                        <AutoText
                          boxRef={(el) => {
                            if (el) boxes.current.set(p.k, el);
                            else boxes.current.delete(p.k);
                          }}
                          value={p.voiceover}
                          readOnly={!editable}
                          placeholder={p.naturalSound || p.visual ? (editable ? t("（现场声，无口播）在这里写要说的话", "(natural sound) type a line here") : t("（现场声，无口播）", "(natural sound)")) : i === 0 && editable ? t("从这里开始写…", "Start writing…") : ""}
                          onChange={(v) => setVoice(p.k, v)}
                          onKeyDown={(e) => onKey(e, i)}
                          onMouseUp={(e) => pickSelection(e, i, { x: e.clientX, y: e.clientY })}
                          onKeyUp={(e) => e.shiftKey && pickSelection(e, i)}
                        />
                      </div>
                      {showVisual || (p.naturalSound && p.visual) ? (
                        <div className="sd-visual">
                          <span>{t("画面", "Shot")}</span>
                          <input value={p.visual} readOnly={!editable} onChange={(e) => setVisual(p.k, e.target.value)} onKeyDown={(e) => { if (!editable && locked && me.canEdit && e.key.length === 1) setLockPrompt(true); }} placeholder={t("镜头、画面、字幕卡…", "Framing, b-roll, on-screen text…")} />
                        </div>
                      ) : null}
                    </div>
                  ))}
            {!viewing && !proposal && editable ? (
              <button type="button" className="sd-add" onClick={() => { const k = `p${++seq.current}`; edit((list) => [...list, { k, visual: "", voiceover: "", subtitle: "", naturalSound: false }]); focusAt(k, 0); }}>
                + {t("加一段", "Add a paragraph")}
              </button>
            ) : null}
          </div>
        </section>

        {/* ---- the side panel ---- */}
        <aside className="sd-side">
          <div style={{ display: "flex", gap: 2, padding: 3, background: "#efeeea", borderRadius: 10 }}>
            {(
              [
                ["ai", t("AI 助手", "AI copilot")],
                ["comments", t(`批注${openComments.length ? ` ${openComments.length}` : ""}`, `Comments${openComments.length ? ` ${openComments.length}` : ""}`)],
                ["versions", t("版本", "Versions")],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className="sd-tab" data-on={tab === k ? "1" : undefined}>
                {label}
              </button>
            ))}
          </div>

          {tab === "ai" ? (
            <div className="sd-panel">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="sd-ai-mark"><Icon name="spark" size={13} /></span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("让编剧改", "Ask the writer")}</div>
                  <div style={{ fontSize: 11.5, color: "#8a8a8a" }}>{t("改法以修订模式显示，接受了才生效", "Edits show as tracked changes; nothing changes until you accept")}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CHIPS.map((c) => (
                  <button key={c.zh} type="button" className="sd-chip" disabled={!me.canEdit || thinking} onClick={() => runCopilot(zh ? c.zh : c.en)}>
                    {zh ? c.zh : c.en}
                  </button>
                ))}
              </div>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={4}
                disabled={!me.canEdit}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runCopilot(); }}
                placeholder={t("例如：把第二段改得更口语，加一个香港观众熟悉的比喻，总长控制在 60 秒内", "e.g. make paragraph 2 more conversational and keep it under 60 seconds")}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #dcdbd6", borderRadius: 10, padding: "9px 11px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
              />
              <button type="button" style={{ ...bigButton("primary", !me.canEdit || thinking), width: "100%" }} disabled={!me.canEdit || thinking} onClick={() => runCopilot()}>
                <Icon name="spark" size={14} />
                {thinking ? t("编剧正在改…", "The writer is on it…") : t("执行改写", "Rewrite")}
              </button>

              <div style={{ borderTop: "1px solid #efeee9", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="paperclip" size={14} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, flexGrow: 1 }}>{t("参考资料", "References")}</span>
                  {me.canEdit ? (
                    <button type="button" style={smallButton()} onClick={() => fileInput.current?.click()}>
                      <Icon name="upload" size={12} />
                      {t("上传", "Upload")}
                    </button>
                  ) : null}
                  <input ref={fileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.txt,.md,.rtf,.csv,.xlsx,.pptx,image/*" onChange={(e) => { if (e.target.files?.length) void uploadRefs(e.target.files); e.target.value = ""; }} />
                </div>
                <div style={{ fontSize: 11.5, color: "#8a8a8a" }}>{t("范例脚本、采访稿、数据、笔记……编剧改写时会读。", "Example scripts, notes, data — the writer reads them when rewriting.")}</div>
                {props.references.map((f) => (
                  <div key={f.id} className="sd-ref">
                    <Icon name="doc" size={13} />
                    <a href={`/files/${f.id}`} target="_blank" rel="noreferrer" style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#171717", textDecoration: "none" }} title={f.name}>{f.name}</a>
                    {!f.hasText ? <span style={{ fontSize: 10.5, color: "#b45309" }} title={t("还没读出文字", "No text read yet")}>{t("无文字", "no text")}</span> : null}
                    {me.canEdit ? (
                      <button type="button" className="sd-x" aria-label={t("移除", "Remove")} onClick={() => start(async () => { await removeReferenceAction(projectId, f.id); router.refresh(); })}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    ) : null}
                  </div>
                ))}
                {uploading.map((u) => (
                  <div key={u.name} className="sd-ref" style={{ color: "#8a8a8a" }}>
                    <Icon name="upload" size={13} />
                    <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</span>
                    <span style={{ fontSize: 11 }}>{u.pct}%</span>
                  </div>
                ))}
                {!props.references.length && !uploading.length ? <div style={{ fontSize: 12, color: "#a3a3a3" }}>{t("还没有资料", "Nothing yet")}</div> : null}
              </div>
              <Link href="/train/script" prefetch={false} style={{ fontSize: 12.5, color: "#1f5fbf", textDecoration: "none" }}>
                {t("训练编剧（长期说明与范例）→", "Train the writer (standing instructions & examples) →")}
              </Link>
            </div>
          ) : null}

          {tab === "comments" ? (
            <div className="sd-panel">
              {draft ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid #f3dfb3", background: "#fffaf0", borderRadius: 10 }}>
                  {draft.quote ? <div className="sd-quote">「{draft.quote}」</div> : <div style={{ fontSize: 12, color: "#8a8a8a" }}>{t("对整份脚本的意见", "About the whole script")}</div>}
                  <textarea ref={draftBox} value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendComment(); }} placeholder={t("写下批注…", "Write a comment…")} style={{ border: "1px solid #dcdbd6", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button type="button" style={smallButton()} onClick={() => setDraft(null)}>{t("取消", "Cancel")}</button>
                    <button type="button" style={smallButton(true)} disabled={pending || !draftText.trim()} onClick={sendComment}>{t("发表", "Post")}</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#8a8a8a", flexGrow: 1 }}>{t("在文档里选中文字即可加批注", "Select words in the document to comment")}</span>
                  <button type="button" style={smallButton()} onClick={() => startComment(null, null)}>{t("总体意见", "General note")}</button>
                </div>
              )}
              {openComments.length ? (
                openComments.map((c) => <CommentItem key={c.id} c={c} zh={zh} active={activeComment === c.id} onJump={() => jumpTo(c)} onResolve={() => start(async () => { await resolveCommentAction(projectId, c.id); router.refresh(); })} />)
              ) : (
                <div style={{ fontSize: 12.5, color: "#a3a3a3", padding: "6px 0" }}>{t("没有待处理的批注", "No open comments")}</div>
              )}
              {props.comments.length > openComments.length ? (
                <>
                  <button type="button" className="sd-link" onClick={() => setShowResolved((v) => !v)}>
                    {showResolved ? t("收起已解决", "Hide resolved") : t(`已解决 ${props.comments.length - openComments.length} 条`, `${props.comments.length - openComments.length} resolved`)}
                  </button>
                  {showResolved
                    ? props.comments.filter((c) => c.resolvedAt).map((c) => <CommentItem key={c.id} c={c} zh={zh} active={false} resolved onJump={() => jumpTo(c)} onResolve={() => start(async () => { await resolveCommentAction(projectId, c.id, true); router.refresh(); })} />)
                    : null}
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "versions" ? (
            <div className="sd-panel">
              {props.versions.length ? (
                props.versions.map((v) => {
                  const isLocked = script?.lockedVersion === v.versionNo;
                  const inReview = open.some((a) => a.versionNo === v.versionNo);
                  const on = viewing?.versionNo === v.versionNo;
                  return (
                    <button
                      key={v.versionNo}
                      type="button"
                      className="sd-version"
                      data-on={on ? "1" : undefined}
                      onClick={() =>
                        start(async () => {
                          const r = await versionBeatsAction(projectId, v.versionNo);
                          if ("error" in r && r.error) return notify(r.error);
                          if ("beats" in r) setViewing({ versionNo: v.versionNo, beats: r.beats });
                        })
                      }
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <b style={{ fontSize: 13 }}>{t(`第 ${v.versionNo} 版`, `v${v.versionNo}`)}</b>
                        {isLocked ? <span className="sd-badge" style={{ color: "#1e7a4f", background: "#e7f6ee" }}>{t("已批准", "Approved")}</span> : null}
                        {inReview ? <span className="sd-badge" style={{ color: "#95590a", background: "#fff4df" }}>{t("审阅中", "In review")}</span> : null}
                        {v.model ? <span className="sd-badge" style={{ color: "#1f5fbf", background: "#eef4fe" }}>AI</span> : null}
                      </span>
                      <span style={{ fontSize: 11.5, color: "#8a8a8a" }}>
                        {v.authorName ?? "—"} · {ago(v.createdAt, zh)} · {t(`${v.wordCount} 字`, `${v.wordCount} words`)}
                      </span>
                      {v.note ? <span style={{ fontSize: 11.5, color: "#6b6b6b" }}>{versionNote(v.note, zh)}</span> : null}
                    </button>
                  );
                })
              ) : (
                <div style={{ fontSize: 12.5, color: "#a3a3a3" }}>{t("还没有存过版本。分享审阅时会自动存一版。", "No versions yet. Sharing for review saves one.")}</div>
              )}
              {props.approvals.filter((a) => a.state !== "withdrawn").length ? (
                <div style={{ borderTop: "1px solid #efeee9", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t("审阅记录", "Reviews")}</div>
                  {props.approvals.filter((a) => a.state !== "withdrawn").slice(0, 8).map((a) => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <PersonAvatar id={a.approverId} url={a.approverAvatar} name={a.approverName ?? "?"} size={20} />
                      <span style={{ flexGrow: 1, minWidth: 0 }}>
                        {a.approverName ?? "?"} · {t(`第 ${a.versionNo ?? "?"} 版`, `v${a.versionNo ?? "?"}`)}
                      </span>
                      <span style={{ color: a.state === "approved" ? "#1e7a4f" : a.state === "rejected" ? "#c42b2b" : "#95590a" }}>
                        {a.state === "approved" ? t("已批准", "approved") : a.state === "rejected" ? t("退回", "sent back") : t("待审", "waiting")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <details style={{ borderTop: "1px solid #efeee9", paddingTop: 10 }}>
                <summary style={{ fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{t("检查项", "Checks")}</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, fontSize: 12.5, color: "#404040" }}>
                  <div>{t(`字数 ${totals.count} · 约 ${clock(totals.seconds, zh)}`, `${totals.count} words · ~${clock(totals.seconds, zh)}`)}{target ? t(`（目标 ${clock(target, zh)}）`, ` (target ${clock(target, zh)})`) : ""}</div>
                  {script?.mandatoryPoints.length ? (
                    script.mandatoryPoints.map((m) => {
                      const hit = paras.some((p) => `${p.voiceover}\n${p.visual}`.toLowerCase().includes(m.trim().toLowerCase()));
                      return (
                        <div key={m} style={{ display: "flex", gap: 6, color: hit ? "#1e7a4f" : "#b45309" }}>
                          <span>{hit ? "✓" : "○"}</span>
                          <span>{m}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ color: "#8a8a8a" }}>{t("简报里没有必讲要点", "No required points in the brief")}</div>
                  )}
                </div>
              </details>
            </div>
          ) : null}
        </aside>
      </div>

      {sel ? (
        <button type="button" className="sd-float" style={{ left: Math.min(sel.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 120), top: Math.max(8, sel.y - 44) }} onMouseDown={(e) => e.preventDefault()} onClick={() => startComment(sel.i, sel.quote)}>
          <Icon name="comment" size={13} />
          {t("添加批注", "Comment")}
        </button>
      ) : null}

      {sharing ? (
        <ShareDialog
          zh={zh}
          title={t(`分享脚本《${props.projectTitle}》`, `Share “${props.projectTitle}”`)}
          url={`/projects/${projectId}/script`}
          accessNote={props.accessNote}
          people={props.people}
          meId={me.id}
          allowReview={!locked}
          defaultAsk={locked ? "view" : "review"}
          onClose={() => setSharing(false)}
          onSend={async (userIds, ask, message) => {
            if (saveState === "dirty") await save();
            const r = await shareScriptAction(projectId, { userIds, ask, message });
            if ("error" in r) return { error: r.error };
            const n = r.sent;
            notify(ask === "review" ? t(`已发给 ${n} 人审阅`, `Sent to ${n} for review`) : t(`已分享给 ${n} 人`, `Shared with ${n}`), "ok");
            router.refresh();
            return { ok: true };
          }}
        />
      ) : null}
    </div>
  );

  function renderProposal() {
    if (!proposal) return null;
    const out: React.ReactNode[] = [];
    const insertsAfter = (k: string | null) =>
      proposal.inserts
        .filter((x) => x.afterK === k)
        .forEach((x) =>
          out.push(
            <div key={x.id} className="sd-para sd-change">
              <div className="sd-new">{x.text}</div>
              <ChangeBar zh={zh} why={x.why} added onAccept={() => applyInsert(x.id)} onReject={() => dropFromProposal({ insert: x.id })} />
            </div>,
          ),
        );
    insertsAfter(null);
    for (const p of paras) {
      const c = proposal.changes[p.k];
      if (!c) {
        out.push(
          <div key={p.k} className="sd-para">
            <div className="sd-text" style={{ color: p.voiceover ? "#404040" : "#a3a3a3" }}>{p.voiceover || t("（现场声，无口播）", "(natural sound)")}</div>
          </div>,
        );
      } else {
        out.push(
          <div key={p.k} className="sd-para sd-change">
            <div className="sd-old">{p.voiceover || t("（空）", "(empty)")}</div>
            {c.text ? <div className="sd-new">{c.text}</div> : <div style={{ fontSize: 12.5, color: "#c42b2b" }}>{t("删掉这一段", "Delete this paragraph")}</div>}
            <ChangeBar zh={zh} why={c.why} onAccept={() => applyChange(p.k)} onReject={() => dropFromProposal({ change: p.k })} />
          </div>,
        );
      }
      insertsAfter(p.k);
    }
    return out;
  }
}

function versionNote(note: string, zh: boolean) {
  const map: Record<string, string> = {
    "before regenerating from the brief": zh ? "重写前自动存的" : note,
    "before restoring an earlier version": zh ? "恢复旧版前自动存的" : note,
  };
  return map[note] ?? note;
}

function ChangeBar({ zh, why, added = false, onAccept, onReject }: { zh: boolean; why: string; added?: boolean; onAccept: () => void; onReject: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
      <span style={{ fontSize: 11.5, color: "#1f5fbf", flexGrow: 1 }}>{added ? (zh ? "新增一段" : "New paragraph") : ""}{why ? `${added ? " · " : ""}${why}` : ""}</span>
      <button type="button" className="sd-mini sd-ok" onClick={onAccept}>
        <Icon name="check" size={11} />
        {zh ? "接受" : "Accept"}
      </button>
      <button type="button" className="sd-mini" onClick={onReject}>{zh ? "不要" : "Reject"}</button>
    </div>
  );
}

function CommentItem({ c, zh, active, resolved = false, onJump, onResolve }: { c: DocComment; zh: boolean; active: boolean; resolved?: boolean; onJump: () => void; onResolve: () => void }) {
  return (
    <div className="sd-comment" data-on={active ? "1" : undefined} style={{ opacity: resolved ? 0.65 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PersonAvatar id={c.authorId} url={c.authorAvatar} name={c.authorName} size={22} />
        <span style={{ fontSize: 12.5, fontWeight: 600, flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.authorName}</span>
        <span style={{ fontSize: 11, color: "#a3a3a3" }}>{ago(c.createdAt, zh)}</span>
      </div>
      {c.quote ? (
        <button type="button" className="sd-quote" onClick={onJump} title={zh ? "跳到原文" : "Jump to it"}>
          「{c.quote}」
        </button>
      ) : null}
      <div style={{ fontSize: 13, color: "#262626", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{c.body}</div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="sd-mini" onClick={onResolve}>
          {resolved ? (zh ? "重新打开" : "Reopen") : (
            <>
              <Icon name="check" size={11} />
              {zh ? "解决" : "Resolve"}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** The comment highlights, drawn under a transparent textarea in exactly the same type. */
function Backdrop({ text, marks, active }: { text: string; marks: { a: number; b: number; id: string }[]; active: string | null }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.a < at) continue;
    if (m.a > at) parts.push(text.slice(at, m.a));
    parts.push(
      <mark key={m.id + m.a} style={{ background: active === m.id ? "#ffd972" : "#fff0b3", color: "transparent", borderRadius: 2 }}>
        {text.slice(m.a, m.b)}
      </mark>,
    );
    at = m.b;
  }
  parts.push(text.slice(at) + "​");
  return (
    <div aria-hidden className="sd-backdrop">
      {parts}
    </div>
  );
}

function AutoText({
  value,
  readOnly,
  placeholder,
  onChange,
  onKeyDown,
  onMouseUp,
  onKeyUp,
  boxRef,
}: {
  value: string;
  readOnly: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onMouseUp: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  boxRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const fit = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  React.useLayoutEffect(fit, [value, fit]);
  React.useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        boxRef(el);
      }}
      className="sd-area"
      rows={1}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onMouseUp={onMouseUp}
      onKeyUp={onKeyUp}
      spellCheck={false}
    />
  );
}

const CSS = `
.sd-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 14px; align-items: start; }
@media (max-width: 1000px) { .sd-grid { grid-template-columns: 1fr; } }
.sd-side { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 10px; background: #fff; border: 1px solid #e7e6e2; border-radius: 14px; padding: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.03); max-height: calc(100vh - 150px); overflow-y: auto; }
.sd-tab { flex: 1; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #6b6b6b; font-family: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.sd-tab[data-on] { background: #fff; color: #171717; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.sd-panel { display: flex; flex-direction: column; gap: 10px; }
.sd-ai-mark { width: 26px; height: 26px; border-radius: 8px; background: #e3edfd; color: #1f6feb; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.sd-chip { height: 28px; padding: 0 10px; border: 1px solid #d6e4fb; border-radius: 999px; background: #f5f9ff; color: #1f4f9a; font-family: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.sd-chip:hover:not(:disabled) { background: #e7f0fe; }
.sd-chip:disabled { opacity: .5; cursor: default; }
.sd-page { max-width: 760px; margin: 0 auto; padding: 22px 36px 30px; display: flex; flex-direction: column; gap: 4px; }
@media (max-width: 700px) { .sd-page { padding: 16px 16px 24px; } }
.sd-para { position: relative; padding: 4px 0; }
.sd-wrap { position: relative; }
.sd-area, .sd-backdrop, .sd-text, .sd-old, .sd-new { font-family: inherit; font-size: 16px; line-height: 1.85; letter-spacing: .01em; padding: 2px 6px; margin: 0; border: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; box-sizing: border-box; width: 100%; }
.sd-backdrop { position: absolute; inset: 0; color: transparent; pointer-events: none; border-radius: 6px; }
.sd-area { position: relative; display: block; resize: none; overflow: hidden; background: transparent; color: #1f1f1f; outline: none; border-radius: 6px; transition: background-color .15s ease; }
.sd-area:hover:not([readonly]) { background: rgba(0,0,0,.018); }
.sd-area:focus:not([readonly]) { background: rgba(31,111,235,.035); }
.sd-area::placeholder { color: #b5b5b0; }
.sd-text { color: #262626; }
.sd-visual { display: flex; align-items: center; gap: 8px; margin: 0 6px 4px; font-size: 12px; color: #8a8a8a; }
.sd-visual span { flex-shrink: 0; font-size: 11px; padding: 0 6px; line-height: 18px; border-radius: 4px; background: #f3f3f1; }
.sd-visual input { flex-grow: 1; min-width: 0; border: 0; border-bottom: 1px dashed transparent; background: transparent; font-family: inherit; font-size: 12.5px; color: #6b6b6b; padding: 2px 0; outline: none; }
.sd-visual input:focus:not([readonly]) { border-bottom-color: #cfcfca; }
.sd-visual-ro { margin: 0 6px 4px; font-size: 12.5px; color: #8a8a8a; }
.sd-add { align-self: flex-start; margin: 8px 6px 0; border: 0; background: none; color: #8a8a8a; font-family: inherit; font-size: 13px; cursor: pointer; padding: 4px 0; }
.sd-add:hover { color: #171717; }
.sd-change { background: #fbfcff; border: 1px solid #e3ebfa; border-radius: 10px; padding: 8px 10px; margin: 4px 0; }
.sd-old { color: #b42318; text-decoration: line-through; text-decoration-color: rgba(180,35,24,.6); background: #fff1f0; border-radius: 6px; }
.sd-new { color: #14663f; background: #eaf7ef; border-radius: 6px; margin-top: 4px; }
.sd-mini { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border: 1px solid #dcdbd6; border-radius: 7px; background: #fff; color: #333; font-family: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
.sd-mini:hover { background: #f5f5f3; }
.sd-ok { background: #171717; border-color: #171717; color: #fff; }
.sd-ok:hover { background: #333; }
.sd-float { position: fixed; z-index: 60; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: #171717; color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.2); }
.sd-comment { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid #ecebe6; border-radius: 10px; background: #fff; transition: border-color .15s ease, box-shadow .15s ease; }
.sd-comment[data-on] { border-color: #f0c64a; box-shadow: 0 0 0 2px rgba(240,198,74,.2); }
.sd-quote { display: block; width: 100%; text-align: left; border: 0; border-left: 3px solid #f0c64a; background: #fffbea; padding: 4px 8px; font-family: inherit; font-size: 12px; color: #6b5a1f; border-radius: 0 6px 6px 0; cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
.sd-link { align-self: flex-start; border: 0; background: none; padding: 0; font-family: inherit; font-size: 12px; color: #1f5fbf; cursor: pointer; }
.sd-ref { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid #efeee9; border-radius: 8px; font-size: 12.5px; }
.sd-x { width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #8a8a8a; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.sd-x:hover { background: #f3f3f1; color: #171717; }
.sd-version { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; padding: 9px 10px; border: 1px solid #ecebe6; border-radius: 10px; background: #fff; cursor: pointer; font-family: inherit; text-align: left; color: #171717; }
.sd-version:hover { background: #fafaf8; }
.sd-version[data-on] { border-color: #9fb8e8; background: #f7faff; }
.sd-badge { font-size: 10.5px; font-weight: 600; border-radius: 999px; padding: 0 7px; line-height: 17px; }
`;
