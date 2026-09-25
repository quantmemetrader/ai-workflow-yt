import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * The strip across the top of a project's script or editor, so opening
 * either never feels like leaving the project: its name, back to it, and
 * the project's three places as tabs.
 *
 * Every link is `prefetch={false}`: the three places are the heaviest pages
 * in the app (the project board, the script editor, the cutting desk), and
 * the bar is drawn on two of them, so a prefetch would load the other two on
 * every visit.
 */
export function ProjectBar({
  project,
  active,
  zh,
}: {
  project: { id: string; title: string; scriptId: string | null; videoProjectId: string | null };
  active: "overview" | "script" | "editor";
  zh: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const tab = (key: typeof active, href: string | null, label: string, icon: IconName) =>
    href ? (
      <Link
        key={key}
        href={href}
        prefetch={false}
        aria-current={active === key ? "page" : undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px", borderRadius: 8, fontSize: 12.5, textDecoration: "none", color: active === key ? "#171717" : "#7c7c7c", background: active === key ? "#fff" : "transparent", boxShadow: active === key ? "0 1px 2px rgba(0,0,0,.08)" : "none", fontWeight: active === key ? 500 : 400 }}
      >
        <Icon name={icon} size={13} />
        {label}
      </Link>
    ) : null;
  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "6px 16px", borderBottom: "1px solid #ededed", background: "#f7f7f5" }}>
      <Link href={`/projects/${project.id}`} prefetch={false} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#525252", textDecoration: "none", minWidth: 0 }}>
        <span style={{ fontSize: 11, color: "#999999", whiteSpace: "nowrap" }}>{t("项目", "Project")}</span>
        <span style={{ fontWeight: 600, color: "#171717", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>{project.title}</span>
      </Link>
      <span style={{ flexGrow: 1 }} />
      <nav style={{ display: "flex", gap: 2, padding: 2, borderRadius: 10, background: "#ededeb" }}>
        {tab("overview", `/projects/${project.id}`, t("概览与对话", "Overview & chat"), "chat")}
        {tab("script", project.scriptId ? `/script/${project.scriptId}` : null, t("脚本", "Script"), "pen")}
        {tab("editor", project.videoProjectId ? `/video?project=${project.videoProjectId}` : null, t("剪辑台", "Editor"), "film")}
      </nav>
    </div>
  );
}
