"use client";

import * as React from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GI } from "@/components/script/doc/icons";
import { notify } from "@/lib/client/notify";
import { docCopilotAction } from "@/app/(app)/docs/ai-actions";

/**
 * The AI bar under the page and the AI panel beside it, for every document
 * that is not a script (5 Oct: "where is the AI bar and AI sidebar"). One
 * instruction, sent with the page's paragraphs; the answer is written into
 * the document as a single step, so 撤销 (or Ctrl+Z) takes it all back.
 * With text selected, only the selected paragraphs are changed.
 */
export type DocKind = "file" | "contract" | "report" | "spend";

type Run = { id: number; instruction: string; summary: string; changed: number; added: number; after: PMNode | null };

const QUICK: Record<DocKind | "all", [string, string][]> = {
  all: [
    ["润色语句", "Polish the wording"],
    ["更简洁", "Make it shorter"],
    ["更正式", "More formal"],
    ["检查错别字和病句", "Fix typos and grammar"],
    ["整理结构，加小标题", "Add structure and headings"],
  ],
  file: [["扩写充实", "Expand it"]],
  contract: [
    ["检查条款是否写清楚，补上常用但缺的条款", "Tighten the clauses and add common missing ones"],
    ["措辞改得对双方更平衡", "Balance the wording for both sides"],
  ],
  report: [
    ["在最前面加一段给老板看的三句话摘要", "Add a three-line summary at the top"],
    ["把需要决定的事单独列出来", "List the decisions needed"],
  ],
  spend: [
    ["整理成申请单：用途、供应商、报价、为什么现在买", "Shape it as a request: purpose, supplier, quote, why now"],
    ["写得更有说服力，方便审批", "Make the case clearer for approvers"],
  ],
};

function blocksOf(editor: Editor) {
  const out: { pos: number; node: PMNode }[] = [];
  editor.state.doc.forEach((node, offset) => out.push({ pos: offset, node }));
  return out;
}

const textOf = (node: PMNode) => node.textBetween(0, node.content.size, "\n", " ");

export function useDocAssistant(editor: Editor | null, opts: { kind: DocKind; id: string; title: string; zh: boolean }) {
  const t = (a: string, b: string) => (opts.zh ? a : b);
  const [busy, setBusy] = React.useState(false);
  const [runs, setRuns] = React.useState<Run[]>([]);
  const seq = React.useRef(0);

  const run = React.useCallback(
    async (instruction: string) => {
      if (!editor || busy || !instruction.trim()) return false;
      const blocks = blocksOf(editor);
      const { from, to, empty } = editor.state.selection;
      const focus = empty ? [] : blocks.map((b, i) => (b.pos < to && b.pos + b.node.nodeSize > from ? i : -1)).filter((i) => i >= 0);
      setBusy(true);
      try {
        const r = (await docCopilotAction({ kind: opts.kind, id: opts.id, title: opts.title, paragraphs: blocks.map((b) => textOf(b.node)), focus, instruction })) as {
          error?: string;
          changes?: { i: number; text: string }[];
          inserts?: { after: number; text: string }[];
          summary?: string;
        };
        if (r.error) {
          notify(r.error);
          return false;
        }
        /* The page may have moved on while the answer was written: apply against the blocks it was asked about only if they are still there. */
        const now = blocksOf(editor);
        if (now.length !== blocks.length || now.some((b, i) => textOf(b.node) !== textOf(blocks[i].node))) {
          notify(t("等待期间文档改动了，这次的改法没有写入，请再试一次", "The document changed while waiting; try again"));
          return false;
        }
        const { schema } = editor.state;
        const para = (s: string) => schema.nodes.paragraph.create(null, s ? schema.text(s) : null);
        const lines = (s: string) => s.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        const build = (orig: PMNode, text: string): PMNode[] => {
          const ls = lines(text);
          if (!ls.length) return [para("")];
          if (orig.type.name === "paragraph" || orig.type.name === "heading") return [orig.type.create(orig.attrs, schema.text(ls[0])), ...ls.slice(1).map(para)];
          return ls.map(para);
        };
        const ops = [
          ...(r.changes ?? []).map((c) => ({ at: now[c.i].pos, end: now[c.i].pos + now[c.i].node.nodeSize, nodes: build(now[c.i].node, c.text) })),
          ...(r.inserts ?? []).map((x) => {
            const at = x.after < 0 ? 0 : now[x.after].pos + now[x.after].node.nodeSize;
            return { at, end: at, nodes: lines(x.text).map(para) };
          }),
        ]
          .filter((o) => o.nodes.length)
          .sort((a, b) => b.at - a.at || b.end - a.end);
        const tr = editor.state.tr;
        for (const o of ops) tr.replaceWith(o.at, o.end, o.nodes);
        editor.view.dispatch(tr);
        const id = ++seq.current;
        setRuns((cur) => [{ id, instruction, summary: r.summary ?? "", changed: r.changes?.length ?? 0, added: r.inserts?.length ?? 0, after: editor.state.doc }, ...cur].slice(0, 12));
        notify(t("已改好，写进文档了；不满意可以点「撤销」", "Done and written in; Undo takes it back"), "ok");
        return true;
      } catch {
        notify(t("没改成，请检查网络后再试", "Could not reach the assistant; try again"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [editor, busy, opts.kind, opts.id, opts.title], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* Undo only while nothing was typed since: otherwise Ctrl+Z would take back the person's own words first. */
  const canUndo = (r: Run) => Boolean(editor && r.id === seq.current && r.after && editor.state.doc.eq(r.after));
  const undo = (r: Run) => {
    if (!editor || !canUndo(r)) return;
    editor.chain().focus().undo().run();
    setRuns((cur) => cur.map((x) => (x.id === r.id ? { ...x, after: null, summary: `${x.summary}（${t("已撤销", "undone")}）` } : x)));
  };

  return { busy, runs, run, undo, canUndo };
}

export type DocAssistantState = ReturnType<typeof useDocAssistant>;

/** The bar floating under the page, as on the script page. */
export function DocAiBar({ ai, zh }: { ai: DocAssistantState; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [text, setText] = React.useState("");
  const send = async () => {
    if (await ai.run(text)) setText("");
  };
  return (
    <div className="dai-bar">
      <GI name="sparkle" size={18} />
      <input
        value={text}
        disabled={ai.busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
        }}
        placeholder={ai.busy ? t("正在改，约半分钟…", "Working on it…") : t("描述你想怎么改这份文档…（选中文字就只改选中的部分）", "Describe the change… (select text to change only that)")}
        aria-label={t("让 AI 改这份文档", "Ask the AI to change this document")}
      />
      <button type="button" className="dai-send" disabled={ai.busy || !text.trim()} onClick={() => void send()} aria-label={t("发送", "Send")}>
        {ai.busy ? <span className="dai-spin" /> : <GI name="up" size={18} />}
      </button>
    </div>
  );
}

/** The AI panel beside the page: who answers, one-click changes, a box for anything else, and what was done. */
export function DocAiPanel({ ai, zh, kind, agentName }: { ai: DocAssistantState; zh: boolean; kind: DocKind; agentName: string }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [text, setText] = React.useState("");
  const quick = [...QUICK[kind], ...QUICK.all];
  return (
    <div className="dai-panel">
      <div className="dai-who">
        <span className="dai-avatar">
          <GI name="sparkle" size={18} />
        </span>
        <div>
          <div style={{ fontWeight: 600 }}>{agentName}</div>
          <div className="dai-sub">{t("告诉我怎么改，改动直接写进文档，可以撤销", "Tell me what to change; it is written in and can be undone")}</div>
        </div>
      </div>
      <div className="dai-label">{t("一键改", "One click")}</div>
      <div className="dai-chips">
        {quick.map(([a, b]) => (
          <button key={a} type="button" disabled={ai.busy} onClick={() => void ai.run(t(a, b))}>
            {t(a, b)}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        disabled={ai.busy}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t("想怎么改？例如：第二段写得更具体，加上交付日期", "What should change? e.g. make the second paragraph more specific")}
      />
      <button type="button" className="dai-go" disabled={ai.busy || !text.trim()} onClick={() => void ai.run(text).then((ok) => ok && setText(""))}>
        {ai.busy ? t("正在改…", "Working…") : t(`让${agentName}改`, `Ask ${agentName}`)}
      </button>
      <p className="dai-hint">{t("先选中一段文字再点，就只改选中的部分。", "Select text first to change only that part.")}</p>
      {ai.runs.length ? (
        <div className="dai-runs">
          <div className="dai-label">{t("改过的", "Done")}</div>
          {ai.runs.map((r) => (
            <div key={r.id} className="dai-run">
              <div className="dai-run-i">{r.instruction}</div>
              <div className="dai-run-s">
                {r.summary || t(`改了 ${r.changed} 段${r.added ? `，加了 ${r.added} 段` : ""}`, `${r.changed} changed${r.added ? `, ${r.added} added` : ""}`)}
              </div>
              {ai.canUndo(r) ? (
                <button type="button" onClick={() => ai.undo(r)}>
                  {t("撤销", "Undo")}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const DOC_AI_CSS = `
.dai-bar { position: sticky; bottom: 18px; z-index: 30; margin: 18px auto 0; width: min(760px, calc(100% - 32px)); display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 8px 0 18px; border-radius: 999px; background: #fff; border: 1px solid #dadce0; box-shadow: 0 4px 18px rgba(60,64,67,.18); color: #1a73e8; box-sizing: border-box; }
.dai-bar input { flex: 1; min-width: 0; border: 0; outline: none; font: inherit; font-size: 15px; color: #1f1f1f; background: transparent; }
.dai-send { width: 38px; height: 38px; border-radius: 50%; border: 0; background: #0b57d0; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.dai-send:disabled { background: #c4c7c5; cursor: default; }
.dai-spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,.5); border-top-color: #fff; animation: dai-rot .8s linear infinite; }
@keyframes dai-rot { to { transform: rotate(360deg); } }
.dai-panel { display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: #1f1f1f; }
.dai-who { display: flex; align-items: center; gap: 10px; }
.dai-avatar { width: 36px; height: 36px; border-radius: 50%; background: #e8f0fe; color: #1a73e8; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.dai-sub, .dai-hint { font-size: 12px; color: #5f6368; line-height: 1.5; margin: 0; }
.dai-label { font-size: 12px; font-weight: 600; color: #3c4043; margin-top: 6px; }
.dai-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.dai-chips button { min-height: 36px; padding: 6px 10px; border: 1px solid #dadce0; border-radius: 10px; background: #fff; font: inherit; font-size: 12.5px; color: #1f1f1f; text-align: left; cursor: pointer; line-height: 1.35; }
.dai-chips button:hover { background: #f1f3f4; }
.dai-chips button:disabled { opacity: .5; cursor: default; }
.dai-panel textarea { border: 1px solid #dadce0; border-radius: 10px; padding: 9px 11px; font: inherit; font-size: 13px; resize: vertical; }
.dai-panel textarea:focus { outline: none; border-color: #1a73e8; }
.dai-go { height: 38px; border: 0; border-radius: 999px; background: #0b57d0; color: #fff; font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; }
.dai-go:disabled { background: #c4c7c5; cursor: default; }
.dai-runs { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #eee; padding-top: 8px; }
.dai-run { border: 1px solid #eee; border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 3px; }
.dai-run-i { font-weight: 500; }
.dai-run-s { color: #5f6368; font-size: 12px; line-height: 1.5; }
.dai-run button { align-self: flex-start; margin-top: 2px; border: 0; background: none; color: #1a73e8; font: inherit; font-size: 12.5px; padding: 0; cursor: pointer; }
`;
