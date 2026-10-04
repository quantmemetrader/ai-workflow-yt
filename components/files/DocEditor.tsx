"use client";

import { TextSelection } from "@tiptap/pm/state";
import { useAsk } from "@/components/ui/useAsk";
import * as React from "react";
import Link from "next/link";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { BlockExtras } from "@/components/script/doc/editor";
import { Toolbar, type Mode } from "@/components/script/doc/toolbar";
import { GD_CSS } from "@/components/script/doc/ScriptDoc";
import { GI } from "@/components/script/doc/icons";
import { notify } from "@/lib/client/notify";
import { renameDocAction, saveDocAction } from "@/app/(app)/docs/actions";
import { docToText } from "@/lib/docs/convert";
import { DOC_AI_CSS, DocAiBar, DocAiPanel, useDocAssistant, type DocKind } from "@/components/files/DocAssistant";

/**
 * A document edited in the browser, on the same paper and toolbar as the
 * script page: contracts, invoices, notes in 法务 / 财务 / 账务 / 人事
 * (Ryan, 1 Oct). Saved as you type; downloads as Word or PDF; the side panel
 * holds who can see it and who it is shared with.
 *
 * The same paper serves records that are not files (5 Oct: contracts, monthly
 * reports and spend requests): those pass their own `save` and `rename`
 * (server actions bound to the record), their downloads, and a side panel of
 * their own details instead of sharing. `textMode` says how the record keeps
 * its text, so each save sends the formatted page and the text together.
 */
export function DocEditor({
  id,
  name,
  html,
  canEdit,
  zh,
  back,
  fromOriginal,
  hasOriginal,
  share,
  openShare = false,
  save: saveRecord,
  rename: renameRecord,
  textMode,
  downloads,
  panelLabel,
  subtitle,
  placeholder,
  fixedName = false,
  aiKind = "file",
  agentName,
}: {
  id: string;
  name: string;
  html: string;
  canEdit: boolean;
  zh: boolean;
  back: { href: string; label: string };
  fromOriginal: boolean;
  hasOriginal: boolean;
  share: React.ReactNode;
  openShare?: boolean;
  save?: (html: string, text: string) => Promise<{ error?: string } | Record<string, unknown>>;
  rename?: (name: string) => Promise<{ error?: string; name?: string } | Record<string, unknown>>;
  textMode?: "markdown" | "plain";
  downloads?: { label: string; href: string }[];
  panelLabel?: string;
  subtitle?: string;
  placeholder?: string;
  /** The title is the record's, not typed (a report is titled by its period). */
  fixedName?: boolean;
  /** What the AI bar and panel are changing, and who answers (5 Oct). */
  aiKind?: DocKind;
  agentName?: string;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const ask = useAsk(zh);
  const [mode, setMode] = React.useState<Mode>(canEdit ? "edit" : "view");
  const [zoom, setZoom] = React.useState(1);
  const [state, setState] = React.useState<"saved" | "dirty" | "saving" | "error">("saved");
  /* The side panel: the AI assistant by default for anyone who can edit, sharing or the record's details on request. */
  const [tab, setTab] = React.useState<"ai" | "info" | null>(openShare && !canEdit ? "info" : canEdit ? "ai" : openShare ? "info" : null);
  const [title, setTitle] = React.useState(name);
  const [, setTick] = React.useState(0);
  const dl = React.useRef<HTMLDetailsElement | null>(null);
  const seq = React.useRef(0);
  const timer = React.useRef<number | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: canEdit,
    content: html,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }, codeBlock: false, code: false }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: () => placeholder ?? (zh ? "从这里开始写…" : "Start writing…"), showOnlyCurrent: true }),
      BlockExtras,
    ],
    editorProps: {
      attributes: { class: "gd-prose notranslate", spellcheck: "false", translate: "no" },
      /* Enter splits where the caret is on screen: if the editor ever holds a stale
         position (a click it has not caught up with), take the browser's selection
         first (QA round 2: the new line once landed at the top of the document). */
      handleKeyDown: (view, event) => {
        if (event.key !== "Enter" || event.isComposing || !view.state.selection.empty) return false;
        const dom = window.getSelection();
        if (!dom || !dom.anchorNode || !view.dom.contains(dom.anchorNode)) return false;
        try {
          const pos = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
          if (pos !== view.state.selection.from && pos > 0 && pos <= view.state.doc.content.size) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
          }
        } catch {
          /* a position the document cannot hold: leave the editor as it is */
        }
        return false;
      },
    },
    onUpdate: ({ transaction }) => {
      if (!transaction.docChanged) return;
      seq.current += 1;
      setState("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), 1200);
    },
  });

  const ai = useDocAssistant(editor, { kind: aiKind, id, title, zh });
  const who = agentName ?? t("助理", "Assistant");

  /* (QA, 2 Oct: after 查看 → 编辑 every toolbar button stayed grey until a key
     was pressed. setEditable alone does not reach the toolbar's state hook, so
     an empty transaction tells it, and a tick re-renders this screen.) */
  const lastMode = React.useRef(mode);
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(canEdit && mode === "edit");
    /* Only when the mode really changed: an empty transaction sent on load left
       ProseMirror with a stale cursor, and the first Enter after a click jumped
       to the top of the document (QA round 2, 2 Oct). */
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    try {
      editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
    } catch {
      /* Not mounted yet: the first render reads the right state anyway. */
    }
    setTick((n) => n + 1);
  }, [editor, canEdit, mode]);

  /* The title is the file's name; editors rename it in place (QA, 2 Oct: a new
     document stayed 「未命名文档」 for good). */
  const [savedName, setSavedName] = React.useState(name);
  const cancelRename = React.useRef(false);
  const rename = async () => {
    if (cancelRename.current) {
      cancelRename.current = false;
      setTitle(savedName);
      return;
    }
    const next = title.trim();
    if (!next || next === savedName) {
      setTitle(savedName);
      return;
    }
    const r = (renameRecord ? await renameRecord(next) : await renameDocAction(id, next)) as { error?: string; name?: string };
    if ("error" in r && r.error) {
      notify(r.error);
      setTitle(savedName);
    } else if ("name" in r && r.name) {
      setTitle(r.name);
      setSavedName(r.name);
      notify(t("已重命名", "Renamed"), "ok");
    }
  };

  const saving = React.useRef(false);
  const save = React.useCallback(async () => {
    if (!editor || !canEdit || saving.current) return;
    saving.current = true;
    const at = seq.current;
    setState("saving");
    try {
      const html = editor.getHTML();
      const r = (saveRecord ? await saveRecord(html, docToText(editor.getJSON(), textMode ?? "markdown")) : await saveDocAction(id, html)) as { error?: string };
      if ("error" in r && r.error) {
        setState("error");
        notify(r.error);
        return;
      }
      setState(seq.current === at ? "saved" : "dirty");
    } catch {
      setState("error");
    } finally {
      saving.current = false;
      if (seq.current !== at) timer.current = window.setTimeout(() => void save(), 600);
    }
  }, [editor, canEdit, id, saveRecord, textMode]);

  /* Leaving with words not yet saved asks first. */
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === "dirty" || state === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  /* Ctrl/⌘+S saves now rather than opening the browser's save dialog. */
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [save]);

  const link = async () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = await ask.prompt({ title: t("链接地址（留空则去掉链接）", "Link address (empty removes the link)"), initial: prev ?? "https://" });
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const stateLabel = state === "saving" ? t("正在保存…", "Saving…") : state === "dirty" ? t("有改动，稍后自动保存", "Unsaved changes") : state === "error" ? t("没保存上，点这里重试", "Not saved, click to retry") : t("已保存", "Saved");

  return (
    <>
      {ask.dialog}
    <div className="gd-root doc-root" data-gd-root="" style={{ minHeight: "100%" }}>
      <style>{GD_CSS}</style>
      <style>{DOC_CSS}</style>
      <style>{DOC_AI_CSS}</style>
      <div className="gd-head" style={{ paddingBottom: 8 }}>
        <Link href={back.href} className="gd-icon" title={back.label} aria-label={back.label}>
          <GI name="left" size={20} />
        </Link>
        <GI name="doc" size={24} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          {canEdit && !fixedName ? (
            <input
              className="doc-title"
              value={title}
              maxLength={200}
              aria-label={t("文档名称", "Document name")}
              title={t("点这里改名", "Click to rename")}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  cancelRename.current = true;
                  setTitle(savedName);
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span style={{ fontSize: 17, color: "#1f1f1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
              {name}
            </span>
          )}
          <span style={{ fontSize: 12, color: "#5f6368" }}>
            {subtitle ?? back.label}
            {canEdit ? "" : t(" · 只读", " · read only")}
          </span>
        </div>
        {canEdit ? (
          <button type="button" className="gd-saved" data-state={state} onClick={() => state === "error" && void save()}>
            <GI name={"cloud"} size={18} />
            <span>{stateLabel}</span>
          </button>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <div className="gd-head-right">
          <details className="doc-dl" ref={dl}>
            <summary className="doc-btn">
              <GI name="download" size={16} />
              {t("下载", "Download")}
            </summary>
            {/* Picking a format closes the menu (QA, 2 Oct: it stayed open). */}
            <div className="doc-menu" onClick={() => dl.current?.removeAttribute("open")}>
              {downloads ? (
                downloads.map((d) => (
                  <a key={d.href} href={d.href} download>
                    {d.label}
                  </a>
                ))
              ) : (
                <>
                  <a href={`/api/docs/${id}/export?format=docx`} download>{t("Word 文档 (.docx)", "Word (.docx)")}</a>
                  <a href={`/api/docs/${id}/export?format=pdf`} download>PDF (.pdf)</a>
                  {hasOriginal ? <a href={`/api/files/${id}/download?download=1`}>{t("上传时的原文件", "The original upload")}</a> : null}
                </>
              )}
            </div>
          </details>
          {canEdit ? (
            <button type="button" className="doc-btn" data-on={tab === "ai" ? "" : undefined} onClick={() => setTab((v) => (v === "ai" ? null : "ai"))} aria-expanded={tab === "ai"}>
              <GI name="sparkle" size={16} />
              {t("AI 助手", "AI assistant")}
            </button>
          ) : null}
          <button type="button" className="gd-share" onClick={() => setTab((v) => (v === "info" ? null : "info"))} aria-expanded={tab === "info"}>
            <GI name={panelLabel ? "outline" : "lock"} size={18} />
            {panelLabel ?? t("分享", "Share")}
          </button>
        </div>
      </div>
      {fromOriginal && canEdit ? (
        <div className="doc-note">{t("这是从原文件转出来的可编辑版本，排版可能和原文件略有不同。改动会自动保存；原文件一直保留，可以在「下载」里拿到。", "An editable copy of the original upload; layout may differ slightly. The original is kept under Download.")}</div>
      ) : null}
      {/* 建议 (tracked changes), 批注 and 图片 belong to the script page; here
          they only made the page read-only or showed a "not yet" toast, so
          they are hidden (DOC_CSS) and 建议 falls back to 编辑 (QA, 2 Oct). */}
      <Toolbar
        editor={editor}
        zh={zh}
        mode={mode}
        setMode={(m) => setMode(m === "suggest" ? "edit" : m)}
        canEdit={canEdit}
        zoom={zoom}
        setZoom={setZoom}
        onFind={() => notify(t("按 Ctrl+F（Mac 上按 ⌘F）就能在文档里查找", "Press Ctrl+F (⌘F on a Mac) to find text"), "info")}
        onPrint={() => window.print()}
        onLink={link}
        onComment={() => undefined}
        onImage={() => undefined}
      />
      <div className="gd-body">
        <div className="gd-canvas">
          <div className="gd-sheet-row" style={{ zoom }}>
            <div className="gd-sheet">
              <EditorContent editor={editor} />
            </div>
          </div>
          {canEdit && mode === "edit" ? <DocAiBar ai={ai} zh={zh} /> : null}
        </div>
        {tab === "ai" && canEdit ? (
          <aside className="doc-panel">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600, flexGrow: 1 }}>{t("AI 助手", "AI assistant")}</span>
              <button type="button" className="gd-icon" onClick={() => setTab(null)} aria-label={t("关闭", "Close")}>
                <GI name="x" size={18} />
              </button>
            </div>
            <DocAiPanel ai={ai} zh={zh} kind={aiKind} agentName={who} />
          </aside>
        ) : null}
        {tab === "info" ? (
          <aside className="doc-panel">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, flexGrow: 1 }}>{panelLabel ?? t("分享和权限", "Sharing")}</span>
              <button type="button" className="gd-icon" onClick={() => setTab(null)} aria-label={t("关闭", "Close")}>
                <GI name="x" size={18} />
              </button>
            </div>
            {share}
          </aside>
        ) : null}
      </div>
    </div>
    </>
  );
}

const DOC_CSS = `
.doc-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid #c7c7c7; background: #fff; color: #1f1f1f; font: inherit; font-size: 14px; cursor: pointer; list-style: none; }
.doc-btn::-webkit-details-marker { display: none; }
.doc-btn[data-on] { background: #c2e7ff; border-color: #c2e7ff; }
.doc-dl { position: relative; }
.doc-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 220px; background: #fff; border-radius: 8px; padding: 6px 0; box-shadow: 0 2px 6px 2px rgba(60,64,67,.15), 0 1px 2px rgba(60,64,67,.3); display: flex; flex-direction: column; }
.doc-menu a { padding: 8px 16px; font-size: 14px; color: #1f1f1f; text-decoration: none; }
.doc-menu a:hover { background: #f1f3f4; }
.doc-title { font: inherit; font-size: 17px; color: #1f1f1f; border: 1px solid transparent; border-radius: 4px; padding: 1px 4px; margin-left: -5px; background: transparent; min-width: 120px; width: min(520px, 40vw); text-overflow: ellipsis; }
.doc-title:hover { border-color: #dadce0; }
.doc-title:focus { outline: none; border-color: #1a73e8; }
.doc-root .gd-toolbar .gd-tb[aria-label^="添加批注"], .doc-root .gd-toolbar .gd-tb[aria-label^="Add comment"],
.doc-root .gd-toolbar .gd-tb[aria-label="插入图片"], .doc-root .gd-toolbar .gd-tb[aria-label="Insert image"] { display: none; }
.doc-note { margin: 0 16px 8px; padding: 8px 12px; border-radius: 8px; background: #fef7e0; color: #5c4400; font-size: 12.5px; }
.doc-panel { width: 340px; flex-shrink: 0; align-self: stretch; border-left: 1px solid #e3e3e3; background: #fff; padding: 14px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; }
@media print { .gd-head, .gd-toolbar, .doc-note, .doc-panel, .dai-bar { display: none !important; } .gd-sheet { box-shadow: none !important; } }
`;
