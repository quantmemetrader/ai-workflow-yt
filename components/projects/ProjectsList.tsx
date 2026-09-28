"use client";

import * as React from "react";
import Link from "next/link";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { ProjectStep } from "@/lib/projects/service";
import type { Publication, PublishedPlace } from "@/lib/projects/publication";
import { PublishedMarks } from "@/components/projects/Published";
import { PROJECT_TABS, nowTab, tabHref } from "@/lib/projects/tabs";
import { NewVideoBox } from "@/components/home/NewVideoBox";
import { Empty, bigButton } from "@/components/projects/kit";

export type ProjectListRow = {
  id: string;
  title: string;
  status: string;
  mode: string;
  updatedAt: string;
  /** `updatedAt` as the card prints it, formatted on the server. */
  when: string;
  mine: boolean;
  access: string;
  steps: ProjectStep[];
  /** The step it has got to (`frontierStep`); null once every step is done. */
  frontier: ProjectStep | null;
  /** The first clip (or the render) for the picture; null draws the gradient. */
  thumbFileId: string | null;
  /** Once marked published: where it went, and the day (formatted on the server). */
  published: { platforms: PublishedPlace[]; day: string; byName: string } | null;
};

type StatusFilter = "active" | "done" | "all";

/**
 * 视频: every video the person may see, one calm row each (28 Sep — the
 * board of cards with five-dot steppers was a lot to read). A row says the
 * title, the step it is on as the project's own tabs number it, who has it,
 * and when it last moved; pressing it opens the step it is on.
 *
 * Filters stay on the client: two hundred rows is nothing to filter here.
 */
export function ProjectsList({ rows, zh }: { rows: ProjectListRow[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("active");
  const [starting, setStarting] = React.useState(false);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (status === "all" || r.status === status) && (!needle || r.title.toLowerCase().includes(needle)));
  const count = (s: StatusFilter) => rows.filter((r) => s === "all" || r.status === s).length;
  const seg = (value: StatusFilter, label: string) => (
    <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)} className="pl-seg" data-on={status === value ? "" : undefined}>
      {label}
      <span className="pl-n">{count(value)}</span>
    </button>
  );
  return (
    <div style={{ maxWidth: 1080, padding: "22px 32px 56px", display: "flex", flexDirection: "column", gap: 14 }}>
      <style dangerouslySetInnerHTML={{ __html: LIST_CSS }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{t("视频", "Videos")}</h1>
        <span style={{ flexGrow: 1 }} />
        <button type="button" onClick={() => setStarting((v) => !v)} style={bigButton(starting ? "secondary" : "primary")}>
          {starting ? t("收起", "Close") : t("新视频", "New video")}
        </button>
      </div>
      {starting ? (
        <div style={{ padding: 16, background: "#fff", border: "1px solid #e7e6e2", borderRadius: 14 }}>
          <NewVideoBox zh={zh} />
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label className="pl-search">
          <svg viewBox="0 0 24 24" aria-hidden style={{ width: 15, height: 15, flexShrink: 0, stroke: "#a3a3a3", fill: "none", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <circle cx="11" cy="11" r="6.2" />
            <path d="m15.6 15.6 4.1 4.1" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索视频", "Search videos")} aria-label={t("搜索视频", "Search videos")} />
        </label>
        <nav className="pl-segs" aria-label={t("按状态", "By status")}>
          {seg("active", t("进行中", "In progress"))}
          {seg("done", t("已发布", "Published"))}
          {seg("all", t("全部", "All"))}
        </nav>
      </div>
      {shown.length === 0 ? (
        <Empty icon="film" text={rows.length === 0 ? t("还没有视频，点右上角「新视频」开始", "No videos yet: press New video") : t("没有找到", "Nothing found")} />
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e7e6e2", borderRadius: 14, overflow: "hidden" }}>
          {shown.map((r, i) => (
            <Row key={r.id} row={r} zh={zh} first={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ row: r, zh, first }: { row: ProjectListRow; zh: boolean; first: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const facts = { steps: r.steps, status: r.status, published: r.published as unknown as Publication | null };
  const tab = r.status === "active" ? nowTab(facts) : null;
  const def = tab ? PROJECT_TABS.find((x) => x.key === tab) : null;
  const f = r.frontier;
  const state = r.status === "done" ? "done" : r.status === "archived" ? "archived" : f?.state === "running" ? "running" : f?.state === "you" ? "you" : "todo";
  const pill =
    state === "done" ? t("已发布", "Published") : state === "archived" ? t("已归档", "Archived") : def?.n ? t(`第 ${def.n} 步 · ${def.zh}`, `Step ${def.n} · ${def.en}`) : t("进行中", "In progress");
  const who =
    state === "running" && f && f.owner !== "you"
      ? t(`${AGENT_LABELS[f.owner as AgentKey].nameLocal}在做`, `${AGENT_LABELS[f.owner as AgentKey].name} on it`)
      : state === "you"
        ? t("等人处理", "Waiting on the team")
        : state === "todo"
          ? t("下一步", "Up next")
          : null;
  const href = tab ? tabHref(r.id, tab) : r.status === "done" ? tabHref(r.id, "review") : `/projects/${r.id}`;
  return (
    <Link href={href} prefetch={false} className="pl-row" style={{ borderTop: first ? 0 : "1px solid #f0efeb" }}>
      <span className="pl-thumb" style={r.thumbFileId ? { backgroundImage: `url(/api/files/${r.thumbFileId}/thumb)` } : undefined} aria-hidden>
        {r.thumbFileId ? null : (
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden style={{ color: "#a9b3c6" }}>
                    <rect x="3.4" y="5.4" width="12.4" height="13.2" rx="2.1" fill="currentColor" />
                    <path d="m16.6 13 4.6 2.8V8.2L16.6 11z" fill="currentColor" />
                  </svg>
                )}
      </span>
      <span style={{ minWidth: 0, flexGrow: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#7a7a7a", minWidth: 0 }}>
          <span className="pl-pill" data-state={state}>
            {pill}
          </span>
          {state === "done" && r.published?.platforms.length ? <PublishedMarks platforms={r.published.platforms} zh={zh} /> : null}
          {who ? <span>{who}</span> : null}
        </span>
      </span>
      <span className="pl-when">{r.when}</span>
      <span style={{ fontSize: 13, color: "#525252", flexShrink: 0 }}>{t("打开 →", "Open →")}</span>
    </Link>
  );
}

const LIST_CSS = `
.pl-search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; background: #fff; border: 1px solid #e2e1dc; border-radius: 10px; flex: 1 1 240px; max-width: 360px; }
.pl-search input { border: 0; outline: none; background: transparent; font: inherit; font-size: 13.5px; min-width: 0; flex-grow: 1; }
.pl-segs { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: #ecebe7; }
.pl-seg { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 13px; color: #6b6b6b; cursor: pointer; }
.pl-seg[data-on] { background: #fff; color: #171717; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.pl-n { font-size: 11.5px; color: #a3a3a3; font-weight: 500; }
.pl-row { display: flex; align-items: center; gap: 14px; padding: 12px 16px; text-decoration: none; color: inherit; transition: background-color .12s ease; }
.pl-row:hover { background: #fafaf8; }
.pl-thumb { width: 72px; height: 44px; border-radius: 8px; background: #eef1f6 center/cover no-repeat; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
.pl-pill { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 0 8px; line-height: 20px; border-radius: 99px; background: #f3f3f1; color: #5f5f5f; white-space: nowrap; }
.pl-pill[data-state="you"] { background: #fff4df; color: #95590a; }
.pl-pill[data-state="running"] { background: #e9f2fe; color: #1f5fbf; }
.pl-pill[data-state="done"] { background: #e7f6ee; color: #1e7a4f; }
.pl-when { font-size: 12px; color: #a3a3a3; white-space: nowrap; flex-shrink: 0; }
@media (max-width: 640px) { .pl-when { display: none; } .pl-thumb { width: 56px; height: 36px; } }
`;
