"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { StageBadge, StepTrack, STAGE_TONE, stageToneOf } from "@/components/projects/StepTrack";
import type { ProjectStep } from "@/lib/projects/service";

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
};

type StatusFilter = "active" | "done" | "archived" | "all";
type WhoseFilter = "all" | "mine" | "shared";

/**
 * Every project the person can see: search, by status, mine or shared.
 *
 * The cards used to be a bare line of grey words ("测试 · 进行中 · 完整流程
 * · 共享 · date"), which told you a project existed and nothing about where
 * it was. They are now Home's project cards laid out as a board: a picture
 * from the first clip (or a soft gradient with a clapper until there is
 * one), the title and the same soft pill Home uses, the five steps with the
 * one it has got to ringed, and whose turn it is — the employee's own face,
 * or the upload glyph when it is the host's — with what happens next. The
 * stepper and the pill are `StepTrack`, shared with Home, so the two cannot
 * tell different stories.
 *
 * The filters are the ones this page always had, and they stay on the
 * client: two hundred rows is nothing to filter in the browser, and a filter
 * that is a round trip feels broken on a list this small.
 */
export function ProjectsList({ rows, zh }: { rows: ProjectListRow[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("active");
  const [whose, setWhose] = React.useState<WhoseFilter>("all");
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (whose === "all" || (whose === "mine" ? r.mine : !r.mine)) &&
      (!needle || r.title.toLowerCase().includes(needle)),
  );
  const count = (s: StatusFilter) => rows.filter((r) => s === "all" || r.status === s).length;
  const filtered = needle !== "" || status !== "active" || whose !== "all";
  const seg = <T extends string>(value: T, current: T, set: (v: T) => void, label: string, n?: number) => (
    <button key={value} type="button" aria-pressed={current === value} onClick={() => set(value)} className="plc-seg" data-on={current === value ? "" : undefined}>
      {label}
      {n !== undefined ? <span className="plc-seg-n">{n}</span> : null}
    </button>
  );
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 28px 48px" }}>
      <style dangerouslySetInnerHTML={{ __html: LIST_CSS }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{t("项目", "Projects")}</h1>
        <span style={{ fontSize: 13, color: "#999999" }}>{t("一条片就是一个项目：对话、脚本、素材、成片都在里面。", "One video, one project: its chat, script, clips and cut, together.")}</span>
        <span style={{ flexGrow: 1 }} />
        <NewProjectButton zh={zh} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <label className="plc-search">
          {/* A magnifier. The box used to wear the eye, which on this page
              already means "everyone can see it". */}
          <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, flexShrink: 0, stroke: "#a3a3a3", fill: "none", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <circle cx="11" cy="11" r="6.2" />
            <path d="m15.6 15.6 4.1 4.1" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索项目…", "Search projects…")} aria-label={t("搜索项目", "Search projects")} />
        </label>
        <nav className="plc-segs" aria-label={t("按状态", "By status")}>
          {seg("active", status, setStatus, t("进行中", "In progress"), count("active"))}
          {seg("done", status, setStatus, t("已交付", "Delivered"), count("done"))}
          {seg("archived", status, setStatus, t("归档", "Archived"), count("archived"))}
          {seg("all", status, setStatus, t("全部", "All"), count("all"))}
        </nav>
        <nav className="plc-segs" aria-label={t("按发起人", "By who started it")}>
          {seg("all", whose, setWhose, t("所有人的", "Everyone's"))}
          {seg("mine", whose, setWhose, t("我发起的", "Mine"))}
          {seg("shared", whose, setWhose, t("别人发起的", "Others'"))}
        </nav>
      </div>
      {shown.length === 0 ? (
        <div className="plc-empty">
          <span className="plc-empty-mark">
            <Icon name="clapper" size={22} color="#8f9bbd" />
          </span>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#171717", marginTop: 12 }}>{rows.length === 0 ? t("还没有项目", "No projects yet") : t("没有符合的项目", "No project matches")}</div>
          <div style={{ fontSize: 12.5, color: "#999999", marginTop: 6, lineHeight: 1.6 }}>
            {rows.length === 0 ? t("点右上角新建，或在首页交代一件事，团队会为它开一个项目。", "Start one above, or give the team a task on Home and a project starts.") : t("换个关键词，或看看其他状态。", "Try other words, or another status.")}
          </div>
          {rows.length > 0 && filtered ? (
            <button
              type="button"
              className="plc-clear"
              onClick={() => {
                setQ("");
                setStatus("all");
                setWhose("all");
              }}
            >
              {t("看全部项目", "Show every project")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="plc-grid">
          {shown.map((r) => (
            <ProjectCard key={r.id} row={r} zh={zh} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Who can open a project, in words for the picture's corner. */
function accessWord(access: string, zh: boolean): string {
  const t = (a: string, b: string) => (zh ? a : b);
  switch (access) {
    case "everyone":
      return t("全员可见", "Everyone");
    case "groups":
      return t("部分成员可见", "Some groups");
    case "people":
      return t("指定的人可见", "Named people");
    default:
      return t("仅自己可见", "Only you");
  }
}

function ProjectCard({ row: r, zh }: { row: ProjectListRow; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const now = r.status === "active" ? r.frontier : null;
  const archived = r.status === "archived";
  const tone = archived ? STAGE_TONE.todo : r.status === "done" ? STAGE_TONE.done : stageToneOf(now);
  const done = r.steps.filter((s) => s.state === "done" || s.state === "skipped").length;
  const pct = r.status === "done" ? 100 : Math.round((done / Math.max(1, r.steps.length)) * 100);
  /* The line along the bottom: whose turn it is and what happens next — the
     employee's own face when it is theirs, the upload glyph when it is the
     host's. A delivered or archived project says so instead. */
  const next =
    now && r.status === "active" ? (
      <>
        {now.owner !== "you" ? <AgentIcon agent={now.owner} size={18} radius={5} /> : <span className="plc-you"><Icon name="upload" size={11} color="#95590a" strokeWidth={2} /></span>}
        <span className="plc-next">{now.line}</span>
      </>
    ) : (
      <>
        <span className="plc-you" style={{ background: archived ? "#f1f1ef" : STAGE_TONE.done.bg }}>
          <Icon name={archived ? "lock" : "check"} size={11} color={archived ? "#8a8a86" : STAGE_TONE.done.ink} strokeWidth={2.2} />
        </span>
        <span className="plc-next">{archived ? t("已归档，只读", "Archived; read only") : t("已交付", "Delivered")}</span>
      </>
    );
  return (
    <Link href={`/projects/${r.id}`} prefetch={false} className="plc-card" data-archived={archived ? "" : undefined} style={{ ["--plc-tone" as string]: tone.line } as React.CSSProperties}>
      <span className="plc-thumb">
        <Thumb fileId={r.thumbFileId} />
        <span className="plc-chip">{r.mode.startsWith("direct:") ? t("直接交代", "Direct") : t("完整流程", "Full line")}</span>
        <span className="plc-chip plc-chip-r" title={accessWord(r.access, zh)}>
          <Icon name={r.access === "private" ? "lock" : "eye"} size={11} color="#6b6b6b" />
          {r.access === "private" ? t("私密", "Private") : t("共享", "Shared")}
        </span>
        <span className="plc-pct" aria-hidden>
          <span style={{ width: `${pct}%`, background: r.status === "done" ? STAGE_TONE.done.dot : "#7fb0ea" }} />
        </span>
      </span>
      <span className="plc-body">
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span className="plc-title">{r.title}</span>
          <StageBadge now={now} zh={zh} status={r.status} />
        </span>
        <span className="plc-meta">
          {r.mine ? t("我发起", "Started by you") : t("同事发起", "Started by a colleague")}
          <span style={{ color: "#d4d4d0" }}>·</span>
          {r.when}
        </span>
        <span style={{ marginTop: 4 }}>
          <StepTrack steps={r.steps} current={now?.key ?? null} />
        </span>
        <span className="plc-foot">
          {next}
          <span className="plc-open">
            {t("打开", "Open")}
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />
            </svg>
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * The card's picture, or the gradient and clapper.
 *
 * A clip whose poster the worker has not made yet, or a file this person may
 * not read, answers the thumbnail URL with an error; the card then falls back
 * to the gradient rather than drawing a broken-image glyph. The ref catches
 * the case where the error came before React was listening (the server's
 * HTML loads the picture before hydration).
 */
function Thumb({ fileId }: { fileId: string | null }) {
  const [failed, setFailed] = React.useState(false);
  if (!fileId || failed) {
    return (
      <span className="plc-mark" aria-hidden>
        <Icon name="clapper" size={20} color="#8f9bbd" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/files/${fileId}/thumb`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      ref={(el) => {
        if (el && el.complete && el.naturalWidth === 0) setFailed(true);
      }}
    />
  );
}

const LIST_CSS = `
.plc-search { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border: 1px solid #e2e2e2; border-radius: 10px; background: #fff; min-width: 220px; flex: 1 1 240px; max-width: 360px; transition: border-color .15s ease, box-shadow .15s ease; }
.plc-search:focus-within { border-color: #cfcfcf; box-shadow: 0 0 0 3px rgba(23,23,23,.05); }
.plc-search input { border: 0; outline: none; font-family: inherit; font-size: 13px; flex-grow: 1; min-width: 0; background: transparent; color: #171717; }
.plc-segs { display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: #ebeae7; }
.plc-seg { height: 28px; padding: 0 11px; border-radius: 8px; border: 0; background: transparent; font-family: inherit; font-size: 12.5px; color: #7c7c7c; font-weight: 400; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: color .15s ease, background-color .15s ease; }
.plc-seg:hover { color: #171717; }
.plc-seg[data-on] { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08); color: #171717; font-weight: 500; }
.plc-seg-n { font-size: 11px; color: #b3b3b3; font-variant-numeric: tabular-nums; }
.plc-grid { margin-top: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.plc-card { display: flex; flex-direction: column; min-width: 0; border: 1px solid #ececec; border-radius: 14px; background: #fff; overflow: hidden; text-decoration: none; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.03); transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
.plc-card:hover { color: #171717; border-color: var(--plc-tone, #e3e3e0); box-shadow: 0 6px 18px rgba(20,30,60,.07); transform: translateY(-1px); }
.plc-card:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
.plc-card:hover .plc-open { color: #171717; }
.plc-card[data-archived] { opacity: .72; }
.plc-card[data-archived] .plc-thumb img { filter: grayscale(1); }
.plc-thumb { position: relative; height: 124px; flex-shrink: 0; overflow: hidden; background: linear-gradient(135deg, #eef4fd, #f3effc 55%, #edf7f2); border-bottom: 1px solid #f1f1ef; display: flex; align-items: center; justify-content: center; }
.plc-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.plc-mark { width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,.8); box-shadow: 0 1px 3px rgba(40,50,90,.08); display: flex; align-items: center; justify-content: center; }
.plc-chip { position: absolute; top: 10px; left: 10px; height: 22px; padding: 0 8px; border-radius: 999px; background: rgba(255,255,255,.9); box-shadow: 0 1px 2px rgba(0,0,0,.06); font-size: 11px; font-weight: 500; color: #525252; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.plc-chip-r { left: auto; right: 10px; }
.plc-pct { position: absolute; left: 10px; right: 10px; bottom: 10px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.78); overflow: hidden; }
.plc-pct > span { display: block; height: 100%; border-radius: 2px; }
.plc-body { display: flex; flex-direction: column; gap: 8px; padding: 13px 14px 12px; flex-grow: 1; min-width: 0; }
.plc-title { font-size: 14px; font-weight: 600; min-width: 0; flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plc-meta { display: flex; align-items: center; gap: 6px; margin-top: -3px; font-size: 11.5px; color: #9a9a9a; white-space: nowrap; overflow: hidden; }
.plc-foot { display: flex; align-items: center; gap: 7px; min-width: 0; margin-top: auto; padding-top: 10px; border-top: 1px solid #f3f3f1; font-size: 12px; color: #6f6f6f; }
.plc-you { width: 18px; height: 18px; border-radius: 5px; background: #fcebc9; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.plc-next { min-width: 0; flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plc-open { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; color: #a3a3a3; font-weight: 500; transition: color .15s ease; }
.plc-empty { margin-top: 18px; padding: 44px 24px; border: 1px dashed #dcdcd8; border-radius: 14px; background: rgba(255,255,255,.7); text-align: center; }
.plc-empty-mark { width: 52px; height: 52px; margin: 0 auto; border-radius: 14px; background: linear-gradient(135deg, #eef4fd, #f3effc 55%, #edf7f2); display: flex; align-items: center; justify-content: center; }
.plc-clear { margin-top: 14px; height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid #e2e2e2; background: #fff; font-family: inherit; font-size: 12.5px; color: #171717; cursor: pointer; }
.plc-clear:hover { border-color: #cfcfcf; }
@media (prefers-reduced-motion: reduce) { .plc-card, .plc-seg, .plc-search { transition: none; } .plc-card:hover { transform: none; } }
`;
