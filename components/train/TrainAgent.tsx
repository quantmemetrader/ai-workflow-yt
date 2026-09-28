"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { Card, Empty, INK, LINE, MUTED, NextStep, PageBody, bigButton, smallButton } from "@/components/projects/kit";
import { notify } from "@/lib/client/notify";
import { TRAIN_BUDGET, TRAIN_PLACEHOLDER, TRAIN_USED, type TrainKey } from "@/lib/agents/train-keys";
import type { TrainRow } from "@/lib/agents/training";
import { ago, trainHint, trainName } from "@/components/train/names";
import {
  addExampleAction,
  addExampleFilesAction,
  deleteExampleAction,
  restoreTrainingAction,
  saveTrainingTextAction,
  setExampleActiveAction,
  trainingHistoryAction,
  tryTrainingAction,
  updateExampleAction,
} from "@/app/(app)/train/actions";

type Version = { version: number; body: string; note: string | null; byName: string | null; at: string };

/**
 * One AI employee's training page, one block per row:
 *
 *   工作说明       the rules it must follow — saved as a new version each time,
 *                  with 历史版本 to look back and 恢复
 *   风格与禁用词   a short list of words to use and never use
 *   范例           upload files (TXT, Markdown, Word) or paste text; each can
 *                  be switched off, opened, edited or deleted
 *   试一试         ask for something small and see how it writes now
 */
export function TrainAgent({ agent, zh, rows, canEdit }: { agent: TrainKey; zh: boolean; rows: TrainRow[]; canEdit: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const name = trainName(agent, zh);
  const ph = TRAIN_PLACEHOLDER[agent];
  const instructionsRow = rows.find((r) => r.kind === "instructions") ?? null;
  const styleRow = rows.find((r) => r.kind === "style") ?? null;
  const examples = rows.filter((r) => r.kind === "example");
  const activeChars = examples.filter((e) => e.active).reduce((n, e) => n + e.body.trim().length, 0);
  const trained = Boolean((instructionsRow?.active && instructionsRow.body.trim()) || (styleRow?.active && styleRow.body.trim()) || examples.some((e) => e.active));

  return (
    <PageBody width={960}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: MUTED }}>
        <Link href="/train" prefetch={false} style={{ color: MUTED, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="spark" size={13} />
          {t("AI 训练", "Train the AI")}
        </Link>
        <span style={{ color: "#c8c8c4" }}>/</span>
        <span style={{ color: INK }}>{name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <AgentIcon agent={agent === "assistant" ? null : agent} size={48} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: INK }}>{t(`训练${name}`, `Train ${name}`)}</h1>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{trainHint(agent, zh)}</div>
        </div>
      </div>
      <NextStep state={trained ? "done" : "you"} zh={zh} text={<>{trained ? t("已经训练过，可以继续补充。", "Trained — you can keep adding.") : t("写几条工作说明、上传一两篇范例，它就会照着做。", "Write a few instructions and upload an example or two.")} <span style={{ color: MUTED }}>{zh ? TRAIN_USED[agent].zh : TRAIN_USED[agent].en}</span></>} />
      {!canEdit ? <div style={{ fontSize: 13, color: "#95590a" }}>{t("访客只能查看，不能修改。", "Guests can look but not change anything.")}</div> : null}

      <TextBlock
        key={`i-${instructionsRow?.id ?? "new"}-${instructionsRow?.version ?? 0}`}
        agent={agent}
        zh={zh}
        kind="instructions"
        row={instructionsRow}
        canEdit={canEdit}
        title={t("工作说明", "Standing instructions")}
        sub={t("它每次干活都必须遵守的要求：语气、结构、必须做和不要做的事。一行一条最清楚。", "What it must always follow: tone, structure, dos and don'ts. One per line reads best.")}
        placeholder={ph.instructions}
        budget={TRAIN_BUDGET.instructions}
        rowsTall={9}
        onSaved={() => router.refresh()}
      />

      <TextBlock
        key={`s-${styleRow?.id ?? "new"}-${styleRow?.version ?? 0}`}
        agent={agent}
        zh={zh}
        kind="style"
        row={styleRow}
        canEdit={canEdit}
        title={t("风格与禁用词", "Style and banned words")}
        sub={t("常用说法、口头禅，以及绝对不能出现的词。", "Phrases to use, catchphrases, and words that must never appear.")}
        placeholder={ph.style}
        budget={TRAIN_BUDGET.style}
        rowsTall={4}
        onSaved={() => router.refresh()}
      />

      <Examples agent={agent} zh={zh} examples={examples} activeChars={activeChars} canEdit={canEdit} onChanged={() => router.refresh()} />

      <TryIt agent={agent} zh={zh} placeholder={ph.tryIt} name={name} />
    </PageBody>
  );
}

function TextBlock({
  agent,
  zh,
  kind,
  row,
  canEdit,
  title,
  sub,
  placeholder,
  budget,
  rowsTall,
  onSaved,
}: {
  agent: TrainKey;
  zh: boolean;
  kind: "instructions" | "style";
  row: TrainRow | null;
  canEdit: boolean;
  title: string;
  sub: string;
  placeholder: string;
  budget: number;
  rowsTall: number;
  onSaved: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const initial = row?.active ? row.body : (row?.body ?? "");
  const [text, setText] = React.useState(initial);
  const [pending, start] = React.useTransition();
  const [history, setHistory] = React.useState<Version[] | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const dirty = text !== initial || (row ? !row.active && text.trim().length > 0 : false);
  const over = text.trim().length > budget;

  const save = () =>
    start(async () => {
      const r = await saveTrainingTextAction(agent, kind, text);
      if ("error" in r) notify(r.error);
      else {
        notify(t("已保存，下次干活就会照着做", "Saved — used from the next job on"), "ok");
        onSaved();
      }
    });
  const openHistory = () => {
    setShowHistory((v) => !v);
    if (!history && row) void trainingHistoryAction(row.id).then((r) => setHistory(r.versions));
  };

  return (
    <Card
      icon={kind === "instructions" ? "pen" : "doc"}
      title={title}
      sub={sub}
      right={
        row ? (
          <span style={{ fontSize: 12, color: MUTED }}>
            {t(`第 ${row.version} 版`, `v${row.version}`)} · {ago(row.updatedAt, zh)}
            {row.updatedByName ? ` · ${row.updatedByName}` : ""}
          </span>
        ) : null
      }
      footer={
        canEdit ? (
          <>
            <button type="button" onClick={save} disabled={!dirty || pending} style={bigButton("primary", !dirty || pending)}>
              <Icon name="check" size={14} />
              {pending ? t("保存中…", "Saving…") : t("保存", "Save")}
            </button>
            {row ? (
              <button type="button" onClick={openHistory} style={smallButton(showHistory)}>
                <Icon name="undo" size={13} />
                {t("历史版本", "History")}
              </button>
            ) : null}
            {dirty ? <span style={{ fontSize: 12, color: "#95590a" }}>{t("有改动还没保存", "Unsaved changes")}</span> : null}
          </>
        ) : null
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={!canEdit}
        placeholder={placeholder}
        rows={rowsTall}
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: `1px solid ${LINE}`, borderRadius: 10, padding: "12px 14px", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7, color: INK, background: canEdit ? "#fff" : "#fafaf8", outline: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: over ? "#b45309" : MUTED, marginTop: 6 }}>
        <span>{over ? t(`超过 ${budget.toLocaleString()} 字的部分它读不到，请精简`, `Past ${budget} characters it is not read; trim it`) : t("写得越具体，效果越好", "The more specific, the better")}</span>
        <span>
          {text.trim().length.toLocaleString()} / {budget.toLocaleString()} {t("字", "chars")}
        </span>
      </div>
      {showHistory ? (
        <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {history === null ? (
            <span style={{ fontSize: 12.5, color: MUTED }}>{t("读取中…", "Loading…")}</span>
          ) : history.length === 0 ? (
            <span style={{ fontSize: 12.5, color: MUTED }}>{t("还没有更早的版本", "No earlier versions yet")}</span>
          ) : (
            history.map((v) => (
              <div key={v.version} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", background: "#fafaf8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED, marginBottom: 6 }}>
                  <b style={{ color: INK }}>{t(`第 ${v.version} 版`, `v${v.version}`)}</b>
                  <span>{ago(v.at, zh)}</span>
                  {v.byName ? <span>· {v.byName}</span> : null}
                  {v.note ? <span>· {v.note}</span> : null}
                  <span style={{ flexGrow: 1 }} />
                  {canEdit && row ? (
                    <button
                      type="button"
                      style={smallButton()}
                      onClick={() =>
                        start(async () => {
                          const r = await restoreTrainingAction(agent, row.id, v.version);
                          if ("error" in r) notify(r.error);
                          else {
                            notify(t(`已恢复到第 ${v.version} 版`, `Restored v${v.version}`), "ok");
                            onSaved();
                          }
                        })
                      }
                    >
                      {t("恢复这一版", "Restore")}
                    </button>
                  ) : null}
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "#444", maxHeight: 140, overflowY: "auto" }}>{v.body || t("（空）", "(empty)")}</div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </Card>
  );
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{ width: 36, height: 20, borderRadius: 99, border: 0, padding: 2, background: on ? "#22a061" : "#d4d4d0", cursor: disabled ? "default" : "pointer", display: "inline-flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background-color .15s ease", flexShrink: 0 }}
    >
      <span style={{ width: 16, height: 16, borderRadius: 99, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </button>
  );
}

function Examples({ agent, zh, examples, activeChars, canEdit, onChanged }: { agent: TrainKey; zh: boolean; examples: TrainRow[]; activeChars: number; canEdit: boolean; onChanged: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [pending, start] = React.useTransition();
  const [adding, setAdding] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; title: string; body: string } | null>(null);
  const [drag, setDrag] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const input = React.useRef<HTMLInputElement | null>(null);
  const over = activeChars > TRAIN_BUDGET.examples;

  const upload = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const r = await addExampleFilesAction(agent, form);
      for (const e of r.errors) notify(e);
      if (r.added) {
        notify(t(`已加入 ${r.added} 篇范例`, `Added ${r.added} example${r.added === 1 ? "" : "s"}`), "ok");
        onChanged();
      }
    } catch {
      notify(t("上传失败：文件可能太大，请粘贴文字", "Upload failed: the file may be too large; paste the text instead"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const act = (fn: () => Promise<{ ok: true } | { error: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if ("error" in r) notify(r.error);
      else {
        if (ok) notify(ok, "ok");
        onChanged();
      }
    });

  return (
    <Card
      icon="paperclip"
      title={t("范例", "Examples")}
      sub={t("上传几篇你们满意的作品（脚本、文案、报告），它会学结构、口吻和长度，不会照抄内容。", "Upload work you are happy with; it learns the structure, tone and length, not the content.")}
      right={<span style={{ fontSize: 12, color: over ? "#b45309" : MUTED }}>{t(`启用 ${examples.filter((e) => e.active).length} 篇 · ${activeChars.toLocaleString()} 字`, `${examples.filter((e) => e.active).length} on · ${activeChars.toLocaleString()} chars`)}</span>}
    >
      {canEdit ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void upload(e.dataTransfer.files);
          }}
          style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "16px 18px", border: `1.5px dashed ${drag ? "#1f6feb" : "#d6d5d0"}`, borderRadius: 12, background: drag ? "#f5f9ff" : "#fafaf8", marginBottom: 12 }}
        >
          <span style={{ width: 36, height: 36, borderRadius: 10, background: "#fff", border: `1px solid ${LINE}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#404040", flexShrink: 0 }}>
            <Icon name="upload" size={17} />
          </span>
          <div style={{ flexGrow: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{uploading ? t("正在读取文件…", "Reading the files…") : t("把文件拖到这里，或选择文件", "Drop files here, or choose them")}</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{t("支持 TXT、Markdown、Word (.docx)、字幕；每个文件一篇范例。PDF 请复制文字粘贴。", "TXT, Markdown, Word (.docx), subtitles; one example per file. For a PDF, paste the text.")}</div>
          </div>
          <input ref={input} type="file" multiple accept=".txt,.md,.markdown,.docx,.srt,.vtt,.csv,.json,.html,.htm,.rtf,text/plain" style={{ display: "none" }} onChange={(e) => e.target.files && void upload(e.target.files)} />
          <button type="button" disabled={uploading} onClick={() => input.current?.click()} style={bigButton("primary", uploading)}>
            <Icon name="upload" size={14} />
            {t("选择文件", "Choose files")}
          </button>
          <button type="button" onClick={() => setAdding((v) => !v)} style={bigButton("secondary")}>
            <Icon name="plus" size={14} />
            {t("粘贴文字", "Paste text")}
          </button>
        </div>
      ) : null}

      {adding ? (
        <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("范例标题，例如：爆款脚本 · 蒸馏之战", "Title, e.g. Our best script")} style={fieldStyle} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("把范例全文粘贴在这里", "Paste the whole example here")} rows={8} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.7 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              disabled={!body.trim() || pending}
              style={bigButton("primary", !body.trim() || pending)}
              onClick={() =>
                start(async () => {
                  const r = await addExampleAction(agent, title, body);
                  if ("error" in r) notify(r.error);
                  else {
                    notify(t("已加入范例", "Example added"), "ok");
                    setTitle("");
                    setBody("");
                    setAdding(false);
                    onChanged();
                  }
                })
              }
            >
              {t("保存范例", "Save example")}
            </button>
            <button type="button" style={smallButton()} onClick={() => setAdding(false)}>
              {t("取消", "Cancel")}
            </button>
            <span style={{ fontSize: 12, color: MUTED, marginLeft: "auto" }}>{body.trim().length.toLocaleString()} {t("字", "chars")}</span>
          </div>
        </div>
      ) : null}

      {over ? (
        <div style={{ fontSize: 12.5, color: "#95590a", background: "#fff6e5", border: "1px solid #f4ddb0", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
          {t(`启用的范例共 ${activeChars.toLocaleString()} 字，它每次只读前 ${TRAIN_BUDGET.examples.toLocaleString()} 字（最新的优先）。可以停用一些旧的，或删短一些。`, `The examples switched on come to ${activeChars} characters; only the first ${TRAIN_BUDGET.examples} (newest first) are read. Switch some off or shorten them.`)}
        </div>
      ) : null}

      {examples.length === 0 ? (
        <Empty icon="doc" text={t("还没有范例。上传一两篇你们最满意的作品，效果最明显。", "No examples yet. One or two of your best pieces makes the biggest difference.")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {examples.map((e) =>
            editing?.id === e.id ? (
              <div key={e.id} style={{ border: `1px solid #9fb8e8`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editing.title} onChange={(ev) => setEditing({ ...editing, title: ev.target.value })} style={fieldStyle} />
                <textarea value={editing.body} onChange={(ev) => setEditing({ ...editing, body: ev.target.value })} rows={10} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.7 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    disabled={pending || !editing.body.trim()}
                    style={bigButton("primary", pending || !editing.body.trim())}
                    onClick={() => {
                      const ed = editing;
                      act(() => updateExampleAction(agent, ed.id, ed.title, ed.body), t("已保存", "Saved"));
                      setEditing(null);
                    }}
                  >
                    {t("保存", "Save")}
                  </button>
                  <button type="button" style={smallButton()} onClick={() => setEditing(null)}>
                    {t("取消", "Cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div key={e.id} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: e.active ? "#fff" : "#fafaf8" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                  <Toggle on={e.active} disabled={!canEdit || pending} label={e.active ? t("已启用，点击停用", "On — press to switch off") : t("已停用，点击启用", "Off — press to switch on")} onChange={(v) => act(() => setExampleActiveAction(agent, e.id, v))} />
                  <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} style={{ flexGrow: 1, minWidth: 0, border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: e.active ? INK : MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>
                      {e.body.trim().length.toLocaleString()} {t("字", "chars")} · {ago(e.updatedAt, zh)}
                      {e.updatedByName ? ` · ${e.updatedByName}` : ""}
                      {!e.active ? ` · ${t("已停用", "off")}` : ""}
                    </div>
                  </button>
                  <button type="button" style={smallButton(open === e.id)} onClick={() => setOpen(open === e.id ? null : e.id)}>
                    <Icon name="eye" size={13} />
                    {open === e.id ? t("收起", "Hide") : t("查看", "View")}
                  </button>
                  {canEdit ? (
                    <>
                      <button type="button" style={smallButton()} onClick={() => setEditing({ id: e.id, title: e.title, body: e.body })}>
                        <Icon name="pen" size={13} />
                        {t("编辑", "Edit")}
                      </button>
                      <button
                        type="button"
                        style={{ ...smallButton(), color: "#c42b2b", borderColor: "#f0c7c7" }}
                        onClick={() => {
                          if (!window.confirm(t(`删除范例「${e.title}」？删除后不能恢复。`, `Delete the example "${e.title}"? This cannot be undone.`))) return;
                          act(() => deleteExampleAction(agent, e.id), t("已删除", "Deleted"));
                        }}
                      >
                        {t("删除", "Delete")}
                      </button>
                    </>
                  ) : null}
                </div>
                {open === e.id ? <div style={{ borderTop: `1px solid ${LINE}`, padding: "10px 14px 14px", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.75, color: "#333", maxHeight: 360, overflowY: "auto" }}>{e.body}</div> : null}
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  );
}

function TryIt({ agent, zh, placeholder, name }: { agent: TrainKey; zh: boolean; placeholder: string; name: string }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [ask, setAsk] = React.useState("");
  const [answer, setAnswer] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const run = () =>
    start(async () => {
      const r = await tryTrainingAction(agent, ask || placeholder);
      if ("error" in r) notify(r.error);
      else setAnswer(r.text);
    });
  return (
    <Card icon="play" title={t("试一试", "Try it")} sub={t(`让${name}按现在保存的训练写一小段，看看效果。没保存的改动不算。`, `Ask ${name} for something small, using what is saved now.`)}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && !pending) run();
          }}
          placeholder={`${t("让它写一段…", "Ask it to write…")} ${t("例如：", "e.g. ")}${placeholder}`}
          style={{ ...fieldStyle, width: "auto", flex: "1 1 240px", height: 40 }}
        />
        <button type="button" onClick={run} disabled={pending} style={bigButton("primary", pending)}>
          <Icon name="spark" size={14} />
          {pending ? t("生成中…", "Writing…") : t("生成", "Generate")}
        </button>
      </div>
      {answer !== null ? (
        <div style={{ marginTop: 12, border: `1px solid #d6e4fb`, background: "#f5f9ff", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#1f5fbf", marginBottom: 6 }}>
            <AgentIcon agent={agent === "assistant" ? null : agent} size={18} />
            {name}
          </div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.75, color: INK }}>{answer}</div>
        </div>
      ) : null}
    </Card>
  );
}

const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 12px", fontFamily: "inherit", fontSize: 14, color: INK, background: "#fff", outline: "none" };
