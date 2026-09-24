import Link from "next/link";
import { requireModule } from "@/lib/auth/dal";
import { listWorkProjects } from "@/lib/projects/service";
import { NewProjectButton } from "@/components/projects/NewProjectButton";

export const metadata = { title: "项目 · Projects" };

/** Every project, newest activity first. */
export default async function ProjectsPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await listWorkProjects(viewer, 100);
  const t = (a: string, b: string) => (zh ? a : b);
  return (
    <div style={{ flexGrow: 1, minWidth: 0, overflowY: "auto", backgroundColor: "#f4f3f0", backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{t("项目", "Projects")}</h1>
          <span style={{ fontSize: 13, color: "#999999" }}>{t("一条片就是一个项目：对话、脚本、素材、成片都在里面。", "One video, one project: its chat, script, clips and cut, together.")}</span>
          <span style={{ flexGrow: 1 }} />
          <NewProjectButton zh={zh} />
        </div>
        {rows.length === 0 ? (
          <div style={{ marginTop: 40, textAlign: "center", color: "#999999", fontSize: 13.5 }}>{t("还没有项目。点右上角新建，或在首页交代一件事。", "No projects yet. Start one above, or give the team a task on Home.")}</div>
        ) : (
          <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {rows.map((r) => (
              <Link key={r.id} href={`/projects/${r.id}`} style={{ display: "block", background: "#fff", border: "1px solid #e2e2e2", borderRadius: 14, padding: "14px 16px", textDecoration: "none", color: "#171717" }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "#999999", marginTop: 6 }}>
                  {r.status === "done" ? t("已交付", "Delivered") : r.status === "archived" ? t("已归档", "Archived") : t("进行中", "In progress")} ·{" "}
                  {r.mode.startsWith("direct:") ? t("直接交代", "Direct") : t("完整流程", "Full line")} · {new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Hong_Kong" }).format(new Date(r.updatedAt))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
