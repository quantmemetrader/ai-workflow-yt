"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";

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
                  ) : null}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: inside ? 600 : 400 }}>{p.title}</span>
              </Link>
            </div>
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
