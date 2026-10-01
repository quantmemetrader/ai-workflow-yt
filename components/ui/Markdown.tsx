import { readerMarkdown } from "@/lib/text/reader";
import React from "react";

/**
 * A small Markdown renderer for model output.
 *
 * It builds React elements rather than HTML strings — model output is
 * untrusted text, and nothing here can become markup. It covers what the
 * assistant actually produces (headings, lists, bold, inline code, fenced
 * code, links) and renders anything else as plain text, which is the right
 * failure mode for a work tool.
 */
export function Markdown({ text }: { text: string }) {
  /* Which language a bare link's words are in: the text's own (QA, 2 Oct). */
  const zh = /[\u4e00-\u9fff]/.test(text);
  return <div className="flex flex-col gap-2 text-sm leading-[1.55] text-ink-gray-8">{blocks(readerMarkdown(text), zh)}</div>;
}

/**
 * A bare app path an employee writes (「在脚本页看、改：/script/scr_…」) as a
 * link with words, not a raw address (QA, 2 Oct).
 */
const APP_PATH = /^\/(?:script|projects|files|chat|video|videos|topics|trends|publish|article|legal|finance|accounting|research)\/[A-Za-z0-9_\-/?=&#.%]+$/;
function pathLabel(path: string, zh: boolean): string {
  if (/^\/script\/|\/script(?:[/?#]|$)/.test(path)) return zh ? "打开脚本" : "Open the script";
  if (path.startsWith("/projects/")) return zh ? "打开项目" : "Open the project";
  if (path.startsWith("/files/")) return zh ? "打开文件" : "Open the file";
  if (path.startsWith("/chat/c/")) return zh ? "打开频道" : "Open the channel";
  if (path.startsWith("/chat/")) return zh ? "打开对话" : "Open the chat";
  if (path.startsWith("/video")) return zh ? "打开剪辑台" : "Open the editor";
  if (path.startsWith("/topics/") || path.startsWith("/trends/") || path.startsWith("/research/")) return zh ? "打开选题" : "Open the topic";
  return zh ? "打开" : "Open";
}

const LIST_RE = /^(\s*)(?:[-*+]|(\d+)\.)\s+(.*)$/;

type ListRow = { indent: number; ordered: boolean; num: number; text: string };

/** One list from its rows: the least-indented rows are its items, anything deeper belongs to the item above it. */
function listTree(rows: ListRow[], nextKey: () => number, zh: boolean): React.ReactNode {
  const base = Math.min(...rows.map((r) => r.indent));
  const tops: { row: ListRow; kids: ListRow[] }[] = [];
  for (const r of rows) {
    if (r.indent > base && tops.length) tops[tops.length - 1].kids.push(r);
    else tops.push({ row: r, kids: [] });
  }
  const ordered = tops[0].row.ordered;
  const items = tops.map((t, n) => (
    <li key={n} className="pl-0.5">
      {inline(t.row.text, zh)}
      {t.kids.length ? <div className="mt-1">{listTree(t.kids, nextKey, zh)}</div> : null}
    </li>
  ));
  const k = nextKey();
  if (!ordered) return <ul key={k} className="ml-4 flex list-outside list-disc flex-col gap-1">{items}</ul>;
  return (
    <ol key={k} start={tops[0].row.num > 1 ? tops[0].row.num : undefined} className="ml-4 flex list-outside list-decimal flex-col gap-1">
      {items}
    </ol>
  );
}

function blocks(src: string, zh: boolean): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg border border-outline-gray-1 bg-surface-gray-1 p-3 text-xs text-ink-gray-8"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <p
          key={key++}
          className={
            level <= 2
              ? "mt-1 text-[15px] font-semibold text-ink-gray-9"
              : "mt-1 text-sm font-semibold text-ink-gray-9"
          }
        >
          {inline(heading[2], zh)}
        </p>,
      );
      i++;
      continue;
    }

    // Lists: nested by indent ("1. topic" then "   - why"), and one list
    // across the blank lines between its items. It was flat and restarted at
    // every blank line, so a researcher's three topics each read "1." and
    // their sub-points came out numbered 2 and 3.
    if (LIST_RE.test(line)) {
      const rows: ListRow[] = [];
      while (i < lines.length) {
        const m = LIST_RE.exec(lines[i]);
        if (m) {
          rows.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: m[2] !== undefined, num: Number(m[2] ?? 1), text: m[3] ?? "" });
          i++;
          continue;
        }
        if (!lines[i].trim()) {
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          if (j < lines.length && LIST_RE.test(lines[j])) {
            i = j;
            continue;
          }
          break;
        }
        // An indented line under an item carries on its text.
        if (/^\s{2,}\S/.test(lines[i]) && rows.length) {
          rows[rows.length - 1].text += ` ${lines[i].trim()}`;
          i++;
          continue;
        }
        break;
      }
      out.push(listTree(rows, () => key++, zh));
      continue;
    }

    // Tables — render as-is in a scroll box rather than half-parsing them.
    if (line.includes("|") && lines[i + 1]?.includes("---")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].includes("|")) rows.push(lines[i++]);
      out.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {rows
                .filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r))
                .map((row, rIdx) => (
                  <tr key={rIdx} className="border-b border-outline-gray-1">
                    {row
                      .replace(/^\||\|$/g, "")
                      .split("|")
                      .map((cell, cIdx) => (
                        <td key={cIdx} className={`px-2 py-1.5 align-top ${rIdx === 0 ? "font-medium text-ink-gray-9" : "text-ink-gray-7"}`}>
                          {inline(cell.trim(), zh)}
                        </td>
                      ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Paragraph: consume until a blank line.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    out.push(<p key={key++}>{inline(para.join(" "), zh)}</p>);
  }

  return out;
}

/** Bold, italic, inline code, links and @mentions, in one pass.
 *
 * A mention only counts at the start or after a space, so an email address
 * stays an email address. It gets the chat's `.ment` pill, which is what an
 * agent's hand-off ("@视频助理 …") needs to read as addressed to someone
 * while its links stay clickable. */
function inline(src: string, zh = true): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|(?<=^|[\s\u3000-\u303f\uff00-\uffef])_[^_\n]+_(?=$|[\s\u3000-\u303f\uff00-\uffef])|\[[^\]]+\]\([^)]+\)|(?<=^|\s)@[A-Za-z0-9_\u4e00-\u9fff-]+|(?<=^|[\s:(\u3000-\u303f\uff00-\uffef])\/(?:script|projects|files|chat|video|videos|topics|trends|publish|article|legal|finance|accounting|research)\/[A-Za-z0-9_\-/?=&#.%]*[A-Za-z0-9_\-/=&#%])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(src))) {
    if (match.index > last) nodes.push(src.slice(last, match.index));
    const token = match[0];

    if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink-gray-9">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("_") && token.endsWith("_")) {
      nodes.push(
        <em key={key++} className="text-ink-gray-6" style={{ fontStyle: "normal" }}>
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-surface-gray-2 px-1 py-0.5 text-[12px] text-ink-gray-8">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("/") && APP_PATH.test(token)) {
      nodes.push(
        <a key={key++} href={token} className="text-ink-blue-3 underline underline-offset-2">
          {pathLabel(token, zh)}
        </a>,
      );
    } else if (token.startsWith("@")) {
      nodes.push(
        <span key={key++} className="ment">
          {token}
        </span>,
      );
    } else if (token.startsWith("[")) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)!;
      const href = link[2];
      const safe = /^(https?:|\/)/i.test(href) ? href : "#";
      nodes.push(
        <a
          key={key++}
          href={safe}
          target={safe.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          className="text-ink-blue-3 underline underline-offset-2"
        >
          {link[1]}
        </a>,
      );
    } else {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }

  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}
