"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { AGENT_COLORS } from "@/lib/agents/catalog";

/**
 * One topic on Home (a researcher's idea, a suggestion from the brief) as a
 * single calm row that opens in place.
 *
 * "The idea researcher is ... completely using the whole page to be filled
 * with text." So the row says only what it takes to pick: how strong, the
 * title, one grey line of why, a small tag, and the one press that starts
 * it. Everything else (other titles, the angle, the opening, the evidence,
 * the rest of the presses) is behind a click on the row, one row open at a
 * time, the way the project chats beside it open.
 *
 * The head is a `div` that toggles on a click anywhere in it; the button
 * inside is what a keyboard reaches (its click bubbles to the same toggle),
 * and the presses on the right stop their click so starting a topic never
 * also opens it.
 */
export function TopicRow({
  first,
  open,
  onToggle,
  strength,
  strengthTitle,
  title,
  line,
  meta,
  action,
  children,
  notice,
}: {
  first: boolean;
  open: boolean;
  /** Unset when there is nothing more to show: no chevron, no toggle. */
  onToggle?: () => void;
  strength: number | null;
  strengthTitle: string;
  title: string;
  /** The one grey line under the title (hidden while open, where the details say it in full). */
  line?: React.ReactNode;
  /** Small tags before the press: the format, "已存". */
  meta?: React.ReactNode;
  /** The press on the right. */
  action?: React.ReactNode;
  /** The details, drawn only while open. */
  children?: React.ReactNode;
  /** Under the row whether open or not: the stay-or-open notice after a start. */
  notice?: React.ReactNode;
}) {
  const detailId = React.useId();
  const canOpen = Boolean(onToggle);
  return (
    <div className={open ? "tpr tpr-open" : "tpr"} style={{ borderTop: first ? "none" : "1px solid #f0f0f0" }}>
      <div className={canOpen ? "tpr-head tpr-can" : "tpr-head"} onClick={onToggle}>
        {canOpen ? (
          <button type="button" className="tpr-hit" aria-expanded={open} aria-controls={open ? detailId : undefined}>
            <RowText strength={strength} strengthTitle={strengthTitle} title={title} line={open ? null : line} />
          </button>
        ) : (
          <span className="tpr-hit">
            <RowText strength={strength} strengthTitle={strengthTitle} title={title} line={line} />
          </span>
        )}
        {meta}
        {action ? (
          <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {action}
          </span>
        ) : null}
        {canOpen ? (
          <svg viewBox="0 0 24 24" aria-hidden className="tpr-chev" style={{ transform: open ? "rotate(90deg)" : "none" }}>
            <path d="M9.5 6.5 15 12l-5.5 5.5" />
          </svg>
        ) : null}
      </div>
      {open && children ? (
        <div id={detailId} style={{ padding: "0 14px 14px 58px" }}>
          {children}
        </div>
      ) : null}
      {notice ? <div style={{ padding: "0 14px 12px" }}>{notice}</div> : null}
    </div>
  );
}

function RowText({ strength, strengthTitle, title, line }: { strength: number | null; strengthTitle: string; title: string; line?: React.ReactNode }) {
  return (
    <>
      <span className="tpr-dots">{strength ? <Strength n={strength} title={strengthTitle} size={5} /> : null}</span>
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="tpr-title" title={title}>
          {title}
        </span>
        {line ? <span className="tpr-line">{line}</span> : null}
      </span>
    </>
  );
}

/**
 * Labelled lines in two columns (a label, then what it says), so the eye runs
 * down the labels instead of reading sentences run together. Empty values are
 * left out.
 */
export function Facts({ rows }: { rows: [label: string, value: React.ReactNode | null | undefined | false][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "");
  if (!shown.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: 12, rowGap: 5, fontSize: 12.5, lineHeight: 1.6, color: "#3d4650" }}>
      {shown.map(([label, value]) => (
        <React.Fragment key={label}>
          <span style={{ fontSize: 11.5, lineHeight: "20px", color: "#a3a3a3", whiteSpace: "nowrap" }}>{label}</span>
          <span style={{ minWidth: 0 }}>{value}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

/** Up to three pieces of evidence as chips: where, what (when known), the platform's own numbers. Linked when there is a link. */
export function EvidenceChips({ items }: { items: { label: string; title?: string | null; url: string | null; numbers: string }[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 1 }}>
      {items.slice(0, 3).map((e, k) => {
        const numbers = e.numbers ? e.numbers.split(" · ").slice(0, 2).join(" · ") : "";
        const inner = (
          <>
            {e.url ? <Icon name="external" size={10} /> : null}
            <span style={{ color: "#7c7c7c", whiteSpace: "nowrap" }}>{e.label}</span>
            {e.title ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>{e.title}</span> : null}
            {numbers ? <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{numbers}</span> : null}
          </>
        );
        return e.url ? (
          <a key={k} href={e.url} target="_blank" rel="noopener noreferrer" title={e.title ?? undefined} className="tpr-ev">
            {inner}
          </a>
        ) : (
          <span key={k} title={e.title ?? undefined} className="tpr-ev">
            {inner}
          </span>
        );
      })}
    </div>
  );
}

/** A small tag in a row: the format, "已存". */
export function RowTag({ children, tone = "grey", title }: { children: React.ReactNode; tone?: "grey" | "ok"; title?: string }) {
  return (
    <span title={title} className={tone === "ok" ? "tpr-tag tpr-tag-ok" : "tpr-tag"}>
      {children}
    </span>
  );
}

/**
 * How strong the researcher thinks a topic is, as five dots in the
 * researcher's own colours: the blue for the strength it has, the light tint
 * (a step darker, `EMPTY_DOT`, so it still shows on white) for the rest.
 */
export function Strength({ n, title, size = 6 }: { n: number; title: string; size?: number }) {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span role="img" aria-label={`${k}/5`} title={title} style={{ display: "inline-flex", alignItems: "center", gap: size > 5 ? 3 : 2, flexShrink: 0 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ width: size, height: size, borderRadius: size / 2, background: i < k ? AGENT_COLORS.research : EMPTY_DOT }} />
      ))}
    </span>
  );
}

/** 研究员's tint (`AGENT_TINTS.research`), a step darker so an empty dot still shows on white. */
const EMPTY_DOT = "#c4d8f4";

/**
 * After a start from Home: the project exists and 编剧 may be writing.
 * The person chooses where to be; the page does not move on its own.
 */
export function StartedNotice({ zh, title, projectId, scriptId, writing, existed, onStay }: { zh: boolean; title: string; projectId: string; scriptId: string | null; writing: boolean; existed: boolean; onStay: () => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <div role="status" style={{ padding: "9px 11px", borderRadius: 11, background: "#f4fbf8", border: "1px solid #c3e6e0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <AgentIcon agent={writing ? "script" : "research"} size={22} radius={6} />
      <div style={{ flexGrow: 1, flexBasis: 180, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {existed ? t(`这个选题已经有项目了：《${title}》`, `This topic already has a project: “${title}”`) : t(`项目已开：《${title}》`, `Project started: “${title}”`)}
        </div>
        <div style={{ fontSize: 12, color: "#525252", marginTop: 1 }}>
          {writing ? t("编剧正在写初稿，写好会出现在脚本里。", "The writer is drafting it; the draft lands in the script.") : t("去项目里接着做，或者留在这里。", "Carry on in the project, or stay here.")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {writing && scriptId ? (
          <Link prefetch={false} href={`/script/${scriptId}?writing=1`} style={{ ...btn(true), height: 28, textDecoration: "none" }}>
            <Icon name="pen" size={13} /> {t("去看脚本", "Watch the script")}
          </Link>
        ) : null}
        <Link prefetch={false} href={`/projects/${projectId}`} style={{ ...btn(!(writing && scriptId)), height: 28, textDecoration: "none" }}>
          {t("打开项目", "Open the project")}
        </Link>
        <button type="button" onClick={onStay} style={{ ...btn(false), height: 28 }}>
          {t("留在这里", "Stay here")}
        </button>
      </div>
    </div>
  );
}

/** `btn` without its colours, which the `ip-go` class supplies (inline colours would beat its hover). */
export function tintBtn(): React.CSSProperties {
  return { ...btn(false), background: undefined, border: undefined, color: undefined };
}

/** The compact press in a row: 26px, in 编剧's tint when it is `ip-go`. */
export function smallBtn(): React.CSSProperties {
  return { ...tintBtn(), height: 26, padding: "0 10px", borderRadius: 7, gap: 5 };
}

export function btn(primary: boolean): React.CSSProperties {
  return {
    height: 30,
    padding: "0 12px",
    borderRadius: 8,
    border: primary ? "1px solid #171717" : "1px solid #e2e2e2",
    background: primary ? "#171717" : "#fff",
    color: primary ? "#fff" : "#171717",
    fontFamily: "inherit",
    fontSize: 12,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  };
}

/**
 * The start press on an idea or a suggestion, in 编剧's tint (it starts the
 * writer), darkening on hover; the quiet white press beside it; and the rows.
 * Drawn once by Home, beside `DETAIL_LINK_CSS`. The link colours are said
 * again on hover because canvas.css turns every `a:hover` blue.
 */
export const IDEAS_CSS = `
.ip-go { background: #fdefe4; border: 1px solid #f4d5bd; color: #8f3510; transition: background-color .15s ease, border-color .15s ease; }
.ip-go:hover:not(:disabled) { background: #f8dcc6; border-color: #ecbf9c; color: #7a2c0b; }
.ip-go:focus-visible { outline: 2px solid #b3420e; outline-offset: 1px; }
.ip-go:disabled { cursor: default; }
.ip-quiet { background: #fff; border: 1px solid #e6e6e6; color: #3d3d3d; transition: background-color .15s ease, border-color .15s ease; }
.ip-quiet:hover:not(:disabled) { background: #f7f7f6; border-color: #d6d6d6; color: #171717; }
.ip-quiet:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.ip-quiet:disabled { cursor: default; }
.ip-more { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 8px; margin-left: -8px; border: 0; border-radius: 7px; background: transparent; font: inherit; font-size: 12px; font-weight: 500; color: #7c7c7c; cursor: pointer; white-space: nowrap; transition: color .15s ease, background-color .15s ease; }
.ip-more:hover { color: #171717; background: #f4f4f2; }
.ip-more:focus-visible { outline: 2px solid #171717; outline-offset: 1px; }
.tpr { transition: background-color .15s ease; }
.tpr-open { background: #fafbfd; }
.tpr-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; min-width: 0; }
.tpr-can { cursor: pointer; }
.tpr:not(.tpr-open) > .tpr-can:hover { background: #fafafa; }
.tpr-hit { flex: 1 1 auto; min-width: 0; display: flex; align-items: flex-start; gap: 10px; padding: 0; border: 0; background: transparent; font: inherit; color: inherit; text-align: left; cursor: inherit; }
.tpr-hit:focus-visible { outline: 2px solid #171717; outline-offset: 3px; border-radius: 6px; }
.tpr-dots { width: 34px; height: 20px; display: inline-flex; align-items: center; flex-shrink: 0; }
.tpr-title { font-size: 13.5px; font-weight: 600; line-height: 20px; color: #171717; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpr-open .tpr-title { white-space: normal; }
.tpr-line { font-size: 12px; line-height: 18px; color: #8a8a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpr-chev { width: 14px; height: 14px; flex-shrink: 0; stroke: #a3a3a3; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform .15s ease, stroke .15s ease; }
.tpr-can:hover .tpr-chev { stroke: #525252; }
.tpr-tag { display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 999px; color: #7c7c7c; background: #f3f3f1; white-space: nowrap; }
.tpr-tag-ok { color: #278f5e; background: #eef8f2; }
.tpr-ev { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-width: 0; font-size: 11.5px; line-height: 20px; color: #525252; background: #f2f5fa; border-radius: 999px; padding: 0 9px; text-decoration: none; }
a.tpr-ev:hover { color: #171717; background: #e9eef7; }
`;
