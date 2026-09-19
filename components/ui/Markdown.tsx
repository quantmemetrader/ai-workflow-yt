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
  return <div className="flex flex-col gap-2 text-sm leading-[1.55] text-ink-gray-8">{blocks(text)}</div>;
}

function blocks(src: string): React.ReactNode[] {
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
          {inline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }

    // Lists
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      out.push(
        <ListTag key={key++} className={`ml-4 flex list-outside flex-col gap-1 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, n) => (
            <li key={n} className="pl-0.5">
              {inline(item)}
            </li>
          ))}
        </ListTag>,
      );
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
                          {inline(cell.trim())}
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
    out.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }

  return out;
}

/** Bold, italic, inline code and links, in one pass. */
function inline(src: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
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
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rounded bg-surface-gray-2 px-1 py-0.5 text-[12px] text-ink-gray-8">
          {token.slice(1, -1)}
        </code>,
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
