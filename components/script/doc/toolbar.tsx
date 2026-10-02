"use client";

import * as React from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { Drop, TB } from "./chrome";
import { GI } from "./icons";

export type Mode = "edit" | "suggest" | "view";

export const FONTS: { label: string; labelEn: string; value: string | null }[] = [
  { label: "默认", labelEn: "Default", value: null },
  { label: "黑体", labelEn: "Hei", value: '"PingFang SC","Microsoft YaHei","Heiti SC",sans-serif' },
  { label: "宋体", labelEn: "Song", value: '"Songti SC","SimSun","STSong",serif' },
  { label: "楷体", labelEn: "Kai", value: '"Kaiti SC","KaiTi","STKaiti",serif' },
  { label: "Arial", labelEn: "Arial", value: "Arial,sans-serif" },
  { label: "Georgia", labelEn: "Georgia", value: "Georgia,serif" },
  { label: "Times New Roman", labelEn: "Times New Roman", value: '"Times New Roman",serif' },
  { label: "Courier New", labelEn: "Courier New", value: '"Courier New",monospace' },
];

export const COLORS = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#efefef", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
];

export const SPACINGS = ["1", "1.15", "1.5", "2"];

/** What the toolbar shows as pressed, read from the editor on every change. */
function useFormat(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const ts = e.getAttributes("textStyle") as { fontSize?: string; fontFamily?: string; color?: string };
      const block = e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "p";
      const para = e.getAttributes(block === "p" ? "paragraph" : "heading") as { textAlign?: string; lineHeight?: string };
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        link: e.isActive("link"),
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        task: e.isActive("taskList"),
        block,
        align: para.textAlign ?? "left",
        lineHeight: para.lineHeight ?? null,
        size: ts.fontSize ? parseFloat(ts.fontSize) : null,
        font: ts.fontFamily ?? null,
        color: ts.color ?? null,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });
}

export const BLOCKS: { key: "p" | "h1" | "h2" | "h3"; zh: string; en: string; size: number; weight: number }[] = [
  { key: "p", zh: "正文", en: "Normal text", size: 14, weight: 400 },
  { key: "h1", zh: "标题 1", en: "Heading 1", size: 22, weight: 500 },
  { key: "h2", zh: "标题 2", en: "Heading 2", size: 18, weight: 500 },
  { key: "h3", zh: "标题 3", en: "Heading 3", size: 15, weight: 600 },
];

export function setBlock(editor: Editor, key: "p" | "h1" | "h2" | "h3") {
  const c = editor.chain().focus();
  if (key === "p") c.setParagraph().run();
  else c.setHeading({ level: Number(key.slice(1)) as 1 | 2 | 3 }).run();
}

export function setLineHeight(editor: Editor, value: string | null) {
  editor.chain().focus().updateAttributes("paragraph", { lineHeight: value }).updateAttributes("heading", { lineHeight: value }).run();
}

export function changeIndent(editor: Editor, delta: 1 | -1) {
  const inList = editor.isActive("listItem") || editor.isActive("taskItem");
  if (inList) {
    const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
    if (delta > 0) editor.chain().focus().sinkListItem(item).run();
    else editor.chain().focus().liftListItem(item).run();
    return;
  }
  const { from, to } = editor.state.selection;
  const tr = editor.state.tr;
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      const next = Math.max(0, Math.min(8, Number(node.attrs.indent || 0) + delta));
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      return false;
    }
    return true;
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function Toolbar({
  editor,
  zh,
  mode,
  setMode,
  canEdit,
  zoom,
  setZoom,
  onFind,
  onPrint,
  onLink,
  onComment,
  onImage,
}: {
  editor: Editor | null;
  zh: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  canEdit: boolean;
  zoom: number;
  setZoom: (z: number) => void;
  onFind: () => void;
  onPrint: () => void;
  onLink: () => void;
  onComment: () => void;
  onImage: () => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const f = useFormat(editor);
  const off = !editor || !f || mode !== "edit" || !editor.isEditable;
  const size = f?.size ?? 11;
  const setSize = (n: number) => editor?.chain().focus().setFontSize(`${Math.max(6, Math.min(96, Math.round(n)))}pt`).run();
  /* What is typed in the size box until Enter or leaving it applies it (QA, 2 Oct: the box could not be typed in). */
  const [sizeText, setSizeText] = React.useState<string | null>(null);
  const applySize = (raw: string) => {
    setSizeText(null);
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0 && Math.max(6, Math.min(96, Math.round(n))) !== size) setSize(n);
  };
  const blockLabel = BLOCKS.find((b) => b.key === (f?.block ?? "p"));
  const fontLabel = FONTS.find((x) => x.value === (f?.font ?? null)) ?? FONTS[0];
  const alignIcon = f?.align === "center" ? "alignCenter" : f?.align === "right" ? "alignRight" : f?.align === "justify" ? "alignJustify" : "alignLeft";
  const modeLabel = mode === "edit" ? t("编辑", "Editing") : mode === "suggest" ? t("建议", "Suggesting") : t("查看", "Viewing");

  return (
    <div className="gd-toolbar" role="toolbar" aria-label={t("格式", "Formatting")}>
      <TB icon="search" label={t("查找和替换 (Ctrl+H)", "Find and replace (Ctrl+H)")} onClick={onFind} />
      <TB icon="undo" label={t("撤销 (Ctrl+Z)", "Undo (Ctrl+Z)")} disabled={off || !f?.canUndo} onClick={() => editor?.chain().focus().undo().run()} />
      <TB icon="redo" label={t("重做 (Ctrl+Y)", "Redo (Ctrl+Y)")} disabled={off || !f?.canRedo} onClick={() => editor?.chain().focus().redo().run()} />
      <span className="gd-tb-wide"><TB icon="print" label={t("打印 (Ctrl+P)", "Print (Ctrl+P)")} onClick={onPrint} /></span>
      <Drop label={t("缩放", "Zoom")} button={<span className="gd-tb-text" style={{ minWidth: 34 }}>{Math.round(zoom * 100)}%</span>} width={110}>
        {(close) =>
          [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => (
            <button key={z} type="button" className="gd-menu-item" onClick={() => { setZoom(z); close(); }}>
              <span className="gd-menu-check">{z === zoom ? <GI name="check" size={16} /> : null}</span>
              <span className="gd-menu-label">{Math.round(z * 100)}%</span>
            </button>
          ))
        }
      </Drop>
      <span className="gd-sep" />
      <Drop label={t("样式", "Styles")} disabled={off} button={<span className="gd-tb-text" style={{ minWidth: 58, textAlign: "left" }}>{zh ? blockLabel?.zh : blockLabel?.en}</span>} width={230}>
        {(close) =>
          BLOCKS.map((b) => (
            <button key={b.key} type="button" className="gd-menu-item" onClick={() => { if (editor) setBlock(editor, b.key); close(); }}>
              <span className="gd-menu-check">{f?.block === b.key ? <GI name="check" size={16} /> : null}</span>
              <span className="gd-menu-label" style={{ fontSize: b.size, fontWeight: b.weight }}>{zh ? b.zh : b.en}</span>
            </button>
          ))
        }
      </Drop>
      <span className="gd-sep" />
      <Drop label={t("字体", "Font")} disabled={off} button={<span className="gd-tb-text" style={{ minWidth: 50, maxWidth: 84, overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>{zh ? fontLabel.label : fontLabel.labelEn}</span>} width={200}>
        {(close) =>
          FONTS.map((x) => (
            <button key={x.label} type="button" className="gd-menu-item" onClick={() => { if (x.value) editor?.chain().focus().setFontFamily(x.value).run(); else editor?.chain().focus().unsetFontFamily().run(); close(); }}>
              <span className="gd-menu-check">{(f?.font ?? null) === x.value ? <GI name="check" size={16} /> : null}</span>
              <span className="gd-menu-label" style={{ fontFamily: x.value ?? undefined }}>{zh ? x.label : x.labelEn}</span>
            </button>
          ))
        }
      </Drop>
      <span className="gd-sep" />
      <TB icon="minus" label={t("减小字号", "Decrease font size")} disabled={off} onClick={() => setSize(size - 1)} />
      <input
        className="gd-size"
        aria-label={t("字号", "Font size")}
        inputMode="numeric"
        value={sizeText ?? String(size)}
        disabled={off}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setSizeText(e.target.value.replace(/[^\d.]/g, "").slice(0, 4))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            applySize((e.target as HTMLInputElement).value);
          } else if (e.key === "Escape") {
            setSizeText(null);
            editor?.commands.focus();
          }
        }}
        onBlur={(e) => {
          if (sizeText !== null) applySize(e.target.value);
        }}
      />
      <TB icon="plus" label={t("增大字号", "Increase font size")} disabled={off} onClick={() => setSize(size + 1)} />
      <span className="gd-sep" />
      <TB label={t("粗体 (Ctrl+B)", "Bold (Ctrl+B)")} on={f?.bold} disabled={off} onClick={() => editor?.chain().focus().toggleBold().run()}>
        <b className="gd-glyph">B</b>
      </TB>
      <TB label={t("斜体 (Ctrl+I)", "Italic (Ctrl+I)")} on={f?.italic} disabled={off} onClick={() => editor?.chain().focus().toggleItalic().run()}>
        <i className="gd-glyph" style={{ fontFamily: "Georgia,serif" }}>I</i>
      </TB>
      <TB label={t("下划线 (Ctrl+U)", "Underline (Ctrl+U)")} on={f?.underline} disabled={off} onClick={() => editor?.chain().focus().toggleUnderline().run()}>
        <u className="gd-glyph">U</u>
      </TB>
      <Drop
        label={t("文字颜色", "Text colour")}
        disabled={off}
        width={236}
        button={
          <span style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
            <GI name="color" size={17} />
            <span style={{ width: 18, height: 3.5, marginTop: -2, borderRadius: 1, background: f?.color ?? "#000" }} />
          </span>
        }
      >
        {(close) => <Palette zh={zh} onPick={(c) => { if (c) editor?.chain().focus().setColor(c).run(); else editor?.chain().focus().unsetColor().run(); close(); }} />}
      </Drop>
      <Drop label={t("突出显示颜色", "Highlight colour")} disabled={off} width={236} button={<GI name="marker" size={17} />}>
        {(close) => <Palette zh={zh} onPick={(c) => { if (c) editor?.chain().focus().toggleHighlight({ color: c }).run(); else editor?.chain().focus().unsetHighlight().run(); close(); }} />}
      </Drop>
      <span className="gd-sep" />
      <TB icon="link" label={t("插入链接 (Ctrl+K)", "Insert link (Ctrl+K)")} on={f?.link} disabled={off} onClick={onLink} />
      <TB icon="comment" label={t("添加批注 (Ctrl+Alt+M)", "Add comment (Ctrl+Alt+M)")} disabled={!editor} onClick={onComment} />
      <TB icon="image" label={t("插入图片", "Insert image")} disabled={off} onClick={onImage} />
      <span className="gd-sep" />
      <Drop label={t("对齐", "Align")} disabled={off} width={60} button={<GI name={alignIcon} size={18} />}>
        {(close) => (
          <div style={{ display: "flex", gap: 2, padding: 2 }}>
            {(["left", "center", "right", "justify"] as const).map((a) => (
              <TB key={a} icon={a === "left" ? "alignLeft" : a === "center" ? "alignCenter" : a === "right" ? "alignRight" : "alignJustify"} label={a === "left" ? t("左对齐", "Left") : a === "center" ? t("居中", "Centre") : a === "right" ? t("右对齐", "Right") : t("两端对齐", "Justified")} on={f?.align === a} onClick={() => { editor?.chain().focus().setTextAlign(a).run(); close(); }} />
            ))}
          </div>
        )}
      </Drop>
      <Drop label={t("行距和段落间距", "Line & paragraph spacing")} disabled={off} width={180} button={<GI name="spacing" size={18} />}>
        {(close) =>
          SPACINGS.map((s) => (
            <button key={s} type="button" className="gd-menu-item" onClick={() => { if (editor) setLineHeight(editor, s === "1.15" && !f?.lineHeight ? null : s); close(); }}>
              <span className="gd-menu-check">{(f?.lineHeight ?? "1.15") === s ? <GI name="check" size={16} /> : null}</span>
              <span className="gd-menu-label">{s === "1" ? t("单倍", "Single") : s === "2" ? t("双倍", "Double") : s}</span>
            </button>
          ))
        }
      </Drop>
      <TB icon="checklist" label={t("清单 (Ctrl+Shift+9)", "Checklist (Ctrl+Shift+9)")} on={f?.task} disabled={off} onClick={() => editor?.chain().focus().toggleTaskList().run()} />
      <TB icon="bullets" label={t("项目符号列表 (Ctrl+Shift+8)", "Bulleted list (Ctrl+Shift+8)")} on={f?.bullet} disabled={off} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
      <TB icon="numbers" label={t("编号列表 (Ctrl+Shift+7)", "Numbered list (Ctrl+Shift+7)")} on={f?.ordered} disabled={off} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
      <TB icon="outdent" label={t("减少缩进", "Decrease indent")} disabled={off} onClick={() => editor && changeIndent(editor, -1)} />
      <TB icon="indent" label={t("增加缩进", "Increase indent")} disabled={off} onClick={() => editor && changeIndent(editor, 1)} />
      <TB icon="clear" label={t("清除格式 (Ctrl+\\)", "Clear formatting (Ctrl+\\)")} disabled={off} onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} />
      <span style={{ flexGrow: 1 }} />
      <Drop
        label={t("模式", "Mode")}
        align="right"
        width={260}
        button={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <GI name={mode === "edit" ? "pencil" : mode === "suggest" ? "suggest" : "eye"} size={17} />
            <span className="gd-tb-text gd-tb-wide">{modeLabel}</span>
          </span>
        }
      >
        {(close) =>
          /* No 建议 here: it only focused the AI box while the label stayed
             编辑 (QA, 2 Oct). 文案's edits already arrive as tracked changes. */
          (
            [
              ["edit", "pencil", t("编辑", "Editing"), t("直接修改文档", "Edit the document directly")],
              ["view", "eye", t("查看", "Viewing"), t("阅读或打印最终文档", "Read or print the final document")],
            ] as [Mode, string, string, string][]
          ).map(([m, icon, label, sub]) => (
            <button key={m} type="button" className="gd-menu-item" disabled={m !== "view" && !canEdit} onClick={() => { setMode(m); close(); }} style={{ alignItems: "flex-start", paddingTop: 8, paddingBottom: 8 }}>
              <span className="gd-menu-check"><GI name={icon} size={17} /></span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1 }}>
                <span className="gd-menu-label" style={{ fontWeight: 500 }}>{label}</span>
                <span style={{ fontSize: 12, color: "#5f6368", whiteSpace: "normal" }}>{sub}</span>
              </span>
              {mode === m ? <GI name="check" size={16} /> : null}
            </button>
          ))
        }
      </Drop>
    </div>
  );
}

function Palette({ zh, onPick }: { zh: boolean; onPick: (c: string | null) => void }) {
  return (
    <div style={{ padding: 8 }}>
      <button type="button" className="gd-menu-item" onClick={() => onPick(null)} style={{ padding: "4px 6px", marginBottom: 6 }}>
        <span className="gd-menu-label">{zh ? "无（恢复默认）" : "None (reset)"}</span>
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 18px)", gap: 4 }}>
        {COLORS.map((c) => (
          <button key={c} type="button" title={c} aria-label={c} onClick={() => onPick(c)} style={{ width: 18, height: 18, borderRadius: 999, border: c === "#ffffff" ? "1px solid #dadce0" : "0", background: c, cursor: "pointer", padding: 0 }} />
        ))}
      </div>
    </div>
  );
}
