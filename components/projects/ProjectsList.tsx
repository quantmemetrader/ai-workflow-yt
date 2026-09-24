"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { NewProjectButton } from "@/components/projects/NewProjectButton";

export type ProjectListRow = { id: string; title: string; status: string; mode: string; updatedAt: string; mine: boolean; access: string };

/** Every project the person can see: search, by status, mine or shared. */
export function ProjectsList({ rows, zh }: { rows: ProjectListRow[]; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"active" | "done" | "archived" | "all">("active");
  const [whose, setWhose] = React.useState<"all" | "mine" | "shared">("all");
  const shown = rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (whose === "all" || (whose === "mine" ? r.mine : !r.mine)) &&
      (!q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const count = (s: typeof status) => rows.filter((r) => s === "all" || r.status === s).length;
  const seg = <T extends string>(value: T, current: T, set: (v: T) => void, label: string, n?: number) => (
    <button key={value} type="button" onClick={() => set(value)} style={{ height: 28, padding: "0 11px", borderRadius: 8, border: 0, background: current === value ? "#fff" : "transparent", boxShadow: current === value ? "0 1px 2px rgba(0,0,0,.08)" : "none", fontFamily: "inherit", fontSize: 12.5, color: current === value ? "#171717" : "#7c7c7c", fontWeight: current === value ? 500 : 400, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
      {label}
      {n !== undefined ? <span style={{ fontSize: 11, color: "#b3b3b3" }}>{n}</span> : null}
    </button>
  );
  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{t("项目", "Projects")}</h1>
        <span style={{ fontSize: 13, color: "#999999" }}>{t("一条片就是一个项目：对话、脚本、素材、成片都在里面。", "One video, one project: its chat, script, clips and cut, together.")}</span>
        <span style={{ flexGrow: 1 }} />
        <NewProjectButton zh={zh} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 11px", border: "1px solid #e2e2e2", borderRadius: 10, background: "#fff", minWidth: 240, flexGrow: 1, maxWidth: 360 }}>
          <Icon name="eye" size={13} color="#b3b3b3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索项目…", "Search projects…")} style={{ border: 0, outline: "none", fontFamily: "inherit", fontSize: 13, flexGrow: 1, minWidth: 0, background: "transparent" }} />
        </label>
        <nav style={{ display: "flex", gap: 2, padding: 2, borderRadius: 10, background: "#ededeb" }}>
          {seg("active", status, setStatus, t("进行中", "In progress"), count("active"))}
          {seg("done", status, setStatus, t("已交付", "Delivered"), count("done"))}
          {seg("archived", status, setStatus, t("归档", "Archived"), count("archived"))}
          {seg("all", status, setStatus, t("全部", "All"), count("all"))}
        </nav>
        <nav style={{ display: "flex", gap: 2, padding: 2, borderRadius: 10, background: "#ededeb" }}>
          {seg("all", whose, setWhose, t("所有人的", "Everyone's"))}
          {seg("mine", whose, setWhose, t("我发起的", "Mine"))}
          {seg("shared", whose, setWhose, t("别人发起的", "Others'"))}
        </nav>
      </div>
      {shown.length === 0 ? (
        <div style={{ marginTop: 40, textAlign: "center", color: "#999999", fontSize: 13.5 }}>
          {rows.length === 0 ? t("还没有项目。点右上角新建，或在首页交代一件事。", "No projects yet. Start one above, or give the team a task on Home.") : t("没有符合的项目。", "No project matches.")}
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
          {shown.map((r) => (
            <Link key={r.id} href={`/projects/${r.id}`} style={{ display: "block", background: "#fff", border: "1px solid #e2e2e2", borderRadius: 14, padding: "14px 16px", textDecoration: "none", color: "#171717", opacity: r.status === "archived" ? 0.65 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: r.status === "done" ? "#278f5e" : r.status === "archived" ? "#d9d9d9" : "#0f5bd5" }} />
                <span style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>{r.title}</span>
                <Icon name={r.access === "everyone" ? "eye" : "lock"} size={12} color="#b3b3b3" />
              </div>
              <div style={{ fontSize: 12, color: "#999999", marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span>{r.status === "done" ? t("已交付", "Delivered") : r.status === "archived" ? t("已归档", "Archived") : t("进行中", "In progress")}</span>
                <span>·</span>
                <span>{r.mode.startsWith("direct:") ? t("直接交代", "Direct") : t("完整流程", "Full line")}</span>
                <span>·</span>
                <span>{r.mine ? t("我发起", "Mine") : t("共享", "Shared")}</span>
                <span style={{ flexGrow: 1 }} />
                <span>{new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" }).format(new Date(r.updatedAt))}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
