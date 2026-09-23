"use client";

import { useEffect, useRef, useState } from "react";
import type { Format } from "@/components/canvas/composer-format";

/**
 * An editor where bold looks bold.
 *
 * The composers wrapped the selection in Markdown, so pressing **B** put
 * `**hi **` on the screen and the actual bold text appeared only behind a
 * Preview tab. That is a fair thing for a chat box, where the asterisks are
 * the message; it is the wrong thing for a brief, which is a document
 * somebody is writing and reading at the same time.
 *
 * So the text is edited as rich text and *stored* as Markdown — what the
 * editor, the agent and the renderer already read. Nothing downstream changes.
 *
 * Deliberately small. Bold, italic, inline code, links and bullets: the five
 * the toolbar has always drawn, and nothing else. A brief with three levels of
 * heading and a table is a brief nobody reads.
 *
 * `document.execCommand` is deprecated and is still the only thing every
 * browser implements for this. The alternative is a selection-and-range
 * editor of a few thousand lines, which is a library, and the one thing worse
 * than `execCommand` here would be shipping a library to make text bold.
 */
export function RichText({
  value,
  onChange,
  placeholder,
  minHeight = 210,
  ariaLabel,
  style,
  editorRef,
}: {
  /** Markdown in, Markdown out. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
  ariaLabel?: string;
  style?: React.CSSProperties;
  /** So a toolbar outside can focus it and run a command on it. */
  editorRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  /* A counter, bumped when the node arrives, so the effect below runs once the
     element exists. The node itself lives in a ref: React's lint rules treat a
     DOM node held in state as render-owned data, and writing `innerHTML` to it
     then reads as mutating state. */
  const [mounted, setMounted] = useState(0);
  // What we last handed out. Re-rendering the HTML while somebody is typing
  // would put the caret back at the start of the document on every keystroke,
  // so the DOM is only rewritten when the value changed somewhere else.
  const lastEmitted = useRef<string | null>(null);

  useEffect(() => {
    const node = own.current;
    if (!node || lastEmitted.current === value) return;
    node.innerHTML = toHtml(value);
    lastEmitted.current = value;
  }, [value, mounted]);

  const emit = () => {
    const node = own.current;
    if (!node) return;
    const markdown = toMarkdown(node);
    lastEmitted.current = markdown;
    onChange(markdown);
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={(node) => {
          own.current = node;
          // The toolbar outside needs the same node to run a command on.
          if (editorRef) editorRef.current = node;
          if (node) setMounted((n) => (n === 0 ? 1 : n));
        }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-rich-text=""
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          /* Plain text only. Pasting from a web page otherwise brings its
             fonts, colours and spacing into a document that has its own. */
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey;
          if (!mod) return;
          const key = e.key.toLowerCase();
          if (key === "b" || key === "i" || key === "u") {
            // The browser's own shortcuts, but routed through the same path as
            // the buttons so the value is emitted straight away.
            e.preventDefault();
            document.execCommand(key === "u" ? "underline" : key === "b" ? "bold" : "italic");
            emit();
          }
        }}
        style={{
          minHeight,
          outline: "none",
          fontSize: 13.5,
          lineHeight: 1.75,
          fontFamily: "inherit",
          color: "#171717",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          ...style,
        }}
      />
      {value.trim() === "" && placeholder ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            pointerEvents: "none",
            color: "#c7c7c7",
            fontSize: 13.5,
            lineHeight: 1.75,
          }}
        >
          {placeholder}
        </div>
      ) : null}
      <style>{`
        [data-rich-text] strong { font-weight: 650; }
        [data-rich-text] em { font-style: italic; }
        [data-rich-text] code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: #f6f6f6; border-radius: 4px; padding: 1px 4px; }
        [data-rich-text] a { color: #007be0; }
        [data-rich-text] ul { margin: 6px 0; padding-left: 20px; }
        [data-rich-text] li { margin: 2px 0; }
      `}</style>
    </div>
  );
}

/**
 * Run one of the toolbar's formats on a rich editor.
 *
 * The same five names the Markdown version takes, so a composer can switch
 * from one to the other without its toolbar changing.
 */
export function formatRich(
  el: HTMLDivElement | null,
  format: Format,
  onChange: (markdown: string) => void,
  askForUrl: () => string | null,
) {
  if (!el) return;
  el.focus();

  if (format === "bold") document.execCommand("bold");
  else if (format === "italic") document.execCommand("italic");
  else if (format === "list") document.execCommand("insertUnorderedList");
  else if (format === "code") {
    // There is no `code` command. The selection is wrapped by hand, which is
    // also why this is the one format that does nothing without a selection.
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const code = document.createElement("code");
    code.appendChild(range.extractContents());
    range.insertNode(code);
    sel.removeAllRanges();
  } else if (format === "link") {
    const url = askForUrl();
    if (!url) return;
    document.execCommand("createLink", false, url);
  }

  onChange(toMarkdown(el));
}

/* ------------------------------------------------------------ conversion */

/**
 * Markdown to the small HTML this editor understands.
 *
 * Only the five formats, and only ever text nodes it has escaped itself, so
 * nothing a person pastes or types can reach `innerHTML` as markup.
 */
function toHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: string[] | null = null;

  const flush = () => {
    if (list) {
      out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      list = null;
    }
  };

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list = list ?? [];
      list.push(bullet[1]);
      continue;
    }
    flush();
    out.push(line.trim() === "" ? "<div><br></div>" : `<div>${inline(line)}</div>`);
  }
  flush();
  return out.join("");
}

function inline(text: string): string {
  let s = escapeHtml(text);
  // Code first: what is inside a backtick span is not formatting.
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return s;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The editor's DOM back to Markdown. */
function toMarkdown(root: HTMLElement): string {
  const out = walk(root).replace(/\n{3,}/g, "\n\n");
  return out.replace(/\s+$/, "");
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // The asterisks a person actually typed stay theirs: escaped, so a round
    // trip through the editor does not turn `2 * 3 * 4` into italics.
    return (node.textContent ?? "").replace(/([*`_])/g, "\\$1");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const inner = Array.from(el.childNodes).map(walk).join("");
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "br":
      return "\n";
    case "strong":
    case "b":
      return inner.trim() ? `**${inner}**` : inner;
    case "em":
    case "i":
      return inner.trim() ? `*${inner}*` : inner;
    // Underline has no Markdown; the browser's Cmd-U produces it, and bold is
    // the nearest honest thing to store.
    case "u":
      return inner.trim() ? `**${inner}**` : inner;
    case "code":
      return inner.trim() ? `\`${inner.replace(/\\`/g, "`")}\`` : inner;
    case "a": {
      const href = el.getAttribute("href");
      return href ? `[${inner}](${href})` : inner;
    }
    case "li":
      return `- ${inner.trim()}\n`;
    case "ul":
    case "ol":
      return `${inner}`;
    case "div":
    case "p":
      return `${inner}\n`;
    default:
      return inner;
  }
}
