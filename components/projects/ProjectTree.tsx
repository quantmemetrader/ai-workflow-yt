"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { Icon, type IconName } from "@/components/ui/Icon";

export type TreeProject = { id: string; title: string; status: string; scriptId: string | null; videoProjectId: string | null };

/**
 * Projects as a tree in the sidebar.
 *
 * Each project opens into what it holds: its page (steps, outputs, chat),
 * its script, and its editor. The project you are in stays open; the rest
 * fold. Delivered ones are dimmed, not hidden.
 */
export function ProjectTree({ projects, zh, wide }: { projects: TreeProject[]; zh: boolean; wide: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const pathname = usePathname();
  const params = useSearchParams();
  const openProjectParam = params.get("project");
  const [openIds, setOpenIds] = React.useState<Set<string>>(new Set());
  const [showAll, setShowAll] = React.useState(false);

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

  const list = showAll ? projects : projects.slice(0, 8);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "4px 0 6px" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 9px 4px" }}>
        <Link href="/projects" style={{ fontSize: 11.5, fontWeight: 600, color: pathname === "/projects" ? "#171717" : "#999999", textDecoration: "none", letterSpacing: ".03em", flexGrow: 1 }}>
          {t("项目", "PROJECTS")}
        </Link>
        <span style={{ fontSize: 11, color: "#c7c7c7" }}>{projects.length || ""}</span>
      </div>
      {list.map((p) => {
        const inside = isIn(p);
        const open = inside || openIds.has(p.id);
        const leaf = (href: string, label: string, on: boolean, icon: IconName) => (
          <Link
            href={href}
            style={{ display: "flex", alignItems: "center", gap: 7, height: 26, padding: "0 8px 0 30px", borderRadius: 7, fontSize: 12.5, color: on ? "#171717" : "#7c7c7c", background: on ? "#fff" : "transparent", boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none", textDecoration: "none", fontWeight: on ? 500 : 400, position: "relative" }}
          >
            <span aria-hidden style={{ position: "absolute", left: 17, top: 0, bottom: 0, width: 1, background: "#e2e2e2" }} />
            <Icon name={icon} size={13} />
            {label}
          </Link>
        );
        return (
          <div key={p.id}>
            <div style={{ display: "flex", alignItems: "center", height: 29, borderRadius: 7, background: pathname === `/projects/${p.id}` ? "#fff" : "transparent", boxShadow: pathname === `/projects/${p.id}` ? "0 1px 2px rgba(0,0,0,.1)" : "none" }}>
              <button
                type="button"
                aria-label={open ? t("收起", "Fold") : t("展开", "Open")}
                aria-expanded={open}
                onClick={() =>
                  setOpenIds((s) => {
                    const n = new Set(s);
                    if (n.has(p.id)) n.delete(p.id);
                    else n.add(p.id);
                    return n;
                  })
                }
                style={{ width: 22, height: 29, border: 0, background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}
              >
                <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease", stroke: "#999999", fill: "none", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }}>
                  <path d="M9.5 6.5 15 12l-5.5 5.5" />
                </svg>
              </button>
              <Link href={`/projects/${p.id}`} title={p.title} style={{ flexGrow: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: p.status === "active" ? "#171717" : "#999999", textDecoration: "none", paddingRight: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: p.status === "done" ? "#278f5e" : p.status === "archived" ? "#d9d9d9" : "#0f5bd5" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: inside ? 600 : 400 }}>{p.title}</span>
              </Link>
            </div>
            {open ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 2 }}>
                {leaf(`/projects/${p.id}`, t("概览与对话", "Overview & chat"), pathname === `/projects/${p.id}`, "chat")}
                {p.scriptId ? leaf(`/script/${p.scriptId}`, t("脚本", "Script"), pathname.startsWith(`/script/${p.scriptId}`), "pen") : null}
                {p.videoProjectId ? leaf(`/video?project=${p.videoProjectId}`, t("剪辑台", "Editor"), pathname === "/video" && openProjectParam === p.videoProjectId, "film") : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {projects.length > 8 ? (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={{ border: 0, background: "transparent", padding: "3px 9px", textAlign: "left", cursor: "pointer", font: "inherit", fontSize: 11.5, color: "#7c7c7c" }}>
          {showAll ? t("收起", "Show fewer") : t(`＋ 另外 ${projects.length - 8} 个`, `+ ${projects.length - 8} more`)}
        </button>
      ) : null}
      <div style={{ padding: "2px 2px 0" }}>
        <NewProjectButton zh={zh} compact />
      </div>
    </div>
  );
}
