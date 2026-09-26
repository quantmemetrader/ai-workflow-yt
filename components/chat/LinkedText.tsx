import * as React from "react";
import Link from "next/link";

/**
 * Plain text with its in-app Markdown links drawn as links.
 *
 * The project page's chat draws a person's message as typed (pre-wrapped
 * text, no Markdown), and the note a conversation leaves when it becomes a
 * project (`lib/chat/conversation-project.ts`) links back to that
 * conversation: "[标题](/chat/t/cnv_…)" printed as brackets read as a bug.
 * Only links inside the app (a path starting with one "/") become links;
 * anything else stays the text it was. A backslash is refused anywhere in
 * the path, as `localHref` in `lib/chat/handoff.ts` does: browsers read
 * `/\host` as `//host`, another site, and any person can type this text.
 */
const LINK = /\[([^\]\n]{1,120})\]\((\/(?![/\\])[^\s)\\]{1,300})\)/g;

export function LinkedText({ text, color }: { text: string; color?: string }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    if (start > at) out.push(text.slice(at, start));
    out.push(
      <Link key={start} href={m[2]} prefetch={false} style={{ color: color ?? "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
        {m[1]}
      </Link>,
    );
    at = start + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
