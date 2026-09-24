"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/** Which project the board shows, and the way back into it. */
export function FlowProjectPicker({ zh, projects, current }: { zh: boolean; projects: { id: string; title: string }[]; current: string | null }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  return (
    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "8px 18px", borderBottom: "1px solid #ededed", background: "#f7f7f5" }}>
      <Icon name="film" size={14} color="#7c7c7c" />
      <span style={{ fontSize: 12, color: "#999999" }}>{t("项目", "Project")}</span>
      <select value={current ?? ""} onChange={(e) => router.push(`/flow?project=${e.target.value}`)} style={{ height: 30, padding: "0 10px", border: "1px solid #e2e2e2", borderRadius: 8, background: "#fff", fontFamily: "inherit", fontSize: 12.5, minWidth: 240, maxWidth: 420 }}>
        {projects.length === 0 ? <option value="">{t("还没有项目", "No projects yet")}</option> : null}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <span style={{ flexGrow: 1 }} />
      {current ? (
        <Link href={`/projects/${current}`} style={{ fontSize: 12.5, color: "#171717", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {t("打开这个项目", "Open this project")} <Icon name="external" size={12} />
        </Link>
      ) : null}
    </div>
  );
}
