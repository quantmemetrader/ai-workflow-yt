"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { useLiveSnapshot } from "@/lib/client/live";
import { isRecent, isRunning } from "@/lib/projects/live-types";

export type TreeProject = { id: string; title: string; status: string; scriptId: string | null; videoProjectId: string | null };

/**
 * Projects as a tree in the sidebar.
 *
 * Each project opens into what it holds: its page (steps, outputs, chat),
 * its script, and its editor. The project you are in stays open; the rest
 * fold. Delivered ones are dimmed, not hidden.
 *
 * The heading is translate-proof (`Tr`): Chrome's translate would otherwise
 * make 项目 whatever it guesses.
 */
export function ProjectTree({ projects, zh, wide }: { projects: TreeProject[]; zh: boolean; wide: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const pathname = usePathname();
  const params = useSearchParams();
  const openProjectParam = params.get("project");
  const [showAll, setShowAll] = React.useState(false);
  /* The films being made right now (`lib/client/live.ts`): a folder whose
     film is rendering gets a small moving dot, and a still green one for two
     minutes after the film lands — the sidebar used to say nothing at all
     while the worker was twenty minutes into a render. Empty on the server
     and at hydration, so the first paint agrees. */
  const { at: polledAt, projects: live } = useLiveSnapshot();
  const liveOf = (id: string) => live.find((x) => x.id === id) ?? null;

  const isIn = (p: TreeProject) =>
    pathname === `/projects/${p.id}` ||
    (p.scriptId !== null && pathname.startsWith(`/script/${p.scriptId}`)) ||
    (p.videoProjectId !== null && pathname === "/video" && openProjectParam === p.videoProjectId);

  if (!wide) {
    return (
      <Link href="/projects" className={`r${pathname.startsWith("/projects") ? " on" : ""}`} aria-label={t("项目", "Projects")} title={t("项目", "Projects")}>
        <svg viewBox="0 0 24 24">
          <path d="M3.6 6.9a2.1 2.1 0 0 1 2.1-2.1h3.2a2.1 2.1 0 0 1 1.62.76l1.02 1.24h6.76a2.1 2.1 0 0 1 2.1 2.1v8.3a2.1 2.1 0 0 1-2.1 2.1H5.7a2.1 2.1 0 0 1-2.1-2.1z" />
        </svg>
      </Link>
    );
  }

  /* Four at a glance; the rest a press away. Eight was the old cut-off,
     and with a busy studio the list pushed the rail's foot off the screen. */
  const SHOWN = 4;
  const list = showAll ? projects : projects.slice(0, SHOWN);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "4px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 9px 4px" }}>
        <Link prefetch={false} href="/projects" style={{ fontSize: 11.5, fontWeight: 600, color: pathname === "/projects" ? "#171717" : "#999999", textDecoration: "none", letterSpacing: ".03em", flexGrow: 1 }}>
          {zh ? <Tr zh="项目" en="PROJECTS" /> : "PROJECTS"}
        </Link>
        <span style={{ fontSize: 11, color: "#c7c7c7" }}>{projects.length || ""}</span>
      </div>
      {list.map((p) => {
        const inside = isIn(p);
        const here = pathname === `/projects/${p.id}`;
        /* Each project is a folder, in the same 17px column and at the same
           9px inset as the rail's own icons above it, so the titles line up
           with 首页 and 聊天. It was a 7px blue square: "don't just add a
           blue dot, have it as a folder icon, it's prettier". The one you
           are in is open and inked; the others closed on a soft grey tint;
           delivered and archived ones a step fainter again. */
        const dim = p.status === "done" || p.status === "archived";
        /* Published (done): a small green check on the folder's corner, so
           a finished project reads as finished, not only as faint. */
        const published = p.status === "done";
        const ink = inside ? "#171717" : dim ? "#c9c9c9" : "#9b9b9b";
        const fill = inside ? "#f0f0ef" : dim ? "none" : "#ededec";
        return (
          <div key={p.id}>
            <div style={{ display: "flex", alignItems: "center", height: 30, borderRadius: 8, background: here ? "#fff" : "transparent", boxShadow: here ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}>
              <Link
                prefetch={false}
                href={`/projects/${p.id}`}
                title={published ? `${p.title} · ${t("已发布", "Published")}` : p.title}
                className="pt-row"
                style={{ flexGrow: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "center", gap: 9, padding: "0 9px", fontSize: 12.5, color: inside ? "#171717" : dim ? "#a3a3a3" : "#525252", textDecoration: "none" }}
              >
                <span aria-hidden style={{ position: "relative", width: 17, height: 17, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon name={inside ? "folderOpen" : "folder"} size={16} color={ink} strokeWidth={1.7} style={{ fill, verticalAlign: 0 }} />
                  {published ? (
                    <span style={{ position: "absolute", right: -3, bottom: -2, width: 10, height: 10, borderRadius: 5, background: "#23a15f", boxShadow: "0 0 0 1.5px #f7f7f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name="check" size={7} color="#fff" strokeWidth={3.4} />
                    </span>
                  ) : (
                    <LiveDot state={liveOf(p.id)} at={polledAt} />
                  )}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: inside ? 600 : 400 }}>{p.title}</span>
              </Link>
            </div>
          </div>
        );
      })}
      {projects.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          style={{ display: "flex", alignItems: "center", gap: 4, border: 0, background: "transparent", padding: "4px 9px 2px 35px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", letterSpacing: "inherit", fontSize: 11.5, color: "#7c7c7c" }}
        >
          {showAll ? t("收起", "Show fewer") : t(`再看 ${projects.length - SHOWN} 个`, `${projects.length - SHOWN} more`)}
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: showAll ? "rotate(180deg)" : undefined }}>
            <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
          </svg>
        </button>
      ) : null}
      <div style={{ padding: "2px 2px 0" }}>
        <NewProjectButton zh={zh} compact />
      </div>
    </div>
  );
}

/**
 * The small dot on a folder's corner: moving (blue) while its film is
 * being made or its auto-cut counts down, still green for two minutes once
 * the film is out, red when the render failed. Nothing otherwise.
 */
function LiveDot({ state, at }: { state: ReturnType<typeof useLiveSnapshot>["projects"][number] | null; at: number }) {
  if (!state) return null;
  const running = isRunning(state) || state.state === "armed";
  if (!running && !isRecent(state, at)) return null;
  const color = running ? "#4a90e2" : state.state === "done" ? "#23a15f" : "#d9534f";
  return (
    <span
      aria-hidden
      title={running ? "正在制作" : state.state === "done" ? "成片已出" : "渲染没成功"}
      style={{ position: "absolute", right: -3, bottom: -2, width: 8, height: 8, borderRadius: 4, background: color, boxShadow: "0 0 0 1.5px #f7f7f6", animation: running ? "auraPulse 1.4s ease-in-out infinite" : undefined }}
    />
  );
}
