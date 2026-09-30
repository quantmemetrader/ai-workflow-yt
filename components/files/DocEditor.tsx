"use client";

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
import { saveDocAction } from "@/app/(app)/docs/actions";

/**
 * A document edited in the browser, on the same paper and toolbar as the
 * script page: contracts, invoices, notes in 法务 / 财务 / 账务 / 人事
 * (Ryan, 1 Oct). Saved as you type; downloads as Word or PDF; the side panel
 * holds who can see it and who it is shared with.
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
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [mode, setMode] = React.useState<Mode>(canEdit ? "edit" : "view");
  const [zoom, setZoom] = React.useState(1);
  const [state, setState] = React.useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [panel, setPanel] = React.useState(openShare);
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
      Placeholder.configure({ placeholder: () => (zh ? "从这里开始写…" : "Start writing…"), showOnlyCurrent: true }),
      BlockExtras,
    ],
    editorProps: { attributes: { class: "gd-prose notranslate", spellcheck: "false", translate: "no" } },
    onUpdate: ({ transaction }) => {
      if (!transaction.docChanged) return;
      seq.current += 1;
      setState("dirty");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), 1200);
    },
  });

  React.useEffect(() => {
    editor?.setEditable(canEdit && mode === "edit");
  }, [editor, canEdit, mode]);

  const saving = React.useRef(false);
  const save = React.useCallback(async () => {
    if (!editor || !canEdit || saving.current) return;
    saving.current = true;
    const at = seq.current;
    setState("saving");
    try {
      const r = await saveDocAction(id, editor.getHTML());
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
  }, [editor, canEdit, id]);

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

  const link = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt(t("链接地址", "Link address"), prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const stateLabel = state === "saving" ? t("正在保存…", "Saving…") : state === "dirty" ? t("有改动，稍后自动保存", "Unsaved changes") : state === "error" ? t("没保存上，点这里重试", "Not saved — retry") : t("已保存", "Saved");

  return (
    <div className="gd-root" data-gd-root="" style={{ minHeight: "100%" }}>
      <style>{GD_CSS}</style>
      <style>{DOC_CSS}</style>
      <div className="gd-head" style={{ paddingBottom: 8 }}>
        <Link href={back.href} className="gd-icon" title={back.label} aria-label={back.label}>
          <GI name="left" size={20} />
        </Link>
        <GI name="doc" size={24} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 17, color: "#1f1f1f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>
            {name}
          </span>
          <span style={{ fontSize: 12, color: "#5f6368" }}>
            {back.label}
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
          <details className="doc-dl">
            <summary className="doc-btn">
              <GI name="download" size={16} />
              {t("下载", "Download")}
            </summary>
            <div className="doc-menu">
              <a href={`/api/docs/${id}/export?format=docx`} download>{t("Word 文档 (.docx)", "Word (.docx)")}</a>
              <a href={`/api/docs/${id}/export?format=pdf`} download>PDF (.pdf)</a>
              {hasOriginal ? <a href={`/api/files/${id}/download?download=1`}>{t("上传时的原文件", "The original upload")}</a> : null}
            </div>
          </details>
          <button type="button" className="gd-share" onClick={() => setPanel((v) => !v)} aria-expanded={panel}>
            <GI name="lock" size={18} />
            {t("分享", "Share")}
          </button>
        </div>
      </div>
      {fromOriginal && canEdit ? (
        <div className="doc-note">{t("这是从原文件转出来的可编辑版本，排版可能和原文件略有不同。改动会自动保存；原文件一直保留，可以在「下载」里拿到。", "An editable copy of the original upload; layout may differ slightly. The original is kept under Download.")}</div>
      ) : null}
      <Toolbar editor={editor} zh={zh} mode={mode} setMode={setMode} canEdit={canEdit} zoom={zoom} setZoom={setZoom} onFind={() => notify(t("用 Ctrl+F（Mac 用 ⌘F）在页面里查找", "Use Ctrl+F / ⌘F to find"), "info")} onPrint={() => window.print()} onLink={link} onComment={() => notify(t("批注目前只在脚本页有", "Comments are on the script page for now"), "info")} onImage={() => notify(t("这里暂时不能插图片", "Images are not supported here yet"), "info")} />
      <div className="gd-body">
        <div className="gd-canvas">
          <div className="gd-sheet-row" style={{ zoom }}>
            <div className="gd-sheet">
              <EditorContent editor={editor} />
            </div>
          </div>
        </div>
        {panel ? (
          <aside className="doc-panel">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, flexGrow: 1 }}>{t("分享和权限", "Sharing")}</span>
              <button type="button" className="gd-icon" onClick={() => setPanel(false)} aria-label={t("关闭", "Close")}>
                <GI name="x" size={18} />
              </button>
            </div>
            {share}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

const DOC_CSS = `
.doc-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid #c7c7c7; background: #fff; color: #1f1f1f; font: inherit; font-size: 14px; cursor: pointer; list-style: none; }
.doc-btn::-webkit-details-marker { display: none; }
.doc-dl { position: relative; }
.doc-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; min-width: 220px; background: #fff; border-radius: 8px; padding: 6px 0; box-shadow: 0 2px 6px 2px rgba(60,64,67,.15), 0 1px 2px rgba(60,64,67,.3); display: flex; flex-direction: column; }
.doc-menu a { padding: 8px 16px; font-size: 14px; color: #1f1f1f; text-decoration: none; }
.doc-menu a:hover { background: #f1f3f4; }
.doc-note { margin: 0 16px 8px; padding: 8px 12px; border-radius: 8px; background: #fef7e0; color: #5c4400; font-size: 12.5px; }
.doc-panel { width: 340px; flex-shrink: 0; align-self: stretch; border-left: 1px solid #e3e3e3; background: #fff; padding: 14px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; }
@media print { .gd-head, .gd-toolbar, .doc-note, .doc-panel { display: none !important; } .gd-sheet { box-shadow: none !important; } }
`;
