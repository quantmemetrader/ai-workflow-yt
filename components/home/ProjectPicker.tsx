"use client";

import * as React from "react";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import type { AgentKey } from "@/lib/agents/catalog";

/**
 * Where the Home task box sends its text: a new project, or one already
 * under way.
 *
 * It was a native <select> reading "项目：…" on every line, which the owner
 * called out as the ugliest thing left in the box. Now a button that shows
 * the choice (a plus for a new project, the open folder and the title for an
 * existing one) and a card that opens under it: a search line, "新项目" on
 * top, then every project with its folder, where it stands (the owner's face
 * and the next step, in the same words as the project cards) and when it
 * last moved. Arrow keys, Enter and Esc work; a press outside closes it.
 *
 * The card is only ever drawn after a press, in the browser, so the relative
 * times below cannot disagree with the server's render.
 */
export type PickerProject = {
  id: string;
  title: string;
  status?: string;
  /** The step it is at, if known: its line ("等编剧开写") and whose it is. */
  step?: { line: string; owner: AgentKey | "you" } | null;
  updatedAt?: string;
};

export function ProjectPicker({
  zh,
  value,
  projects,
  onChange,
}: {
  zh: boolean;
  /** "new", or a project id. */
  value: string;
  projects: PickerProject[];
  onChange: (value: string) => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hi, setHi] = React.useState(0);
  const root = React.useRef<HTMLDivElement | null>(null);
  const search = React.useRef<HTMLInputElement | null>(null);
  const list = React.useRef<HTMLDivElement | null>(null);

  const current = value === "new" ? null : (projects.find((p) => p.id === value) ?? null);
  const needle = q.trim().toLowerCase();
  const shown = needle ? projects.filter((p) => p.title.toLowerCase().includes(needle)) : projects;
  /* Row 0 is "新项目" unless a search is on; then only matches. */
  const rows: ("new" | PickerProject)[] = needle ? shown : ["new", ...shown];

  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    const id = window.setTimeout(() => search.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", away);
      window.clearTimeout(id);
    };
  }, [open]);

  React.useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-row="${hi}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  function pick(row: "new" | PickerProject) {
    onChange(row === "new" ? "new" : row.id);
    setOpen(false);
    setQ("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(rows.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[hi];
      if (row) pick(row);
    }
  }

  function toggle() {
    setOpen((o) => {
      if (!o) {
        setQ("");
        const at = value === "new" ? 0 : projects.findIndex((p) => p.id === value) + 1;
        setHi(Math.max(0, at));
      }
      return !o;
    });
  }

  return (
    <div ref={root} style={{ position: "relative", minWidth: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <button
        type="button"
        className={`pjp-btn${open ? " on" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("交给哪个项目", "Which project")}
        title={current ? current.title : undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {current ? <Icon name="folderOpen" size={14} color="#525252" /> : <Icon name="plus" size={13} color="#525252" />}
        <span className="pjp-btn-label">{current ? current.title : zh ? <Tr zh="新项目" en="New project" /> : "New project"}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#8a8a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s ease" }}>
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </button>

      {open ? (
        <div className="pjp-card" role="dialog" aria-label={t("选择项目", "Choose a project")} onKeyDown={onKey}>
          <div className="pjp-search">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#9a9a9a" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="6.4" />
              <path d="m15.8 15.8 4 4" />
            </svg>
            <input
              ref={search}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              placeholder={t("搜索项目…", "Search projects…")}
              aria-label={t("搜索项目", "Search projects")}
            />
          </div>
          <div ref={list} className="pjp-list" role="listbox">
            {rows.map((row, i) => {
              if (row === "new") {
                const on = value === "new";
                return (
                  <button key="new" type="button" role="option" aria-selected={on} data-row={i} className={`pjp-row${hi === i ? " hi" : ""}`} onMouseEnter={() => setHi(i)} onClick={() => pick("new")}>
                    <span className="pjp-ico new">
                      <Icon name="plus" size={14} color="#171717" />
                    </span>
                    <span className="pjp-text">
                      <span className="pjp-title">{zh ? <Tr zh="新项目" en="New project" /> : "New project"}</span>
                      <span className="pjp-sub">{t("研究员先查标题和对标，再写脚本", "The researcher checks the title and rivals, then the script")}</span>
                    </span>
                    {on ? <Icon name="check" size={14} color="#171717" /> : null}
                  </button>
                );
              }
              const on = row.id === value;
              const dim = row.status === "done" || row.status === "archived";
              return (
                <React.Fragment key={row.id}>
                  {!needle && i === 1 ? <div className="pjp-label">{t("交给已有项目", "Into a project")}</div> : null}
                  <button type="button" role="option" aria-selected={on} data-row={i} className={`pjp-row${hi === i ? " hi" : ""}${dim ? " dim" : ""}`} onMouseEnter={() => setHi(i)} onClick={() => pick(row)}>
                    <span className="pjp-ico">
                      <Icon name={on ? "folderOpen" : "folder"} size={15} color={on ? "#171717" : "#8a8a8a"} />
                    </span>
                    <span className="pjp-text">
                      <span className="pjp-title">{row.title}</span>
                      <span className="pjp-sub">
                        {row.step ? (
                          <>
                            {row.step.owner !== "you" ? <AgentIcon agent={row.step.owner} size={14} radius={4} /> : <Icon name="upload" size={11} color="#b07a1f" />}
                            <span className="pjp-ell">{row.step.line}</span>
                          </>
                        ) : (
                          <span className="pjp-ell">{row.status === "done" ? t("已交付", "Delivered") : t("进行中", "In progress")}</span>
                        )}
                        {row.updatedAt ? <span className="pjp-when">{ago(row.updatedAt, zh)}</span> : null}
                      </span>
                    </span>
                    {on ? <Icon name="check" size={14} color="#171717" /> : null}
                  </button>
                </React.Fragment>
              );
            })}
            {needle && rows.length === 0 ? <div className="pjp-empty">{t("没有叫这个名字的项目", "No project by that name")}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "3 分钟前": drawn only in the browser, after a press. */
function ago(iso: string, zh: boolean): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return zh ? "刚刚" : "just now";
  if (m < 60) return zh ? `${m} 分钟前` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return zh ? `${d} 天前` : `${d}d ago`;
}

const CSS = `
.pjp-btn { display: inline-flex; align-items: center; gap: 7px; height: 30px; max-width: 280px; padding: 0 10px 0 9px; border: 1px solid #e2e2e2; border-radius: 9px; background: #fff; color: #171717; font-family: inherit; font-size: 12.5px; letter-spacing: inherit; cursor: pointer; transition: border-color .12s ease, box-shadow .12s ease; }
.pjp-btn:hover { border-color: #cfcfcc; }
.pjp-btn.on { border-color: #b9d5f5; box-shadow: 0 0 0 3px #eef5fe; }
.pjp-btn-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.pjp-card { position: absolute; left: 0; top: calc(100% + 6px); z-index: 50; width: 360px; max-width: min(360px, calc(100vw - 32px)); background: #fff; border: 1px solid #e6e6e3; border-radius: 13px; box-shadow: 0 12px 32px rgba(20,24,40,.12), 0 2px 6px rgba(20,24,40,.06); overflow: hidden; }
.pjp-search { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid #f0f0ee; }
.pjp-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-family: inherit; font-size: 13px; letter-spacing: inherit; color: #171717; }
.pjp-list { max-height: 330px; overflow-y: auto; padding: 6px; }
.pjp-label { padding: 8px 8px 4px; font-size: 11px; font-weight: 600; color: #9a9a9a; letter-spacing: .02em; }
.pjp-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: 9px; background: transparent; font-family: inherit; letter-spacing: inherit; text-align: left; cursor: pointer; color: #171717; }
.pjp-row.hi { background: #f4f7fc; }
.pjp-row.dim { opacity: .6; }
.pjp-ico { width: 28px; height: 28px; border-radius: 8px; background: #f5f5f3; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pjp-ico.new { background: #eaf3fe; }
.pjp-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pjp-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pjp-sub { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: #8a8a8a; min-width: 0; }
.pjp-ell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pjp-when { margin-left: auto; padding-left: 8px; flex-shrink: 0; color: #b0b0ac; }
.pjp-empty { padding: 18px 10px; text-align: center; font-size: 12.5px; color: #9a9a9a; }
`;
